'use client';
import {useEffect,useState,useRef,type FormEvent} from 'react';
import {invitationResultSchema,roles,type StaffIdentity} from '@restrodock/contracts';
import {z} from 'zod';
import {AdminPanel} from '../restaurant/admin-panel';
import {BranchAudit} from '../restaurant/audit';
import {BranchAnalytics} from '../restaurant/analytics';
import {SessionGate} from './session';
import {assignedMemberships} from './policy';
import {accessRequest,errorText} from './api';
import {RestaurantWorkbench} from '../restaurant/workbench';
import {restaurantSections,type RestaurantSettingsSection} from '../restaurant/sections';
import {RestaurantBranchPicker} from '../restaurant/branch-picker';
import {useBranchSelection} from '../restaurant/branch-selection';
import {InviteLink} from './platform';
export function TenantPortal({section='profile'}:{kind:'restaurant';section?:RestaurantSettingsSection}){return <SessionGate>{identity=><TenantWorkspace key={identity.email+section} identity={identity} section={section}/>}</SessionGate>;}
function TenantWorkspace({identity,section}:{identity:StaffIdentity;section:RestaurantSettingsSection}){
 const [branchNames,setBranchNames]=useState<Record<string,string>>({});
 const assignments=assignedMemberships(identity).filter(member=>member.role==='RESTAURANT_ADMIN').flatMap(member=>member.access.map(access=>({tenantId:member.tenant.id,branchId:access.branch.id,label:`${member.tenant.name} · ${branchNames[access.branch.id]??access.branch.name}`,role:member.role})));
 const [selected,setSelected]=useBranchSelection(assignments,identity.email);
 const [context,setContext]=useState<{message:string;role:typeof roles[number]}|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[link,setLink]=useState('');
 const requestVersion=useRef(0),alive=useRef(true);
 const assignment=assignments.find(item=>item.branchId===selected);
 async function load(){
  const version=++requestVersion.current;setError('');setContext(null);if(!assignment||section==='analytics'||section==='audit')return;
  setBusy(true);
  try{const query=new URLSearchParams({tenantId:assignment.tenantId,branchId:assignment.branchId});const result=z.object({message:z.string(),role:z.enum(roles)}).parse(await accessRequest(`/restaurant/context?${query}`));if(alive.current&&version===requestVersion.current){if(result.role!==assignment.role)throw new Error('Your branch permissions changed. Reload this page to verify your current access.');setContext(result);}}
  catch(error){if(alive.current&&version===requestVersion.current)setError(errorText(error));}
  finally{if(alive.current&&version===requestVersion.current)setBusy(false);}
 }
 useEffect(()=>{alive.current=true;setLink('');void load();return()=>{alive.current=false;requestVersion.current++;};},[selected]);
 async function invite(event:FormEvent<HTMLFormElement>){
  event.preventDefault();if(!assignment||section!=='staff')return;const version=requestVersion.current;setBusy(true);setError('');setLink('');const data=new FormData(event.currentTarget);
  try{const result=invitationResultSchema.parse(await accessRequest('/restaurant/invitations',{method:'POST',csrf:identity.csrfToken,body:{tenantId:assignment.tenantId,branchId:assignment.branchId,email:data.get('email'),role:data.get('role')}}));if(alive.current&&version===requestVersion.current)setLink(result.link);}
  catch(error){if(alive.current&&version===requestVersion.current)setError(errorText(error));}
  finally{if(alive.current&&version===requestVersion.current)setBusy(false);}
 }
 const current=restaurantSections.find(entry=>entry.key===section)!;
 function changeBranch(branchId:string){
  requestVersion.current++;setContext(null);setLink('');setSelected(branchId);
 }
 return <div className="restaurant-admin">
  <div className="restaurant-page-heading">
   <div><h1>{current.label}</h1><p>{current.description}</p></div>
   {assignment&&<RestaurantBranchPicker assignments={assignments} selected={assignment} onChange={changeBranch}/>}
  </div>
  {!assignment?<div className="access-empty"><h2>No administrator assignment</h2><p>Contact the platform administrator for a branch invitation.</p></div>
   :section==='analytics'?<BranchAnalytics key={assignment.branchId} tenantId={assignment.tenantId} branchId={assignment.branchId}/>
   :section==='audit'?<BranchAudit key={assignment.branchId} tenantId={assignment.tenantId} branchId={assignment.branchId}/>
   :<>
    {busy&&!context&&<p role="status" className="access-note">Verifying branch permissions…</p>}
    {error&&!context&&<p role="alert" className="access-error">{error} <button className="text-button" onClick={()=>void load()}>Retry branch check</button></p>}
    {context&&<RestaurantWorkbench key={selected} tenantId={assignment.tenantId} branchId={assignment.branchId} csrf={identity.csrfToken} section={section}
      onBranchNameSaved={name=>setBranchNames(previous=>({...previous,[assignment.branchId]:name}))}
      staffInvitation={section==='staff'&&<AdminPanel title="Invite a staff member" description="Choose the role this person will have at the selected branch." className="rd-staff-invitation">
       {error&&<p role="alert" className="access-error">{error}</p>}
       <form onSubmit={invite} className="access-form access-form-grid">
        <label>Staff email<input name="email" type="email" required maxLength={254}/></label>
        <label>Staff role<select name="role" defaultValue="WORKER"><option value="WORKER">Worker / waiter</option><option value="CHEF">Chef</option><option value="CASHIER">Cashier</option><option value="MANAGER">Manager</option></select></label>
        <div className="rd-form-actions"><button className="button primary" disabled={busy}>{busy?'Creating invitation…':'Create staff invitation'}</button></div>
       </form>
       {link&&<><InviteLink key={link} link={link}/><button className="text-button" onClick={()=>setLink('')}>Dismiss private link</button></>}
      </AdminPanel>}/>}
   </>}
 </div>;
}
