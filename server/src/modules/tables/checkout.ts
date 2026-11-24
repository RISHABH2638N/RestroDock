import {planEntitlements} from '@restrodock/contracts';
import type {Prisma} from '@prisma/client';
import {priceSelection,type CheckoutRequest,type CheckoutReceipt} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import {tokenHash} from '../auth/crypto.js';
import {HttpError} from '../auth/session.js';
import {invalidGuest,lockGuestTable} from './guest.js';
import {branchBurstLimit,checkoutRisk,intakeWindowMs,lockIntake,tableBurstLimit} from './intake.js';
import {txOptions} from './repository.js';

import {newOrderAnnouncement,spokenTable} from './announcements.js';

const maxOrdersPerGuest=3;
const maxOrdersPerTableSession=10;
const conflict=(code:string,message:string)=>({error:new HttpError(409,code,message)});

function receipt(order:{id:string;estimatedTotalMinor:number;createdAt:Date;reviewReason:string|null}):CheckoutReceipt{
 return {orderId:order.id,status:order.reviewReason==='AUTO_DISPATCHED'?'PLACED':'AWAITING_REVIEW',estimatedTotalMinor:order.estimatedTotalMinor,createdAt:order.createdAt.toISOString()};
}

export async function submitCheckout(db:Database,secret:string,input:CheckoutRequest){
 const requestHash=tokenHash(JSON.stringify(input.lines.map(line=>({
  itemId:line.itemId,variant:line.variant,addons:[...line.addons].sort(),quantity:line.quantity,
  note:line.note,expectedUnitPriceMinor:line.expectedUnitPriceMinor,
 }))));
 const result=await db.$transaction(async tx=>{
  const scope=await lockGuestTable(tx,secret,true);
  if(!scope)return {error:invalidGuest()};
  const {owned,table,guest}=scope;
  if(input.cartId!==guest.id)return {error:invalidGuest()};
  const branch=await tx.branch.findFirstOrThrow({
   where:{tenantId:owned.tenantId,id:owned.branchId},
   include:{tenant:{select:{status:true,subscription:{select:{planCode:true}}}},settings:{select:{maxItemQuantity:true,maxOrderQuantity:true,maxOrderValueMinor:true,approvalQuantity:true,approvalValueMinor:true}}},
  });
  const qr=await tx.qrCode.findFirst({where:{...owned,tableId:table.id,revokedAt:null},select:{id:true}});
  if(!guest.diningSession.checkoutPilot||table.archived||!branch.tableEntryPublished||branch.tenant.status==='SUSPENDED'||!qr){
   return conflict('CHECKOUT_UNAVAILABLE','Checkout is unavailable for this table. Ask restaurant staff.');
  }

  const session={...owned,diningSessionId:guest.diningSessionId};
  const guestOrders={...session,guestSessionId:guest.id};
  const existing=await tx.order.findFirst({where:{...guestOrders,idempotencyKey:input.key}});
  if(existing){
   if(existing.requestHash!==requestHash)return conflict('CHECKOUT_KEY_CONFLICT','This attempt belongs to a different order. Ask staff before submitting again.');
   return {receipt:receipt(existing),replayed:true};
  }
  // Pilot intake has its own pause control. Branch deactivation still stops new orders.
  if(!branch.active||(branch.tenant.status!=='TRIAL'&&branch.tenant.status!=='ACTIVE')){
   return conflict('CHECKOUT_UNAVAILABLE','Checkout is unavailable for this table. Ask restaurant staff.');
  }
  const awaitingWaiter=guest.requiresWaiterConfirmation&&!guest.waiterConfirmedAt;
  if(guest.requiresWaiterConfirmation){
   if(awaitingWaiter&&guest.createdAt.getTime()<Date.now()-10*60000)return conflict('WAITER_REQUEST_EXPIRED','Your confirmation request expired. Ask your waiter to start a new table session.');
   const anotherOwner=await tx.guestSession.count({where:{...owned,diningSessionId:guest.diningSessionId,id:{not:guest.id},
    OR:[{requiresWaiterConfirmation:false,revokedAt:null},{requiresWaiterConfirmation:true,waiterConfirmedAt:{not:null}}]}});
   if(anotherOwner) return conflict('TABLE_OCCUPIED','Another guest has been approved for this table. Ask your waiter.');
   if(awaitingWaiter&&await tx.order.count({where:{...guestOrders,status:'AWAITING_REVIEW'}}))return conflict('WAITER_REVIEW_PENDING','Your first order is waiting for the waiter. Please wait for confirmation.');
  }
  if(guest.diningSession.billRequestedAt)return conflict('BILL_REQUESTED','The bill has been requested. Ask staff to reopen ordering.');
  const billableSession=guest.requiresWaiterConfirmation?{...session,status:{notIn:['REJECTED','CANCELLED'] as ('REJECTED'|'CANCELLED')[]},guestSession:{OR:[{requiresWaiterConfirmation:false},{waiterConfirmedAt:{not:null}}]}}:session;
  if(await tx.order.count({where:guestOrders})>=maxOrdersPerGuest||await tx.order.count({where:billableSession})>=maxOrdersPerTableSession){
   return conflict('CHECKOUT_SESSION_LIMIT','This table session reached its checkout limit. Ask restaurant staff.');
  }

  const quantities=new Map<string,number>();
  let totalQuantity=0;
  for(const line of input.lines){
   quantities.set(line.itemId,(quantities.get(line.itemId)??0)+line.quantity);
   totalQuantity+=line.quantity;
  }
  const itemLimit=branch.settings?.maxItemQuantity??10;
  const orderLimit=branch.settings?.maxOrderQuantity??30;
  if(totalQuantity>orderLimit||[...quantities.values()].some(quantity=>quantity>itemLimit)){
   return conflict('CHECKOUT_QUANTITY_LIMIT',`Reduce the cart to ${itemLimit} of each menu item and ${orderLimit} items total.`);
  }

  const menu=await tx.menuItem.findMany({
   where:{...owned,id:{in:[...quantities.keys()]},currency:'INR',state:'PUBLISHED',reviewRequired:false,category:{archived:false}},
   select:{id:true,name:true,available:true,priceMinor:true,variants:{select:{name:true,priceMinor:true,available:true}},
    addons:{select:{name:true,priceMinor:true,available:true}}},
  });
  const itemsById=new Map(menu.map(item=>[item.id,item]));
  const snapshots:Prisma.OrderItemCreateManyOrderInput[]=[];
  let estimatedTotalMinor=0;
  for(const line of input.lines){
   const item=itemsById.get(line.itemId);
   const pricing=priceSelection(item,line);
   if(!item||!pricing)return conflict('CHECKOUT_MENU_CHANGED','An item or option is unavailable. Refresh the menu and review your cart.');
   if(pricing.unitPriceMinor!==line.expectedUnitPriceMinor){
    return conflict('CHECKOUT_MENU_CHANGED','A menu price changed. Refresh the menu and review your new estimate.');
   }
   estimatedTotalMinor+=pricing.unitPriceMinor*line.quantity;
   snapshots.push({menuItemId:item.id,nameSnapshot:item.name,quantity:line.quantity,preparationNote:line.note,...pricing});
  }
  const valueLimit=branch.settings?.maxOrderValueMinor??500000;
  if(estimatedTotalMinor>valueLimit){
   return conflict('CHECKOUT_VALUE_LIMIT','This estimate exceeds the restaurant’s checkout limit. Reduce the cart or ask staff.');
  }
  // Keep pricing and validation outside the branch-wide intake lock.
  const intake=await lockIntake(tx,owned);
  if(intake.paused)return conflict('CHECKOUT_PAUSED','The restaurant paused new orders. Keep your cart and ask staff.');
  const now=new Date();
  const recent=await tx.order.findMany({
   where:{...owned,createdAt:{gte:new Date(now.getTime()-intakeWindowMs)},diningSession:{checkoutPilot:true}},
   select:{requestHash:true,diningSession:{select:{tableId:true}}},
   orderBy:{createdAt:'desc'},take:branchBurstLimit,
  });
  const fromTable=recent.filter(order=>order.diningSession.tableId===table.id);
  if(recent.length>=branchBurstLimit||fromTable.length>=tableBurstLimit){
   return {error:new HttpError(429,'CHECKOUT_RATE_LIMIT','Too many new orders arrived in a short time. Wait a minute or ask staff.')};
  }
  const advanced=planEntitlements(branch.tenant.subscription?.planCode).advancedControls;
  const riskSignals=checkoutRisk({
   quantity:totalQuantity,value:estimatedTotalMinor,quantityLimit:advanced?(branch.settings?.approvalQuantity??null):null,valueLimit:advanced?(branch.settings?.approvalValueMinor??null):null,
   tableCount:fromTable.length,branchCount:recent.length,repeated:fromTable.some(order=>order.requestHash===requestHash),
  });
  if(guest.expiresAt<=new Date()||guest.diningSession.expiresAt<=new Date())return {error:invalidGuest()};
  const order=await tx.order.create({data:{
   ...guestOrders,idempotencyKey:input.key,requestHash,status:awaitingWaiter||riskSignals.length?'AWAITING_REVIEW':'PLACED',
   ...(awaitingWaiter||riskSignals.length?{}:{reviewReason:'AUTO_DISPATCHED',reviewedAt:now}),estimatedTotalMinor,riskSignals,items:{createMany:{data:snapshots}},
  }});
  await tx.auditEvent.create({data:{...owned,actorReference:'guest-checkout',action:'CHECKOUT_ORDER_RECORDED',resourceReference:order.id}});
  return {receipt:receipt(order),replayed:false,branch:owned,announcement:order.status==='PLACED'?newOrderAnnouncement(order.id,table.label,snapshots.map(item=>({name:item.nameSnapshot,quantity:item.quantity}))):awaitingWaiter?{id:'confirm:'+order.id,kind:'confirmation' as const,text:spokenTable(table.label)+' के पहले ऑर्डर की पुष्टि करें।'}:undefined};
 },txOptions);
 if('error' in result)throw result.error;
 return result;
}
