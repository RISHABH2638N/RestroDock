import {Router} from 'express';
import {z} from 'zod';
import {kitchenAction,kitchenTicketSchema} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import type {Config} from '../../config.js';
import type {NotifyBranchOrders} from '../../realtime.js';
import {HttpError,type Identity} from '../auth/session.js';
import {resolveEntryScope,type EntryScope} from './scope.js';
import {lockTable,txOptions} from './repository.js';
import {reviewSelect,ticketItems} from './review.js';

const dispatchReasons=['VERIFIED_AT_TABLE','AUTO_DISPATCHED'] as const;
const ticketSelect={
 id:true,version:true,status:true,createdAt:true,reviewedAt:true,kitchenNote:true,kitchenUpdatedAt:true,
 items:reviewSelect.items,diningSession:{select:{state:true,expiresAt:true,tableId:true,table:{select:{label:true}}}},
} as const;
import {spokenTable} from './announcements.js';
const transitions={
 ACCEPT:['PLACED','ACCEPTED'],REJECT:['PLACED','REJECTED'],PREPARE:['ACCEPTED','PREPARING'],
 READY:['PREPARING','READY'],SERVE:['READY','SERVED'],
} as const;

export function kitchenRouter(db:Database,config:Config,notify?:NotifyBranchOrders){
 const router=Router();
 router.use(async(req,res,next)=>{
  if(!config.CHECKOUT_PILOT_ENABLED)throw new HttpError(409,'KITCHEN_DISABLED','Kitchen operations are available in the development checkout pilot.');
  const identity=res.locals.identity as Identity;
  res.locals.kitchen=await resolveEntryScope(db,identity.user.id,req.query,true);
  next();
 });
 router.get('/',async(_req,res)=>{
  const {tenantId,branchId,role}=res.locals.kitchen as EntryScope;
  const now=new Date();
  const rows=await db.order.findMany({
   where:{tenantId,branchId,diningSession:{checkoutPilot:true},guestSession:{OR:[{requiresWaiterConfirmation:false},{waiterConfirmedAt:{not:null}}]},AND:[
    {OR:[{status:'AWAITING_REVIEW' as const},{reviewReason:{in:[...dispatchReasons]}}]},
    {OR:[
    {status:'AWAITING_REVIEW' as const,diningSession:{state:'OPEN' as const,expiresAt:{gt:now}}},
    {status:'READY'},
    ...(role==='WORKER'?[]:[
     {status:'PLACED' as const,diningSession:{state:'OPEN' as const,expiresAt:{gt:now}}},
     {status:{in:['ACCEPTED' as const,'PREPARING' as const]}},
    ]),
    {status:{in:role==='WORKER'?['SERVED']:['SERVED','REJECTED']},kitchenUpdatedAt:{gte:new Date(now.getTime()-3600000)}},
   ]}]},
   orderBy:[{createdAt:'asc'},{id:'asc'}],take:101,select:ticketSelect,
  });
  res.json({hasMore:rows.length>100,tickets:rows.slice(0,100).map(row=>kitchenTicketSchema.parse({
   id:row.id,version:row.version,status:row.status,tableLabel:row.diningSession.table.label,
   queuedAt:(row.reviewedAt??row.createdAt).toISOString(),updatedAt:row.kitchenUpdatedAt?.toISOString()??null,
   kitchenNote:row.kitchenNote,items:ticketItems(row.items),
  }))});
 });
 router.post('/:id/action',async(req,res)=>{
  const {tenantId,branchId,role,userId}=res.locals.kitchen as EntryScope;
  const input=kitchenAction.parse(req.body),id=z.uuid().parse(req.params.id);
  if((role==='WORKER'&&input.action!=='SERVE')||(role==='CHEF'&&input.action==='SERVE')){
   throw new HttpError(403,'KITCHEN_ACTION_FORBIDDEN','Your role cannot perform this ticket action.');
  }
  const owned={tenantId,branchId};
  const where={...owned,id,reviewReason:{in:[...dispatchReasons]},diningSession:{checkoutPilot:true}};
  const [from,to]=transitions[input.action];
  const tableLabel=await db.$transaction(async tx=>{
   const target=await tx.order.findFirst({where,select:{diningSession:{select:{tableId:true}}}});
   if(!target)throw new HttpError(404,'TICKET_NOT_FOUND','Kitchen ticket not found in this branch.');
   const table=await lockTable(tx,owned,target.diningSession.tableId);
   const saved=await tx.order.updateMany({
    where:{...where,status:from,version:input.version,...(from==='PLACED'?{
     diningSession:{checkoutPilot:true,state:'OPEN',expiresAt:{gt:new Date()}},
    }:{})},
    data:{status:to,version:{increment:1},kitchenUpdatedAt:new Date(),...(input.note?{kitchenNote:input.note}:{})},
   });
   if(saved.count!==1)throw new HttpError(409,'TICKET_CHANGED','The ticket or table session changed. Refresh the kitchen queue and retry.');
   await tx.auditEvent.create({data:{...owned,actorReference:userId,action:'KITCHEN_'+to,resourceReference:id}});
   return table.label;
  },txOptions);
  notify?.(owned,to==='READY'?{id:'ready:'+id,kind:'ready',text:spokenTable(tableLabel)+' का ऑर्डर तैयार है। कृपया सर्व करें।'}:undefined);
  res.json({saved:true});
 });
 return router;
}
