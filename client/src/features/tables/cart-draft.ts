import {z} from 'zod';
import {cartSelectionSchema,maxCartLines,maxCartQuantity,priceSelection,type QrContext} from '@restrodock/contracts';

export type MenuItem=QrContext['items'][number];
const lineSchema=cartSelectionSchema.extend({id:z.number().int().positive()});
export type DraftLine=z.infer<typeof lineSchema>;
const draftSchema=z.object({
 cartId:z.uuid(),
 lines:z.array(lineSchema).min(1).max(maxCartLines),
}).strict().refine(draft=>new Set(draft.lines.map(line=>line.id)).size===draft.lines.length
 && draft.lines.reduce((sum,line)=>sum+line.quantity,0)<=maxCartQuantity);

const storageKey='restrodock.guest-cart.v1';

export function secureRandomUuid():string|null{
 const source=globalThis.crypto;
 if(source?.randomUUID)return source.randomUUID();
 if(!source?.getRandomValues)return null;
 const bytes=source.getRandomValues(new Uint8Array(16));
 bytes[6]=(bytes[6]!&0x0f)|0x40;bytes[8]=(bytes[8]!&0x3f)|0x80;
 const hex=Array.from(bytes,value=>value.toString(16).padStart(2,'0')).join('');
 return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
}

export function readCartDraft(){
 try {
  const raw=window.sessionStorage.getItem(storageKey);
  if(!raw)return null;
  const result=draftSchema.safeParse(JSON.parse(raw));
  return result.success?result.data:null;
 }catch{return null;}
}

export function saveCartDraft(cartId:string,lines:DraftLine[]){
 try {
  if(lines.length)window.sessionStorage.setItem(storageKey,JSON.stringify({cartId,lines}));
  else window.sessionStorage.removeItem(storageKey);
  return true;
 }catch{return false;}
}

export function clearCartDraft(){
 try{window.sessionStorage.removeItem(storageKey);}catch{/* Storage may be disabled. */}
}

const currency=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
export const formatEstimate=(minor:number)=>currency.format(minor/100);

export function estimateLine(item:MenuItem|undefined,line:Pick<DraftLine,'variant'|'addons'|'quantity'>){
 const pricing=priceSelection(item,line);
 return pricing?pricing.unitPriceMinor*line.quantity:null;
}
