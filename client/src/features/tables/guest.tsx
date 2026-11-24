'use client';
import {useEffect,useEffectEvent,useRef,useState,type FormEvent,type ReactNode,type RefObject} from 'react';
import {qrContextSchema,guestJoin,guestRequest,guestViewSchema,guestCartContextSchema,type QrContext,type GuestView} from '@restrodock/contracts';
import {AccessError,accessRequest,errorText} from '../access/api';
import {useFormFeedback,FormErrorSummary} from '../../components/form-feedback';
import {io} from 'socket.io-client';
import {BadgeCheck, ConciergeBell, RefreshCw, Utensils} from 'lucide-react';
import {MenuCart} from './menu-cart';
import {clearCartDraft,readCartDraft,secureRandomUuid} from './cart-draft';
import {clearCheckoutState,readCheckoutState} from './checkout-storage';

function VerificationSurface({modal,dialog,children}:{modal:boolean;dialog:RefObject<HTMLDialogElement|null>;children:ReactNode}){
 if(!modal)return <section className="guest-join">{children}</section>;
 return <dialog className="guest-join guest-code-dialog" ref={dialog} aria-labelledby="guest-code-title">
  {children}<button className="button secondary" type="button" onClick={()=>dialog.current?.close()}>Back to cart</button>
 </dialog>;
}

function clearGuestDrafts(){
 clearCartDraft();
 clearCheckoutState();
}

const freshSecret=()=>{const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');};
const freshDraftId=()=>{const id=secureRandomUuid();if(!id)throw new Error('Secure browser randomness is unavailable. Reopen this QR in a supported browser.');return id;};
export function GuestEntry(){
 const [context,setContext]=useState<QrContext|null>(null),[joined,setJoined]=useState<GuestView|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const qr=useRef(''),secret=useRef(''),alive=useRef(true),generation=useRef(0),heading=useRef<HTMLHeadingElement>(null),feedback=useFormFeedback(busy);
 const [checkingGuest,setCheckingGuest]=useState(false);
 const [watching,setWatching]=useState(false);
 const resume=useRef(false);
 const codeDialog=useRef<HTMLDialogElement>(null);
 const submitAfterVerification=useRef<((guest:GuestView)=>void)|null>(null);
 const draftId=useRef('');
 const liveRead=useRef(0);
 async function syncTable(){
  if(!qr.current||(joined&&!joined.awaitingWaiter)||busy)return;
  const token=qr.current,request=generation.current,read=++liveRead.current;
  try{
   const value=qrContextSchema.parse(await accessRequest('/table-entry/lookup',{method:'POST',body:{qrToken:token}}));
   if(alive.current&&qr.current===token&&generation.current===request&&read===liveRead.current){
    setContext(value);
    if(joined?.awaitingWaiter){
     const guest=guestViewSchema.parse(await accessRequest('/guest/session',{method:'POST',body:{qrToken:token}}));
     if(alive.current&&generation.current===request&&read===liveRead.current)setJoined(guest);
    }
   }
  }catch{/* Manual refresh remains available if the connection or lookup fails. */}
 }
 const syncLiveTable=useEffectEvent(syncTable);
 const watchedQr=watching&&context?.deferredVerification&&(!joined||joined.awaitingWaiter)?qr.current:'';
 useEffect(()=>{
  if(!watchedQr)return;
  const socket=io({path:'/restrodock-live',addTrailingSlash:false,transports:['websocket'],
   auth:{qrToken:watchedQr},autoConnect:false,reconnectionDelayMax:10000});
  socket.on('connect',()=>void syncLiveTable());
  socket.on('table-entry:changed',()=>void syncLiveTable());
  socket.connect();
  return ()=>{socket.removeAllListeners().disconnect();};
 },[watchedQr]);

 async function refresh(){
  const request=++generation.current;
  const current=()=>alive.current&&request===generation.current;
  setBusy(true);
  setCheckingGuest(true);
  setError('');
  feedback.clear();
  let menuLoaded=false;

  try{
   if(!qr.current){
    if(!resume.current&&!readCartDraft()&&!readCheckoutState())throw new Error('Scan the complete table QR link. Ask staff for the current QR.');
    const data=guestCartContextSchema.parse(await accessRequest('/guest/cart-context',{method:'POST',body:{}}));
    if(current()){
     resume.current=true;
     setContext(data.context);
     setJoined(data.guest);
    }
    return;
   }

   const value=qrContextSchema.parse(await accessRequest('/table-entry/lookup',{method:'POST',body:{qrToken:qr.current}}));
   if(!current())return;
   menuLoaded=true;
   setContext(value);
   try{
    const guest=guestViewSchema.parse(await accessRequest('/guest/session',{method:'POST',body:{qrToken:qr.current}}));
    if(current())setJoined(guest);
   }catch(e){
    if(!current())return;
    if(!(e instanceof AccessError&&e.status===401))throw e;
    const savedCart=readCartDraft(),savedCheckout=readCheckoutState();
    if(savedCart?.cartId!==draftId.current)clearCartDraft();
    if(savedCheckout?.cartId!==draftId.current)clearCheckoutState();
    setJoined(null);
    secret.current='';
   }
  }catch(e){
   if(current()){
    if(!menuLoaded&&e instanceof AccessError&&[401,403,404].includes(e.status)){
     clearGuestDrafts();
     setContext(null);setJoined(null);
     resume.current=false;
    }
    setError(errorText(e));
   }
  }finally{
   if(current()){setBusy(false);setCheckingGuest(false);}
  }
 }

 useEffect(()=>{
  alive.current=true;
  const scan=()=>{
   const fragment=window.location.hash.slice(1);
   if(fragment){
    qr.current=fragment;
    setWatching(false);
    window.history.replaceState(null,'',window.location.pathname);
    try{draftId.current=freshDraftId();}catch(error){setError(errorText(error));return;}
    clearGuestDrafts();
    secret.current='';
    resume.current=false;
   }
   void refresh();
  };
  const rescan=()=>{if(window.location.hash.length>1)scan();};
  scan();
  window.addEventListener('hashchange',rescan);
  return()=>{
   alive.current=false;
   generation.current++;
   window.removeEventListener('hashchange',rescan);
  };
 },[]);

 useEffect(()=>{
  if(!joined)return;
  heading.current?.focus();
  const timer=setTimeout(()=>{
   clearGuestDrafts();
   setJoined(null);
   secret.current='';
   setNotice('Table verification expired. Verify again to start a cart.');
  },Math.max(0,new Date(joined.expiresAt).getTime()-Date.now()));
  return()=>clearTimeout(timer);
 },[joined]);

 async function join(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!context||(!context.waiterConfirmation&&!context.session))return;const form=event.currentTarget,fields=new FormData(form),n=++generation.current;setBusy(true);setError('');feedback.clear();try{if(!secret.current)secret.current=freshSecret();const input=(context.waiterConfirmation?guestRequest:guestJoin).parse({qrToken:qr.current,...(context.waiterConfirmation?{}:{sessionId:context.session?.id,pinVersion:context.session?.pinVersion,pin:fields.get('pin')}),displayName:fields.get('displayName'),mobile:fields.get('mobile'),privacyAccepted:fields.get('privacyAccepted')==='on',guestSecret:secret.current});const value=guestViewSchema.parse(await accessRequest(context.waiterConfirmation?'/table-entry/request':'/table-entry/join',{method:'POST',body:input}));if(alive.current&&n===generation.current){form.reset();setJoined(value);setNotice('');const submit=submitAfterVerification.current;submitAfterVerification.current=null;codeDialog.current?.close();submit?.(value);}}
 catch(e){if(alive.current&&n===generation.current)feedback.report(form,e);}finally{if(alive.current&&n===generation.current)setBusy(false);}}
 async function leave(){if(!joined)return;const n=++generation.current;setBusy(true);setError('');try{await accessRequest('/guest/leave',{method:'POST',body:{},csrf:joined.csrfToken});if(alive.current&&n===generation.current){setJoined(null);secret.current='';clearGuestDrafts();resume.current=false;setNotice('You left this table session. Your cart and guest contact record were cleared.');if(!qr.current)setContext(null);}}catch(e){if(alive.current&&n===generation.current)setError(errorText(e));}finally{if(alive.current&&n===generation.current)setBusy(false);}}
 function openVerification(submit:(guest:GuestView)=>void){submitAfterVerification.current=submit;feedback.clear();codeDialog.current?.showModal();if(watching)void syncTable();else setWatching(true);}
 const reservedForAnotherGuest=!!context?.session?.occupied&&!joined;
 return <div className="guest-entry guest-dining">
 <header className="guest-entry-heading">
  <div className="guest-dining-top">
   <p className="guest-brand"><Utensils size={18} aria-hidden="true"/> RestroDock</p>
   <button className="button secondary guest-refresh" type="button" disabled={busy} onClick={()=>void refresh()}>
    <RefreshCw size={16} aria-hidden="true"/> Refresh table entry
   </button>
  </div>
  <h1>{context?.restaurantName??'Your table entry'}</h1>
  {context&&<div className="guest-dining-location"><strong><ConciergeBell size={16} aria-hidden="true"/>{context.tableLabel}</strong><span>{[context.branchName,context.section].filter(Boolean).join(' · ')}</span></div>}
 </header>
 <div className="guest-dining-status">
 {busy&&!context&&<p role="status">Loading the table menu…</p>}
 {error&&<p role="alert" className="access-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
 {joined?<section className="guest-verified"><div><h2 ref={heading} tabIndex={-1}><BadgeCheck size={20} aria-hidden="true"/> {joined.awaitingWaiter?'Waiting for waiter confirmation':'Table entry verified'}</h2><p>Welcome, {joined.displayName}. {joined.awaitingWaiter?'Ask your waiter to confirm within 10 minutes. If the request expires, leave this session and try again. Session ends at':'You can place another order until'} {new Date(joined.expiresAt).toLocaleTimeString([], {hour:"numeric",minute:"2-digit"})}.</p></div><button className="button secondary" disabled={busy} onClick={()=>void leave()}>Leave table session</button></section>:reservedForAnotherGuest?<section className="guest-waiting guest-table-reserved" role="status"><h2>This table already has an active guest session</h2><p>You can still browse the menu. If you’re seated here, ask your waiter for help.</p></section>:context&&!error&&!checkingGuest?<VerificationSurface modal={!!context.deferredVerification} dialog={codeDialog}><h2 id="guest-code-title">{context.waiterConfirmation?'Confirm your order':context.deferredVerification?'Enter your table code':'Verify your table'}</h2>{context.deferredVerification&&(context.waiterConfirmation||context.session?.canJoin)&&<p className="guest-code-intro">Confirm your details. Your waiter will check the first order with you before it reaches the kitchen.</p>}{context.waiterConfirmation||context.session?.canJoin?<form action="/api/v1/table-entry/join" method="post" data-validation="guest-entry" onSubmit={join} aria-busy={busy}><fieldset disabled={busy}><FormErrorSummary feedback={feedback} owner="guest-entry"/>{!context.waiterConfirmation&&<label>{context.deferredVerification?'Six-digit code from your waiter':'Staff-issued PIN'}<input name="pin" type="password" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required {...feedback.props('guest-entry','pin')}/></label>}<label>Your name<input name="displayName" autoComplete="given-name" minLength={2} maxLength={100} required {...feedback.props('guest-entry','displayName')}/></label><label>Mobile number<input name="mobile" type="tel" autoComplete="tel" pattern="\+?[1-9][0-9]{7,14}" maxLength={16} required {...feedback.props('guest-entry','mobile')}/></label><p id="guest-privacy">Your waiter uses your name to confirm the order. Your mobile number is stored encrypted. Leaving or closing the session clears your contact details. Expired sessions are cleared during cleanup.</p><label className="registration-checkbox"><input name="privacyAccepted" type="checkbox" required aria-describedby="guest-privacy" {...feedback.props('guest-entry','privacyAccepted')}/><span>I understand the guest-entry privacy notice.</span></label><button className="button primary">{context.waiterConfirmation?'Send to waiter':context.deferredVerification?'Verify and place order':'Verify table entry'}</button></fieldset><noscript>JavaScript is required for private table entry. Ask staff for assistance.</noscript></form>:<p className="guest-waiting" role="status">{context.session?'Entry PIN is locked or expired. Ask staff to issue a new PIN.':'Ask your waiter to open this table and generate a PIN before placing your order.'}</p>}</VerificationSurface>:null}
 </div>
 {context&&<MenuCart readOnly={checkingGuest||reservedForAnotherGuest||!!error} key={context.deferredVerification?'deferred-'+draftId.current:(joined?.cartId??'browse')} context={context} guest={joined} {...(draftId.current?{draftId:draftId.current}:{})} onRefresh={()=>void refresh()} {...(context.deferredVerification&&!joined&&!checkingGuest&&!reservedForAnotherGuest&&!error?{onVerify:openVerification}:{})}/>}
 </div>;
}
