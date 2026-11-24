'use client';
import {useEffect,useState,useRef,type FormEvent} from 'react';
import {planCodes,subscriptionStatuses,tenantListSchema,tenantDetailSchema,invitationResultSchema,type StaffIdentity,type TenantSummary,type TenantDetail} from '@restrodock/contracts';
import {z} from 'zod';
import Link from 'next/link';
import {SessionGate} from './auth';
import {accessRequest,errorText,AccessError} from './api';
export function PlatformPortal(){return <SessionGate>{identity=>identity.platformAdmin?<PlatformWorkspace identity={identity}/>:<section className="access-auth"><h1>Platform access required</h1><p>Your account cannot administer the platform. Use your restaurant or staff workspace.</p></section>}</SessionGate>;}
export function InviteLink({link}:{link:string}) {
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 return <div className="access-invitation"><h3>Invitation ready</h3><p>Share this one-use link privately with its intended recipient. Expires in 24 hours. No email has been sent.</p><label>Private invitation link<input readOnly value={link} onFocus={event=>event.currentTarget.select()}/></label><button className="button secondary" onClick={async()=>{try{await navigator.clipboard.writeText(link);setCopied(true);}catch{setError('Select the link above and copy it manually.');}}}>{copied?'Copied':'Copy invitation link'}</button>{error&&<p role="alert">{error}</p>}</div>;
}
function PlatformWorkspace({identity}:{identity:StaffIdentity}) {
 const [items,setItems]=useState<TenantSummary[]>([]),[cursor,setCursor]=useState<string|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(''),[query,setQuery]=useState(''),[detail,setDetail]=useState<TenantDetail|null>(null),[busy,setBusy]=useState(false),[link,setLink]=useState(''),[fields,setFields]=useState<string[]>([]);
 const listVersion=useRef(0);
 const [appliedQuery,setAppliedQuery]=useState('');
 const write=(path:string,body:unknown,method='POST')=>accessRequest(path,{method,body,csrf:identity.csrfToken});
 async function list(append=false){const version=++listVersion.current;const activeQuery=append?appliedQuery:query;setLoading(true);setError('');try{const params=new URLSearchParams();if(activeQuery)params.set('q',activeQuery);if(append&&cursor)params.set('cursor',cursor);const data=tenantListSchema.parse(await accessRequest(`/super-admin/tenants?${params}`));if(version!==listVersion.current)return;setItems(old=>append?[...old,...data.items]:data.items);setCursor(data.nextCursor);setAppliedQuery(activeQuery);}catch(error){if(version===listVersion.current)setError(errorText(error));}finally{if(version===listVersion.current)setLoading(false);}}
 useEffect(()=>{
  void list();
  const restaurant=z.uuid().safeParse(new URLSearchParams(window.location.search).get('restaurant'));
  if(restaurant.success)void select(restaurant.data);
 },[]);
 async function select(id:string){setBusy(true);setError('');setLink('');try{setDetail(tenantDetailSchema.parse(await accessRequest(`/super-admin/tenants/${id}`)));}catch(error){setError(errorText(error));}finally{setBusy(false);}}
 async function create(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);setBusy(true);setError('');setFields([]);setLink('');
  try{const result=z.object({tenant:tenantDetailSchema,invitation:invitationResultSchema}).parse(await write('/super-admin/tenants',Object.fromEntries(data)));setDetail(result.tenant);setLink(result.invitation.link);form.reset();await list();}
  catch(error){setError(errorText(error));if(error instanceof AccessError){setFields(error.fields.map(f=>f.field));const first=form.elements.namedItem(error.fields[0]?.field??'');if(first instanceof HTMLElement)first.focus();}}finally{setBusy(false);}
 }
 async function update(body:unknown){if(!detail)return;setBusy(true);setError('');try{setDetail(tenantDetailSchema.parse(await write(`/super-admin/tenants/${detail.id}`,body,'PATCH')));await list();}catch(error){setError(errorText(error));}finally{setBusy(false);}}
 async function invite(event:FormEvent<HTMLFormElement>){event.preventDefault();if(!detail)return;const data=new FormData(event.currentTarget);setBusy(true);setError('');setLink('');try{const result=invitationResultSchema.parse(await write(`/super-admin/tenants/${detail.id}/invitations`,Object.fromEntries(data)));setLink(result.link);setDetail(tenantDetailSchema.parse(await accessRequest(`/super-admin/tenants/${detail.id}`)));}catch(error){setError(errorText(error));}finally{setBusy(false);}}
 return <><div className="restaurant-page-heading"><div><h1>Restaurant directory</h1><p>Manage onboarding, subscriptions and billing access.</p></div><Link href="/super-admin/registrations" className="button primary">Review registration requests</Link></div>{error&&<p role="alert" className="access-error">{error}</p>}<div className="access-platform"><section className="access-section rd-panel"><form className="access-search" onSubmit={event=>{event.preventDefault();void list();}}><label>Find a restaurant<input value={query} onChange={event=>setQuery(event.target.value)} maxLength={80} placeholder="Name or slug"/></label><button className="button secondary" disabled={loading}>Search</button></form>{loading&&<p role="status">Loading restaurants…</p>}{!loading&&!items.length&&<div className="access-empty"><h2>No restaurants found</h2><p>Create a draft restaurant below, or change your search.</p></div>}<div className="table-scroll" role="region" aria-label="Restaurant directory table" tabIndex={0}><table className="access-table"><caption className="sr-only">Restaurants managed by this platform</caption><thead><tr><th scope="col">Restaurant</th><th scope="col">Status</th><th scope="col">Plan</th><th scope="col"><span className="sr-only">Details</span></th></tr></thead><tbody>{items.map(item=><tr key={item.id}><td><strong>{item.name}</strong><span className="access-subtext">/{item.slug}</span></td><td><span className="platform-state" data-state={item.status}>{item.status}</span></td><td>{item.subscription?.planCode??'Unassigned'}{item.subscription&&<span className="access-subtext">{item.subscription.status}</span>}</td><td><button className="text-button" disabled={busy} onClick={()=>void select(item.id)} aria-label={`Open ${item.name}`}>Open</button></td></tr>)}</tbody></table></div>{cursor&&<button className="button secondary" disabled={loading||query!==appliedQuery} onClick={()=>void list(true)}>Load more restaurants</button>}<div className="access-create"><h2>Create draft restaurant</h2><p>Creates an inactive, paused branch and a private administrator invitation. No working account is prefilled.</p><form className="access-form access-form-grid" onSubmit={create}>{[{name:'name',label:'Restaurant name',max:160},{name:'slug',label:'Restaurant slug',max:80},{name:'branchName',label:'Initial branch name',max:160},{name:'adminEmail',label:'Administrator email',max:254}].map(field=><label key={field.name}>{field.label}<input aria-label={field.label} name={field.name} type={field.name==='adminEmail'?'email':'text'} required maxLength={field.max} minLength={field.name==='adminEmail'?undefined:2} aria-invalid={fields.includes(field.name)||undefined} aria-describedby={field.name==='slug'?'slug-help':undefined}/>{field.name==='slug'&&<span id="slug-help" className="access-help">Lowercase letters, numbers and single hyphens.</span>}</label>)}<label>Plan<select name="planCode" defaultValue="TRIAL">{planCodes.map(code=><option key={code}>{code}</option>)}</select><span className="access-help">Plan metadata only; no charge is collected.</span></label><button className="button primary" disabled={busy}>{busy?'Saving…':'Create draft restaurant'}</button></form></div></section><aside className="access-section access-detail rd-panel" aria-label="Restaurant details">{!detail?<div className="access-empty"><h2>Review a restaurant</h2><p>Open a directory entry to manage its plan, billing mode and onboarding.</p></div>:<><h2>{detail.name}</h2><p className="muted">/{detail.slug} · {detail.status}</p><h3>Onboarding checklist</h3><ul className="access-checklist">{detail.checklist.map(check=><li key={check.key}><span>{check.complete?'Complete':'Pending'}</span>{check.label}</li>)}</ul><p className="access-help">{detail.branches.some(branch=>branch.active)?"Branch active for staff. Guest ordering remains separately gated.":"The branch will activate automatically after its administrator submits the completed configuration."}</p><h3>Subscription</h3>
 {detail.usage&&<dl className="platform-usage">
  <div><dt>Branches</dt><dd>{detail.usage.branches}</dd></div>
  <div><dt>Tables</dt><dd>{detail.usage.tables}</dd></div>
  <div><dt>Active staff accounts</dt><dd>{detail.usage.staff}</dd></div>
 </dl>}
 <form className="access-form" key={`${detail.id}:${detail.version}`} onSubmit={event=>{
  event.preventDefault();
  const data=new FormData(event.currentTarget);
  void update({version:detail.version,planCode:data.get('planCode'),subscriptionStatus:data.get('subscriptionStatus'),endsOn:data.get('endsOn')||null});
 }}>
  <label>Assigned plan<select name="planCode" defaultValue={detail.subscription?.planCode??'TRIAL'}>{planCodes.map(code=><option key={code}>{code}</option>)}</select></label>
  <label>Subscription status<select name="subscriptionStatus" defaultValue={detail.subscription?.status??'TRIAL'}>{subscriptionStatuses.map(status=><option key={status}>{status}</option>)}</select></label>
  <label>Term end date (00:00 UTC)<input type="date" name="endsOn" defaultValue={detail.subscription?.endsAt?.slice(0,10)??''}/></label>
  <p className="access-help">To renew, select Active and enter a future term end date. Expired or suspended subscriptions block new tables. Use Restaurant access to suspend the entire restaurant.</p>
  <button className="button secondary" disabled={busy}>Save plan</button>
 </form>
 <h3>Restaurant access</h3>
 <p className="access-help">Suspension disables the branches and pauses ordering. Returning to draft requires the restaurant to submit setup again.</p>
 <button className="button secondary" disabled={busy} onClick={()=>void update({version:detail.version,status:detail.status==='SUSPENDED'?'DRAFT':'SUSPENDED'})}>{detail.status==='SUSPENDED'?'Return to draft':'Suspend restaurant'}</button><h3>Billing</h3>
 <p role="status">Current mode: {detail.billingMode==='RESTRODOCK'?'RestroDock Billing':'External POS'}</p>
 <form className="access-form" key={`billing:${detail.id}:${detail.version}`} onSubmit={event=>{
  event.preventDefault();
  const billingMode=new FormData(event.currentTarget).get('billingMode');
  if(billingMode!==detail.billingMode)void update({version:detail.version,billingMode});
 }}>
  <label>Billing mode
   <select name="billingMode" defaultValue={detail.billingMode} disabled={busy} aria-describedby="billing-mode-help">
    <option value="EXTERNAL_POS">External POS</option>
    <option value="RESTRODOCK">RestroDock Billing</option>
   </select>
  </label>
  <p id="billing-mode-help" className="access-help">Customers can request a bill in either mode. RestroDock Billing issues a payment receipt when staff confirm collection.</p>
  <button className="button secondary" disabled={busy}>Save billing mode</button>
 </form><h3>Administrator invitation</h3>{detail.invitations.map(invite=><p className="access-help" key={invite.id}>Pending for {invite.email}</p>)}<form className="access-form" onSubmit={invite}><label>Recipient email<input name="email" type="email" required maxLength={254}/></label><label>Assigned branch<select name="branchId">{detail.branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><button className="button secondary" disabled={busy||detail.status==='SUSPENDED'}>Create new invitation</button><p className="access-help">A new link revokes earlier unused invitations for the same email and restaurant.</p></form></>}{link&&<><InviteLink key={link} link={link}/><button className="text-button" onClick={()=>setLink('')}>Dismiss private link</button></>}</aside></div></>;
}
