import {allowsClientOrigin} from './config.js';
import type {Server as HttpServer} from 'node:http';
import {z} from 'zod';
import {Server,type Socket} from 'socket.io';
import {entrySelection,qrLookup} from '@restrodock/contracts';
import type {Config} from './config.js';
import type {Database} from './db.js';
import {authenticate,HttpError} from './modules/auth/session.js';
import {resolveEntryScope,type EntryScope} from './modules/tables/scope.js';

import {qrRecord} from './modules/tables/guest.js';
import type {ServiceAnnouncement} from './modules/tables/announcements.js';

type Branch=Pick<EntryScope,'tenantId'|'branchId'>;
export type NotifyBranchOrders=(branch:Branch,announcement?:ServiceAnnouncement,tableId?:string)=>void;
const room=({tenantId,branchId}:Branch)=>'branch-orders:'+tenantId+':'+branchId;

const tableRoom=(tableId:string)=>'table-entry:'+tableId;

export function createRealtime(server:HttpServer,config:Config,db:Database|null){
 const io=new Server(server,{
  transports:['websocket'],maxHttpBufferSize:4096,
  allowRequest:(req,done)=>done(null,allowsClientOrigin(config,req.headers.origin)),
 });
 async function authorize(socket:Socket){
  if(!db||!config.CHECKOUT_PILOT_ENABLED)throw new HttpError(401,'AUTH_REQUIRED','Order review live updates are unavailable.');
  const {kitchen,tableService,...selection}=entrySelection.extend({kitchen:z.literal(true).optional(),tableService:z.literal(true).optional()}).parse(socket.handshake.auth);
  if(kitchen&&tableService)throw new HttpError(403,'FORBIDDEN','Select one workspace.');
  const identity=await authenticate(db,socket.request,config);
  const scope=await resolveEntryScope(db,identity.user.id,selection,kitchen);
  if(!kitchen&&!tableService&&scope.role!=='MANAGER'&&scope.role!=='RESTAURANT_ADMIN'&&scope.role!=='WORKER')throw new HttpError(403,'FORBIDDEN','Order review access required.');
  return scope;
 }
 io.use(async(socket,next)=>{
  try{
   if('qrToken' in socket.handshake.auth){
    if(!db||!config.CHECKOUT_PILOT_ENABLED)throw new Error('Unavailable');
    const {qrToken}=qrLookup.parse(socket.handshake.auth);
    const qr=await qrRecord(db,qrToken);
    if((io.sockets.adapter.rooms.get(tableRoom(qr.tableId))?.size??0)>=32)throw new Error('Unavailable');
    socket.data.guestTableRoom=tableRoom(qr.tableId);
   }else{
    const scope=await authorize(socket);
    socket.data.branchOrderRoom=room(scope);
   }
   next();
  }
  catch{next(new Error('AUTH_REQUIRED'));}
 });
 io.on('connection',socket=>void socket.join(socket.data.guestTableRoom??socket.data.branchOrderRoom));
 const notify:NotifyBranchOrders=(branch,announcement,tableId)=>{
  if(tableId&&db){
   const roomName=tableRoom(tableId);
   for(const id of io.sockets.adapter.rooms.get(roomName)??[]){
    const socket=io.sockets.sockets.get(id);
    if(!socket)continue;
    void qrRecord(db,socket.handshake.auth.qrToken).then(qr=>{
     if(socket.connected&&qr.tableId===tableId&&qr.tenantId===branch.tenantId&&qr.branchId===branch.branchId){
      socket.emit('table-entry:changed',{version:1});
     }
    },()=>socket.disconnect(true));
   }
  }
  const target=room(branch);
  for(const id of io.sockets.adapter.rooms.get(target)??[]){
   const socket=io.sockets.sockets.get(id);
   if(!socket)continue;
   void authorize(socket).then(scope=>{
    if(!socket.connected||room(scope)!==target)return;
    socket.emit('branch-orders:changed',{version:1});
    if(!announcement)return;
    const {kitchen,tableService}=socket.handshake.auth;
    if(announcement.kind==='new-order'?scope.role==='CHEF'&&kitchen===true:
     scope.role==='WORKER'&&(announcement.kind==='confirmation'||kitchen===true||tableService===true)){
     socket.emit('service:announcement',announcement);
    }
   },()=>socket.disconnect(true));
  }
 };
 return {io,notify};
}
