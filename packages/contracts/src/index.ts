import { z } from 'zod';
export const healthSchema = z.object({ service:z.literal('restrodock-api'), status:z.literal('ok'), version:z.string(), requestId:z.string() });
export const readinessSchema = z.object({ status:z.enum(['ready','not_ready']), database:z.enum(['connected','unconfigured','unavailable']), schema:z.enum(['current','pending','unchecked']).default('unchecked') });
export type Health = z.infer<typeof healthSchema>;
export type Readiness = z.infer<typeof readinessSchema>;
export const roles = ['RESTAURANT_ADMIN','MANAGER','CHEF','WORKER','CASHIER'] as const;
export type Role = typeof roles[number];
export interface DemoWorkspace { source:'synthetic_fixture'; tenant:{ name:string; slug:string }; branch:{ name:string }; menu:{ name:string; priceMinor:number; category:string }[]; tables:{ label:string; seats:number }[] }
export const demoWorkspaceSchema = z.object({ source:z.literal('synthetic_fixture'), tenant:z.object({name:z.string(),slug:z.string()}), branch:z.object({name:z.string()}), menu:z.array(z.object({name:z.string(),priceMinor:z.number().int().nonnegative(),category:z.string()})), tables:z.array(z.object({label:z.string(),seats:z.number().int().positive()})) });
export interface ApiError { error:{ code:string; message:string; requestId:string } }
export const identitySchema=z.object({email:z.string(),platformAdmin:z.boolean(),csrfToken:z.string(),expiresAt:z.string(),memberships:z.array(z.object({role:z.enum(roles),tenant:z.object({id:z.string(),name:z.string(),status:z.enum(['DRAFT','TRIAL','ACTIVE','SUSPENDED'])}),access:z.array(z.object({branch:z.object({id:z.string(),name:z.string(),active:z.boolean()})}))}))});
export type StaffIdentity=z.infer<typeof identitySchema>;
export const tenantSummarySchema=z.object({id:z.string(),name:z.string(),slug:z.string(),status:z.enum(['DRAFT','TRIAL','ACTIVE','SUSPENDED']),version:z.number(),createdAt:z.string(),subscription:z.object({planCode:z.string(),status:z.string(),endsAt:z.string().nullable().optional()}).nullable()});
export const tenantListSchema=z.object({items:z.array(tenantSummarySchema),nextCursor:z.string().nullable()});
export type TenantSummary=z.infer<typeof tenantSummarySchema>;
export const billingModeSchema = z.enum(['EXTERNAL_POS', 'RESTRODOCK']);
export type BillingMode = z.infer<typeof billingModeSchema>;
export const tenantDetailSchema=tenantSummarySchema.extend({billingMode:billingModeSchema,usage:z.object({branches:z.number().int().nonnegative(),tables:z.number().int().nonnegative(),staff:z.number().int().nonnegative()}).optional(),branches:z.array(z.object({id:z.string(),name:z.string(),active:z.boolean(),orderingPaused:z.boolean()})),invitations:z.array(z.object({id:z.string(),email:z.string(),expiresAt:z.string()})),checklist:z.array(z.object({key:z.string(),label:z.string(),complete:z.boolean()})),activationAllowed:z.boolean()});
export type TenantDetail=z.infer<typeof tenantDetailSchema>;
export const invitationResultSchema=z.object({link:z.string(),expiresAt:z.string()});
export * from './restaurant.js';
export * from './registration.js';
export * from './tables.js';
export * from './checkout.js';
export * from './order-review.js';

export * from './analytics.js';

export * from './plan-access.js';

export * from './platform-analytics.js';
