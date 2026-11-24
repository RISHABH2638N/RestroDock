import type { Role } from '@restrodock/contracts';
// Unforgeable in this process; never construct scope from request headers/body/URL.
const verified = new WeakSet<object>();
export interface VerifiedMembership { userId:string; tenantId:string; branchId:string; role:Role; tenantActive:boolean; branchActive:boolean; membershipActive:boolean }
export type TenantScope = Readonly<{ userId:string; tenantId:string; branchId:string; role:Role }>;
// Internal auth-policy boundary: Day 5 must call this ONLY after DB session + membership lookup.
export function scopeFromVerifiedMembership(m:VerifiedMembership):TenantScope {
  if (!m.tenantActive || !m.branchActive || !m.membershipActive) throw new Error('Inactive access');
  if (![m.userId,m.tenantId,m.branchId].every(Boolean)) throw new Error('Incomplete scope');
  const scope = Object.freeze({userId:m.userId,tenantId:m.tenantId,branchId:m.branchId,role:m.role});
  verified.add(scope); return scope;
}
export function assertScope(scope:TenantScope) {
  if (!verified.has(scope)) throw new Error('Unverified tenant scope');
}
export function requireRole(scope:TenantScope, allowed:readonly Role[]) {
  assertScope(scope); if (!allowed.includes(scope.role)) throw new Error('Forbidden role');
}
