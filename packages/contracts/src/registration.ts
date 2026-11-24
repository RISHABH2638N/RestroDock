import {z} from 'zod';
import {plainText} from './text.js';

export const planCodes=['TRIAL','STARTER','GROWTH','PRO'] as const;
export const subscriptionStatuses=['TRIAL','ACTIVE','EXPIRED','SUSPENDED'] as const;

export const registrationStatuses=['PENDING','APPROVED','REJECTED','EXPIRED'] as const;
export const registrationSecret=z.string().regex(/^[A-Za-z0-9_-]{43}$/,'Use the complete private tracking link.');
export const restaurantSlug=z.string().min(2).max(80).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/,'Use lowercase letters, numbers and single hyphens.');
export const registrationInput=z.object({
 restaurantName:plainText(z.string().trim().min(2).max(160)),
 branchName:plainText(z.string().trim().min(2).max(160)),
 ownerName:plainText(z.string().trim().min(2).max(100)),
 email:z.email().max(254).transform(value=>value.toLowerCase()),
 phone:z.string().trim().regex(/^\+?[1-9]\d{7,14}$/,'Use 8–15 digits, with an optional leading +.'),
 city:plainText(z.string().trim().min(2).max(100)),
 address:plainText(z.string().trim().min(5).max(300)),
 password:z.string().min(15).max(128),
 ownerAuthorised:z.literal(true,{error:'Confirm that you are authorised to apply for this restaurant.'}),
 trackingSecret:registrationSecret
}).strict();
export type RegistrationInput=z.infer<typeof registrationInput>;
export const registrationStatusInput=z.object({trackingSecret:registrationSecret}).strict();
export const registrationCreatedSchema=z.object({id:z.uuid(),status:z.literal('PENDING'),expiresAt:z.iso.datetime()});
export const registrationPublicSchema=z.object({restaurantName:z.string(),status:z.enum(registrationStatuses),expiresAt:z.iso.datetime(),reviewedAt:z.iso.datetime().nullable(),reason:z.string().nullable(),loginReady:z.boolean()});
export type RegistrationPublic=z.infer<typeof registrationPublicSchema>;
export const registrationDetailSchema=z.object({id:z.uuid(),restaurantName:z.string(),branchName:z.string(),ownerName:z.string(),email:z.string(),phone:z.string(),city:z.string(),address:z.string(),status:z.enum(registrationStatuses),version:z.number().int().positive(),createdAt:z.iso.datetime(),expiresAt:z.iso.datetime(),reviewedAt:z.iso.datetime().nullable(),reason:z.string().nullable(),tenantId:z.uuid().nullable(),suggestedSlug:z.string()});
export type RegistrationDetail=z.infer<typeof registrationDetailSchema>;
export const registrationListSchema=z.object({items:z.array(registrationDetailSchema),nextCursor:z.string().nullable()});
export const registrationDecisionInput=z.discriminatedUnion('decision',[
 z.object({decision:z.literal('APPROVE'),version:z.number().int().positive(),slug:restaurantSlug,planCode:z.enum(planCodes),ownershipConfirmed:z.literal(true,{error:'Verify the applicant contact and restaurant ownership before approval.'})}).strict(),
 z.object({decision:z.literal('REJECT'),version:z.number().int().positive(),reason:plainText(z.string().trim().min(10).max(500))}).strict()
]);
export type RegistrationDecision=z.infer<typeof registrationDecisionInput>;
