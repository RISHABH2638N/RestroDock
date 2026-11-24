import {Router,type Response} from 'express';
import type {Prisma} from '@prisma/client';
import {z} from 'zod';
import {checkoutIntakeInput,orderDecisionInput,type CheckoutIntakeInput,type OrderDecision,type ReviewOrder} from '@restrodock/contracts';
import type {Config} from '../../config.js';
import type {Database} from '../../db.js';
import {HttpError,type Identity} from '../auth/session.js';
import {lockIntake} from './intake.js';
import {lockTable,txOptions} from './repository.js';
import {requireEntryScope,resolveEntryScope,type EntryScope} from './scope.js';

import {newOrderAnnouncement} from './announcements.js';

export const reviewSelect={
 id:true,version:true,status:true,createdAt:true,estimatedTotalMinor:true,riskSignals:true,reviewReason:true,reviewedAt:true,
 guestSession:{select:{displayName:true,requiresWaiterConfirmation:true,waiterConfirmedAt:true}},
 diningSession:{select:{table:{select:{label:true}}}},
 items:{orderBy:{id:'asc'},select:{nameSnapshot:true,quantity:true,portionNameSnapshot:true,addOnSnapshots:true,preparationNote:true}},
} as const satisfies Prisma.OrderSelect;
const addOnsSchema=z.array(z.object({name:z.string()}));

export const ticketItems=(items:Prisma.OrderGetPayload<{select:typeof reviewSelect}>['items'])=>items.map(item=>({
   name:item.nameSnapshot,quantity:item.quantity,portion:item.portionNameSnapshot,note:item.preparationNote,
   addOns:addOnsSchema.parse(item.addOnSnapshots).map(addOn=>addOn.name),
  }));

function reviewView(row:Prisma.OrderGetPayload<{select:typeof reviewSelect}>):ReviewOrder{
 const {status}=row;
 if(status!=='AWAITING_REVIEW'&&status!=='PLACED'&&status!=='REJECTED'&&status!=='CANCELLED'&&status!=='ACCEPTED'&&status!=='PREPARING'&&status!=='READY'&&status!=='SERVED')throw new Error('Unexpected review state.');
 return {
  awaitingWaiter:row.guestSession.requiresWaiterConfirmation&&!row.guestSession.waiterConfirmedAt,
  guestName:row.guestSession.displayName,
  id:row.id,version:row.version,status,createdAt:row.createdAt.toISOString(),tableLabel:row.diningSession.table.label,
  estimatedTotalMinor:row.estimatedTotalMinor,riskSignals:row.riskSignals,reviewReason:row.reviewReason,
  reviewedAt:row.reviewedAt?.toISOString()??null,
  items:ticketItems(row.items),
 };
}

const stale=()=>new HttpError(409,'REVIEW_CHANGED','The order or intake setting changed. Refresh the review board before retrying.');

function reviewRepository(db:Database,scope:EntryScope){
 requireEntryScope(scope);
 if(!['MANAGER','RESTAURANT_ADMIN','WORKER'].includes(scope.role))throw new HttpError(403,'ORDER_REVIEW_FORBIDDEN','Order review requires an assigned Manager or Restaurant Admin.');
 const owned={tenantId:scope.tenantId,branchId:scope.branchId};
 const firstOrderGuest={requiresWaiterConfirmation:true,waiterConfirmedAt:null,revokedAt:null,expiresAt:{gt:new Date()},createdAt:{gt:new Date(Date.now()-10*60000)}};
 const pilot={...owned,diningSession:{checkoutPilot:true},...(scope.role==='WORKER'?{guestSession:firstOrderGuest}:{})};
 const audit=(tx:Prisma.TransactionClient,action:string,id:string)=>tx.auditEvent.create({
  data:{...owned,actorReference:scope.userId,action,resourceReference:id},
 });
 return {
  async board(){
   const [intake,pending,recent]=await Promise.all([
    db.checkoutIntake.findUnique({where:{tenantId_branchId:owned},select:{paused:true,version:true}}),
    db.order.findMany({
     where:{...pilot,status:'AWAITING_REVIEW',diningSession:{...pilot.diningSession,state:'OPEN',expiresAt:{gt:new Date()}}},
     orderBy:[{createdAt:'asc'},{id:'asc'}],take:51,select:reviewSelect,
    }),
    db.order.findMany({
     where:{...pilot,status:{in:['PLACED','REJECTED','CANCELLED','ACCEPTED','PREPARING','READY','SERVED']},reviewedAt:{not:null}},
     orderBy:[{reviewedAt:'desc'},{id:'desc'}],take:15,select:reviewSelect,
    }),
   ]);
   return {intake:intake??{paused:false,version:1},pending:pending.slice(0,50).map(reviewView),hasMore:pending.length>50,recent:recent.map(reviewView)};
  },
  async setIntake(input:CheckoutIntakeInput){
   if(scope.role==='WORKER')throw new HttpError(403,'ORDER_REVIEW_FORBIDDEN','Only a manager or restaurant admin can pause ordering.');
   return db.$transaction(async tx=>{
    const intake=await lockIntake(tx,owned);
    if(intake.version!==input.version)throw stale();
    if(intake.paused===input.paused)return intake;
    const saved=await tx.checkoutIntake.update({
     where:{tenantId_branchId:owned},data:{paused:input.paused,version:{increment:1}},select:{paused:true,version:true},
    });
    await audit(tx,input.paused?'CHECKOUT_INTAKE_PAUSED':'CHECKOUT_INTAKE_RESUMED',scope.branchId);
    return saved;
   },txOptions);
  },
  async decide(id:string,input:OrderDecision){
   return db.$transaction(async tx=>{
    const target=await tx.order.findFirst({where:{...pilot,id},select:{diningSession:{select:{tableId:true}}}});
    if(!target)throw new HttpError(404,'ORDER_NOT_FOUND','Order not found in this branch.');
    await lockTable(tx,owned,target.diningSession.tableId);
    await tx.$queryRaw`SELECT g.id FROM "GuestSession" g JOIN "Order" o ON o."guestSessionId"=g.id
     WHERE o.id=${id}::uuid AND o."tenantId"=${owned.tenantId}::uuid AND o."branchId"=${owned.branchId}::uuid FOR UPDATE OF g`;
    const order=await tx.order.findFirstOrThrow({
     where:{...owned,id},
     select:{version:true,status:true,riskSignals:true,guestSessionId:true,diningSessionId:true,guestSession:{select:{requiresWaiterConfirmation:true,waiterConfirmedAt:true,revokedAt:true,expiresAt:true,createdAt:true}},diningSession:{select:{state:true,expiresAt:true}}},
    });
    if(order.version!==input.version||order.status!=='AWAITING_REVIEW')throw stale();
    if(order.diningSession.state!=='OPEN'||order.diningSession.expiresAt<=new Date()){
     throw new HttpError(409,'REVIEW_SESSION_CLOSED','This table session ended. Refresh the review board.');
    }
    if(order.guestSession.requiresWaiterConfirmation&&!await tx.branch.count({where:{id:owned.branchId,tenantId:owned.tenantId,active:true,tableEntryPublished:true,tenant:{status:{in:['TRIAL','ACTIVE']}}}}))throw new HttpError(409,'CHECKOUT_UNAVAILABLE','This restaurant is unavailable.');
    const needsWaiter=order.guestSession.requiresWaiterConfirmation&&!order.guestSession.waiterConfirmedAt;
    if(needsWaiter&&(order.guestSession.revokedAt||order.guestSession.expiresAt<=new Date()||order.guestSession.createdAt.getTime()<Date.now()-10*60000))throw new HttpError(409,'REVIEW_SESSION_CLOSED','This guest request expired. Ask the customer to start again.');
    if(scope.role==='WORKER'&&!needsWaiter)throw new HttpError(403,'ORDER_REVIEW_FORBIDDEN','A manager must review this order.');
    const flagged=order.riskSignals.length>0;
    if(input.decision==='APPROVE'&&flagged&&scope.role!=='WORKER'&&!input.override){
     throw new HttpError(409,'REVIEW_OVERRIDE_REQUIRED','Confirm that you verified this flagged order with the table before approving it.');
    }
    const approved=input.decision==='APPROVE';
    if(needsWaiter&&approved){
     const owner=await tx.guestSession.count({where:{...owned,diningSessionId:order.diningSessionId,id:{not:order.guestSessionId},OR:[{requiresWaiterConfirmation:false,revokedAt:null},{requiresWaiterConfirmation:true,waiterConfirmedAt:{not:null}}]}});
     if(owner)throw new HttpError(409,'TABLE_OCCUPIED','A different guest has already been approved for this table.');
     await tx.guestSession.update({where:{id:order.guestSessionId},data:{waiterConfirmedAt:new Date(),expiresAt:order.diningSession.expiresAt}});
     await tx.order.updateMany({where:{...owned,diningSessionId:order.diningSessionId,guestSessionId:{not:order.guestSessionId},status:'AWAITING_REVIEW',guestSession:{requiresWaiterConfirmation:true,waiterConfirmedAt:null}},
      data:{status:'REJECTED',reviewReason:'UNVERIFIED',reviewedAt:new Date(),version:{increment:1}}});
    }
    const needsManager=approved&&flagged&&scope.role==='WORKER';
    const saved=await tx.order.updateMany({
     where:{...owned,id,status:'AWAITING_REVIEW',version:input.version},
     data:{
      status:needsManager?'AWAITING_REVIEW':approved?'PLACED':'REJECTED',
      reviewReason:needsManager?null:input.decision==='APPROVE'?'VERIFIED_AT_TABLE':input.reason,
      reviewedAt:needsManager?null:new Date(),version:{increment:1},
     },
    });
    if(saved.count!==1)throw stale();
    await audit(tx,needsManager?'WAITER_TABLE_CONFIRMED_MANAGER_REVIEW_REQUIRED':approved?(flagged?'CHECKOUT_RISK_OVERRIDDEN':'CHECKOUT_ORDER_APPROVED'):'CHECKOUT_ORDER_REJECTED',id);
    return reviewView(await tx.order.findFirstOrThrow({where:{...owned,id},select:reviewSelect}));
   },txOptions);
  },
 };
}

import type {NotifyBranchOrders} from '../../realtime.js';
export function orderReviewRouter(db:Database,config:Config,role:'MANAGER'|'RESTAURANT_ADMIN'|'STAFF',notify?:NotifyBranchOrders){
 const router=Router();
 const repo=(res:Response)=>res.locals.review as ReturnType<typeof reviewRepository>;
 router.use(async(req,res,next)=>{
  const identity=res.locals.identity as Identity;
  const scope=await resolveEntryScope(db,identity.user.id,req.query);
  if(role==='STAFF'?!['MANAGER','WORKER'].includes(scope.role):scope.role!==role)throw new HttpError(403,'ORDER_REVIEW_FORBIDDEN','This workspace requires an assigned '+(role==='MANAGER'?'Manager.':'Restaurant Admin.'));
  if(!config.CHECKOUT_PILOT_ENABLED)throw new HttpError(409,'ORDER_REVIEW_DISABLED','Order review is available in the development checkout pilot.');
  res.locals.reviewScope=scope;
  res.locals.review=reviewRepository(db,scope);
  if(notify&&req.method==='PUT')res.once('finish',()=>{if(res.statusCode<300)notify(scope);});
  next();
 });
 router.get('/',async(_req,res)=>res.json(await repo(res).board()));
 router.put('/intake',async(req,res)=>res.json(await repo(res).setIntake(checkoutIntakeInput.parse(req.body))));
 router.post('/:id/decision',async(req,res)=>{
  const order=await repo(res).decide(z.uuid().parse(req.params.id),orderDecisionInput.parse(req.body));
  const scope=res.locals.reviewScope as EntryScope;
  const saved=await db.order.findFirstOrThrow({where:{tenantId:scope.tenantId,branchId:scope.branchId,id:order.id},select:{diningSession:{select:{tableId:true}}}});
  notify?.(scope,order.status==='PLACED'?newOrderAnnouncement(order.id,order.tableLabel,order.items):undefined,saved.diningSession.tableId);
  res.json(order);
 });
 return router;
}
