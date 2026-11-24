import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scopeFromVerifiedMembership,assertScope,requireRole,type TenantScope } from '../../src/security/scope.js';
import { menuRepository } from '../../src/repositories/menu.js';
import type { Database } from '../../src/db.js';
const membership={userId:'user',tenantId:'tenant-a',branchId:'branch-a',role:'CHEF' as const,tenantActive:true,branchActive:true,membershipActive:true};
test('scope cannot be forged by a request-shaped object',()=>{assert.throws(()=>assertScope({userId:'user',tenantId:'tenant-a',branchId:'branch-a',role:'CHEF'}),/Unverified/);});
test('inactive tenant, branch or membership fails closed',()=>{for(const key of ['tenantActive','branchActive','membershipActive'])assert.throws(()=>scopeFromVerifiedMembership({...membership,[key]:false}),/Inactive/);});
test('empty membership identifiers rejected',()=>{assert.throws(()=>scopeFromVerifiedMembership({...membership,tenantId:''}),/Incomplete/);});
test('verified scope is immutable and checks least privilege',()=>{const scope=scopeFromVerifiedMembership(membership);assert.ok(Object.isFrozen(scope));assertScope(scope);requireRole(scope,['CHEF']);assert.throws(()=>requireRole(scope,['RESTAURANT_ADMIN']),/Forbidden/);assert.throws(()=>assertScope({...scope}));});
test('repository scopes list and ID lookup to tenant AND branch',async()=>{
 const calls:unknown[]=[];
 const db={menuItem:{findMany:async(args:unknown)=>{calls.push(args);return [];},findFirst:async(args:unknown)=>{calls.push(args);return null;}}} as unknown as Database;
 const repository=menuRepository(db,scopeFromVerifiedMembership(membership));await repository.list();await repository.find('foreign-menu-id');
 assert.deepEqual((calls[0] as {where:unknown}).where,{tenantId:'tenant-a',branchId:'branch-a',state:'PUBLISHED',reviewRequired:false,category:{archived:false},available:true});
 assert.deepEqual((calls[1] as {where:unknown}).where,{tenantId:'tenant-a',branchId:'branch-a',state:'PUBLISHED',reviewRequired:false,category:{archived:false},id:'foreign-menu-id',available:true});
});
test('repository refuses unverified scopes before touching the database',()=>{assert.throws(()=>menuRepository({} as Database,{} as TenantScope),/Unverified/);});
