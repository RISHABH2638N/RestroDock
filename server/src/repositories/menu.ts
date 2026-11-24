import type { Database } from '../db.js';
import { assertScope, type TenantScope } from '../security/scope.js';
// Data plane only. There is deliberately no generic unscoped CRUD repository.
export function menuRepository(db:Database, scope:TenantScope) {
  assertScope(scope);
  const where = { tenantId:scope.tenantId, branchId:scope.branchId, state:'PUBLISHED', reviewRequired:false, category:{archived:false} };
  return Object.freeze({
    list:() => db.menuItem.findMany({where:{...where,available:true},select:{id:true,name:true,priceMinor:true,categoryId:true},orderBy:{name:'asc'}}),
    find:(id:string) => db.menuItem.findFirst({where:{...where,id,available:true},select:{id:true,name:true,priceMinor:true}})
  });
}
