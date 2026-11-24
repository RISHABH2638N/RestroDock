import {z} from 'zod';
import {checkoutReceiptSchema,checkoutRequestSchema} from '@restrodock/contracts';

const storageKey='restrodock.guest-checkout.v1';
const stateSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('pending'),cartId:z.uuid(),request:checkoutRequestSchema}).strict(),
 z.object({status:z.literal('confirmed'),cartId:z.uuid(),receipt:checkoutReceiptSchema}).strict(),
]);
export type CheckoutState=z.infer<typeof stateSchema>;

export function readCheckoutState(){
 try{
  const raw=window.sessionStorage.getItem(storageKey);
  return raw?stateSchema.parse(JSON.parse(raw)):null;
 }catch{return null;}
}

export function saveCheckoutState(value:CheckoutState){
 try{
  window.sessionStorage.setItem(storageKey,JSON.stringify(value));
  return true;
 }catch{return false;}
}

export function clearCheckoutState(){
 try{window.sessionStorage.removeItem(storageKey);}catch{/* Tab storage may be disabled. */}
}
