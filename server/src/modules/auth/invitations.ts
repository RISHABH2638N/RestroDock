import type {Prisma} from '@prisma/client';
import type {Database} from '../../db.js';
import {HttpError} from './session.js';
import {hashPassword,verifyPassword,randomToken,tokenHash} from './crypto.js';
type Transaction=Prisma.TransactionClient;
export async function issueInvitation(tx:Transaction,input:{tenantId:string;branchId:string;email:string;role:'RESTAURANT_ADMIN'|'MANAGER'|'CHEF'|'WORKER'|'CASHIER';actorId:string}) {
 const now=new Date();const token=randomToken();
 await tx.staffInvitation.updateMany({where:{tenantId:input.tenantId,email:input.email,acceptedAt:null,revokedAt:null},data:{revokedAt:now}});
 const invitation=await tx.staffInvitation.create({data:{tenantId:input.tenantId,branchId:input.branchId,email:input.email,role:input.role,createdById:input.actorId,tokenHash:tokenHash(token),expiresAt:new Date(now.getTime()+24*60*60*1000)}});
 await tx.controlAudit.create({data:{actorId:input.actorId,tenantId:input.tenantId,action:'INVITATION_CREATED',resourceReference:invitation.id}});
 await tx.auditEvent.create({data:{tenantId:input.tenantId,branchId:input.branchId,actorReference:input.actorId,action:'INVITATION_CREATED',resourceReference:invitation.id}});
 return {id:invitation.id,token,expiresAt:invitation.expiresAt};
}
export async function validInvitation(db:Database,token:string) {
 const invitation=await db.staffInvitation.findUnique({where:{tokenHash:tokenHash(token)},include:{tenant:{select:{name:true,status:true}},branch:{select:{name:true}}}});
 if(!invitation||invitation.acceptedAt||invitation.revokedAt||invitation.expiresAt<=new Date()||invitation.tenant.status==='SUSPENDED')throw new HttpError(400,'INVITATION_INVALID','This invitation is expired, unavailable or already used. Ask your administrator for a new link.');
 return invitation;
}
export async function acceptInvitation(db:Database,token:string,password:string) {
 const invitation=await validInvitation(db,token);
 const existing=await db.user.findUnique({where:{email:invitation.email}});
 if(existing?.passwordHash&&(!existing.active||!await verifyPassword(password,existing.passwordHash)))throw new HttpError(400,'INVITATION_INVALID','For an existing account, enter its current password. Otherwise ask your administrator for help.');
 const passwordHash=existing?.passwordHash??await hashPassword(password);
 await db.$transaction(async tx=>{
  // The conditional update is the one-time claim. A failed transaction restores the invitation.
  const claimed=await tx.staffInvitation.updateMany({where:{id:invitation.id,acceptedAt:null,revokedAt:null,expiresAt:{gt:new Date()},tenant:{status:{not:'SUSPENDED'}}},data:{acceptedAt:new Date()}});
  if(claimed.count!==1)throw new HttpError(400,'INVITATION_INVALID','This invitation is no longer available.');
  const user=existing??await tx.user.create({data:{email:invitation.email,passwordHash,active:true}});
  if(existing&&!existing.passwordHash){
   const changed=await tx.user.updateMany({where:{id:user.id,passwordHash:null},data:{passwordHash,active:true}});
   if(changed.count!==1)throw new HttpError(409,'ACCOUNT_CHANGED','Your account changed. Sign in with its current password and retry the invitation.');
  }
  const member=await tx.membership.upsert({where:{tenantId_userId:{tenantId:invitation.tenantId,userId:user.id}},create:{tenantId:invitation.tenantId,userId:user.id,role:invitation.role,active:true},update:{}});
  // An invitation cannot silently change an existing role or reinstate revoked membership.
  const [locked]=await tx.$queryRaw<{role:string;active:boolean}[]>`SELECT role,active FROM "Membership" WHERE id=${member.id}::uuid AND "tenantId"=${invitation.tenantId}::uuid FOR UPDATE`;
  if(!locked?.active||locked.role!==invitation.role)throw new HttpError(409,'MEMBERSHIP_CONFLICT','An existing membership needs administrator review.');
  await tx.branchAccess.upsert({where:{tenantId_branchId_membershipId:{tenantId:invitation.tenantId,branchId:invitation.branchId,membershipId:member.id}},create:{tenantId:invitation.tenantId,branchId:invitation.branchId,membershipId:member.id},update:{}});
  await tx.controlAudit.create({data:{actorId:user.id,tenantId:invitation.tenantId,action:'INVITATION_ACCEPTED',resourceReference:invitation.id}});
  await tx.auditEvent.create({data:{tenantId:invitation.tenantId,branchId:invitation.branchId,actorReference:user.id,action:'INVITATION_ACCEPTED',resourceReference:invitation.id}});
 });
 return {accepted:true};
}
