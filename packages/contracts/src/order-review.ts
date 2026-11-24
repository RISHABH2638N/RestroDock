import {z} from 'zod';

export const orderRiskSignals=['LARGE_QUANTITY','HIGH_VALUE','TABLE_BURST','BRANCH_BURST','REPEATED_CART'] as const;
export const rejectionReasons=['DUPLICATE','UNVERIFIED','OTHER_RISK'] as const;
const reviewReason=z.enum(['AUTO_DISPATCHED','VERIFIED_AT_TABLE',...rejectionReasons]);
const version=z.number().int().positive();

export const checkoutIntakeInput=z.object({version,paused:z.boolean()}).strict();
export const orderDecisionInput=z.discriminatedUnion('decision',[
 z.object({version,decision:z.literal('APPROVE'),override:z.boolean()}).strict(),
 z.object({version,decision:z.literal('REJECT'),reason:z.enum(rejectionReasons)}).strict(),
]);

export const reviewOrderSchema=z.object({
 awaitingWaiter:z.boolean().optional(),guestName:z.string().optional(),id:z.uuid(),version,status:z.enum(['AWAITING_REVIEW','PLACED','REJECTED','CANCELLED','ACCEPTED','PREPARING','READY','SERVED']),
 tableLabel:z.string(),createdAt:z.iso.datetime(),estimatedTotalMinor:z.number().int().nonnegative(),
 riskSignals:z.array(z.enum(orderRiskSignals)),reviewReason:reviewReason.nullable(),reviewedAt:z.iso.datetime().nullable(),
 items:z.array(z.object({
  name:z.string(),quantity:z.number().int().positive(),portion:z.string().nullable(),
  addOns:z.array(z.string()),note:z.string(),
 })).max(30),
});
export const checkoutIntakeSchema=z.object({paused:z.boolean(),version});
export const reviewBoardSchema=z.object({
 intake:checkoutIntakeSchema,
 pending:z.array(reviewOrderSchema).max(50),hasMore:z.boolean(),recent:z.array(reviewOrderSchema).max(15),
});
export type OrderDecision=z.infer<typeof orderDecisionInput>;
export type CheckoutIntakeInput=z.infer<typeof checkoutIntakeInput>;
export type ReviewOrder=z.infer<typeof reviewOrderSchema>;

export const kitchenRoles=['CHEF','WORKER','MANAGER'] as const;
export const kitchenStatuses=['AWAITING_REVIEW','PLACED','ACCEPTED','PREPARING','READY','SERVED','REJECTED'] as const;
export const kitchenTicketSchema=reviewOrderSchema.pick({id:true,version:true,tableLabel:true,items:true}).extend({
 status:z.enum(kitchenStatuses),queuedAt:z.iso.datetime(),updatedAt:z.iso.datetime().nullable(),kitchenNote:z.string().nullable(),
});
export const kitchenBoardSchema=z.object({tickets:z.array(kitchenTicketSchema).max(100),hasMore:z.boolean()});
export const kitchenAction=z.object({
 version,action:z.enum(['ACCEPT','REJECT','PREPARE','READY','SERVE']),note:z.string().trim().max(240).optional(),
}).strict().refine(input=>input.action!=='REJECT'||Boolean(input.note),{path:['note'],message:'Enter a reason for rejecting this ticket.'});
