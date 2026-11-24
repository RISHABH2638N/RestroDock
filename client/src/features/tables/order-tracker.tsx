'use client';

import {useEffect,useRef,useState,type RefObject} from 'react';
import {guestOrdersSchema,type GuestView} from '@restrodock/contracts';
import {Check,ReceiptText} from 'lucide-react';
import {AccessError,accessRequest,errorText} from '../access/api';
import {formatEstimate} from './cart-draft';

type Order=ReturnType<typeof guestOrdersSchema.parse>['orders'][number];
const copy={
 en:{
  title:'Your orders',order:'Order',language:'हिन्दी',estimate:'Estimate',progress:'Order progress',
  steps:['Received','Preparing','Ready','Served'],
  labels:{AWAITING_REVIEW:'Awaiting approval',PLACED:'Sent to kitchen',ACCEPTED:'Accepted by kitchen',PREPARING:'Preparing',READY:'Ready to serve',SERVED:'Served',REJECTED:'Order declined',CANCELLED:'Order cancelled'},
  loading:'Checking order status…',current:'Updates automatically while this page is open.',retrying:'Updates are delayed. We’ll retry automatically.',
  ended:'Table session ended. Ask staff if you need your final bill.',
  bill:'Request bill',sending:'Requesting bill…',requested:'Bill requested',invoice:'Staff will bring the final bill. New orders are paused.',
  confirm:'Request the final bill for this table?',confirmNote:'Ordering pauses after the request. Ask staff if you want to order again.',cancel:'Keep ordering',
  finalBill:'The restaurant provides the final bill.',
 },
 hi:{
  title:'आपके ऑर्डर',order:'ऑर्डर',language:'English',estimate:'अनुमानित राशि',progress:'ऑर्डर की स्थिति',
  steps:['मिल गया','बन रहा है','तैयार है','परोसा गया'],
  labels:{AWAITING_REVIEW:'मंज़ूरी बाकी है',PLACED:'रसोई में भेजा गया',ACCEPTED:'रसोई ने स्वीकार किया',PREPARING:'बन रहा है',READY:'परोसने के लिए तैयार',SERVED:'परोसा गया',REJECTED:'ऑर्डर अस्वीकार हुआ',CANCELLED:'ऑर्डर रद्द हुआ'},
  loading:'ऑर्डर की स्थिति देख रहे हैं…',current:'इस पेज पर स्थिति अपने आप अपडेट होती है।',retrying:'अपडेट में देरी है। हम फिर कोशिश करेंगे।',
  ended:'टेबल सत्र समाप्त हो गया। बिल के लिए स्टाफ़ से पूछें।',
  bill:'बिल माँगें',sending:'बिल का अनुरोध भेज रहे हैं…',requested:'बिल माँगा गया',invoice:'स्टाफ़ अंतिम बिल लाएगा। नए ऑर्डर अभी बंद हैं।',
  confirm:'इस टेबल का अंतिम बिल माँगें?',confirmNote:'बिल माँगने के बाद नए ऑर्डर रुक जाते हैं। फिर से ऑर्डर करने के लिए स्टाफ़ से पूछें।',cancel:'ऑर्डर जारी रखें',
  finalBill:'अंतिम बिल रेस्टोरेंट देगा।',
 },
};
const progress:Partial<Record<Order['status'],number>>={PLACED:0,ACCEPTED:0,PREPARING:1,READY:2,SERVED:3};

export function OrderTracker({guest,receipt,heading}:{guest:GuestView;receipt:Order|null;heading:RefObject<HTMLHeadingElement|null>}){
 const [orders,setOrders]=useState<Order[]|null>(null);
 const [billRequested,setBillRequested]=useState(false);
 const [billing,setBilling]=useState(false);
 const confirmation=useRef<HTMLDivElement>(null);
 const billTrigger=useRef<HTMLButtonElement>(null);
 const billSuccess=useRef<HTMLDivElement>(null);
 const [confirming,setConfirming]=useState(false);
 const [billError,setBillError]=useState('');
 const [language,setLanguage]=useState<'en'|'hi'>('en');
 const [state,setState]=useState<'loading'|'current'|'retrying'|'ended'>('loading');
 const billRevision=useRef(0);
 const billBusy=useRef(false);
 const text=copy[language];

 useEffect(()=>{
  let active=true,reading=false,ended=false;
  async function refresh(){
   if(reading||ended||document.hidden)return;
   reading=true;
   const revision=billRevision.current;
   try{
    const result=guestOrdersSchema.parse(await accessRequest('/guest/order-status',{method:'POST',csrf:guest.csrfToken,body:{}}));
    if(active){
     setOrders(result.orders);
     if(revision===billRevision.current&&!billBusy.current)setBillRequested(!!result.billRequestedAt);
     setState('current');
    }
   }catch(error){
    if(!active)return;
    ended=error instanceof AccessError&&error.status===401;
    setState(ended?'ended':'retrying');
   }finally{reading=false;}
  }
  void refresh();
  const timer=setInterval(()=>void refresh(),15000);
  document.addEventListener('visibilitychange',refresh);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh);};
 },[guest.csrfToken,receipt?.orderId]);

 useEffect(()=>{
  if(confirming)confirmation.current?.focus();
 },[confirming]);

 async function requestBill(){
  if(billBusy.current)return;
  billBusy.current=true;
  billRevision.current++;
  setBilling(true);
  setBillError('');
  try{
   await accessRequest('/guest/bill',{method:'POST',csrf:guest.csrfToken,body:{}});
   setBillRequested(true);
   setConfirming(false);
   window.requestAnimationFrame(()=>billSuccess.current?.focus());
  }catch(error){setBillError(errorText(error));}
  finally{billRevision.current++;billBusy.current=false;setBilling(false);}
 }
 const visible=receipt&&!orders?.some(order=>order.orderId===receipt.orderId)?[receipt,...(orders??[])]:orders??[];
 if(!visible.length&&state!=='ended')return null;
 return <section className="guest-order-confirmation" aria-labelledby="guest-order-heading" lang={language}>
  <div className="guest-order-header">
   <h4 id="guest-order-heading" ref={heading} tabIndex={-1}>{text.title}</h4>
   <button type="button" className="text-button" lang={language==='en'?'hi':'en'} onClick={()=>setLanguage(language==='en'?'hi':'en')}>{text.language}</button>
  </div>
  <p className="guest-item-detail" role="status">{guest.awaitingWaiter?(language==='hi'?'वेटर आपकी टेबल पर पहला ऑर्डर पक्का करेगा, फिर रसोई में भेजा जाएगा।':'Your waiter will confirm your first order at the table before it reaches the kitchen.'):text[state]}</p>
  {visible.length>0&&<ul className="guest-tracking-list">{visible.map(order=>{
   const step=progress[order.status];
   return <li key={order.orderId}>
    <div className="guest-tracking-order">
     <div><strong aria-live="polite">{text.labels[order.status]}</strong><p title={order.orderId}>{text.order} #{order.orderId.slice(0,8)}</p></div>
     <div><strong>{formatEstimate(order.estimatedTotalMinor)}</strong><p>{text.estimate}</p></div>
    </div>
    {step!==undefined&&<ol className="guest-tracking-steps" aria-label={text.progress}>{text.steps.map((label,index)=>
     <li key={label} data-reached={index<=step} aria-current={index===step?'step':undefined}>{label}</li>)}</ol>}
   </li>;
  })}</ul>}
  {state!=='ended'&&billRequested&&<div className="guest-bill-panel" role="status" ref={billSuccess} tabIndex={-1}><Check size={18} aria-hidden="true"/><div><strong>{text.requested}</strong><p>{text.invoice}</p></div></div>}
  {state!=='ended'&&!guest.awaitingWaiter&&!billRequested&&visible.some(order=>!['REJECTED','CANCELLED'].includes(order.status))&&
   <div className="guest-bill-panel" ref={confirmation} tabIndex={-1}>
    <ReceiptText size={18} aria-hidden="true"/>
    <div>
     {confirming&&<><strong>{text.confirm}</strong><p>{text.confirmNote}</p></>}
     <div className="guest-bill-actions">
      <button ref={billTrigger} type="button" className="button primary" disabled={billing} onClick={()=>confirming?void requestBill():setConfirming(true)}>{billing?text.sending:text.bill}</button>
      {confirming&&<button type="button" className="button secondary" disabled={billing} onClick={()=>{setConfirming(false);setBillError('');billTrigger.current?.focus();}}>{text.cancel}</button>}
     </div>
    </div>
   </div>}
  {billError&&<p role="alert" className="access-error">{billError}</p>}
  {visible.length>0&&<p className="guest-item-detail">{text.finalBill}</p>}
 </section>;
}
