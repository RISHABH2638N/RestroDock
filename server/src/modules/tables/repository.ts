import {createPosExport} from '../pos/handoff.js';
import {seatingOpen} from './hours.js';
import {canOpenTables} from '../platform/plan-access.js';
import type {tableSectionInput} from '@restrodock/contracts';
import type {Prisma} from '@prisma/client';
import {randomInt} from 'node:crypto';
import QRCode from 'qrcode';
import {diningReceiptSchema} from '@restrodock/contracts';
import type {z} from 'zod';
import type {tableCreate,tableEdit,entryPublish,sessionOpen,settlementInput,billSessionInput} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import type {Config} from '../../config.js';
import {HttpError} from '../auth/session.js';
import {randomToken,tokenHash,hashPassword} from '../auth/crypto.js';
import {privacyKey} from './privacy.js';
import {requireEntryScope,type EntryScope} from './scope.js';
export type Tx=Prisma.TransactionClient;
export type Owned={tenantId:string;branchId:string};
export const txOptions={timeout:15000,maxWait:10000};
const stale=()=>new HttpError(409,'TABLE_CHANGED','This table or session changed. Refresh saved tables before retrying.');
export async function lockTable(tx:Tx,owned:Owned,id:string){
 const rows=await tx.$queryRaw<{id:string}[]>`SELECT id FROM "RestaurantTable" WHERE "tenantId"=${owned.tenantId}::uuid AND "branchId"=${owned.branchId}::uuid AND id=${id}::uuid FOR UPDATE`;
 if(!rows.length)throw new HttpError(404,'TABLE_NOT_FOUND','Table not found in this branch.');
 return tx.restaurantTable.findFirstOrThrow({where:{...owned,id}});
}
export async function endEntry(tx:Tx,owned:Owned,id:string,onExpiry=false){
 const session=await tx.diningSession.findFirst({where:{...owned,id,state:{not:'CLOSED'}}});if(!session)return;
 const requiresHandoff=!!session.billRequestedAt||!session.entryOnly||await tx.order.count({
  where:{...owned,diningSessionId:id,NOT:{status:'AWAITING_REVIEW',guestSession:{requiresWaiterConfirmation:true,waiterConfirmedAt:null}},...(session.checkoutPilot?{status:{notIn:session.singleGuest?['REJECTED','CANCELLED']:['AWAITING_REVIEW','PLACED','REJECTED','CANCELLED']}}:{})},
 });
 if(requiresHandoff&&(!onExpiry||!session.entryOnly||session.billRequestedAt)){
  if(onExpiry)return;
  throw new HttpError(409,'SERVICE_HANDOFF_REQUIRED','This session requires the service/billing closure workflow. It cannot be closed as an entry pilot.');
 }
 if(session.checkoutPilot)await tx.order.updateMany({where:{...owned,diningSessionId:id,status:{in:['AWAITING_REVIEW','PLACED']}},data:{status:'CANCELLED',version:{increment:1}}});
 await tx.guestSession.updateMany({where:{...owned,diningSessionId:id,OR:[{revokedAt:null},{mobileCiphertext:{not:null}},{displayName:{not:'Guest'}}]},data:{revokedAt:new Date(),mobileCiphertext:null,displayName:'Guest'}});
 if(!requiresHandoff)await tx.diningSession.update({where:{id},data:{state:'CLOSED',assistanceRequestedAt:null,closedAt:new Date(),pinHash:null,pinExpiresAt:null,lockedUntil:null,version:{increment:1}}});
}
export async function expireTable(tx:Tx,owned:Owned,id:string){
 const expired=await tx.diningSession.findFirst({where:{...owned,tableId:id,state:'OPEN',entryOnly:true,expiresAt:{lte:new Date()}}});if(expired)await endEntry(tx,owned,expired.id,true);
 await tx.guestSession.updateMany({where:{...owned,diningSession:{tableId:id},OR:[{expiresAt:{lte:new Date()}},{revokedAt:{not:null}}]},data:{mobileCiphertext:null,displayName:'Guest'}});
}
const billOrders={notIn:['CANCELLED','REJECTED'] as ('CANCELLED'|'REJECTED')[]};
const summaryFields={id:true,status:true,estimatedTotalMinor:true,items:{select:{nameSnapshot:true,quantity:true,portionNameSnapshot:true,addOnSnapshots:true,unitPriceMinor:true}}} as const;

export async function requestBill(tx:Tx,owned:Owned,sessionId:string,allowExpired=false){
 const session=await tx.diningSession.findFirst({where:{...owned,id:sessionId,state:'OPEN',checkoutPilot:true,...(allowExpired?{}:{expiresAt:{gt:new Date()}})}});
 if(!session)throw stale();
 if(session.billRequestedAt)return false;
 if(!await tx.order.count({where:{...owned,diningSessionId:sessionId,status:billOrders}}))
  throw new HttpError(409,'NO_BILLABLE_ORDERS','Place an order before requesting the bill.');
 await tx.diningSession.update({where:{id:sessionId},data:{billRequestedAt:new Date(),version:{increment:1}}});
 return true;
}
export function tableRepository(db:Database,config:Config,scope:EntryScope){
 requireEntryScope(scope);const owned={tenantId:scope.tenantId,branchId:scope.branchId};
 const manage=()=>{if(scope.role!=='RESTAURANT_ADMIN')throw new HttpError(403,'TABLE_ADMIN_REQUIRED','Restaurant Admin access is required for table and QR administration.');};
 const canOpen=scope.role!=='CASHIER';
 const canResumeBilling=['RESTAURANT_ADMIN','MANAGER'].includes(scope.role);
 const canSettle=config.CHECKOUT_PILOT_ENABLED&&(canResumeBilling||scope.role==='CASHIER'||scope.role==='WORKER');
 const audit=(tx:Tx,action:string,id:string)=>tx.auditEvent.create({data:{...owned,actorReference:scope.userId,action,resourceReference:id}});
 async function cleanup(){
  await db.$transaction(async tx=>{
   const now=new Date();
   const rows=await tx.restaurantTable.findMany({
    where:{...owned,sessions:{some:{OR:[
     {state:'OPEN',entryOnly:true,expiresAt:{lte:now}},
     {guests:{some:{AND:[
      {OR:[{expiresAt:{lte:now}},{revokedAt:{not:null}}]},
      {OR:[{mobileCiphertext:{not:null}},{displayName:{not:'Guest'}}]},
     ]}}},
    ]}}},
    select:{id:true},orderBy:{id:'asc'},take:100,
   });
   for(const row of rows){await lockTable(tx,owned,row.id);await expireTable(tx,owned,row.id);}
  },txOptions);
 }
 async function board(){
  await cleanup();const now=new Date();
  const branch=await db.branch.findFirstOrThrow({where:{tenantId:owned.tenantId,id:owned.branchId},include:{tenant:{select:{name:true,billingMode:true}}}});
  const tables=await db.restaurantTable.findMany({where:owned,orderBy:[{section:'asc'},{label:'asc'},{id:'asc'}],take:100,include:{qrCodes:{where:{revokedAt:null},select:{id:true},take:1},sessions:{where:{OR:[{state:{not:'CLOSED'}},...(canSettle?[{state:'CLOSED' as const}]:[])]},orderBy:[{openedAt:'desc'},{id:'desc'}],take:2,include:{handoffs:{where:{status:'EXTERNALLY_SETTLED'},select:{summarySnapshot:true},take:1},orders:{where:owned,select:summaryFields,orderBy:[{createdAt:'asc'},{id:'asc'}]},guests:{where:{revokedAt:null,expiresAt:{gt:now}},select:{id:true,requiresWaiterConfirmation:true,waiterConfirmedAt:true}}}}}});
  return {waiterConfirmation:config.CHECKOUT_PILOT_ENABLED,revision:branch.tableRevision,entryPublished:branch.tableEntryPublished,restaurantName:branch.tenant.name,branchName:branch.name,billingMode:branch.tenant.billingMode,canManage:scope.role==='RESTAURANT_ADMIN',canOpen,canClose:true,canSettle,canResumeBilling,items:tables.map(t=>{const s=t.sessions.find(session=>session.state!=='CLOSED');const settled=t.sessions.find(session=>session.state==='CLOSED');const snapshot=settled?.handoffs[0]?.summarySnapshot;
   const receipt=diningReceiptSchema.safeParse(snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)?snapshot.receipt:undefined);
   return {id:t.id,label:t.label,seats:t.seats,section:t.section,archived:t.archived,version:t.version,qrActive:t.qrCodes.length>0,...(!s&&receipt.success?{receipt:receipt.data}:{}),...(canResumeBilling&&settled?.handoffs.length&&!s?{lastSettledSessionId:settled.id}:{}),session:s?{awaitingWaiter:config.CHECKOUT_PILOT_ENABLED&&!s.guests.some(guest=>!guest.requiresWaiterConfirmation||guest.waiterConfirmedAt),id:s.id,version:s.version,pinVersion:s.pinVersion,state:s.state,expiresAt:s.expiresAt.toISOString(),pinExpiresAt:s.pinExpiresAt?.toISOString()??null,locked:s.failedJoinAttempts>=5||!!(s.lockedUntil&&s.lockedUntil>now),guestCount:s.guests.length,entryOnly:s.entryOnly, singleGuest:s.singleGuest, assistanceRequestedAt:s.assistanceRequestedAt?.toISOString()??null,billRequestedAt:s.billRequestedAt?.toISOString()??null, orders:s.orders}:null};})};
 }
 async function branchClaim(tx:Tx,revision:number){if((await tx.branch.updateMany({where:{tenantId:owned.tenantId,id:owned.branchId,tableRevision:revision},data:{tableRevision:{increment:1}}})).count!==1)throw stale();}
 async function active(tx:Tx,id:string){return tx.diningSession.findFirst({where:{...owned,tableId:id,state:{not:'CLOSED'}}});}
 return {
  board,
  async billing(id:string,input:z.infer<typeof billSessionInput>,resume:boolean){
   if(!config.CHECKOUT_PILOT_ENABLED||(resume&&!canResumeBilling))throw new HttpError(403,'BILLING_FORBIDDEN','This billing action is unavailable for your role.');
   await db.$transaction(async tx=>{
    await lockTable(tx,owned,id);
    const session=await active(tx,id);
    if(!session?.checkoutPilot||session.id!==input.sessionId||session.version!==input.version)throw stale();
    if(resume){
     if(!session.billRequestedAt)throw stale();
     await tx.diningSession.update({where:{id:session.id},data:{billRequestedAt:null,version:{increment:1}}});
     await audit(tx,'BILL_REQUEST_REOPENED',session.id);
    }else if(await requestBill(tx,owned,session.id,true))await audit(tx,'BILL_REQUESTED',session.id);
   },txOptions);
   return {board:await board()};
  },
  async settle(id:string,input:z.infer<typeof settlementInput>){
   if(!canSettle)throw new HttpError(403,'SETTLEMENT_FORBIDDEN','An assigned waiter, cashier, manager or restaurant admin must confirm payment.');
   await db.$transaction(async tx=>{
    await lockTable(tx,owned,id);
    const branch=await tx.branch.findFirstOrThrow({
     where:{tenantId:owned.tenantId,id:owned.branchId},
     select:{name:true,tenant:{select:{name:true,billingMode:true}}},
    });
    const internal=input.billingMode==='RESTRODOCK';
    const reference=internal?`RD-${input.sessionId}`:input.externalBillReference;
    const session=await active(tx,id);
    if(internal&&reference&&session?.id!==input.sessionId){
     const saved=await tx.billingHandoff.findFirst({
      where:{...owned,diningSessionId:input.sessionId,diningSession:{tableId:id,state:'CLOSED',version:input.version+1},
       externalBillReference:reference,paymentMethod:input.paymentMethod},
      select:{summarySnapshot:true},
     });
     const snapshot=saved?.summarySnapshot;
     if(snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)&&diningReceiptSchema.safeParse(snapshot.receipt).success)return;
    }
    if(!session?.checkoutPilot||session.id!==input.sessionId||session.version!==input.version)throw stale();
    if(internal!==(branch.tenant.billingMode==='RESTRODOCK'))throw new HttpError(409,'BILLING_MODE_CHANGED','Refresh the billing queue before confirming payment.');
    if(!reference)throw new HttpError(400,'BILL_REFERENCE_REQUIRED','Enter the external POS invoice reference.');
    if(!session.billRequestedAt)throw new HttpError(409,'BILL_REQUEST_REQUIRED','Request the bill before confirming payment.');
    const orders=await tx.order.findMany({where:{...owned,diningSessionId:session.id,status:billOrders},select:summaryFields,orderBy:{id:'asc'}});
    if(!orders.length||orders.some(order=>order.status!=='SERVED'))throw new HttpError(409,'ORDERS_NOT_SERVED','Finish serving or resolving all orders before confirming payment.');
    const now=new Date();
    const packet=createPosExport({...owned,diningSessionId:session.id,revision:1},orders);
    const receipt=internal?diningReceiptSchema.parse({
     reference,issuedAt:now.toISOString(),paymentMethod:input.paymentMethod,
     restaurantName:branch.tenant.name,branchName:branch.name,
     tableLabel:(await tx.restaurantTable.findFirstOrThrow({where:{...owned,id},select:{label:true}})).label,
     totalMinor:orders.reduce((total,order)=>total+order.estimatedTotalMinor,0),
     lines:orders.flatMap(order=>order.items.map(item=>({
      description:[item.nameSnapshot,item.portionNameSnapshot,
       ...((Array.isArray(item.addOnSnapshots)?item.addOnSnapshots:[]).flatMap(addOn=>
        addOn&&typeof addOn==='object'&&!Array.isArray(addOn)&&typeof addOn.name==='string'?[addOn.name]:[])),
      ].filter(Boolean).join(' · '),
      quantity:item.quantity,amountMinor:item.quantity*item.unitPriceMinor,
     }))),
    }):undefined;
    await tx.billingHandoff.create({data:{...owned,diningSessionId:session.id,revision:1,status:'EXTERNALLY_SETTLED',
     externalBillReference:reference,paymentMethod:input.paymentMethod,staffConfirmedAt:now,
     summarySnapshot:receipt?{...packet,receipt}:packet}});
    await tx.guestSession.updateMany({where:{...owned,diningSessionId:session.id},data:{revokedAt:now,mobileCiphertext:null,displayName:'Guest'}});
    await tx.diningSession.update({where:{...owned,id:session.id},data:{state:'CLOSED',closedAt:now,pinHash:null,pinExpiresAt:null,assistanceRequestedAt:null,version:{increment:1}}});
    await audit(tx,'TABLE_PAYMENT_CONFIRMED',session.id);
   },txOptions);
   return {board:await board()};
  },
  async resolveAssistance(id:string,version:number){
   if(!config.CHECKOUT_PILOT_ENABLED||!canOpen)throw new HttpError(403,'ASSISTANCE_FORBIDDEN','Assigned service staff must clear assistance requests.');
   await db.$transaction(async tx=>{
    await lockTable(tx,owned,id);
    const session=await active(tx,id);
    if(!session?.checkoutPilot||session.version!==version||!session.assistanceRequestedAt)throw stale();
    await tx.diningSession.update({where:{...owned,id:session.id},data:{assistanceRequestedAt:null,version:{increment:1}}});
    await audit(tx,'TABLE_ASSISTANCE_RESOLVED',session.id);
   },txOptions);
   return {board:await board()};
  },
  async create(input:z.infer<typeof tableCreate>){manage();await db.$transaction(async tx=>{await branchClaim(tx,input.revision);if(await tx.restaurantTable.count({where:owned})>=100)throw new HttpError(409,'TABLE_LIMIT','This branch supports up to 100 tables including archived history.');const {revision:_,...fields}=input;void _;const table=await tx.restaurantTable.create({data:{...owned,...fields}});await audit(tx,'TABLE_CREATED',table.id);},txOptions);return {board:await board()};},
  async moveSection(input:z.infer<typeof tableSectionInput>){
   manage();
   await db.$transaction(async tx=>{
    for(const {id,version} of [...input.tables].sort((a,b)=>a.id.localeCompare(b.id))){
     const table=await lockTable(tx,owned,id);
     if(table.version!==version||table.archived)throw stale();
     await expireTable(tx,owned,id);
     if(await active(tx,id))throw new HttpError(409,'TABLE_OCCUPIED','Close active table sessions before moving the selected tables.');
     await tx.restaurantTable.update({where:{id},data:{section:input.section,version:{increment:1}}});
     await audit(tx,'TABLE_SECTION_MOVED',id);
    }
   },txOptions);
   return {board:await board()};
  },
  async edit(id:string,input:z.infer<typeof tableEdit>){manage();await db.$transaction(async tx=>{const table=await lockTable(tx,owned,id);if(table.version!==input.version)throw stale();await expireTable(tx,owned,id);if(await active(tx,id))throw new HttpError(409,'TABLE_OCCUPIED','Close the current entry session before editing or archiving this table.');const {version:_,...fields}=input;void _;await tx.restaurantTable.update({where:{id},data:{...fields,version:{increment:1}}});if(input.archived)await tx.qrCode.updateMany({where:{...owned,tableId:id,revokedAt:null},data:{revokedAt:new Date()}});await audit(tx,input.archived?'TABLE_ARCHIVED':'TABLE_UPDATED',id);},txOptions);return {board:await board()};},
  async publish(input:z.infer<typeof entryPublish>){manage();await db.$transaction(async tx=>{await branchClaim(tx,input.revision);if(input.enabled&&!await tx.restaurantTable.count({where:{...owned,archived:false,qrCodes:{some:{revokedAt:null}}}}))throw new HttpError(409,'QR_REQUIRED','Create at least one table QR before publishing entry.');await tx.branch.update({where:{id:owned.branchId},data:{tableEntryPublished:input.enabled}});if(!input.enabled){// Lock every branch table in a stable order so opening a table cannot race unpublication.
    await tx.$queryRaw`SELECT id FROM "RestaurantTable" WHERE "tenantId"=${owned.tenantId}::uuid AND "branchId"=${owned.branchId}::uuid ORDER BY id FOR UPDATE`;
    const sessions=await tx.diningSession.findMany({where:{...owned,state:{not:'CLOSED'}},select:{id:true},orderBy:{tableId:'asc'}});
    for(const session of sessions)await endEntry(tx,owned,session.id);}await audit(tx,input.enabled?'TABLE_ENTRY_PUBLISHED':'TABLE_ENTRY_UNPUBLISHED',owned.branchId);},txOptions);return {board:await board()};},
  async qr(id:string,version:number,rotate:boolean){manage();const secret=randomToken(),url=config.CLIENT_ORIGIN+'/q#'+secret;
   const pngDataUrl=rotate?await QRCode.toDataURL(url,{errorCorrectionLevel:'M',margin:4,width:768}):'';
   await db.$transaction(async tx=>{const table=await lockTable(tx,owned,id);if(table.version!==version)throw stale();if(table.archived)throw new HttpError(409,'TABLE_ARCHIVED','Restore this table before issuing a QR.');const session=await active(tx,id);if(session)await endEntry(tx,owned,session.id);await tx.qrCode.updateMany({where:{...owned,tableId:id,revokedAt:null},data:{revokedAt:new Date()}});if(rotate)await tx.qrCode.create({data:{...owned,tableId:id,secretHash:tokenHash(secret)}});await tx.restaurantTable.update({where:{id},data:{version:{increment:1}}});await audit(tx,rotate?'TABLE_QR_ROTATED':'TABLE_QR_REVOKED',id);},txOptions);
   return {board:await board(),...(rotate?{qr:{url,pngDataUrl}}:{})};
  },
  async open(id:string,input:z.infer<typeof sessionOpen>,settledSessionId?:string){if(settledSessionId&&(!canResumeBilling||!config.CHECKOUT_PILOT_ENABLED))throw new HttpError(403,'BILLING_FORBIDDEN','A manager or restaurant admin must approve reopening.');if(!canOpen)throw new HttpError(403,'ENTRY_OPEN_FORBIDDEN','A Restaurant Admin, Manager or Worker must open the table.');const key=privacyKey(config),pin=String(randomInt(1000000)).padStart(6,'0'),pinHash=await hashPassword(pin+key.toString('hex'));
   await db.$transaction(async tx=>{const table=await lockTable(tx,owned,id);if(table.version!==input.version)throw stale();await expireTable(tx,owned,id);const branch=await tx.branch.findFirstOrThrow({where:{tenantId:owned.tenantId,id:owned.branchId},include:{tenant:{select:{status:true,subscription:true}},settings:{select:{pinExpiryMinutes:true,businessHours:true,lastSeatingMinutes:true}}}});if(!canOpenTables(branch.tenant.subscription))throw new HttpError(409,'SUBSCRIPTION_ENDED','Renew the subscription to open a new table. Existing tables can finish service.');if(!branch.tableEntryPublished||branch.tenant.status==='SUSPENDED'||table.archived)throw new HttpError(409,'ENTRY_UNAVAILABLE','Publish table entry and use an available table before opening a session.');if(!await tx.qrCode.count({where:{...owned,tableId:id,revokedAt:null}}))throw new HttpError(409,'QR_REQUIRED','Issue a current QR before opening this table.');if(await active(tx,id))throw new HttpError(409,'TABLE_OCCUPIED','This table already has an open session. Refresh saved tables.');if(settledSessionId){
    const settled=await tx.diningSession.findFirst({where:{...owned,tableId:id,state:'CLOSED'},orderBy:[{openedAt:'desc'},{id:'desc'}],select:{id:true,handoffs:{where:{status:'EXTERNALLY_SETTLED'},select:{id:true},take:1}}});
    if(settled?.id!==settledSessionId||!settled.handoffs.length)throw stale();
   }const cutoff=branch.settings?.lastSeatingMinutes;const singleGuest=config.CHECKOUT_PILOT_ENABLED;if(cutoff!=null&&!seatingOpen(branch.settings?.businessHours,branch.timezone,cutoff))throw new HttpError(409,'SEATING_CLOSED','The branch is outside its seating hours or has reached its last seating cutoff.');const now=Date.now(),expiresAt=new Date(now+input.durationMinutes*60000);const session=await tx.diningSession.create({data:{...owned,tableId:id,entryOnly:true,singleGuest,checkoutPilot:config.CHECKOUT_PILOT_ENABLED,pinHash,pinExpiresAt:new Date(Math.min(expiresAt.getTime(),now+(branch.settings?.pinExpiryMinutes??15)*60000)),expiresAt}});await audit(tx,'ENTRY_SESSION_OPENED',session.id);if(settledSessionId)await audit(tx,'SETTLED_TABLE_REOPEN_APPROVED',settledSessionId);},txOptions);return {board:await board(),pin};
  },
  async session(id:string,version:number,operation:'close'|'pin'){if(operation==='pin'&&!canOpen)throw new HttpError(403,'ENTRY_OPEN_FORBIDDEN','Your role cannot rotate join PINs.');const key=operation==='pin'?privacyKey(config):null,pin=operation==='pin'?String(randomInt(1000000)).padStart(6,'0'):null,pinHash=pin&&key?await hashPassword(pin+key.toString('hex')):null;
   await db.$transaction(async tx=>{await lockTable(tx,owned,id);await expireTable(tx,owned,id);const session=await active(tx,id);if(!session||session.version!==version)throw stale();if(operation==='pin'&&session.waiterConfirmation)throw new HttpError(409,'PIN_NOT_REQUIRED','This table uses waiter confirmation instead of a PIN.');if(operation==='close')await endEntry(tx,owned,session.id);else{if(!session.entryOnly||session.state!=='OPEN')throw new HttpError(409,'ENTRY_UNAVAILABLE','Only an open entry-pilot session can receive a new PIN.');const branch=await tx.branch.findFirstOrThrow({where:{id:owned.branchId},include:{settings:{select:{pinExpiryMinutes:true}}}});if(!branch.tableEntryPublished)throw new HttpError(409,'ENTRY_UNAVAILABLE','Table entry is unpublished.');await tx.guestSession.updateMany({where:{...owned,diningSessionId:session.id},data:{revokedAt:new Date(),mobileCiphertext:null,displayName:'Guest'}});await tx.diningSession.update({where:{id:session.id},data:{pinHash,pinExpiresAt:new Date(Math.min(session.expiresAt.getTime(),Date.now()+(branch.settings?.pinExpiryMinutes??15)*60000)),pinVersion:{increment:1},version:{increment:1},failedJoinAttempts:0,lockedUntil:null}});}await audit(tx,operation==='close'?'ENTRY_SESSION_CLOSED':'ENTRY_PIN_ROTATED',session.id);},txOptions);return {board:await board(),...(pin?{pin}:{})};
  }
 };
}
