import type {Database} from '../db.js';
import {scopeFromVerifiedMembership,type TenantScope} from './scope.js';
/** INTERNAL: userId must come from verified staff identity (Day 5), never request input. */
export async function scopeForVerifiedUser(db:Database,userId:string,tenantId:string,branchId:string):Promise<TenantScope> {
 const member=await db.membership.findUnique({where:{tenantId_userId:{tenantId,userId}},include:{tenant:{select:{status:true}},user:{select:{active:true}},access:{where:{branchId},select:{branch:{select:{id:true,active:true}}}}}});
 const branch=member?.access[0]?.branch;
 if(!member||!member.active||!member.user.active||!['TRIAL','ACTIVE'].includes(member.tenant.status)||!branch?.active)throw new Error('Tenant or branch access denied.');
 return scopeFromVerifiedMembership({userId,tenantId,branchId:branch.id,role:member.role,tenantActive:true,branchActive:true,membershipActive:true});
}
