import type {Database} from '../../db.js';
import type {BillingMode,Prisma} from '@prisma/client';
import {HttpError} from '../auth/session.js';
import {configurationChecks} from '../restaurant/readiness.js';
import {issueInvitation} from '../auth/invitations.js';
import {planCodes,planEntitlements} from '@restrodock/contracts';
import type {SubscriptionStatus} from '@prisma/client';
export {planCodes};
export async function provisionRestaurant(tx:Prisma.TransactionClient,actorId:string,input:{name:string;slug:string;branchName:string;planCode:typeof planCodes[number]}){
 const tenant=await tx.tenant.create({data:{name:input.name,slug:input.slug,subscription:{create:{planCode:input.planCode,status:'TRIAL'}}}});
 const branch=await tx.branch.create({data:{tenantId:tenant.id,name:input.branchName}});
 await tx.controlAudit.create({data:{actorId,tenantId:tenant.id,action:'TENANT_CREATED',resourceReference:tenant.id}});
 return {tenant,branch};
}
export async function tenantDetail(db:Database,id:string) {
 const tenant=await db.tenant.findUnique({where:{id},include:{subscription:true,branches:{select:{id:true,name:true,active:true,orderingPaused:true,settings:true}},memberships:{where:{role:'RESTAURANT_ADMIN',active:true,user:{active:true}},select:{id:true}},invitations:{where:{role:'RESTAURANT_ADMIN',revokedAt:null,acceptedAt:null,expiresAt:{gt:new Date()}},select:{id:true,email:true,expiresAt:true}}}});
 if(!tenant)throw new HttpError(404,'NOT_FOUND','Restaurant not found.');
 const staff=await db.membership.findMany({where:{tenantId:id,active:true,user:{active:true}},select:{role:true,access:{select:{branchId:true}}}});
 const tables=await db.restaurantTable.count({where:{tenantId:id,archived:false}});
 const usage={branches:tenant.branches.length,tables,staff:staff.length};
 const configured=tenant.branches.length>0&&tenant.branches.every(branch=>branch.settings?.submittedAt&&configurationChecks({...branch.settings,roles:staff.filter(member=>member.access.some(access=>access.branchId===branch.id)).map(member=>member.role)}).every(check=>check.complete));
 const checklist=[
  {key:'profile',label:'Restaurant profile created',complete:!!tenant.name},
  {key:'branch',label:'Initial branch created',complete:tenant.branches.length>0},
  {key:'plan',label:'Plan assigned',complete:!!tenant.subscription},
  {key:'administrator',label:'Restaurant administrator access enabled',complete:tenant.memberships.length>0},
  {key:'configuration',label:'Restaurant configuration submitted',complete:configured},
  {key:'menu_qr',label:'Menu and secure table QR verified · Days 8–10',complete:false},
  {key:'pilot',label:'Operational pilot accepted · Day 30',complete:false}
 ];
 return {id:tenant.id,name:tenant.name,slug:tenant.slug,status:tenant.status,billingMode:tenant.billingMode,version:tenant.version,createdAt:tenant.createdAt,subscription:tenant.subscription,usage,branches:tenant.branches.map(({settings:_,...branch})=>{void _;return branch;}),invitations:tenant.invitations,checklist,activationAllowed:false};
}
export async function createTenant(db:Database,actorId:string,input:{name:string;slug:string;branchName:string;adminEmail:string;planCode:typeof planCodes[number]}) {
 return db.$transaction(async tx=>{
  const {tenant,branch}=await provisionRestaurant(tx,actorId,input);
  const invitation=await issueInvitation(tx,{tenantId:tenant.id,branchId:branch.id,email:input.adminEmail,role:'RESTAURANT_ADMIN',actorId});
  return {tenantId:tenant.id,invitation};
 });
}
export async function changeTenant(db:Database,actorId:string,id:string,input:{version:number;status?:'DRAFT'|'SUSPENDED'|'TRIAL'|'ACTIVE'|undefined;planCode?:typeof planCodes[number]|undefined;billingMode?:BillingMode|undefined;subscriptionStatus?:SubscriptionStatus|undefined;endsOn?:string|null|undefined}) {
 if(input.status==='ACTIVE'||input.status==='TRIAL')throw new HttpError(409,'ACTIVATION_BLOCKED','Complete restaurant configuration and operational pilot acceptance before activation.');
 await db.$transaction(async tx=>{
  const updated=await tx.tenant.updateMany({where:{id,version:input.version},data:{...(input.status?{status:input.status}:{}),...(input.billingMode?{billingMode:input.billingMode}:{}),version:{increment:1}}});
  if(updated.count!==1)throw new HttpError(409,'STALE_VERSION','The restaurant changed. Refresh its details before retrying.');
  if(input.status==='SUSPENDED'||input.status==='DRAFT')await tx.branch.updateMany({where:{tenantId:id},data:{active:false,orderingPaused:true}});
  if(input.planCode){
   const {outletLimit}=planEntitlements(input.planCode);
   if(outletLimit!==null&&await tx.branch.count({where:{tenantId:id,active:true}})>outletLimit)
    throw new HttpError(409,'PLAN_OUTLET_LIMIT','This plan allows fewer active outlets than this restaurant currently uses.');
   if(input.subscriptionStatus==='ACTIVE'&&input.endsOn&&new Date(input.endsOn+'T00:00:00.000Z')<=new Date())
    throw new HttpError(400,'INVALID_TERM_END','Choose a future term end date to renew this subscription.');
   const subscription={
    planCode:input.planCode,
    ...(input.subscriptionStatus?{status:input.subscriptionStatus}:{}),
    ...(input.endsOn!==undefined?{endsAt:input.endsOn?new Date(input.endsOn+'T00:00:00.000Z'):null}:{})
   };
   await tx.subscription.upsert({where:{tenantId:id},create:{tenantId:id,...subscription},update:subscription});
  }
  if(input.status||input.planCode)await tx.controlAudit.create({data:{actorId,tenantId:id,action:'TENANT_UPDATED',resourceReference:id}});
  if(input.billingMode){
   const action=input.billingMode==='RESTRODOCK'?'RESTRODOCK_BILLING_ENABLED':'EXTERNAL_POS_BILLING_SELECTED';
   await tx.controlAudit.create({data:{actorId,tenantId:id,action,resourceReference:id}});
  }
 });
 return tenantDetail(db,id);
}
