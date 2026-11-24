'use client';
import {useEffect,useState,useRef,type FormEvent} from 'react';
import Link from 'next/link';
import {z} from 'zod';
import {accessRequest,loadIdentity,errorText} from './api';
import {staffHome,workspacePath} from './policy';
export {SessionGate} from './session';
import {ArrowRight, Store, ShieldCheck, Users, Eye, EyeOff} from 'lucide-react';
export function SignIn({portal='staff',navigate=(path:string)=>window.location.assign(path)}:{portal?:'platform'|'restaurant'|'staff';navigate?:(path:string)=>void}) {
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [showPassword,setShowPassword]=useState(false);
 const errorRef=useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(error&&!busy)errorRef.current?.focus();},[error,busy]);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);setBusy(true);setError('');
  try{await accessRequest('/auth/login',{method:'POST',body:{portal,email:String(data.get('email')).trim(),password:data.get('password'),...(data.get('rememberDevice')==='on'?{rememberDevice:true}:{})}});navigate(portal==='staff'?staffHome(await loadIdentity()):workspacePath[portal]);}
  catch(error){setError(errorText(error));}finally{setBusy(false);}
 }
 const portals=[
  {key:'platform',label:'Platform Admin',href:'/sign-in?portal=platform',icon:ShieldCheck,description:'Review registrations, manage restaurants and assign subscription plans.'},
  {key:'restaurant',label:'Restaurant Admin',href:'/sign-in?portal=restaurant',icon:Store,description:'Manage menus, tables, staff and your restaurant settings.'},
  {key:'staff',label:'Staff login',href:'/sign-in?portal=staff',icon:Users,description:'Open your kitchen, waiter or cashier workspace.'},
 ];
 const selected=portals.find(item=>item.key===portal)!;
 const Icon=selected.icon;
 return <div className="public-auth-layout">
  <aside className="public-auth-story">
   <span className="public-auth-symbol"><Icon size={38} strokeWidth={1.5} aria-hidden="true"/></span>
   <h2>Back to service.</h2>
   <p>{selected.description}</p>
   <Link href="/">Back to RestroDock <ArrowRight size={17} aria-hidden="true"/></Link>
  </aside>
  <section className="access-auth public-sign-in">
   <nav className="public-portal-switch" aria-label="Choose your login">
    {portals.map(({key,label,href,icon:RoleIcon})=><Link key={key} href={href} aria-current={portal===key?'page':undefined}>
     <RoleIcon size={17} aria-hidden="true"/>{label}
    </Link>)}
   </nav>
   <h1>{selected.label}</h1><p>Sign in with your RestroDock account.</p>
   <noscript><p className="access-error">Enable JavaScript to sign in securely, then reload this page.</p></noscript><form method="post" action="/api/v1/auth/login" onSubmit={submit} className="access-form" aria-busy={busy}><fieldset disabled={busy}><label htmlFor="login-email">Email address</label><input id="login-email" name="email" type="email" autoComplete="username" required maxLength={254}/><label htmlFor="login-password">Password</label><div className="public-password-field"><input id="login-password" name="password" type={showPassword?'text':'password'} autoComplete="current-password" required maxLength={128}/><button type="button" onClick={()=>setShowPassword(value=>!value)} aria-label={showPassword?'Hide password':'Show password'}>{showPassword?<EyeOff size={19}/>:<Eye size={19}/>}</button></div><label className="registration-checkbox"><input type="checkbox" name="rememberDevice"/><span>Keep me signed in on this device</span></label><p className="access-help">Up to 30 days for restaurant and staff accounts. Leave unchecked on shared devices.</p>{error&&<p ref={errorRef} tabIndex={-1} role="alert" className="access-error">{error}</p>}<button className="button primary" type="submit">{busy?'Signing in…':'Sign in'}<ArrowRight size={17}/></button></fieldset></form><p className="public-auth-help"><Link href="/reset-password">Forgot password?</Link> Contact your administrator for account access.</p>
   <p className="public-auth-help">New restaurant? <Link href="/register" className="registration-inline-link">Register for review</Link>.</p>
  </section></div>;
}
export function InvitationAcceptance() {
 const initialized=useRef(false),confirmation=useRef<HTMLInputElement>(null);
 const [mismatch,setMismatch]=useState(false);
 const [token,setToken]=useState(''),[details,setDetails]=useState<{email:string;restaurant:string;branch:string;role:string}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(true),[done,setDone]=useState(false);
 useEffect(()=>{if(initialized.current)return;initialized.current=true;const value=window.location.hash.slice(1);window.history.replaceState(null,'',window.location.pathname);setToken(value);
  if(!value){setError('No invitation was provided. Open the complete link from your administrator.');setBusy(false);return;}
  accessRequest('/auth/invitations/preview',{method:'POST',body:{token:value}}).then(data=>setDetails(z.object({email:z.string(),restaurant:z.string(),branch:z.string(),role:z.string()}).parse(data))).catch(error=>setError(errorText(error))).finally(()=>setBusy(false));
 },[]);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const data=new FormData(event.currentTarget);setError('');setMismatch(false);if(data.get('password')!==data.get('confirm')){setMismatch(true);setError('The passwords do not match. Enter them again.');confirmation.current?.focus();return;}setBusy(true);
  try{await accessRequest('/auth/invitations/accept',{method:'POST',body:{token,password:data.get('password'),...(data.get('rememberDevice')==='on'?{rememberDevice:true}:{})}});setToken('');setDone(true);}catch(error){setError(errorText(error));}finally{setBusy(false);}
 }
 return <section className="access-auth"><h1>{done?'Your account is ready':'Join your restaurant'}</h1>{done?<><p>Your invitation was accepted. Sign in to view your assigned access.</p><Link href="/sign-in" className="button primary">Continue to sign in</Link></>:<>{busy&&!details&&<p role="status">Checking your invitation…</p>}{details&&<><p>{details.restaurant} · {details.branch}</p><div className="access-note"><strong>{details.email}</strong><br/>{details.role.replaceAll('_',' ')}<p>New account: choose a password with 15–128 characters. Existing account: enter its current password. An invitation never resets an existing password.</p></div><form method="post" action="/api/v1/auth/invitations/accept" onSubmit={submit} className="access-form"><label>Password<input name="password" type="password" minLength={15} maxLength={128} required autoComplete="new-password"/></label><label>Confirm password<input ref={confirmation} aria-invalid={mismatch} aria-describedby={mismatch?'invite-password-error':undefined} name="confirm" type="password" minLength={15} maxLength={128} required autoComplete="new-password"/></label><button className="button primary" disabled={busy}>{busy?'Accepting…':'Accept invitation'}</button></form></>}{error&&<p id="invite-password-error" role="alert" className="access-error">{error}</p>}<p className="access-note">Invitations expire after 24 hours and can be used once. Refreshing this page removes the link from memory; reopen the original link to retry.</p></>}</section>;
}
