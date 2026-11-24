import {z} from 'zod';
import {plainText} from './text.js';
export const entrySecret=z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const entrySelection=z.object({tenantId:z.uuid(),branchId:z.uuid()}).strict();
const version=z.number().int().positive();
export const tableFields=z.object({label:plainText(z.string().trim().min(1).max(80)),section:plainText(z.string().trim().min(1).max(80)),seats:z.number().int().min(1).max(30),archived:z.boolean()}).strict();
export const tableCreate=tableFields.omit({archived:true}).extend({revision:version});
export const tableEdit=tableFields.extend({version});
export const entryPublish=z.object({revision:version,enabled:z.boolean(),confirmed:z.literal(true)}).strict();
export const entryVersion=z.object({version}).strict();
export const sessionOpen=z.object({version,durationMinutes:z.number().int().min(15).max(240)}).strict();
export const qrLookup=z.object({qrToken:entrySecret}).strict();
export const guestJoin=qrLookup.extend({sessionId:z.uuid(),pinVersion:version,pin:z.string().regex(/^\d{6}$/,'Enter the six-digit PIN supplied by staff.'),displayName:plainText(z.string().trim().min(2).max(100)),mobile:z.string().regex(/^\+?[1-9]\d{7,14}$/,'Use 8–15 digits and an optional leading +.'),privacyAccepted:z.literal(true),guestSecret:entrySecret}).strict();
export const guestRequest=guestJoin.omit({sessionId:true,pinVersion:true,pin:true});
export const entrySessionSchema=z.object({awaitingWaiter:z.boolean().optional(),id:z.uuid(),version,pinVersion:version,state:z.enum(['OPEN','BILL_REQUESTED','CLOSED']),expiresAt:z.iso.datetime(),pinExpiresAt:z.iso.datetime().nullable(),locked:z.boolean(),guestCount:z.number().int(),entryOnly:z.boolean(),singleGuest:z.boolean().optional(),assistanceRequestedAt:z.iso.datetime().nullable().optional(),billRequestedAt:z.iso.datetime().nullable().optional(),orders:z.array(z.object({id:z.uuid(),status:z.string(),estimatedTotalMinor:z.number().int().nonnegative(),items:z.array(z.object({nameSnapshot:z.string(),quantity:z.number().int(),portionNameSnapshot:z.string().nullable(),addOnSnapshots:z.array(z.object({name:z.string()})).optional()})).optional()})).optional()});
export const diningReceiptSchema=z.object({
 reference:z.string(),issuedAt:z.iso.datetime(),totalMinor:z.number().int().nonnegative(),
 paymentMethod:z.enum(['CASH','UPI']),restaurantName:z.string(),branchName:z.string(),tableLabel:z.string(),
 lines:z.array(z.object({description:z.string(),quantity:z.number().int().positive(),amountMinor:z.number().int().nonnegative()})),
});
export const entryTableSchema=tableFields.extend({id:z.uuid(),version,qrActive:z.boolean(),lastSettledSessionId:z.uuid().optional(),receipt:diningReceiptSchema.optional(),session:entrySessionSchema.nullable()});
export const tableBoardSchema=z.object({waiterConfirmation:z.boolean().optional(),revision:version,entryPublished:z.boolean(),restaurantName:z.string(),branchName:z.string(),billingMode:z.enum(['EXTERNAL_POS','RESTRODOCK']).optional(),canManage:z.boolean(),canOpen:z.boolean(),canClose:z.boolean(),canSettle:z.boolean().optional(),canResumeBilling:z.boolean().optional(),items:z.array(entryTableSchema)});
export type TableBoard=z.infer<typeof tableBoardSchema>;
export const tableActionSchema=z.object({board:tableBoardSchema,pin:z.string().optional(),qr:z.object({url:z.string(),pngDataUrl:z.string().startsWith('data:image/png;base64,')}).optional()});
export const qrContextSchema=z.object({waiterConfirmation:z.boolean().optional(),deferredVerification:z.boolean().optional(),assistanceEnabled:z.boolean().optional(),restaurantName:z.string(),branchName:z.string(),tableLabel:z.string(),section:z.string(),entryOnly:z.literal(true),orderingEnabled:z.boolean(),session:z.object({id:z.uuid(),pinVersion:version,expiresAt:z.iso.datetime(),canJoin:z.boolean(),occupied:z.boolean().optional()}).nullable(),categories:z.array(z.object({id:z.uuid(),name:z.string()})),items:z.array(z.object({id:z.uuid(),categoryId:z.uuid(),name:z.string(),description:z.string(),priceMinor:z.number().int(),available:z.boolean(),foodType:z.string(),variants:z.array(z.object({name:z.string(),priceMinor:z.number().int(),available:z.boolean()})),addons:z.array(z.object({name:z.string(),priceMinor:z.number().int(),available:z.boolean()}))}))});
export type QrContext=z.infer<typeof qrContextSchema>;
export const guestViewSchema=z.object({joined:z.literal(true),cartId:z.uuid(),displayName:z.string(),expiresAt:z.iso.datetime(),csrfToken:z.string(),entryOnly:z.literal(true),orderingEnabled:z.boolean(),awaitingWaiter:z.boolean().optional()});
export type GuestView=z.infer<typeof guestViewSchema>;
export const guestCartContextSchema=z.object({context:qrContextSchema,guest:guestViewSchema});

export const billSessionInput=entryVersion.extend({sessionId:z.uuid()});
export const settlementInput=billSessionInput.extend({
 externalBillReference:z.string().trim().min(1).max(160).optional(),
 billingMode:z.literal('RESTRODOCK').optional(),
 paymentMethod:z.enum(['CASH','UPI']),
 confirmed:z.literal(true),
});

export const reopenSettledInput=sessionOpen.extend({settledSessionId:z.uuid(),approved:z.literal(true)});

export const tableSectionInput=z.object({
 section:tableFields.shape.section,
 tables:z.array(z.object({id:z.uuid(),version}).strict()).min(1).max(20)
  .refine(tables=>new Set(tables.map(table=>table.id)).size===tables.length,'Select each table only once.'),
}).strict();
