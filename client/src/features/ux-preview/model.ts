/** Day 2 UI-only state. No API, database, token, Socket.IO or persistence access. */
export type PreviewView = 'overview'|'guest'|'kitchen'|'cashier'|'restaurant'|'platform'|'ui-kit';
export type Scenario = 'normal'|'loading'|'empty'|'error'|'offline';
export const previewViews = ['overview','guest','kitchen','cashier','restaurant','platform','ui-kit'] as const;
export function previewEnabled(environment:string|undefined, flag:string|undefined) {
  return (environment === 'development' || environment === 'test') && flag === 'true';
}
export function resolveView(parts:readonly string[] = []):PreviewView|null {
  if (!parts.length) return 'overview';
  return parts.length === 1 && previewViews.includes(parts[0] as PreviewView) ? parts[0] as PreviewView : null;
}
export interface SampleItem { id:string; name:string; category:string; description:string; priceMinor:number; available:boolean }
export const sampleMenu:readonly SampleItem[] = [
  {id:'paneer',name:'Paneer tikka',category:'Starters',description:'Chargrilled paneer, peppers and mint chutney.',priceMinor:24000,available:true},
  {id:'dal',name:'Dal tadka',category:'Main course',description:'Yellow lentils with a tempered spice finish.',priceMinor:16000,available:true},
  {id:'naan',name:'Butter naan',category:'Breads',description:'Tandoor-baked bread brushed with butter.',priceMinor:4500,available:true},
  {id:'raita',name:'Boondi raita',category:'Sides',description:'Seasoned yoghurt with crisp boondi.',priceMinor:8000,available:false}
];
export type Cart = Readonly<Record<string,number>>;
export function changeQuantity(cart:Cart, id:string, delta:number):Cart {
  const item=sampleMenu.find(i=>i.id===id);
  if (!item?.available || !Number.isSafeInteger(delta)) return cart;
  const quantity=Math.max(0,Math.min(5,(cart[id]??0)+delta));
  const next={...cart}; if(quantity)next[id]=quantity;else delete next[id];return next;
}
export function cartLines(cart:Cart) {
 return sampleMenu.filter(item=>item.available && (cart[item.id]??0)>0).map(item=>({...item,quantity:Math.min(5,Math.max(0,Math.trunc(cart[item.id]??0)))}));
}
export const cartTotal=(cart:Cart)=>cartLines(cart).reduce((sum,item)=>sum+item.quantity*item.priceMinor,0);
export const formatMoney=(minor:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:2}).format(minor/100);
export interface ValidationIssue<Field extends string> { field:Field; message:string }
export type JoinIssue=ValidationIssue<'pin'|'name'|'mobile'>;
export function validateSampleJoin(pin:string,name:string,mobile:string):JoinIssue|null {
 if(pin!=='246810')return {field:'pin',message:'Use sample PIN 246810 to continue this local preview.'};
 if(!name.trim()||name.trim().length>60)return {field:'name',message:'Enter a sample name between 1 and 60 characters.'};
 if(mobile!=='0000000000')return {field:'mobile',message:'Use sample mobile 0000000000. Do not enter a real phone number.'};
 return null;
}
export type SampleOrderStatus='PLACED'|'AWAITING_REVIEW'|'ACCEPTED'|'PREPARING'|'READY'|'SERVED'|'REJECTED';
export type KitchenRole='CHEF'|'WORKER';
export interface SampleOrder { id:string; table:string; summary:string; status:SampleOrderStatus; note:string }
export const sampleOrders:readonly SampleOrder[]=[
 {id:'SAMPLE-01',table:'Table 03',summary:'2 Paneer tikka · 2 Butter naan',status:'PLACED',note:'No additional instructions.'},
 {id:'SAMPLE-02',table:'Table 01',summary:'1 Dal tadka · 3 Butter naan',status:'PREPARING',note:'Sample instruction: mild spice.'},
 {id:'SAMPLE-03',table:'Table 06',summary:'1,000 Butter naan',status:'AWAITING_REVIEW',note:'Illustrative risk hold. Manager review required; never dispatch to preparation.'}
];
export function kitchenAction(status:SampleOrderStatus,role:KitchenRole):{target:SampleOrderStatus;label:string}|null {
 if(role==='WORKER')return status==='READY'?{target:'SERVED',label:'Preview served'}:null;
 if(status==='PLACED')return {target:'ACCEPTED',label:'Preview acceptance'};
 if(status==='ACCEPTED')return {target:'PREPARING',label:'Preview preparation'};
 if(status==='PREPARING')return {target:'READY',label:'Preview ready'};
 return null;
}
export function transitionSampleOrder(order:SampleOrder,target:SampleOrderStatus,role:KitchenRole,reason=''):SampleOrder {
 const allowed=kitchenAction(order.status,role)?.target===target;
 const rejection=role==='CHEF' && (order.status==='PLACED'||order.status==='ACCEPTED') && target==='REJECTED' && !!reason.trim();
 if(!allowed&&!rejection)throw new Error('This preview role cannot make that transition.');
 return {...order,status:target,...(rejection?{note:reason.trim()}: {})};
}
export function parseMoney(value:string):number|null {
 if(!/^\d{1,7}(\.\d{1,2})?$/.test(value.trim()))return null;
 const [major='0',fraction='']=value.trim().split('.');
 return Number(major)*100+Number(fraction.padEnd(2,'0'));
}
export type CashierStep='summary'|'reference'|'confirmed';
export type SettlementIssue=ValidationIssue<'reference'|'amount'|'acknowledgement'>;
export function validateSampleSettlement(reference:string,amount:string,acknowledged:boolean):SettlementIssue|null {
 if(!reference.trim()||reference.trim().length>80)return {field:'reference',message:'Enter a sample POS reference between 1 and 80 characters.'};
 const minor=parseMoney(amount);if(minor===null||minor<=0)return {field:'amount',message:'Enter a positive sample amount with no more than two decimal places.'};
 if(!acknowledged)return {field:'acknowledgement',message:'Acknowledge that this is a local preview and no payment is verified.'};
 return null;
}
