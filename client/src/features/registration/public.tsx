'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {useRouter} from 'next/navigation';
import {z} from 'zod';
import {ArrowRight,Check,Clock,Copy,RefreshCw} from 'lucide-react';
import {registrationInput,registrationCreatedSchema,registrationPublicSchema,registrationSecret,type RegistrationPublic} from '@restrodock/contracts';
import {accessRequest,errorText} from '../access/api';
import {useFormFeedback,FormErrorSummary} from '../../components/form-feedback';

function trackingSecret(){const bytes=crypto.getRandomValues(new Uint8Array(32));return btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replaceAll('=','');}
type SavedReceipt=z.infer<typeof registrationCreatedSchema>;
type ThankYouReceipt=SavedReceipt&{trackingSecret:string};

// Keep the submission receipt in memory across this client-side navigation.
let pendingReceipt:ThankYouReceipt|null=null;

export function RegistrationFlow(){
 const router=useRouter();
 return <RegistrationForm onRegistered={receipt=>{
  pendingReceipt=receipt;
  router.replace('/register/thank-you');
 }}/>;
}

export function RegistrationThankYou(){
 const [receipt,setReceipt]=useState<ThankYouReceipt|null>(null);
 const [copied,setCopied]=useState(false);
 const trackingInput=useRef<HTMLInputElement>(null);
 useEffect(()=>{
  if(pendingReceipt&&Date.parse(pendingReceipt.expiresAt)>Date.now())setReceipt(pendingReceipt);
  pendingReceipt=null;
 },[]);
 return <section className="registration-receipt">
  <h1>{receipt?'Thank you for applying':'Restaurant applications'}</h1>
  {receipt?<><p>Your request is pending review. Save your private tracking link to check the decision.</p>
   <label className="registration-link">Private tracking link<input ref={trackingInput} readOnly value={window.location.origin+'/registration/status#'+receipt.trackingSecret} onFocus={event=>event.currentTarget.select()}/></label>
   <div className="registration-actions">
    <Link className="button primary" href={'/registration/status#'+receipt.trackingSecret}>Check request status</Link>
    <button className="button secondary" type="button" onClick={async()=>{
     try{await navigator.clipboard.writeText(window.location.origin+'/registration/status#'+receipt.trackingSecret);setCopied(true);}
     catch{trackingInput.current?.focus();trackingInput.current?.select();}
    }}>{copied?'Copied':'Copy tracking link'}</button>
   </div>
  </>:<><p>Use your saved tracking link to check an existing request, or start a new application.</p><Link className="button primary" href="/register">Register your restaurant</Link></>}
 </section>;
}

export function RegistrationForm({createSecret=trackingSecret,onRegistered}:{createSecret?:()=>string;onRegistered?:(receipt:ThankYouReceipt)=>void}){
 const [busy,setBusy]=useState(false),[receipt,setReceipt]=useState<{id:string;expiresAt:string}|null>(null),[copied,setCopied]=useState(false);
 const secret=useRef(''),heading=useRef<HTMLHeadingElement>(null),feedback=useFormFeedback(busy);
 useEffect(()=>{if(receipt)heading.current?.focus();},[receipt]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);feedback.clear();
  try{
   if(data.get('password')!==data.get('confirmPassword'))throw new z.ZodError([{code:'custom',path:['confirmPassword'],message:'Enter the same password in both fields.'}]);
   if(!secret.current)secret.current=registrationSecret.parse(createSecret());
   const fields=Object.fromEntries(data);delete fields.confirmPassword;delete fields.companyWebsite;
   const body=registrationInput.parse({...fields,ownerAuthorised:data.get('ownerAuthorised')==='on',trackingSecret:secret.current});
   const saved=registrationCreatedSchema.parse(await accessRequest('/registrations',{method:'POST',body:{...body,companyWebsite:data.get('companyWebsite')||''}}));form.reset();setReceipt(saved);onRegistered?.({...saved,trackingSecret:secret.current});
  }catch(error){feedback.report(form,error);}finally{setBusy(false);}
 }
 const link=secret.current?`/registration/status#${secret.current}`:'';
 if(receipt)return <section className="registration-receipt"><Clock size={30}/><h1 ref={heading} tabIndex={-1}>Your request is pending review.</h1><p>We received your restaurant application. Your account will be enabled only after a Platform Admin approves it.</p><p>Keep this private tracking link. It is not emailed automatically and is not an account login.</p><label className="registration-link">Private tracking link<input readOnly value={`${window.location.origin}${link}`} onFocus={event=>event.currentTarget.select()}/></label><div className="registration-actions"><a className="button primary" href={link}>Check request status <ArrowRight size={16}/></a><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.origin+link);setCopied(true);}catch{setCopied(false);}}}><Copy size={16}/>{copied?'Copied':'Copy tracking link'}</button></div><p className="registration-help">Request reference: {receipt.id}. Pending requests expire after seven days. If copy is unavailable, select and copy the complete link above.</p></section>;
 return <div className="registration-layout"><section className="registration-intro"><h1>Bring your restaurant aboard.</h1><p>Tell us about your restaurant. A Platform Admin will review your request before your administrator account is enabled.</p><ol><li>Submit your restaurant and contact details.</li><li>Keep your private request-tracking link.</li><li>After approval, sign in and complete your setup.</li></ol><p className="registration-help">Approval enables setup and menu access. Guest QR ordering and live kitchen service remain in development.</p><Link href="/sign-in?portal=restaurant" className="landing-text-link">Already have an account? Sign in <ArrowRight size={16}/></Link></section><form className="registration-form" data-validation="registration" onSubmit={submit} method="post" action="/api/v1/registrations" aria-busy={busy}><fieldset disabled={busy}><legend>Your restaurant</legend><div hidden><label>Company website<input name="companyWebsite" type="text" tabIndex={-1} autoComplete="off"/></label></div><FormErrorSummary feedback={feedback} owner="registration"/>{[{name:'restaurantName',label:'Restaurant name',max:160},{name:'branchName',label:'Initial branch name',max:160,value:'Main branch'},{name:'city',label:'City',max:100},{name:'address',label:'Restaurant address',max:300}].map(field=><label key={field.name}>{field.label}<input name={field.name} required maxLength={field.max} defaultValue={field.value} autoComplete={field.name==='city'?'address-level2':field.name==='address'?'street-address':field.name==='restaurantName'?'organization':'off'} {...feedback.props('registration',field.name)}/></label>)}<h2>Administrator account</h2><label>Your name<input name="ownerName" required maxLength={100} autoComplete="name" {...feedback.props('registration','ownerName')}/></label><label>Email address<input name="email" type="email" required maxLength={254} autoComplete="email" {...feedback.props('registration','email')}/></label><label>Contact phone<input aria-label="Contact phone" name="phone" type="tel" required maxLength={16} autoComplete="tel" aria-describedby="registration-phone-help" {...feedback.props('registration','phone')}/><span id="registration-phone-help" className="registration-help">8–15 digits; include + before a country code if needed.</span></label><label>Choose a password<input aria-label="Choose a password" name="password" type="password" required minLength={15} maxLength={128} autoComplete="new-password" aria-describedby="registration-password-help" {...feedback.props('registration','password')}/><span id="registration-password-help" className="registration-help">15–128 characters. Use this password after approval.</span></label><label>Confirm password<input name="confirmPassword" type="password" required minLength={15} maxLength={128} autoComplete="new-password" {...feedback.props('registration','confirmPassword')}/></label><label className="registration-checkbox"><input type="checkbox" name="ownerAuthorised" required {...feedback.props('registration','ownerAuthorised')}/><span>I am authorised to apply on behalf of this restaurant.</span></label><button type="submit" className="button primary">{busy?'Submitting…':'Submit registration request'}<ArrowRight size={16}/></button></fieldset><noscript><p className="access-error">Enable JavaScript and reload to submit this request securely.</p></noscript><p className="registration-help">This is for first-time accounts. Existing account holders should sign in or contact the platform team for additional restaurant access. No charge is collected.</p>{secret.current&&!receipt&&<p className="registration-help">If a submission was interrupted, <a href={link}>check its private status</a> before retrying.</p>}</form></div>;
}
export function RegistrationTracking(){
 const secret=useRef(''),initialised=useRef(false),generation=useRef(0),alive=useRef(true);
 const [data,setData]=useState<RegistrationPublic|null>(null),[busy,setBusy]=useState(true),[error,setError]=useState('');
 async function load(){const version=++generation.current;setBusy(true);setError('');try{const trackingSecret=registrationSecret.parse(secret.current);const value=registrationPublicSchema.parse(await accessRequest('/registrations/status',{method:'POST',body:{trackingSecret}}));if(alive.current&&version===generation.current)setData(value);}catch(error){if(alive.current&&version===generation.current){setData(null);setError(secret.current?errorText(error):'Open the complete private tracking link you saved after registration.');}}finally{if(alive.current&&version===generation.current)setBusy(false);}}
 useEffect(()=>{alive.current=true;if(!initialised.current){initialised.current=true;secret.current=window.location.hash.slice(1);window.history.replaceState(null,'',window.location.pathname);}void load();return()=>{alive.current=false;generation.current++;};},[]);
 return <section className="registration-tracking"><h1>Your restaurant application</h1>{busy&&<p role="status">Checking your request…</p>}{error&&<p role="alert" className="access-error">{error}</p>}{data&&<><p className="registration-restaurant-name">{data.restaurantName}</p><span className={`registration-status ${data.status.toLowerCase()}`}>{data.status==='PENDING'?'Pending review':data.status==='APPROVED'?'Approved':data.status==='REJECTED'?'Rejected':'Expired'}</span>{data.status==='PENDING'?<p>A Platform Admin has not decided yet. Your account is not enabled. Check this link again after review; pending requests expire after seven days.</p>:data.status==='APPROVED'?<><h2><Check size={22}/> Your administrator setup access is approved.</h2><p>{data.loginReady?'Sign in using the email and password from your registration to complete your restaurant profile, staff and menu.':'Approval is recorded, but access is currently unavailable. Contact the platform team.'}</p>{data.loginReady&&<Link className="button primary" href="/sign-in?portal=restaurant">Restaurant Admin login <ArrowRight size={16}/></Link>}<p className="registration-help">After you complete and submit the required setup, your branch activates automatically. Guest ordering remains separately gated.</p></>:<><p>{data.status==='REJECTED'?'The platform team rejected this request. No account was created.':'This request expired before review. No account was created.'}</p>{data.reason&&<div className="registration-reason"><h2>Reason shared by the reviewer</h2><p>{data.reason}</p></div>}<Link href="/register" className="landing-text-link">Submit a new request <ArrowRight size={16}/></Link></>}</>}{secret.current&&<button className="button secondary" disabled={busy} onClick={()=>void load()}><RefreshCw size={15}/>{busy?'Checking…':'Refresh request status'}</button>}<p className="registration-help">Your private link is cleared from the address bar. Reopen the original saved link after a refresh. It grants status viewing only.</p></section>;
}
