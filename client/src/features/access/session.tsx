'use client';
import {createContext,useContext,useEffect,useRef,useState,type ReactNode} from 'react';
import Link from 'next/link';
import type {StaffIdentity} from '@restrodock/contracts';
import {accessRequest,loadIdentity,AccessError,errorText} from './api';
import {PublicFrame} from '../../components/public-frame';

type VerifiedSession={identity:StaffIdentity;signOut:()=>Promise<void>;signingOut:boolean;error:string};
const SessionContext=createContext<VerifiedSession|null>(null);
export const useVerifiedSession=()=>useContext(SessionContext);
export function SessionGate({children,showSessionBar=true,publicFallback=false}:{children:(identity:StaffIdentity)=>ReactNode;showSessionBar?:boolean;publicFallback?:boolean}){
 const parent=useVerifiedSession();
 if(parent)return <>{children(parent.identity)}</>;
 return <SessionLoader showSessionBar={showSessionBar} publicFallback={publicFallback}>{children}</SessionLoader>;
}
function SessionLoader({children,showSessionBar,publicFallback}:{children:(identity:StaffIdentity)=>ReactNode;showSessionBar:boolean;publicFallback:boolean}){
 const [identity,setIdentity]=useState<StaffIdentity|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[signedOut,setSignedOut]=useState(false),[signingOut,setSigningOut]=useState(false);
 const generation=useRef(0),alive=useRef(true);
 async function load(){const current=++generation.current;setLoading(true);setError('');setIdentity(null);try{const result=await loadIdentity();if(alive.current&&generation.current===current){setIdentity(result);setSignedOut(false);}}catch(error){if(alive.current&&generation.current===current){if(error instanceof AccessError&&error.status===401)setSignedOut(true);else setError(errorText(error));}}finally{if(alive.current&&generation.current===current)setLoading(false);}}
 useEffect(()=>{alive.current=true;void load();return()=>{alive.current=false;generation.current++;};},[]);
 async function signOut(){if(!identity||signingOut)return;setSigningOut(true);setError('');try{await accessRequest('/auth/logout',{method:'POST',body:{},csrf:identity.csrfToken});if(alive.current){generation.current++;setIdentity(null);setSignedOut(true);}}catch(error){if(alive.current)setError(errorText(error));}finally{if(alive.current)setSigningOut(false);}}
 const fallback=(content:ReactNode)=>publicFallback?<PublicFrame><div className="workspace-access-state">{content}</div></PublicFrame>:content;
 if(loading)return fallback(<div role="status" aria-label="Loading workspace" className="workspace-session-loading"><span aria-hidden="true"/></div>);
 if(signedOut)return fallback(<section className="access-auth"><h1>Sign in to continue</h1><p>This workspace requires a verified staff account.</p><Link href="/sign-in" className="button primary">Sign in</Link></section>);
 if(!identity)return fallback(<section className="access-auth"><h1>Could not verify your session</h1><p role="alert" className="access-error">{error}</p><button onClick={()=>void load()} className="button secondary">Check session again</button></section>);
 return <SessionContext.Provider value={{identity,signOut,signingOut,error}}>{showSessionBar&&<><div className="access-session"><span>Signed in as <strong>{identity.email}</strong></span><button className="text-button" disabled={signingOut} onClick={()=>void signOut()}>{signingOut?'Signing out…':'Sign out'}</button></div>{error&&<p role="alert" className="access-error">{error}</p>}</>}{children(identity)}</SessionContext.Provider>;
}
