'use client';
import {useEffect,useRef,useState,type FormEvent} from 'react';
import {Plus,QrCode} from 'lucide-react';
import {BulkSelection} from '../restaurant/bulk-selection';
import {RestaurantBranchPicker} from '../restaurant/branch-picker';
import {useBranchSelection} from '../restaurant/branch-selection';
import {tableBoardSchema,tableActionSchema,tableCreate,tableEdit,tableSectionInput,type TableBoard,type StaffIdentity} from '@restrodock/contracts';
import {tableStatus} from '../restaurant/service';
import {useServiceSound} from '../announcements/sound';
import {useOrderUpdates} from '../order-review/live';
import {SessionGate} from '../access/session';
import {assignedMemberships,staffSections} from '../access/policy';
import {accessRequest,errorText,writeResultUnknown} from '../access/api';
import {useFormFeedback,FormErrorSummary} from '../../components/form-feedback';
type TableView='tables'|'billing'|'assistance';

export function TablesPortal({kind,view='tables'}:{kind:'restaurant'|'staff';view?:TableView}){
 return <SessionGate showSessionBar={false}>{identity=><AssignedTables key={identity.email+view} identity={identity} kind={kind} view={view}/>}</SessionGate>;
}
function AssignedTables({identity,kind,view}:{identity:StaffIdentity;kind:'restaurant'|'staff';view:TableView}){
 const staffRoles=staffSections.find(section=>section.href==='/staff/'+view)?.roles??[];
 const assignments=assignedMemberships(identity)
  .filter(member=>kind==='restaurant'?member.role==='RESTAURANT_ADMIN':staffRoles.some(role=>role===member.role))
  .flatMap(member=>member.access.map(({branch})=>({
   tenantId:member.tenant.id,branchId:branch.id,role:member.role,label:member.tenant.name+' · '+branch.name,
  })));
 const [selected,setSelected]=useBranchSelection(assignments,kind==='restaurant'?identity.email:'staff:'+identity.email);
 const assignment=assignments.find(branch=>branch.branchId===selected);
 const heading=kind==='restaurant'?'Tables & QR':view==='billing'?'Billing queue':view==='assistance'?'Guest assistance':'Manage tables';
 const description=view==='billing'?'Review bill requests and close out table sessions.':view==='assistance'?'Find tables that requested help and clear each request after responding.':'Open a table, issue its PIN, or check the current session.';
 return <div className="restaurant-admin">
  <div className="restaurant-page-heading">
   <div><h1>{heading}</h1><p>{description}</p></div>
   {assignment&&<RestaurantBranchPicker assignments={assignments} selected={assignment} onChange={setSelected}/>}
  </div>
  {assignment?<TableBoardView key={selected} tenantId={assignment.tenantId} branchId={assignment.branchId} csrf={identity.csrfToken} kind={kind} view={view} waiter={assignment.role==='WORKER'}/>:
   <section className="access-empty"><h2>Table-service access required</h2><p>Ask your restaurant administrator for an eligible role and branch assignment.</p></section>}
 </div>;
}
export function TableBoardView({tenantId,branchId,csrf,kind,view='tables',waiter=false}:{tenantId:string;branchId:string;csrf:string;kind:'restaurant'|'staff';view?:TableView;waiter?:boolean}){
 const [board,setBoard]=useState<TableBoard|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[disclosure,setDisclosure]=useState<{label:string;pin?:string;qr?:{url:string;pngDataUrl:string}}|null>(null);
 const [section,setSection]=useState('');
 const [billsOnly,setBillsOnly]=useState(false);
 const [selectedTable,setSelectedTable]=useState(()=>typeof window==='undefined'?'':new URLSearchParams(window.location.search).get('table')??'');
 const issuedHeading=useRef<HTMLHeadingElement>(null);
 useEffect(()=>{if(disclosure)issuedHeading.current?.focus();},[disclosure]);
 const alive=useRef(true),generation=useRef(0),feedback=useFormFeedback(busy),base='/'+kind+'/tables',query='?'+new URLSearchParams({tenantId,branchId});
 async function reload(){const n=++generation.current;setBusy(true);setError('');setNotice('');setDisclosure(null);feedback.clear();try{const value=tableBoardSchema.parse(await accessRequest(base+query));if(alive.current&&n===generation.current)setBoard(value);}catch(e){if(alive.current&&n===generation.current)setError(errorText(e));}finally{if(alive.current&&n===generation.current)setBusy(false);}}
 useEffect(()=>{alive.current=true;void reload();return()=>{alive.current=false;generation.current++;};},[]);
 const sound=useServiceSound();
 useOrderUpdates(tenantId,branchId,'tables',async isCurrent=>{
  if(busy||!board)return true;
  const current=generation.current;
  try{
   const result=tableBoardSchema.parse(await accessRequest(base+query));
   if(isCurrent()&&alive.current&&current===generation.current)setBoard(result);
  }catch{/* Keep the current board available. The next event or periodic refresh retries. */}
  return true;
 },false,waiter?sound.receive:undefined);
 async function act(path:string,body:unknown,label:string,form?:HTMLFormElement,method='POST'){
  const n=++generation.current;setBusy(true);setError('');setNotice('');setDisclosure(null);feedback.clear();
  try{const result=tableActionSchema.parse(await accessRequest(base+path+query,{method,csrf,body}));if(alive.current&&n===generation.current){setBoard(result.board);if(path.endsWith('/settle'))setBillsOnly(false);setNotice(path.endsWith('/settle')?label+(board?.billingMode==='RESTRODOCK'?' closed. Payment recorded and the table is available.':' closed. Payment confirmed in the POS and the table is available.'):'Saved. Current table state reloaded.');if(result.pin||result.qr)setDisclosure({label,...(result.pin?{pin:result.pin}:{}),...(result.qr?{qr:result.qr}:{})});return true;}}
  catch(e){if(alive.current&&n===generation.current){if(form?.dataset.validation)feedback.report(form,e);else setError(errorText(e));const issuesCredential=['/qr','/open','/reopen-settled','/pin'].some(suffix=>path.endsWith(suffix));if(writeResultUnknown(e))setNotice('The change may already have saved. Refresh saved tables before retrying.'+(issuesCredential?' If the issued PIN or QR was lost, rotate it and replace the previous one.':''));}}
  finally{if(alive.current&&n===generation.current)setBusy(false);}
 }
 function save(event:FormEvent<HTMLFormElement>,id?:string){event.preventDefault();const form=event.currentTarget,fields=new FormData(form);try{const common={label:fields.get('label'),section:fields.get('section'),seats:Number(fields.get('seats'))};const row=board?.items.find(t=>t.id===id);const body=id?tableEdit.parse({...common,archived:fields.get('archived')==='on',version:row!.version}):tableCreate.parse({...common,revision:board!.revision});void act(id?'/'+id:'',body,id?'Table updated':'Table created',form,id?'PUT':'POST');}catch(e){feedback.report(form,e);}}
 if(!board)return <section className="access-section">{error?<p role="alert">{error} <button className="button secondary" onClick={()=>void reload()}>Retry saved tables</button></p>:<p role="status">Loading assigned tables…</p>}</section>;
 const sections=[...new Set(board.items.filter(table=>kind==='restaurant'||!table.archived).map(table=>table.section))];
 const activeSection=sections.includes(section)?section:'';
 const internalBilling=board.billingMode==='RESTRODOCK';
 const money=(minor:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(minor/100);
 const requested=board.items.filter(table=>table.session?.billRequestedAt);
 const billQueue=view==='billing'||billsOnly;
 const assistanceQueue=view==='assistance';
 const visible=billQueue?requested:assistanceQueue?board.items.filter(table=>table.session?.assistanceRequestedAt):
  board.items.filter(table=>(kind==='restaurant'||!table.archived)&&(!activeSection||table.section===activeSection));
 const unavailable=view==='billing'&&!board.canSettle?'Billing is unavailable for this branch or role.':
  assistanceQueue&&!board.canOpen?'Guest assistance is unavailable for this branch or role.':'';
 const emptyMessage=billQueue?'No tables are waiting for a bill.':assistanceQueue?'No tables are waiting for assistance.':'';

 const activeTable=visible.find(table=>table.id===selectedTable)??visible[0];
 return <section className="table-board" aria-busy={busy}>
  <div className="table-entry-summary"><div><h2>{board.branchName}</h2><p>{kind==='restaurant'&&<QrCode size={15} aria-hidden="true"/>}{view==='tables'?(board.entryPublished?'Table entry published':'Table entry unpublished'):`${visible.length} ${visible.length===1?'table':'tables'} waiting`}</p></div><button className="button secondary" disabled={busy} onClick={()=>void reload()}>Refresh saved tables</button></div>
  {waiter&&sound.controls}
  {view==='billing'&&board.items.some(table=>table.receipt)&&<details>
   <summary>Recent RestroDock receipts</summary>
   {board.items.flatMap(table=>table.receipt?[<details key={table.receipt.reference}>
    <summary>{table.label} · {money(table.receipt.totalMinor)}</summary>
    <h3>{table.receipt.restaurantName} · {table.receipt.branchName}</h3>
    <p>Payment receipt · {table.receipt.reference}</p>
    <p>{new Date(table.receipt.issuedAt).toLocaleString('en-IN')} · {table.receipt.paymentMethod}</p>
    <ul>{table.receipt.lines.map((line,index)=><li key={index}>{line.quantity} × {line.description} · {money(line.amountMinor)}</li>)}</ul>
    <p>Total paid <strong>{money(table.receipt.totalMinor)}</strong></p>
   </details>]:[])}
  </details>}
  {error&&<p role="alert" className="access-error">{error}</p>}{notice&&<p role="status">{notice}</p>}
  {disclosure&&<section className="table-disclosure" aria-label="Issued table credentials"><h2 ref={issuedHeading} tabIndex={-1}>{disclosure.label}</h2>{disclosure.pin&&!board.waiterConfirmation&&<><p>Share this PIN with the guest at this table. It is stored securely and shown once; the guest enters it for their first order.</p><p className="table-pin" aria-label="Issued PIN">{disclosure.pin}</p><p>After verification, this guest can place repeat orders from the same browser without another PIN. The PIN expiry is shown in the table row.</p></>}{disclosure.qr&&<div className="table-qr-receipt"><h3>{board.restaurantName} · {disclosure.label}</h3><img src={disclosure.qr.pngDataUrl} width={280} height={280} alt={'Scannable QR for '+disclosure.label}/><p>Scan at your table. The waiter confirms your first order.</p><p>RestroDock · table entry pilot</p><a className="button primary" href={disclosure.qr.pngDataUrl} download="restrodock-table-qr.png">Download QR PNG</a><button className="button secondary" onClick={()=>window.print()}>Print QR card</button><label>Save the current QR link<input readOnly value={disclosure.qr.url} onFocus={e=>e.currentTarget.select()}/></label><p>Save or print now. The QR secret cannot be retrieved later; rotating replaces existing cards.</p></div>}<button className="button secondary" onClick={()=>setDisclosure(null)}>Dismiss issued credentials</button></section>}
  {board.canManage&&<details className="rd-admin-panel rd-table-add">
   <summary><Plus size={17} aria-hidden="true"/>Add a physical table</summary>
   <p>Choose its label, section and capacity before issuing a QR.</p>
  <form className="table-create" data-validation="table-create" onSubmit={e=>save(e)}><fieldset disabled={busy}><FormErrorSummary feedback={feedback} owner="table-create"/><label>Table label<input name="label" required maxLength={80} {...feedback.props('table-create','label')}/></label><label>Section<input name="section" required maxLength={80} defaultValue="Main" {...feedback.props('table-create','section')}/></label><label>Seats<input name="seats" type="number" min={1} max={30} defaultValue={4} required {...feedback.props('table-create','seats')}/></label><button className="button primary">Add table</button></fieldset></form>
  </details>}
  {view==='tables'&&board.canSettle&&(requested.length>0||billsOnly)&&<div className="rd-table-filters" aria-label="Billing queue">
   <button type="button" className="button secondary" aria-pressed={!billsOnly} onClick={()=>setBillsOnly(false)}>All service</button>
   <button type="button" className="button secondary" aria-pressed={billsOnly} onClick={()=>setBillsOnly(true)}>Bill requested ({requested.length})</button>
  </div>}
  {(unavailable||(!visible.length&&emptyMessage))&&<p role="status" className="rd-panel">{unavailable||emptyMessage}</p>}
  {view==='tables'&&!billsOnly&&sections.length>1&&<div className="rd-table-filters" aria-label="Table sections">
   {['',...sections].map(value=><button key={value} className={activeSection===value?'button primary':'button secondary'} aria-pressed={activeSection===value} onClick={()=>setSection(value)}>{value||'All tables'}</button>)}
  </div>}
  {kind==='restaurant'&&board.canManage&&view==='tables'&&!billsOnly&&<BulkSelection title="Move tables to a section" busy={busy}
   items={visible.filter(table=>!table.archived&&!table.session).map(table=>({id:table.id,label:table.label+' · '+table.section}))}
   onApply={async(ids,fields)=>{
    const input=tableSectionInput.safeParse({
     section:fields.get('section'),
     tables:visible.filter(table=>ids.includes(table.id)).map(({id,version})=>({id,version})),
    });
    if(!input.success){setError('Enter a section name and select up to 20 unoccupied tables.');return false;}
    return (await act('/section',input.data,'Tables moved',undefined,'PUT'))===true;
   }}>
   <label>Destination section<input name="section" required maxLength={80}/></label>
  </BulkSelection>}
  {kind==='restaurant'&&<div className="rd-admin-list-heading">
   <h2>Table floor</h2><span>{visible.length} {visible.length===1?'table':'tables'}</span>
  </div>}
  <div className={!unavailable&&activeTable?'rd-table-layout':undefined}>
  {!unavailable&&activeTable&&<ul className="rd-table-grid" aria-label="Tables">{visible.map(table=><li key={table.id}><button type="button" aria-label={table.label+', '+table.section+', '+tableStatus(table)} aria-pressed={table.id===activeTable.id} onClick={()=>setSelectedTable(table.id)}>
   <strong>{table.label}</strong><span>{table.section}</span><span className="rd-table-status" data-status={tableStatus(table)}>{tableStatus(table)}</span>
  </button></li>)}</ul>}
  {view==='tables'&&!visible.length?<div className="access-empty"><h2>No tables configured</h2><p>{board.canManage?'Add a physical table, issue its QR, then publish table entry.':'Ask your Restaurant Admin to configure tables and publish entry.'}</p></div>:!unavailable&&activeTable&&<ul className="table-rows">{[activeTable].map(table=><li key={table.id} className="table-row"><div className="table-row-heading"><div><h3>{table.label}</h3><p>{table.section} · {table.seats} seats · {table.archived?'Archived':table.session?'Occupied':'Available'} · {table.qrActive?'Current QR issued':'No current QR'}</p></div></div>
   {table.session&&<div className="table-session"><p><strong>{!board.waiterConfirmation&&table.session.locked?'PIN locked — rotate required':'Session open'}</strong> · {table.session.guestCount} verified guests</p><p>Session ends {new Date(table.session.expiresAt).toLocaleString()}. PIN expires {table.session.pinExpiresAt?new Date(table.session.pinExpiresAt).toLocaleTimeString():'unavailable'}.</p>{view!=='billing'&&table.session.assistanceRequestedAt&&<p><strong>Guest requested help</strong> · {new Date(table.session.assistanceRequestedAt).toLocaleTimeString()} {board.canOpen&&<button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/assistance/resolve',{version:table.session!.version},table.label)}>Clear request</button>}</p>}
   {!!table.session.orders?.length&&<details><summary>Session orders ({table.session.orders.length})</summary><ul>{table.session.orders.map(order=><li key={order.id}><abbr title={order.id}>{order.id.slice(0,8)}</abbr> · {order.status.toLowerCase().replaceAll('_',' ')} · {new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(order.estimatedTotalMinor/100)} estimate</li>)}</ul></details>}
   {!table.session.entryOnly&&<p>Legacy service session: use its service/billing closure workflow.</p>}</div>}
   {view==='tables'&&<div className="table-actions">{!table.archived&&board.canManage&&<><button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/qr',{version:table.version},table.label)}>Issue / rotate QR</button>{table.qrActive&&<button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/qr/revoke',{version:table.version},table.label)}>Revoke QR</button>}</>}{!table.archived&&!table.session&&board.canOpen&&<form onSubmit={e=>{e.preventDefault();void act('/'+table.id+'/open',{version:table.version,durationMinutes:Number(new FormData(e.currentTarget).get('duration'))},table.label,e.currentTarget);}}><fieldset disabled={busy||!board.entryPublished||!table.qrActive}><label>Session duration<select name="duration" defaultValue="120"><option value="60">1 hour</option><option value="120">2 hours</option><option value="240">4 hours</option></select></label><button className="button primary">{board.waiterConfirmation?'Start table session':'Start table session & generate PIN'}</button></fieldset></form>}{table.session?.entryOnly&&<>{!board.waiterConfirmation&&board.canOpen&&table.session.guestCount===0&&<button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/pin',{version:table.session!.version},table.label)}>Replace expired or lost PIN</button>}{board.canClose&&(table.session.awaitingWaiter||!table.session.singleGuest||((table.session.guestCount===0||board.waiterConfirmation)&&!table.session.orders?.some(order=>!['REJECTED','CANCELLED'].includes(order.status))))&&<button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/close',{version:table.session!.version},table.label)}>{table.session.singleGuest?'End unused table session':'Close table & revoke guests'}</button>}</>}</div>}
   {!assistanceQueue&&table.session?.billRequestedAt&&<section className="rd-panel cashier-summary">
    <h4>Bill requested</h4><p>Order summary · Not a tax invoice</p>
    <ul>{table.session.orders?.filter(order=>!['REJECTED','CANCELLED'].includes(order.status)).map(order=><li key={order.id}>
     <strong>#{order.id.slice(0,8)} · {order.status.toLowerCase().replaceAll('_',' ')}</strong>
     <ul>{order.items?.map((item,index)=><li key={index}>{item.quantity} × {item.nameSnapshot}{item.portionNameSnapshot?' · '+item.portionNameSnapshot:''}{item.addOnSnapshots?.length?' · '+item.addOnSnapshots.map(addOn=>addOn.name).join(', '):''}</li>)}</ul>
     <p>Estimate {new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(order.estimatedTotalMinor/100)}</p>
    </li>)}</ul>
    {board.canResumeBilling&&<button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/bill/resume',{sessionId:table.session!.id,version:table.session!.version},table.label)}>Reopen unpaid ordering</button>}
   </section>}
   {view==='tables'&&board.canSettle&&table.session?.orders?.some(order=>!['CANCELLED','REJECTED'].includes(order.status))&&!table.session.billRequestedAt&&
    <button className="button secondary" disabled={busy} onClick={()=>void act('/'+table.id+'/bill',{sessionId:table.session!.id,version:table.session!.version},table.label)}>Request bill</button>}
   {!assistanceQueue&&board.canSettle&&table.session?.billRequestedAt&&!!table.session.orders?.some(order=>order.status==='SERVED')&&table.session.orders.every(order=>['SERVED','REJECTED','CANCELLED'].includes(order.status))&&<form key={table.session.id} className="access-form cashier-settlement" onSubmit={event=>{
    event.preventDefault();
    const fields=new FormData(event.currentTarget);
    void act('/'+table.id+'/settle',{sessionId:table.session!.id,version:table.session!.version,...(internalBilling?{billingMode:'RESTRODOCK'}:{externalBillReference:fields.get('bill')}),paymentMethod:fields.get('method'),confirmed:fields.get('confirmed')==='on'},table.label,event.currentTarget);
   }}><fieldset disabled={busy}><legend>{internalBilling?'Issue payment receipt':'Confirm POS settlement'}</legend>
    {internalBilling?<p>Collect {money(table.session.orders!.filter(order=>order.status==='SERVED').reduce((total,order)=>total+order.estimatedTotalMinor,0))} before issuing the receipt.</p>:<>
     <p>Generate the final invoice and collect payment in your POS first.</p>
     <label>POS invoice reference<input name="bill" required maxLength={160}/></label>
    </>}
    <label>Payment method<select name="method" required defaultValue=""><option value="" disabled>Select a method</option><option value="CASH">Cash</option><option value="UPI">UPI</option></select></label>
    <label className="registration-checkbox"><input type="checkbox" name="confirmed" required/><span>{internalBilling?'I received the full amount.':'I confirmed payment in the POS.'}</span></label>
    <button className="button primary">Confirm payment and release table</button></fieldset></form>}
   {view==='tables'&&board.canResumeBilling&&table.lastSettledSessionId&&board.entryPublished&&table.qrActive&&!table.archived&&!table.session&&<details>
    <summary>Reopen after settlement</summary><form className="access-form" onSubmit={event=>{
     event.preventDefault();
     const fields=new FormData(event.currentTarget);
     void act('/'+table.id+'/reopen-settled',{version:table.version,durationMinutes:120,settledSessionId:table.lastSettledSessionId,approved:fields.get('approved')==='on'},table.label,event.currentTarget);
    }}><p>Start a fresh session. The previous payment confirmation stays in history.</p>
    <label className="registration-checkbox"><input type="checkbox" name="approved" required/><span>I approve reopening this table.</span></label>
    <button className="button secondary" disabled={busy}>{board.waiterConfirmation?'Reopen table':'Approve reopening & issue PIN'}</button></form>
   </details>}
   {board.canManage&&<details><summary>Edit or archive {table.label}</summary><form key={table.version} data-validation={'table-'+table.id} onSubmit={e=>save(e,table.id)}><fieldset disabled={busy||!!table.session}><FormErrorSummary feedback={feedback} owner={'table-'+table.id}/><label>Table label<input name="label" defaultValue={table.label} required maxLength={80} {...feedback.props('table-'+table.id,'label')}/></label><label>Section<input name="section" defaultValue={table.section} required maxLength={80} {...feedback.props('table-'+table.id,'section')}/></label><label>Seats<input name="seats" type="number" defaultValue={table.seats} min={1} max={30} required {...feedback.props('table-'+table.id,'seats')}/></label><label className="registration-checkbox"><input name="archived" type="checkbox" defaultChecked={table.archived}/><span>Archived — disable this physical table</span></label><button className="button secondary">Save table</button></fieldset>{table.session&&<p>Close the current session before editing this table.</p>}</form></details>}
  </li>)}</ul>}</div>
  {board.canManage&&<><form className="table-publication rd-admin-panel" onSubmit={e=>{e.preventDefault();void act('/publication',{revision:board.revision,enabled:!board.entryPublished,confirmed:true},'Publication updated',e.currentTarget,'PUT');}}><fieldset disabled={busy}><legend>Public table entry</legend><p>Publishing exposes the reviewed, published menu through current table QRs. Unpublishing closes entry-pilot sessions and revokes their guest access. Restaurant service remains paused.</p><label className="registration-checkbox"><input type="checkbox" required/><span>I reviewed this branch and understand the table-entry visibility change.</span></label><button className="button secondary">{board.entryPublished?'Unpublish table entry':'Publish table entry'}</button></fieldset></form>
</>}
{kind==='restaurant'&&view==='tables'&&<p className="table-footnote">Keep the printed QR in place between guests. Don’t close or replace an active session after each order: the verified customer can add more orders, and cashier POS-settlement confirmation closes the table. Replace a PIN only when it expires before use, is lost or may have been shared.</p>}
 </section>;
}
