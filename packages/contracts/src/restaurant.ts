import {planAccessSchema} from './plan-access.js';
import {z} from 'zod';
import {plainText,plainNote} from './text.js';
export const foodTypes=['UNSPECIFIED','VEG','NON_VEG','EGG'] as const;
export const menuStates=['DRAFT','PUBLISHED','ARCHIVED'] as const;
export const setupVersion=z.number().int().positive();
export const money=z.number().int().min(1).max(10000000);
const zone=z.string().max(80).refine(value=>{try{new Intl.DateTimeFormat('en',{timeZone:value});return true;}catch{return false;}},'Use a valid IANA timezone.');
export const profileInput=z.object({version:setupVersion,displayName:plainText(z.string().trim().max(160)),branchName:plainText(z.string().trim().min(2).max(160)),address:plainText(z.string().trim().max(300)),contactEmail:z.union([z.email().max(254),z.literal('')]),contactPhone:z.string().regex(/^(\+?[0-9]{10,15})?$/,'Use 10–15 digits, with an optional leading +.'),timezone:zone}).strict();
const clock=z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);
export const hoursDay=z.object({day:z.number().int().min(0).max(6),closed:z.boolean(),opens:clock,closes:clock,closesNextDay:z.boolean()}).strict().refine(value=>{if(value.closed)return true;const minute=(s:string)=>Number(s.slice(0,2))*60+Number(s.slice(3));const duration=minute(value.closes)-minute(value.opens)+(value.closesNextDay?1440:0);return duration>0&&duration<=1440;},'Closing time must follow opening time; mark next day for overnight service.');
export const weeklyHours=z.array(hoursDay).length(7).refine(days=>new Set(days.map(day=>day.day)).size===7,'Provide each weekday exactly once.');
export const hoursInput=z.object({version:setupVersion,hours:weeklyHours,lastSeatingMinutes:z.union([z.literal(15),z.literal(30)]).nullable().optional()}).strict();
export const safetyInput=z.object({version:setupVersion,maxItemQuantity:z.number().int().min(1).max(50),maxOrderQuantity:z.number().int().min(1).max(100),maxOrderValueMinor:z.number().int().min(100).max(50000000),approvalQuantity:z.number().int().min(1).max(100).nullish(),approvalValueMinor:z.number().int().min(1).max(50000000).nullish(),pinExpiryMinutes:z.number().int().min(5).max(30),acknowledged:z.literal(true)}).strict().refine(value=>value.maxOrderQuantity>=value.maxItemQuantity,'Order quantity limit must cover the per-item limit.').superRefine((value,ctx)=>{
 if(value.approvalQuantity!=null&&value.approvalQuantity>value.maxOrderQuantity)ctx.addIssue({code:'custom',path:['approvalQuantity'],message:'Use a threshold at or below the maximum order quantity.'});
 if(value.approvalValueMinor!=null&&value.approvalValueMinor>value.maxOrderValueMinor)ctx.addIssue({code:'custom',path:['approvalValueMinor'],message:'Use a threshold at or below the maximum order value.'});
});
export const posInput=z.object({version:setupVersion,billingMode:z.literal('EXTERNAL_POS_MANUAL'),kitchenSource:z.literal('RESTRODOCK'),posName:plainText(z.string().trim().max(100)),posInstructions:plainNote(z.string().trim().max(500)),acknowledged:z.literal(true)}).strict();
export const flagsInput=z.object({version:setupVersion,assistanceEnabled:z.boolean(),menuPhotosEnabled:z.boolean(),orderingPaused:z.boolean()}).strict();
export const categoryInput=z.object({revision:setupVersion,name:plainText(z.string().trim().min(1).max(100)),sortOrder:z.number().int().min(0).max(9999),archived:z.boolean().default(false)}).strict();
export const optionInput=z.object({name:plainText(z.string().trim().min(1).max(80)),priceMinor:z.number().int().min(0).max(10000000),available:z.boolean()}).strict();
const uniqueOptions=z.array(optionInput).max(12).refine(rows=>new Set(rows.map(row=>row.name.toLowerCase())).size===rows.length,'Option names must be unique.');
export const itemFields=z.object({categoryId:z.uuid(),name:plainText(z.string().trim().min(1).max(160)),description:plainNote(z.string().trim().max(1000)),priceMinor:money,foodType:z.enum(foodTypes),available:z.boolean(),state:z.enum(menuStates),sortOrder:z.number().int().min(0).max(9999),variants:uniqueOptions.refine(rows=>rows.every(row=>row.priceMinor>0),'Variant prices must be greater than zero.'),addons:uniqueOptions}).strict();
export const itemInput=itemFields.extend({revision:setupVersion}).strict();
export const importRow=z.object({name:z.string().trim().min(1).max(160),priceMinor:money,foodType:z.enum(foodTypes),description:z.string().trim().max(300).default('')}).strict();
export const importInput=z.object({revision:setupVersion,requestKey:z.uuid(),categoryId:z.uuid(),rows:z.array(importRow).min(1).max(20)}).strict();
export const revisionInput=z.object({revision:setupVersion}).strict();
export interface SetupView {
 planAccess?:z.infer<typeof planAccessSchema>|undefined;
 version:number;branch:{id:string;name:string;timezone:string;active:boolean;orderingPaused:boolean};
 profile:{displayName:string;address:string;contactEmail:string;contactPhone:string};
 hours:z.infer<typeof weeklyHours>;
 lastSeatingMinutes?:15|30|null|undefined;
 safety:{maxItemQuantity:number;maxOrderQuantity:number;maxOrderValueMinor:number;approvalQuantity?:number|null|undefined;approvalValueMinor?:number|null|undefined;pinExpiryMinutes:number;configured:boolean};
 pos:{posName:string;posInstructions:string;configured:boolean};
 flags:{assistanceEnabled:boolean;menuPhotosEnabled:boolean};logoUrl:string|null;
 checklist:{key:string;label:string;complete:boolean}[];configurationReady:boolean;submittedAt:string|null;activationAllowed:false;
 staff:{membershipId:string;email:string;role:string;active:boolean;canChangeRole?:boolean|undefined}[];
}
export interface Catalogue {
 revision:number;categories:{id:string;name:string;sortOrder:number;archived:boolean}[];
 items:(z.infer<typeof itemFields>&{id:string;source:string;reviewRequired:boolean;photoUrl:string|null})[];
}
export function rupeesToMinor(value:string):number {
 if(!/^\d{1,6}(\.\d{1,2})?$/.test(value.trim()))throw new Error('Enter a rupee amount with at most two decimal places.');
 const [whole,fraction='']=value.trim().split('.');return Number(whole)*100+Number(fraction.padEnd(2,'0'));
}
const categoryView=z.object({id:z.string(),name:z.string(),sortOrder:z.number().int(),archived:z.boolean()});
export const catalogueSchema=z.object({revision:setupVersion,categories:z.array(categoryView),items:z.array(itemFields.extend({id:z.string(),source:z.string(),reviewRequired:z.boolean(),photoUrl:z.string().nullable()}))});
export const setupViewSchema=z.object({planAccess:planAccessSchema.optional(),version:setupVersion,branch:z.object({id:z.string(),name:z.string(),timezone:z.string(),active:z.boolean(),orderingPaused:z.boolean()}),profile:z.object({displayName:z.string(),address:z.string(),contactEmail:z.string(),contactPhone:z.string()}),hours:weeklyHours,lastSeatingMinutes:z.union([z.literal(15),z.literal(30)]).nullable().optional(),safety:z.object({maxItemQuantity:z.number().int(),maxOrderQuantity:z.number().int(),maxOrderValueMinor:z.number().int(),approvalQuantity:z.number().int().nullish(),approvalValueMinor:z.number().int().nullish(),pinExpiryMinutes:z.number().int(),configured:z.boolean()}),pos:z.object({posName:z.string(),posInstructions:z.string(),configured:z.boolean()}),flags:z.object({assistanceEnabled:z.boolean(),menuPhotosEnabled:z.boolean()}),logoUrl:z.string().nullable(),checklist:z.array(z.object({key:z.string(),label:z.string(),complete:z.boolean()})),configurationReady:z.boolean(),submittedAt:z.string().nullable(),activationAllowed:z.literal(false),staff:z.array(z.object({membershipId:z.string(),email:z.string(),role:z.string(),active:z.boolean(),canChangeRole:z.boolean().optional()}))});

export const branchStaffRoles=['MANAGER','CHEF','WORKER','CASHIER'] as const;
export const staffRoleInput=z.object({version:setupVersion,role:z.enum(branchStaffRoles)}).strict();
export const menuAvailabilityInput=z.object({
 revision:setupVersion,
 ids:z.array(z.uuid()).min(1).max(20).refine(ids=>new Set(ids).size===ids.length,'Select each item only once.'),
 available:z.boolean(),
}).strict();
export const auditPageSchema=z.object({
 events:z.array(z.object({
  id:z.uuid(),action:z.string(),resource:z.string(),actor:z.enum(['Staff','Guest','System']),createdAt:z.iso.datetime(),
 })),
 nextCursor:z.uuid().nullable(),
 timezone:z.string(),
});
