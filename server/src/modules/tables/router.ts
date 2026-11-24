import {randomUUID} from 'node:crypto';
import {allowsClientOrigin} from '../../config.js';
import {Router,type Request,type Response} from 'express';
import {rateLimit} from 'express-rate-limit';
import {z} from 'zod';
import {tableCreate,tableEdit,tableSectionInput,entryPublish,entryVersion,sessionOpen,qrLookup,guestJoin,guestRequest,entrySecret,checkoutRequestSchema,billSessionInput,settlementInput,reopenSettledInput} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import type {Config} from '../../config.js';
import {HttpError,type Identity} from '../auth/session.js';
import {tokenHash,equalToken,csrfFor} from '../auth/crypto.js';
import {resolveEntryScope} from './scope.js';
import {tableRepository,txOptions,requestBill} from './repository.js';
import {submitCheckout} from './checkout.js';
import {lookupQr,requestGuest,joinGuest,currentGuest,leaveGuest,resumeGuestCart,lockGuestTable,invalidGuest,listGuestOrders} from './guest.js';
import type {NotifyBranchOrders} from '../../realtime.js';
import {spokenTable} from './announcements.js';
export function tableRouter(db:Database,config:Config,portal:'restaurant'|'staff',notify?:NotifyBranchOrders){
 const router=Router();
 router.use(async(req,res,next)=>{
  const identity=res.locals.identity as Identity;
  const scope=await resolveEntryScope(db,identity.user.id,req.query);
  if((scope.role==='RESTAURANT_ADMIN') !== (portal==='restaurant')){
   throw new HttpError(403,'FORBIDDEN','Use your assigned table workspace.');
  }
  res.locals.tables=tableRepository(db,config,scope);
  if(notify&&config.CHECKOUT_PILOT_ENABLED&&req.method==='POST'&&/\/(open|reopen-settled|close|settle|bill|bill\/resume|pin|qr|qr\/revoke)$/.test(req.path)){
   const table=z.uuid().safeParse(req.path.split('/')[1]);
   const tableId=table.success?table.data:undefined;
   res.once('finish',()=>{if(res.statusCode<300)notify(scope,undefined,tableId);});
  }
  next();
 });
 const repo=(res:Response)=>res.locals.tables as ReturnType<typeof tableRepository>;
 router.post('/:id/settle',async(req,res)=>res.json(await repo(res).settle(z.uuid().parse(req.params.id),settlementInput.parse(req.body))));
 for(const resume of [false,true])router.post('/:id/bill'+(resume?'/resume':''),async(req,res)=>res.json(await repo(res).billing(z.uuid().parse(req.params.id),billSessionInput.parse(req.body),resume)));
 router.post('/:id/assistance/resolve',async(req,res)=>res.json(await repo(res).resolveAssistance(z.uuid().parse(req.params.id),entryVersion.parse(req.body).version)));
 router.get('/',async(_req,res)=>res.json(await repo(res).board()));
 router.post('/',async(req,res)=>res.status(201).json(await repo(res).create(tableCreate.parse(req.body))));
 router.put('/publication',async(req,res)=>res.json(await repo(res).publish(entryPublish.parse(req.body))));
 router.put('/section',async(req,res)=>res.json(await repo(res).moveSection(tableSectionInput.parse(req.body))));
 router.put('/:id',async(req,res)=>res.json(await repo(res).edit(z.uuid().parse(req.params.id),tableEdit.parse(req.body))));
 for(const [path,rotate] of [['qr',true],['qr/revoke',false]] as const)router.post('/:id/'+path,async(req,res)=>res.json(await repo(res).qr(z.uuid().parse(req.params.id),entryVersion.parse(req.body).version,rotate)));
 router.post('/:id/reopen-settled',async(req,res)=>{
  const {settledSessionId,version,durationMinutes}=reopenSettledInput.parse(req.body);
  res.json(await repo(res).open(z.uuid().parse(req.params.id),{version,durationMinutes},settledSessionId));
 });
 router.post('/:id/open',async(req,res)=>res.json(await repo(res).open(z.uuid().parse(req.params.id),sessionOpen.parse(req.body))));
 for(const operation of ['close','pin'] as const)router.post('/:id/'+operation,async(req,res)=>res.json(await repo(res).session(z.uuid().parse(req.params.id),entryVersion.parse(req.body).version,operation)));
 return router;}
const name=(config:Config)=>config.NODE_ENV==='production'?'__Host-restrodock_guest':'restrodock_guest';
function guestToken(req:Request,config:Config){const values=(req.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(name(config)+'='));const result=values.length===1?values[0]!.slice(name(config).length+1):'';if(!entrySecret.safeParse(result).success)throw new HttpError(401,'GUEST_AUTH_REQUIRED','Scan a current table QR and start a guest session.');return result;}
export function publicEntryRouter(db:Database|null,config:Config,notify?:NotifyBranchOrders){const router=Router(),database=()=>{if(!db)throw new HttpError(503,'DATABASE_UNAVAILABLE','Table entry is unavailable until the restaurant database is configured.');return db;};
 router.use((req,_res,next)=>{if(!allowsClientOrigin(config,req.headers.origin)||!req.is('application/json'))throw new HttpError(403,'CSRF_DENIED','Use the configured RestroDock page to submit table entry.');next();});
 if(config.CHECKOUT_PILOT_ENABLED)router.post('/guest/order-status',
  rateLimit({windowMs:60000,limit:12,keyGenerator:req=>tokenHash(guestToken(req,config)),standardHeaders:'draft-8',legacyHeaders:false}),
  async(req,res)=>{
   z.object({}).strict().parse(req.body);
   const secret=guestToken(req,config);
   if(!equalToken(req.get('x-csrf-token')??'',csrfFor(secret)))throw new HttpError(403,'CSRF_DENIED','Refresh your guest entry before tracking orders.');
   res.json(await listGuestOrders(database(),secret));
  });
 router.use(rateLimit({windowMs:15*60000,limit:120,keyGenerator:req=>(req.path==='/guest/cart-context'||(config.CHECKOUT_PILOT_ENABLED&&['/guest/orders','/guest/assistance','/guest/bill'].includes(req.path)))?tokenHash('cart:'+guestToken(req,config)):tokenHash(entrySecret.safeParse(req.body?.qrToken).success?`entry:${req.body.qrToken}`:'entry:invalid'),standardHeaders:'draft-8',legacyHeaders:false,message:{error:{code:'ENTRY_RATE_LIMITED',message:'Too many table entry requests. Wait before trying again.'}}}));
 router.post('/table-entry/lookup',async(req,res)=>res.json(await lookupQr(database(),qrLookup.parse(req.body).qrToken,config.CHECKOUT_PILOT_ENABLED)));
 if(config.CHECKOUT_PILOT_ENABLED)router.post('/table-entry/request',async(req,res)=>{
  const input=guestRequest.parse(req.body),result=await requestGuest(database(),config,input);
  res.cookie(name(config),input.guestSecret,{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:Math.max(0,new Date(result.expiresAt).getTime()-Date.now())});
  res.json(result);
 });
 router.post('/table-entry/join',async(req,res)=>{const input=guestJoin.parse(req.body),result=await joinGuest(database(),config,input);res.cookie(name(config),input.guestSecret,{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:'/',maxAge:Math.max(0,new Date(result.expiresAt).getTime()-Date.now())});res.json(result);});
 router.post('/guest/session',async(req,res)=>res.json(await currentGuest(database(),guestToken(req,config),qrLookup.parse(req.body).qrToken,config.CHECKOUT_PILOT_ENABLED)));
 router.post('/guest/cart-context',async(req,res)=>{
  z.object({}).strict().parse(req.body);
  res.json(await resumeGuestCart(database(),guestToken(req,config),config.CHECKOUT_PILOT_ENABLED));
 });
 if(config.CHECKOUT_PILOT_ENABLED)router.post('/guest/assistance',async(req,res)=>{
  const secret=guestToken(req,config);
  if(!equalToken(req.get('x-csrf-token')??'',csrfFor(secret)))throw new HttpError(403,'CSRF_DENIED','Refresh your guest entry before requesting help.');
  z.object({}).strict().parse(req.body);
  const saved=await database().$transaction(async tx=>{
   const scope=await lockGuestTable(tx,secret,true);
   if(!scope?.guest.diningSession.checkoutPilot||scope.table.archived||(scope.guest.requiresWaiterConfirmation&&!scope.guest.waiterConfirmedAt))return false;
   const {owned,guest,table}=scope;
   if(!await tx.branch.count({where:{...{id:owned.branchId,tenantId:owned.tenantId},tableEntryPublished:true,tenant:{status:{not:'SUSPENDED'}}}}))return false;
   if(!await tx.branchSettings.count({where:{branchId:owned.branchId,tenantId:owned.tenantId,assistanceEnabled:true}}))throw new HttpError(409,'ASSISTANCE_DISABLED','This branch has turned off requests for staff help.');
   const requestedAt=new Date();
   const updated=await tx.diningSession.updateMany({
    where:{...owned,id:guest.diningSessionId,assistanceRequestedAt:null},
    data:{assistanceRequestedAt:requestedAt,version:{increment:1}},
   });
   return {owned,updated:updated.count,label:table.label};
  },txOptions);
  if(!saved)throw invalidGuest();
  if(saved.updated)notify?.(saved.owned,{id:'help:'+randomUUID(),kind:'assistance',text:spokenTable(saved.label)+' को वेटर की ज़रूरत है।'});
  res.json({saved:true});
 });
 if(config.CHECKOUT_PILOT_ENABLED)router.post('/guest/bill',async(req,res)=>{
  const secret=guestToken(req,config);
  if(!equalToken(req.get('x-csrf-token')??'',csrfFor(secret)))throw new HttpError(403,'CSRF_DENIED','Refresh your guest entry before requesting a bill.');
  z.object({}).strict().parse(req.body);
  const result=await database().$transaction(async tx=>{
   const scope=await lockGuestTable(tx,secret,true);
   if(!scope?.guest.diningSession.checkoutPilot||scope.table.archived||(scope.guest.requiresWaiterConfirmation&&!scope.guest.waiterConfirmedAt))return null;
   const {owned,guest}=scope;
   if(!await tx.branch.count({where:{id:owned.branchId,tenantId:owned.tenantId,tableEntryPublished:true,tenant:{status:{not:'SUSPENDED'}}}}))return null;
   if(await requestBill(tx,owned,guest.diningSessionId))await tx.auditEvent.create({data:{...owned,actorReference:'GUEST',action:'BILL_REQUESTED',resourceReference:guest.diningSessionId}});
   return owned;
  },txOptions);
  if(!result)throw invalidGuest();
  notify?.(result);
  res.json({saved:true});
 });
 if(config.CHECKOUT_PILOT_ENABLED)router.post('/guest/orders',async(req,res)=>{
  const secret=guestToken(req,config);
  if(!equalToken(req.get('x-csrf-token')??'',csrfFor(secret)))throw new HttpError(403,'CSRF_DENIED','Refresh your guest entry before submitting.');
  const result=await submitCheckout(database(),secret,checkoutRequestSchema.parse(req.body));
  if(!result.replayed&&result.branch)notify?.(result.branch,result.announcement);
  res.status(result.replayed?200:201).json(result.receipt);
 });
 router.post('/guest/leave',async(req,res)=>{const secret=guestToken(req,config);z.object({}).strict().parse(req.body);if(!equalToken(req.get('x-csrf-token')??'',csrfFor(secret)))throw new HttpError(403,'CSRF_DENIED','Refresh your guest entry before leaving.');const result=await leaveGuest(database(),secret);res.clearCookie(name(config),{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:'/'});res.json(result);});return router;}
