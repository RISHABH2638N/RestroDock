import {kitchenRoles} from '@restrodock/contracts';
import type {Role,StaffIdentity} from '@restrodock/contracts';

export const staffRoles = ['MANAGER','CHEF','WORKER','CASHIER'] as const;
export const isStaffRole=(role:Role)=>staffRoles.some(value=>value===role);
export const assignedMemberships=(identity:StaffIdentity)=>identity.memberships.filter(member=>member.tenant.status!=='SUSPENDED');
export type Workspace='platform'|'restaurant'|'staff';
export function workspacesFor(identity:StaffIdentity):Workspace[]{
 const memberships=assignedMemberships(identity),result:Workspace[]=[];
 if(identity.platformAdmin)result.push('platform');
 if(memberships.some(member=>member.role==='RESTAURANT_ADMIN'))result.push('restaurant');
 if(memberships.some(member=>isStaffRole(member.role)))result.push('staff');
 return result;
}
export const workspacePath={platform:'/super-admin',restaurant:'/restaurant',staff:'/staff'} as const;
export function defaultWorkspace(identity:StaffIdentity){const kind=workspacesFor(identity)[0]??'staff';return kind==='staff'?staffHome(identity):workspacePath[kind];}
export function workspaceForPath(path:string):Workspace|null{
 return (Object.keys(workspacePath) as Workspace[]).find(key=>path===workspacePath[key]||path.startsWith(workspacePath[key]+'/'))??null;
}
export const staffTitles={MANAGER:'Manager',CHEF:'Chef',WORKER:'Waiter',CASHIER:'Cashier'} as const;
const staffLanding={MANAGER:'/staff/order-review',CHEF:'/staff/kitchen',WORKER:'/staff/tables',CASHIER:'/staff/billing'} as const;

export function staffHome(identity:StaffIdentity){
 const active=assignedMemberships(identity).find(member=>
  isStaffRole(member.role)&&['TRIAL','ACTIVE'].includes(member.tenant.status)&&member.access.some(({branch})=>branch.active)
 );
 return active?staffLanding[active.role as keyof typeof staffLanding]:workspacePath.staff;
}

export const staffSections = [
 {href:'/staff/tables',label:'Manage tables',icon:'tables',roles:['MANAGER','WORKER','CASHIER']},
 {href:'/staff/assistance',label:'Guest assistance',icon:'assistance',roles:['MANAGER','WORKER']},
 {href:'/staff/kitchen',label:'Kitchen tickets',icon:'kitchen',roles:kitchenRoles},
 {href:'/staff/order-review',label:'Order review',icon:'review',roles:['MANAGER','WORKER']},
 {href:'/staff/billing',label:'Billing queue',icon:'billing',roles:['MANAGER','WORKER','CASHIER']},
] as const;

export function staffSectionsFor(identity:StaffIdentity){
 const memberships=assignedMemberships(identity);
 return staffSections.filter(section=>memberships.some(member=>
  ['TRIAL','ACTIVE'].includes(member.tenant.status)&&member.access.some(({branch})=>branch.active)&&section.roles.some(role=>role===member.role)
 ));
}
