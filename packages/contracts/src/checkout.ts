import {z} from 'zod';
import {plainNote} from './text.js';

export const maxCartQuantity=100;
export const maxLineQuantity=50;
export const maxCartLines=30;
export const maxNoteLength=200;
const optionName=z.string().min(1).max(80);
const minorUnits=z.number().int().min(0).max(2147483647);

export const cartSelectionSchema=z.object({
 itemId:z.uuid(),
 variant:optionName.nullable(),
 addons:z.array(optionName).max(12).refine(names=>new Set(names).size===names.length),
 quantity:z.number().int().min(1).max(maxLineQuantity),
 note:plainNote(z.string().max(maxNoteLength)),
}).strict();

export const checkoutRequestSchema=z.object({
 key:z.uuid(),
 cartId:z.uuid(),
 lines:z.array(cartSelectionSchema.extend({expectedUnitPriceMinor:minorUnits})).min(1).max(maxCartLines),
}).strict().refine(request=>request.lines.reduce((sum,line)=>sum+line.quantity,0)<=maxCartQuantity,'Reduce the number of items in the order.');

export const checkoutReceiptSchema=z.object({
 orderId:z.uuid(),
 status:z.enum(['AWAITING_REVIEW','PLACED']),
 estimatedTotalMinor:minorUnits,
 createdAt:z.iso.datetime(),
}).strict();
export type CheckoutRequest=z.infer<typeof checkoutRequestSchema>;
export type CheckoutReceipt=z.infer<typeof checkoutReceiptSchema>;

type Option={name:string;priceMinor:number;available:boolean};
type PricedItem={available:boolean;priceMinor:number;variants:Option[];addons:Option[]};
export function priceSelection(item:PricedItem|undefined,selection:Pick<z.infer<typeof cartSelectionSchema>,'variant'|'addons'>){
 if(!item?.available)return null;
 const portion=item.variants.find(option=>option.name===selection.variant&&option.available);
 if(!portion&&(item.variants.length>0||selection.variant!==null))return null;
 const addons:{name:string;priceMinor:number}[]=[];
 for(const name of selection.addons){
  const option=item.addons.find(addon=>addon.name===name&&addon.available);
  if(!option)return null;
  addons.push({name:option.name,priceMinor:option.priceMinor});
 }
 const portionPriceMinor=portion?.priceMinor??item.priceMinor;
 return {portionNameSnapshot:portion?.name??null,portionPriceMinor,addOnSnapshots:addons,
  unitPriceMinor:addons.reduce((sum,addon)=>sum+addon.priceMinor,portionPriceMinor)};
}

export const guestOrdersSchema=z.object({
 billRequestedAt:z.iso.datetime().nullable().optional(),
 orders:z.array(checkoutReceiptSchema.extend({
  status:z.enum(['AWAITING_REVIEW','PLACED','ACCEPTED','PREPARING','READY','SERVED','REJECTED','CANCELLED']),
 })),
});
