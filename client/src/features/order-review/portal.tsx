'use client';

import {useOrderUpdates} from './live';
import {useServiceSound} from '../announcements/sound';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {checkoutIntakeSchema,orderDecisionInput,reviewBoardSchema,reviewOrderSchema,type OrderDecision,type ReviewOrder,type StaffIdentity} from '@restrodock/contracts';
import {accessRequest,errorText,writeResultUnknown} from '../access/api';
import {assignedMemberships} from '../access/policy';
import {SessionGate} from '../access/session';
import {RestaurantBranchPicker} from '../restaurant/branch-picker';
import {useBranchSelection} from '../restaurant/branch-selection';
import type {z} from 'zod';

type Kind='restaurant'|'staff';
type ReviewBoard=z.infer<typeof reviewBoardSchema>;
const money=new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'});
const dateTime=new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short'});
const signals={
 LARGE_QUANTITY:'Large quantity',HIGH_VALUE:'High estimate',TABLE_BURST:'Rapid orders at this table',
 BRANCH_BURST:'Rapid orders in this branch',REPEATED_CART:'Repeated cart at this table',
};
const reasons={
 AUTO_DISPATCHED:'Sent directly to kitchen',VERIFIED_AT_TABLE:'Verified with the table',DUPLICATE:'Duplicate order',UNVERIFIED:'Guest could not be verified',OTHER_RISK:'Other risk',
};
const statuses={AWAITING_REVIEW:'Awaiting review',PLACED:'Approved',REJECTED:'Rejected',CANCELLED:'Cancelled',ACCEPTED:'Kitchen accepted',PREPARING:'Preparing',READY:'Ready',SERVED:'Served'};

export function OrderReviewPortal({kind}:{kind:Kind}){
 return <SessionGate showSessionBar={false}>{identity=><AssignedReview key={identity.email} identity={identity} kind={kind}/>}</SessionGate>;
}

function AssignedReview({identity,kind}:{identity:StaffIdentity;kind:Kind}){
 const role=kind==='restaurant'?'RESTAURANT_ADMIN':'MANAGER';
 const assignments=assignedMemberships(identity).filter(member=>(member.role===role||(kind==='staff'&&member.role==='WORKER'))).flatMap(member=>member.access.map(({branch})=>({
  tenantId:member.tenant.id,branchId:branch.id,label:member.tenant.name+' · '+branch.name,
 })));
 const [branchId,setBranchId]=useBranchSelection(assignments,kind==='restaurant'?identity.email:'staff:'+identity.email);
 const selected=assignments.find(assignment=>assignment.branchId===branchId);
 return <div className="restaurant-admin">
  <div className="restaurant-page-heading">
   <div><h1>Order review</h1><p>Confirm first orders with the table before sending them to the kitchen.</p></div>
   {selected&&<RestaurantBranchPicker assignments={assignments} selected={selected} onChange={setBranchId}/>}
  </div>
  {selected?<ReviewBoardView key={selected.branchId} {...selected} kind={kind} waiter={identity.memberships.some(member=>member.role==='WORKER'&&member.tenant.id===selected.tenantId)} csrf={identity.csrfToken}/>
   :<section className="access-empty"><h2>Order review access required</h2><p>Ask for an assigned {kind==='staff'?'Manager':'Restaurant Admin'} role on this branch.</p></section>}
 </div>;
}

export function ReviewBoardView({tenantId,branchId,kind,csrf,waiter=false}:{tenantId:string;branchId:string;kind:Kind;csrf:string;waiter?:boolean}){
 const [board,setBoard]=useState<ReviewBoard|null>(null);
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const revision=useRef(0);
 const lifetime=useRef(0),inFlight=useRef(false);
 const refreshButton=useRef<HTMLButtonElement>(null);
 const intakeButton=useRef<HTMLButtonElement>(null);
 const alert=useRef<HTMLParagraphElement>(null);
 const focusOnResult=useRef<'intake'|'refresh'|'decision'|null>(null);
 useEffect(()=>{
  if(busy||!focusOnResult.current)return;
  const target=focusOnResult.current;
  focusOnResult.current=null;
  if(target==='decision'&&error)alert.current?.focus();
  else if(target==='intake')intakeButton.current?.focus();
  else refreshButton.current?.focus();
 },[busy,error,notice,board]);
 const query='?'+new URLSearchParams({tenantId,branchId});
 const base='/'+kind+'/order-review';

 async function run(action:()=>Promise<()=>void>,focus:'intake'|'refresh'|'decision'|null=null){
  if(inFlight.current)return;
  const started=lifetime.current;
  inFlight.current=true;
  revision.current++;
  focusOnResult.current=focus;
  setBusy(true);setError('');setNotice('');
  try{
   const update=await action();
   if(started===lifetime.current)update();
  }catch(error){
   if(started===lifetime.current){
    setError(errorText(error)+((focus==='decision'||focus==='intake')&&writeResultUnknown(error)?' Refresh orders to confirm the saved state.':''));
   }
  }finally{
   if(started===lifetime.current){inFlight.current=false;setBusy(false);}
  }
 }
 function refresh(restoreFocus=false){
  return run(async()=>{
   const saved=reviewBoardSchema.parse(await accessRequest(base+query));
   return ()=>setBoard(saved);
  },restoreFocus?'refresh':null);
 }
 useEffect(()=>{
  void refresh();
  return ()=>{lifetime.current++;inFlight.current=false;};
 },[]);

 const sound=useServiceSound();
 const live=useOrderUpdates(tenantId,branchId,false,async isCurrent=>{
  if(inFlight.current)return false;
  const started=revision.current;
  try{
   const saved=reviewBoardSchema.parse(await accessRequest(base+query));
   if(isCurrent()&&started===revision.current){setBoard(saved);setError('');}
  }catch(error){
   if(isCurrent()&&started===revision.current)setError(errorText(error));
  }
  return true;
 },false,waiter?sound.receive:undefined);

 function toggleIntake(){
  if(!board)return;
  return run(async()=>{
   const intake=checkoutIntakeSchema.parse(await accessRequest(base+'/intake'+query,{
    method:'PUT',csrf,body:{version:board.intake.version,paused:!board.intake.paused},
   }));
   return ()=>{
    setBoard({...board,intake});
    setNotice(intake.paused?'New orders paused. Pending orders can still be reviewed.':'New orders resumed.');
   };
  },'intake');
 }

 function decide(orderId:string,input:OrderDecision){
  if(!board)return;
  return run(async()=>{
   const saved=reviewOrderSchema.parse(await accessRequest(base+'/'+orderId+'/decision'+query,{method:'POST',csrf,body:input}));
   return ()=>{
    setBoard({...board,pending:board.pending.filter(order=>order.id!==saved.id),recent:[saved,...board.recent.filter(order=>order.id!==saved.id)].slice(0,15)});
    setNotice(saved.status==='PLACED'?'Order approved.':saved.status==='AWAITING_REVIEW'?'Table confirmed. Manager review is required before kitchen dispatch.':'Order rejected.');
   };
  },'decision');
 }

 const intakeMessage=!board?(busy?'Checking intake status…':'Intake status is unavailable. Refresh orders to check it.')
  :board.intake.paused?'Paused for this branch.':'Accepting new pilot orders. Pause while staff investigate unusual activity.';

 return <div className="review-workspace" aria-busy={busy}>
  {!waiter&&<section className="review-panel review-intake" aria-label="New order intake">
   <div><h2>New order intake</h2><p>{intakeMessage}</p></div>
   {board&&<button type="button" ref={intakeButton} className="button secondary" onClick={()=>void toggleIntake()} disabled={busy}>
    {board.intake.paused?'Resume new orders':'Pause new orders'}
   </button>}
  </section>}
  {waiter&&sound.controls}
  {error&&<p className="access-error" role="alert" ref={alert} tabIndex={-1}>{error}</p>}
  {notice&&<p className="review-notice" role="status">{notice}</p>}
  <section className="review-panel rd-review-queue" aria-labelledby="pending-orders">
   <div className="review-section-heading"><div><h2 id="pending-orders">Awaiting review</h2><p className="muted" role="status">{live?'Live updates connected':'Checking for updates periodically'}</p></div>
    <button type="button" ref={refreshButton} className="button secondary" disabled={busy} onClick={()=>void refresh(true)}>Refresh orders</button>
   </div>
   {busy&&!board&&<p role="status">Loading orders…</p>}
   {board&&!board.pending.length&&<p>No orders awaiting review.</p>}
   {board?.hasMore&&<p>Showing the oldest 50 orders. Refresh to load the next orders after reviewing these.</p>}
   {board&&board.pending.length>0&&<ul className="review-list">{board.pending.map(order=><li key={order.id}><PendingOrder order={order} busy={busy} decide={decide} waiter={waiter}/></li>)}</ul>}
  </section>
  {board&&(kind==='restaurant'||board.recent.length>0)&&<section className="review-panel rd-review-history" aria-labelledby="recent-decisions">
   <h2 id="recent-decisions">Recent decisions</h2>
   {board.recent.length===0&&<p>Reviewed orders will appear here.</p>}
   <ul className="review-list">{board.recent.map(order=><li key={order.id}>
    <OrderHeader order={order}/><p>{order.status==='PLACED'&&order.reviewReason==='AUTO_DISPATCHED'?'New':statuses[order.status]}{order.reviewReason&&' · '+reasons[order.reviewReason]}</p>
   </li>)}</ul>
  </section>}
 </div>;
}

function OrderHeader({order}:{order:ReviewOrder}){
 return <div className="review-order-heading">
  <div><h3>{order.tableLabel}</h3><p><time dateTime={order.createdAt}>{dateTime.format(new Date(order.createdAt))}</time> · #{order.id.slice(0,8)}</p></div>
  <strong>{money.format(order.estimatedTotalMinor/100)} <span>estimate</span></strong>
 </div>;
}

function PendingOrder({order,busy,decide,waiter=false}:{order:ReviewOrder;busy:boolean;waiter?:boolean;decide:(id:string,input:OrderDecision)=>void}){
 const flagged=order.riskSignals.length>0;
 function reject(event:FormEvent<HTMLFormElement>){
  event.preventDefault();
  const result=orderDecisionInput.safeParse({version:order.version,decision:'REJECT',reason:new FormData(event.currentTarget).get('reason')});
  if(result.success)decide(order.id,result.data);
 }
 return <article>
  <OrderHeader order={order}/>
  {order.awaitingWaiter&&<p>Confirm this first order with {order.guestName??'the guest'} at the table.</p>}
  {flagged&&<ul className="review-signals" aria-label="Risk signals">{order.riskSignals.map(signal=><li key={signal}>{signals[signal]}</li>)}</ul>}
  <ul className="review-items">{order.items.map((item,index)=><li key={index}>
   <strong>{item.quantity} × {item.name}</strong>
   {item.portion&&' · '+item.portion}{item.addOns.length>0&&' · '+item.addOns.join(', ')}
   {item.note&&<p>Preparation note: {item.note}</p>}
  </li>)}</ul>
  <details className="review-details">
   <summary>Review order</summary>
   <div className="review-decisions">
    <form onSubmit={event=>{
     event.preventDefault();
     if(new FormData(event.currentTarget).get('verified')==='on')decide(order.id,{version:order.version,decision:'APPROVE',override:flagged});
    }}>
     <label className="review-checkbox"><input type="checkbox" name="verified" required disabled={busy}/>I verified this order with the table.</label>
     <button className="button primary" disabled={busy}>{waiter&&order.awaitingWaiter?'Confirm table & approve':flagged?'Approve flagged order':'Approve order'}</button>
    </form>
    <form onSubmit={reject}>
     <label>Rejection reason<select name="reason" required defaultValue="" disabled={busy}>
      <option value="" disabled>Select reason</option><option value="DUPLICATE">{reasons.DUPLICATE}</option>
      <option value="UNVERIFIED">{reasons.UNVERIFIED}</option><option value="OTHER_RISK">{reasons.OTHER_RISK}</option>
     </select></label>
     <button className="button secondary" disabled={busy}>Reject order</button>
    </form>
   </div>
  </details>
 </article>;
}
