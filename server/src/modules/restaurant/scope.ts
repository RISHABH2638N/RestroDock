import {z} from 'zod';
import type {Database} from '../../db.js';
import {HttpError} from '../auth/session.js';
export interface SetupScope {readonly userId:string;readonly tenantId:string;readonly branchId:string}
const issued=new WeakSet<object>();
export function requireSetupScope(value:SetupScope){if(!value||!issued.has(value))throw new Error('Verified setup scope is required.');}
/** Auth middleware must supply the verified session user ID, never a browser user ID. */
export async function resolveSetupScope(db:Database,userId:string,query:unknown):Promise<SetupScope> {
 const {tenantId,branchId}=z.object({tenantId:z.uuid(),branchId:z.uuid(),v:z.string().max(64).optional()}).strict().parse(query);
 const member=await db.membership.findFirst({where:{tenantId,userId,active:true,role:'RESTAURANT_ADMIN',user:{active:true},tenant:{status:{not:'SUSPENDED'}},access:{some:{branchId}}},select:{id:true}});
 if(!member)throw new HttpError(403,'FORBIDDEN','Restaurant administrator access to this branch is required.');
 const scope=Object.freeze({userId,tenantId,branchId});issued.add(scope);return scope;
}
