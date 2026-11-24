import type {Prisma,RegistrationRequest} from '@prisma/client';
import type {RegistrationInput,RegistrationDecision} from '@restrodock/contracts';
import type {Database} from '../../db.js';
import {hashPassword,verifyPassword,tokenHash} from '../auth/crypto.js';
import {HttpError} from '../auth/session.js';
import {provisionRestaurant} from '../platform/service.js';

const ttl=7*24*60*60*1000;
const transactionOptions={timeout:15000,maxWait:10000};
const stale=()=>new HttpError(409,'REGISTRATION_CHANGED','This request changed or was already reviewed. Refresh before deciding.');
export function registrationPayload(input:Omit<RegistrationInput,'password'|'trackingSecret'|'ownerAuthorised'>){
 return {restaurantName:input.restaurantName,branchName:input.branchName,ownerName:input.ownerName,email:input.email,phone:input.phone,city:input.city,address:input.address};
}
function detail(row:RegistrationRequest){
 const base=row.restaurantName.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,60).replace(/-$/,'')||'restaurant';
 return {id:row.id,...registrationPayload(row),status:row.status,version:row.version,createdAt:row.createdAt,expiresAt:row.expiresAt,reviewedAt:row.reviewedAt,reason:row.reason,tenantId:row.tenantId,suggestedSlug:`${base}-${row.id.slice(0,8)}`};
}
async function expire(db:Database,where:Prisma.RegistrationRequestWhereInput={}){
 await db.registrationRequest.updateMany({where:{...where,status:'PENDING',expiresAt:{lte:new Date()}},data:{status:'EXPIRED',passwordHash:null,version:{increment:1}}});
}
export async function submitRegistration(db:Database,input:RegistrationInput){
 const payload=registrationPayload(input),trackingHash=tokenHash(input.trackingSecret),payloadHash=tokenHash(JSON.stringify(payload));
 await expire(db,{OR:[{email:input.email},{trackingHash}]});
 const previous=await db.registrationRequest.findUnique({where:{trackingHash}});
 if(previous){
  if(previous.status==='PENDING'&&previous.expiresAt>new Date()&&previous.payloadHash===payloadHash&&await verifyPassword(input.password,previous.passwordHash))return {id:previous.id,status:'PENDING' as const,expiresAt:previous.expiresAt};
  throw new HttpError(409,'REGISTRATION_EXISTS','A request already uses this tracking link. Check its status before submitting again.');
 }
 const [user,pending]=await Promise.all([db.user.findUnique({where:{email:input.email},select:{id:true}}),db.registrationRequest.findFirst({where:{email:input.email,status:'PENDING'},select:{id:true}})]);
 if(user||pending)throw new HttpError(409,'REGISTRATION_UNAVAILABLE','This email cannot be used for a new request. Use your private tracking link, sign in, or contact the platform team.');
 const passwordHash=await hashPassword(input.password);
 try{
  const row=await db.registrationRequest.create({data:{...payload,trackingHash,payloadHash,passwordHash,expiresAt:new Date(Date.now()+ttl)}});
  return {id:row.id,status:'PENDING' as const,expiresAt:row.expiresAt};
 }catch(error){
  if(error&&typeof error==='object'&&'code' in error&&error.code==='P2002')throw new HttpError(409,'REGISTRATION_UNAVAILABLE','A matching request was received. Check your tracking link or contact the platform team.');
  throw error;
 }
}
export async function publicRegistrationStatus(db:Database,secret:string){
 const trackingHash=tokenHash(secret);await expire(db,{trackingHash});
 const row=await db.registrationRequest.findUnique({where:{trackingHash},select:{restaurantName:true,status:true,expiresAt:true,reviewedAt:true,reason:true,tenantId:true,branchId:true,applicantUserId:true}});
 if(!row)throw new HttpError(404,'REGISTRATION_NOT_FOUND','The private tracking link is invalid. Check the complete link or contact the platform team.');
 const access=row.status==='APPROVED'&&row.applicantUserId&&row.tenantId&&row.branchId?await db.membership.findFirst({where:{userId:row.applicantUserId,tenantId:row.tenantId,role:'RESTAURANT_ADMIN',active:true,user:{active:true},tenant:{status:{not:'SUSPENDED'}},access:{some:{branchId:row.branchId}}},select:{id:true}}):null;
 return {restaurantName:row.restaurantName,status:row.status,expiresAt:row.expiresAt,reviewedAt:row.reviewedAt,reason:row.reason,loginReady:!!access};
}
export async function listRegistrations(db:Database,input:{status:'PENDING'|'APPROVED'|'REJECTED'|'EXPIRED';cursor?:string|undefined}){
 await expire(db);
 const rows=await db.registrationRequest.findMany({where:{status:input.status},orderBy:[{createdAt:'desc'},{id:'desc'}],take:21,...(input.cursor?{cursor:{id:input.cursor},skip:1}:{})});
 return {items:rows.slice(0,20).map(detail),nextCursor:rows.length>20?rows[19]!.id:null};
}
export async function registrationDetail(db:Database,id:string){
 await expire(db,{id});const row=await db.registrationRequest.findUnique({where:{id}});
 if(!row)throw new HttpError(404,'NOT_FOUND','Registration request not found.');
 return detail(row);
}
export async function decideRegistration(db:Database,actorId:string,id:string,input:RegistrationDecision){
 await expire(db,{id});
 await db.$transaction(async tx=>{
  const claimed=await tx.registrationRequest.updateMany({where:{id,version:input.version,status:'PENDING',expiresAt:{gt:new Date()}},data:{version:{increment:1}}});
  if(claimed.count!==1)throw stale();
  const row=await tx.registrationRequest.findUniqueOrThrow({where:{id}});
  const reviewedAt=new Date();
  if(input.decision==='REJECT'){
   await tx.registrationRequest.update({where:{id},data:{status:'REJECTED',passwordHash:null,reviewedById:actorId,reviewedAt,reason:input.reason}});
   await tx.controlAudit.create({data:{actorId,action:'REGISTRATION_REJECTED',resourceReference:id}});
   return;
  }
  if(!input.ownershipConfirmed)throw new HttpError(400,'OWNERSHIP_REQUIRED','Review the applicant contact and restaurant ownership before approval.');
  if(!row.passwordHash||await tx.user.findUnique({where:{email:row.email},select:{id:true}}))throw new HttpError(409,'IDENTITY_CONFLICT','This email now belongs to an account. Do not overwrite it; reject this request and use the existing-account invitation workflow.');
  const user=await tx.user.create({data:{email:row.email,passwordHash:row.passwordHash,active:true}});
  const {tenant,branch}=await provisionRestaurant(tx,actorId,{name:row.restaurantName,branchName:row.branchName,slug:input.slug,planCode:input.planCode});
  const membership=await tx.membership.create({data:{tenantId:tenant.id,userId:user.id,role:'RESTAURANT_ADMIN',active:true}});
  await tx.branchAccess.create({data:{tenantId:tenant.id,branchId:branch.id,membershipId:membership.id}});
  await tx.branchSettings.create({data:{tenantId:tenant.id,branchId:branch.id,displayName:row.restaurantName,address:`${row.address}, ${row.city}`.slice(0,300),contactEmail:row.email,contactPhone:row.phone}});
  await tx.registrationRequest.update({where:{id},data:{status:'APPROVED',passwordHash:null,reviewedById:actorId,reviewedAt,ownershipConfirmed:true,tenantId:tenant.id,branchId:branch.id,applicantUserId:user.id}});
  await tx.controlAudit.create({data:{actorId,tenantId:tenant.id,action:'REGISTRATION_APPROVED',resourceReference:id}});
 },transactionOptions);
 return registrationDetail(db,id);
}
