'use client';

import {useEffect,useState,type FormEvent} from 'react';
import Link from 'next/link';
import {accessRequest,errorText} from './api';

export function PasswordRecovery(){
 const [token,setToken]=useState('');
 const [busy,setBusy]=useState(false);
 const [updated,setUpdated]=useState(false);
 const [notice,setNotice]=useState('');
 const [error,setError]=useState('');
 useEffect(()=>{
  const value=window.location.hash.slice(1);
  if(value){
   window.history.replaceState(window.history.state,'',window.location.pathname);
   if(/^[A-Za-z0-9_-]{43}$/.test(value))setToken(value);
   else setError('This reset link is invalid. Request a new one.');
  }
 },[]);
 async function submit(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const data=new FormData(event.currentTarget);
  setError('');setNotice('');
  if(token&&data.get('password')!==data.get('confirm')){
   setError('The passwords do not match.');return;
  }
  setBusy(true);
  try{
   if(token){
    await accessRequest('/auth/password-reset/complete',{method:'POST',body:{token,password:data.get('password')}});
    setToken('');setUpdated(true);
   }else{
    await accessRequest('/auth/password-reset/request',{method:'POST',body:{email:String(data.get('email')).trim()}});
    setNotice('If an eligible account exists, check your inbox for a reset link.');
   }
  }catch(error){setError(errorText(error));}
  finally{setBusy(false);}
 }
 return <main className="access-section">
  <h1>{token?'Choose a new password':'Reset your password'}</h1>
  {updated?<p role="status">Password updated. Sign in with your new password.</p>:<>
   <p>{token?'Use at least 15 characters. Saving signs you out on all devices.':'Enter the email you use to sign in to RestroDock.'}</p>
   <form key={token?'complete':'request'} method="post" action={token?'/api/v1/auth/password-reset/complete':'/api/v1/auth/password-reset/request'} className="access-form" onSubmit={submit}>
    <fieldset disabled={busy}>
     {token?<><label>New password<input name="password" type="password" autoComplete="new-password" minLength={15} maxLength={128} required/></label>
     <label>Confirm new password<input name="confirm" type="password" autoComplete="new-password" minLength={15} maxLength={128} required/></label></>:
     <label>Email address<input name="email" type="email" autoComplete="email" maxLength={254} required/></label>}
     <button className="button primary">{token?'Save new password':'Send reset link'}</button>
    </fieldset>
   </form>
   {token&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{setToken('');setError('');}}>Request a new link</button>}
  </>}
  {notice&&<p role="status">{notice}</p>}
  {error&&<p role="alert" className="access-error">{error}</p>}
  <Link href="/sign-in">Back to sign in</Link>
 </main>;
}
