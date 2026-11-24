import type {z} from 'zod';
import type {guestJoin,guestRequest} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import type {Config} from '../../config.js';
import {HttpError} from '../auth/session.js';
import {tokenHash,verifyPassword,csrfFor} from '../auth/crypto.js';
import {privacyKey,encryptMobile,decryptMobile} from './privacy.js';
import {canOpenTables} from '../platform/plan-access.js';
import {seatingOpen} from './hours.js';
import {lockIntake} from './intake.js';
import {lockTable,expireTable,txOptions,type Tx} from './repository.js';
export async function qrRecord(tx:Tx,secret:string){const qr=await tx.qrCode.findUnique({where:{secretHash:tokenHash(secret)},include:{table:{include:{branch:{include:{tenant:{select:{name:true,status:true}}}}}}}});if(!qr||qr.revokedAt||qr.table.archived||!qr.table.branch.tableEntryPublished||qr.table.branch.tenant.status==='SUSPENDED')throw new HttpError(404,'QR_UNAVAILABLE','This table QR is unavailable. Ask restaurant staff for the current code.');return qr;}
async function lockedQr(tx:Tx,secret:string){const before=await qrRecord(tx,secret);const owned={tenantId:before.tenantId,branchId:before.branchId};await lockTable(tx,owned,before.tableId);const qr=await qrRecord(tx,secret);await expireTable(tx,owned,qr.tableId);return {qr,owned};}
const aad=(row:{tenantId:string;branchId:string;diningSessionId:string;tokenHash:string})=>[row.tenantId,row.branchId,row.diningSessionId,row.tokenHash].join(':');
const view=(row:{id:string;displayName:string;expiresAt:Date;requiresWaiterConfirmation?:boolean;waiterConfirmedAt?:Date|null},secret:string,orderingEnabled:boolean)=>({joined:true as const,cartId:row.id,displayName:row.displayName,expiresAt:row.expiresAt.toISOString(),csrfToken:csrfFor(secret),entryOnly:true as const,orderingEnabled,awaitingWaiter:!!row.requiresWaiterConfirmation&&!row.waiterConfirmedAt});
async function publishedMenu(tx:Tx,qr:Awaited<ReturnType<typeof qrRecord>>,owned:{tenantId:string;branchId:string},deferredVerification=false){
 const now=new Date(),branch=qr.table.branch;
 const session=await tx.diningSession.findFirst({where:{...owned,tableId:qr.tableId,entryOnly:true,state:'OPEN',expiresAt:{gt:now}}});
 const categories=await tx.menuCategory.findMany({where:{...owned,archived:false},select:{id:true,name:true},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:40});
 const items=await tx.menuItem.findMany({where:{...owned,state:'PUBLISHED',reviewRequired:false,category:{archived:false}},select:{id:true,categoryId:true,name:true,description:true,priceMinor:true,available:true,foodType:true,variants:{select:{name:true,priceMinor:true,available:true},orderBy:{sortOrder:'asc'}},addons:{select:{name:true,priceMinor:true,available:true},orderBy:{sortOrder:'asc'}}},orderBy:[{sortOrder:'asc'},{id:'asc'}],take:200});
 const settings=await tx.branchSettings.findUnique({where:{tenantId_branchId:owned},select:{assistanceEnabled:true}});
 const assistanceEnabled=settings?.assistanceEnabled??false;
 const occupied=!!session?.singleGuest&&await tx.guestSession.count({where:{...owned,diningSessionId:session.id,OR:[{requiresWaiterConfirmation:false,revokedAt:null,expiresAt:{gt:now}},{requiresWaiterConfirmation:true,waiterConfirmedAt:{not:null}}]}})>0;
 return {waiterConfirmation:deferredVerification,assistanceEnabled,restaurantName:branch.tenant.name,branchName:branch.name,tableLabel:qr.table.label,section:qr.table.section,entryOnly:true,orderingEnabled:false,deferredVerification,session:session?{id:session.id,pinVersion:session.pinVersion,expiresAt:session.expiresAt.toISOString(),canJoin:!!session.pinHash&&!!session.pinExpiresAt&&session.pinExpiresAt>now&&session.failedJoinAttempts<5&&(!session.lockedUntil||session.lockedUntil<=now),occupied}:null,categories,items};
}
export async function lookupQr(db:Database,secret:string,deferredVerification=false){
 return db.$transaction(async tx=>{
  const {qr,owned}=await lockedQr(tx,secret);
  return publishedMenu(tx,qr,owned,deferredVerification);
 },txOptions);
}
export async function joinGuest(db:Database,config:Config,input:z.infer<typeof guestJoin>){
 const key=privacyKey(config),hash=tokenHash(input.guestSecret);
 const result=await db.$transaction(async tx=>{try{const {qr,owned}=await lockedQr(tx,input.qrToken);const now=new Date();
 const session=await tx.diningSession.findFirst({where:{...owned,id:input.sessionId,tableId:qr.tableId,entryOnly:true,state:'OPEN',expiresAt:{gt:now},pinVersion:input.pinVersion}});
 if(!session)throw new HttpError(409,'TABLE_SESSION_UNAVAILABLE','This table session changed or closed. Refresh table entry and ask staff for a current PIN.');
 const previous=await tx.guestSession.findUnique({where:{tokenHash:hash}});
 if(previous){if(previous.diningSessionId!==session.id||previous.tenantId!==owned.tenantId||previous.branchId!==owned.branchId||previous.revokedAt||previous.expiresAt<=now||previous.displayName!==input.displayName||!previous.mobileCiphertext||decryptMobile(previous.mobileCiphertext,key,aad(previous))!==input.mobile)throw new HttpError(409,'JOIN_RETRY_CONFLICT','This entry attempt changed or expired. Reopen the QR page before joining again.');return {guest:view(previous,input.guestSecret,config.CHECKOUT_PILOT_ENABLED&&session.checkoutPilot)};}
 if(!session.pinHash||!session.pinExpiresAt||session.pinExpiresAt<=now)throw new HttpError(409,'PIN_EXPIRED','The join PIN expired. Ask staff to issue a new PIN.');
 if(session.failedJoinAttempts>=5||(session.lockedUntil&&session.lockedUntil>now))throw new HttpError(429,'PIN_LOCKED','Too many incorrect PINs. Ask staff to rotate the PIN.');
 if(!await verifyPassword(input.pin+key.toString('hex'),session.pinHash)){
  const failures=session.failedJoinAttempts+1;await tx.diningSession.update({where:{id:session.id},data:{failedJoinAttempts:failures,lockedUntil:failures>=5?new Date(Date.now()+15*60000):null}});
  await tx.auditEvent.create({data:{...owned,actorReference:'guest-entry',action:failures>=5?'GUEST_PIN_LOCKED':'GUEST_PIN_DENIED',resourceReference:session.id}});
  // Return the error so the failed-attempt transaction commits before the response is rejected.
  return {error:new HttpError(failures>=5?429:403,failures>=5?'PIN_LOCKED':'PIN_INVALID',failures>=5?'Too many incorrect PINs. Ask staff to rotate the PIN.':'The PIN is incorrect. Check the six digits with staff.')};
 }
 if(await tx.guestSession.count({where:{...owned,diningSessionId:session.id,revokedAt:null,expiresAt:{gt:now}}})>=30)throw new HttpError(409,'GUEST_LIMIT','This table session has reached its guest entry limit. Ask staff for assistance.');
 const data={...owned,diningSessionId:session.id,tokenHash:hash};const guest=await tx.guestSession.create({data:{...data,displayName:input.displayName,mobileCiphertext:encryptMobile(input.mobile,key,aad(data)),expiresAt:new Date(session.singleGuest?session.expiresAt.getTime():Math.min(session.expiresAt.getTime(),Date.now()+2*60*60000))}});
 if(session.singleGuest)await tx.diningSession.update({where:{...owned,id:session.id},data:{pinExpiresAt:now,version:{increment:1}}});
 await tx.auditEvent.create({data:{...owned,actorReference:'guest-entry',action:'GUEST_ENTRY_VERIFIED',resourceReference:guest.id}});return {guest:view(guest,input.guestSecret,config.CHECKOUT_PILOT_ENABLED&&session.checkoutPilot)};
 }catch(error){if(error instanceof HttpError)return {error};throw error;}
 },txOptions);
 if(result.error)throw result.error;
 return result.guest!;
}
export async function currentGuest(db:Database,secret:string,qrToken:string,pilotEnabled:boolean){const result=await db.$transaction(async tx=>{try{const {qr,owned}=await lockedQr(tx,qrToken);const now=new Date();const guest=await tx.guestSession.findFirst({where:{...owned,tokenHash:tokenHash(secret),revokedAt:null,expiresAt:{gt:now},diningSession:{tableId:qr.tableId,state:'OPEN',entryOnly:true,expiresAt:{gt:now}}},include:{diningSession:{select:{checkoutPilot:true}}}});if(!guest)throw new HttpError(401,'GUEST_SESSION_EXPIRED','Guest entry expired or was closed. Ask staff to verify this table again.');return {guest:view(guest,secret,pilotEnabled&&guest.diningSession.checkoutPilot)};}catch(error){if(error instanceof HttpError)return {error};throw error;}},txOptions);if(result.error)throw result.error;return result.guest!;}
export const invalidGuest=()=>new HttpError(401,'GUEST_SESSION_EXPIRED','Scan the current table QR and verify again to start a cart.');

export async function lockGuestTable(tx:Tx,secret:string,checkout=false){
 const token=tokenHash(secret);
 const previous=await tx.guestSession.findUnique({
  where:{tokenHash:token},select:{id:true,tenantId:true,branchId:true,diningSession:{select:{tableId:true}}},
 });
 if(!previous)return null;
 const owned={tenantId:previous.tenantId,branchId:previous.branchId};
 const tableId=previous.diningSession.tableId;
 // Menu, settings and publication writers acquire the Branch row before the table.
 if(checkout)await tx.$queryRaw`SELECT b.id FROM "Branch" b JOIN "Tenant" t ON t.id=b."tenantId"
  WHERE b.id=${owned.branchId}::uuid AND b."tenantId"=${owned.tenantId}::uuid FOR SHARE OF b,t`;
 const table=await lockTable(tx,owned,tableId);
 await expireTable(tx,owned,tableId);
 // A guest can leave without acquiring the table lock.
 if(checkout)await tx.$queryRaw`SELECT id FROM "GuestSession" WHERE id=${previous.id}::uuid FOR UPDATE`;
 const now=new Date();
 const guest=await tx.guestSession.findFirst({
  where:{...owned,id:previous.id,tokenHash:token,revokedAt:null,expiresAt:{gt:now},
   diningSession:{tableId,state:'OPEN',entryOnly:true,expiresAt:{gt:now}}},
  include:{diningSession:{select:{checkoutPilot:true,expiresAt:true,billRequestedAt:true}}},
 });
 return guest?{owned,table,guest}:null;
}

export async function resumeGuestCart(db:Database,secret:string,pilotEnabled:boolean){
 const result=await db.$transaction(async tx=>{
  const scope=await lockGuestTable(tx,secret);
  if(!scope)return {error:invalidGuest()};
  const {owned,guest,table}=scope;
  const qr=await tx.qrCode.findFirst({
   where:{...owned,tableId:table.id,revokedAt:null,table:{archived:false,branch:{tableEntryPublished:true,tenant:{status:{not:'SUSPENDED'}}}}},
   include:{table:{include:{branch:{include:{tenant:{select:{name:true,status:true}}}}}}},
  });
  if(!qr)return {error:invalidGuest()};
  return {context:await publishedMenu(tx,qr,owned,pilotEnabled),guest:view(guest,secret,pilotEnabled&&guest.diningSession.checkoutPilot)};
 },txOptions);
 if('error' in result)throw result.error;
 return result;
}
export async function leaveGuest(db:Database,secret:string){await db.guestSession.updateMany({where:{tokenHash:tokenHash(secret),revokedAt:null},data:{revokedAt:new Date(),mobileCiphertext:null,displayName:'Guest'}});return {left:true};}

// Read through the guest relation so the caller cannot select another guest or table.
export async function listGuestOrders(db:Database,secret:string){
 const now=new Date();
 const guest=await db.guestSession.findFirst({
  where:{tokenHash:tokenHash(secret),revokedAt:null,expiresAt:{gt:now},diningSession:{
   state:'OPEN',entryOnly:true,checkoutPilot:true,expiresAt:{gt:now},
   table:{archived:false,branch:{tableEntryPublished:true,tenant:{status:{not:'SUSPENDED'}}}},
  }},
  select:{diningSession:{select:{billRequestedAt:true}},orders:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:20,
   select:{id:true,status:true,estimatedTotalMinor:true,createdAt:true}}},
 });
 if(!guest)throw invalidGuest();
 return {billRequestedAt:guest.diningSession.billRequestedAt?.toISOString()??null,orders:guest.orders.map(({id,createdAt,...order})=>({...order,orderId:id,createdAt:createdAt.toISOString()}))};
}


export async function requestGuest(db:Database,config:Config,input:z.infer<typeof guestRequest>){
 const key=privacyKey(config),hash=tokenHash(input.guestSecret);
 return db.$transaction(async tx=>{
  const before=await qrRecord(tx,input.qrToken),owned={tenantId:before.tenantId,branchId:before.branchId};
  await tx.$queryRaw`SELECT b.id FROM "Branch" b JOIN "Tenant" t ON t.id=b."tenantId"
   WHERE b.id=${owned.branchId}::uuid AND b."tenantId"=${owned.tenantId}::uuid FOR SHARE OF b,t`;
  const {qr}=await lockedQr(tx,input.qrToken);
  const branch=await tx.branch.findFirstOrThrow({where:{id:owned.branchId,tenantId:owned.tenantId},
   include:{tenant:{include:{subscription:true}},settings:true}});
  if(!branch.active||!['TRIAL','ACTIVE'].includes(branch.tenant.status))throw new HttpError(409,'CHECKOUT_UNAVAILABLE','Ordering is unavailable for this table.');
  const intake=await lockIntake(tx,owned);
  if(intake.paused)throw new HttpError(409,'CHECKOUT_PAUSED','The restaurant paused new orders. Please ask staff.');
  const now=new Date();
  let session=await tx.diningSession.findFirst({where:{...owned,tableId:qr.tableId,state:{not:'CLOSED'}}});
  if(!session){
   if(!canOpenTables(branch.tenant.subscription,now))throw new HttpError(409,'SUBSCRIPTION_ENDED','Ordering is unavailable. Please ask staff.');
   const cutoff=branch.settings?.lastSeatingMinutes;
   if(cutoff!=null&&!seatingOpen(branch.settings?.businessHours,branch.timezone,cutoff))throw new HttpError(409,'SEATING_CLOSED','The restaurant has stopped taking new tables.');
   session=await tx.diningSession.create({data:{...owned,tableId:qr.tableId,entryOnly:true,singleGuest:true,checkoutPilot:true,waiterConfirmation:true,expiresAt:new Date(now.getTime()+120*60000)}});
  }
  if(!session.checkoutPilot||session.state!=='OPEN'||session.expiresAt<=now||session.billRequestedAt)throw new HttpError(409,'CHECKOUT_UNAVAILABLE','Ordering is unavailable for this table.');
  const existing=await tx.guestSession.findUnique({where:{tokenHash:hash}});
  if(existing){
   if(existing.diningSessionId!==session.id||existing.revokedAt||existing.expiresAt<=now||existing.displayName!==input.displayName||
    !existing.mobileCiphertext||decryptMobile(existing.mobileCiphertext,key,aad(existing))!==input.mobile)throw new HttpError(409,'JOIN_RETRY_CONFLICT','This request changed. Reopen the table QR.');
   return view(existing,input.guestSecret,true);
  }
  if(await tx.guestSession.count({where:{...owned,diningSessionId:session.id,
   OR:[{requiresWaiterConfirmation:false,revokedAt:null,expiresAt:{gt:now}},{requiresWaiterConfirmation:true,waiterConfirmedAt:{not:null}}]}}))throw new HttpError(409,'TABLE_OCCUPIED','This table has an approved guest. Ask your waiter for help.');
  if(await tx.guestSession.count({where:{...owned,diningSessionId:session.id,revokedAt:null,expiresAt:{gt:now},createdAt:{gt:new Date(now.getTime()-10*60000)}}})>=10)throw new HttpError(429,'TABLE_REQUEST_LIMIT','This table has several pending requests. Ask your waiter to review them.');
  const data={...owned,diningSessionId:session.id,tokenHash:hash};
  const guest=await tx.guestSession.create({data:{...data,requiresWaiterConfirmation:true,displayName:input.displayName,
   mobileCiphertext:encryptMobile(input.mobile,key,aad(data)),expiresAt:session.expiresAt}});
  await tx.auditEvent.create({data:{...owned,actorReference:'guest-entry',action:'WAITER_CONFIRMATION_REQUESTED',resourceReference:guest.id}});
  return view(guest,input.guestSecret,true);
 },txOptions);
}
