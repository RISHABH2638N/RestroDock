import type {Database} from '../../db.js';
import {entrySelection,kitchenRoles} from '@restrodock/contracts';
import {HttpError} from '../auth/session.js';
const issued=new WeakSet<object>();
export interface EntryScope {readonly userId:string;readonly tenantId:string;readonly branchId:string;readonly role:string}
export async function resolveEntryScope(db:Database,userId:string,input:unknown,kitchen=false):Promise<EntryScope>{
 const selection=entrySelection.parse(input);
 const member=await db.membership.findFirst({
  where:{
   tenantId:selection.tenantId,userId,active:true,user:{active:true},
   tenant:{status:{not:'SUSPENDED'}},
   role:{in:kitchen?[...kitchenRoles]:['RESTAURANT_ADMIN','MANAGER','WORKER','CASHIER']},
   access:{some:{branchId:selection.branchId}},
   OR:[
    {role:'RESTAURANT_ADMIN'},
    {tenant:{status:{in:['TRIAL','ACTIVE']}},access:{some:{branchId:selection.branchId,branch:{active:true}}}},
   ],
  },select:{role:true},
 });
 if(!member)throw new HttpError(403,'ENTRY_FORBIDDEN','Assigned table-service access to this branch is required.');
 const scope=Object.freeze({...selection,userId,role:member.role});issued.add(scope);return scope;
}
export function requireEntryScope(scope:EntryScope){if(!issued.has(scope))throw Error('Verified table-entry scope is required.');}
