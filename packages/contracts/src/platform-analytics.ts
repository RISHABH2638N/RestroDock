import {z} from 'zod';

export const platformAnalyticsPageSize=20;
const count=z.number().int().nonnegative();
export const platformTenantStatuses=['DRAFT','TRIAL','ACTIVE','SUSPENDED'] as const;
const tenantStatus=z.enum(platformTenantStatuses);
const subscriptionStatus=z.enum(['TRIAL','ACTIVE','EXPIRED','SUSPENDED']);
export const platformPeriodSchema=z.object({days:z.enum(['7','30','90']).default('30')}).strict();
export const platformDirectoryQuerySchema=platformPeriodSchema.extend({
 q:z.string().trim().max(100).default(''),
 plan:z.string().trim().min(1).max(40).optional(),
 status:tenantStatus.optional(),
 attention:z.enum(['setup','qr','renewal','idle']).optional(),
 page:z.coerce.number().int().min(1).max(10000).default(1),
});
export const platformAnalyticsSchema=z.object({
 from:z.iso.date(),to:z.iso.date(),
 restaurants:z.record(tenantStatus,count),branches:count,tables:count,qrTables:count,
 plans:z.array(z.object({plan:z.string().nullable(),status:subscriptionStatus.nullable(),count})),
 applications:z.object({received:count,approved:count,rejected:count,pending:count}),
 attention:z.object({setup:count,qr:count,renewal:count,idle:count}),
 activity:z.object({restaurants:count,total:count,days:z.array(z.object({date:z.iso.date(),orders:count}))}),
});
const branch=z.object({id:z.uuid(),name:z.string(),active:z.boolean(),published:z.boolean(),tables:count,qrTables:count,orders:count});
export const platformRestaurantSchema=z.object({
 id:z.uuid(),name:z.string(),status:tenantStatus,slug:z.string(),
 plan:z.string().nullable(),subscriptionStatus:subscriptionStatus.nullable(),endsAt:z.iso.datetime().nullable(),
 branches:count,tables:count,qrTables:count,orders:count,
});
export const platformDirectorySchema=z.object({items:z.array(platformRestaurantSchema),total:count});
export const platformBranchesSchema=z.object({items:z.array(branch)});
