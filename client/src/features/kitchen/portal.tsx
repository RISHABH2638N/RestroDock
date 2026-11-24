'use client';

import {useEffect,useRef,useState,type FormEvent} from 'react';
import {kitchenBoardSchema,kitchenRoles,type StaffIdentity} from '@restrodock/contracts';
import type {z} from 'zod';
import {accessRequest,errorText} from '../access/api';
import {assignedMemberships} from '../access/policy';
import {SessionGate} from '../access/session';
import {RestaurantBranchPicker} from '../restaurant/branch-picker';
import {useBranchSelection} from '../restaurant/branch-selection';
import {useServiceSound} from '../announcements/sound';
import {useOrderUpdates} from '../order-review/live';

type Board=z.infer<typeof kitchenBoardSchema>;
type Ticket=Board['tickets'][number];
type KitchenRole=typeof kitchenRoles[number];
const labels={AWAITING_REVIEW:'Awaiting verification',PLACED:'New',ACCEPTED:'Accepted',PREPARING:'Preparing',READY:'Ready',SERVED:'Served',REJECTED:'Rejected'};
const next={PLACED:['ACCEPT','Accept ticket'],ACCEPTED:['PREPARE','Start preparing'],PREPARING:['READY','Mark ready'],READY:['SERVE','Mark served']} as const;

export function KitchenPortal(){
 return <SessionGate showSessionBar={false}>{identity=><AssignedKitchen identity={identity}/>}</SessionGate>;
}

function AssignedKitchen({identity}:{identity:StaffIdentity}){
 const assignments=assignedMemberships(identity).flatMap(member=>{
  const role=kitchenRoles.find(value=>value===member.role);
  return role?member.access.map(({branch})=>({
   role,branchId:branch.id,tenantId:member.tenant.id,label:member.tenant.name+' · '+branch.name,
  })):[];
 });
 const [branchId,setBranchId]=useBranchSelection(assignments,'staff:'+identity.email);
 const selected=assignments.find(branch=>branch.branchId===branchId);
 return <div className="restaurant-admin">
  <div className="restaurant-page-heading">
   <div><h1>{selected?.role==='WORKER'?'Incoming & pickup':'Kitchen tickets'}</h1>
    <p>{selected?.role==='WORKER'?'Pick up ready orders and mark them served.':'Accept orders and mark dishes ready for pickup.'}</p></div>
   {selected&&<RestaurantBranchPicker assignments={assignments} selected={selected} onChange={setBranchId}/>}
  </div>
  {selected?<KitchenBoard key={selected.branchId} {...selected} csrf={identity.csrfToken}/>:<p>No kitchen or pickup branch is assigned to your account.</p>}
 </div>;
}

export function KitchenBoard({tenantId,branchId,role,csrf}:{tenantId:string;branchId:string;role:KitchenRole;csrf:string}){
 const [board,setBoard]=useState<Board|null>(null);
 const [error,setError]=useState('');
 const [loadError,setLoadError]=useState('');
 const [notice,setNotice]=useState('');
 const [saving,setSaving]=useState(false);
 const [now,setNow]=useState(()=>Date.now());
 const lifetime=useRef(0),revision=useRef(0),writing=useRef(false);
 const query='?'+new URLSearchParams({tenantId,branchId});
 const base='/staff/kitchen';
 async function load(isCurrent:()=>boolean){
  const started=++revision.current;
  try{
   const data=kitchenBoardSchema.parse(await accessRequest(base+query));
   if(isCurrent()&&started===revision.current){setBoard(data);setLoadError('');}
   return true;
  }catch(error){
   if(isCurrent()&&started===revision.current)setLoadError(errorText(error));
   return false;
  }
 }
 useEffect(()=>{
  const started=++lifetime.current;
  void load(()=>started===lifetime.current);
  const clock=setInterval(()=>setNow(Date.now()),15000);
  return ()=>{lifetime.current++;clearInterval(clock);};
 },[]);
 const sound=useServiceSound();
 const voiceAvailable=role==='CHEF'||role==='WORKER';
 const live=useOrderUpdates(tenantId,branchId,true,async isCurrent=>{
  if(writing.current)return false;
  await load(isCurrent);
  return true;
 },false,voiceAvailable?sound.receive:undefined);
 async function act(event:FormEvent<HTMLFormElement>,ticket:Ticket){
  event.preventDefault();
  if(writing.current)return;
  const action=(event.nativeEvent as SubmitEvent).submitter?.getAttribute('value');
  if(!action)return;
  const note=String(new FormData(event.currentTarget).get('note')??'').trim();
  if(action==='REJECT'&&!note){setError('Enter a reason for rejecting this ticket.');return;}
  writing.current=true;
  revision.current++;
  const started=lifetime.current;
  const isCurrent=()=>started===lifetime.current;
  setSaving(true);setError('');setNotice('');
  try{
   await accessRequest(base+'/'+ticket.id+'/action'+query,{method:'POST',csrf,body:{version:ticket.version,action,note}});
   if(isCurrent()){setNotice('Ticket updated.');await load(isCurrent);}
  }catch(error){
   if(isCurrent()){setError(errorText(error));await load(isCurrent);}
  }finally{writing.current=false;if(isCurrent())setSaving(false);}
 }
 return <section className="review-panel staff-ticket-board" aria-labelledby="ticket-queue">
  <div className="review-section-heading"><div><h2 id="ticket-queue">Branch queue</h2>
   <p className="muted">{live?'Live updates connected':'Checking for updates periodically'}</p></div>
   <button className="button secondary" disabled={saving} onClick={()=>{setError('');const started=lifetime.current;void load(()=>started===lifetime.current);}}>Refresh tickets</button>
  </div>
  {voiceAvailable&&board&&sound.controls}
  {(error||loadError)&&<p className="access-error" role="alert">{error||loadError}</p>}
  {notice&&<p className="review-notice" role="status">{notice}</p>}
  {!board&&!loadError&&<p role="status">Loading tickets…</p>}
  {board?.hasMore&&<p>Showing the first 100 tickets.</p>}
  {board?.tickets.length===0&&<p>No tickets right now. New orders will appear here.</p>}
  <ul className="review-list">{board?.tickets.map(ticket=>{
   const step=ticket.status in next?next[ticket.status as keyof typeof next]:undefined;
   const actionable=step&&(ticket.status==='READY'?role!=='CHEF':role!=='WORKER');
   const wait=Math.max(0,Math.floor((now-Date.parse(ticket.queuedAt))/60000));
    const overdue=wait>=15&&['AWAITING_REVIEW','PLACED','ACCEPTED','PREPARING'].includes(ticket.status);
   return <li key={ticket.id}><article>
    <div className="review-order-heading"><div><h3>{ticket.tableLabel}</h3><p>KOT <abbr title={ticket.id}>{ticket.id.slice(0,8)}</abbr></p></div><strong className="staff-ticket-status" data-ticket-status={ticket.status}>{labels[ticket.status]}</strong></div>
    {overdue&&<p className="access-error"><strong>Waiting {wait} min</strong> {ticket.status==='AWAITING_REVIEW'?'for table verification':'in the kitchen queue'}</p>}
    <ul className="review-items">{ticket.items.map((item,index)=><li key={index}><strong>{item.quantity} × {item.name}</strong>
     {item.portion&&' · '+item.portion}{item.addOns.length>0&&' · '+item.addOns.join(', ')}
     {item.note&&<p>Guest preparation note: {item.note}</p>}</li>)}</ul>
    {ticket.status==='AWAITING_REVIEW'&&<p className="held-message" role="note">Visible to the kitchen. An assigned Manager or Restaurant Admin must verify this order before preparation can begin.</p>}
    {ticket.kitchenNote&&<p>Staff note: {ticket.kitchenNote}</p>}
    {actionable&&<form key={ticket.version} className="access-form" onSubmit={event=>void act(event,ticket)}>
     <label>Staff note{ticket.status==='PLACED'?' (required to reject)':' (optional)'}<input name="note" maxLength={240} disabled={saving}/></label>
     <div className="review-section-heading">
      <button type="submit" className="button primary" value={step[0]} disabled={saving}>{step[1]}</button>
      {ticket.status==='PLACED'&&<button type="submit" className="button secondary" value="REJECT" disabled={saving}>Reject ticket</button>}
     </div>
    </form>}
   </article></li>;
  })}</ul>
 </section>;
}
