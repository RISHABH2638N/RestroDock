'use client';
import {useEffect,useRef,useState,type FormEvent,type ReactNode} from 'react';
import {type SetupView,type Catalogue,foodTypes,branchStaffRoles,staffRoleInput,menuAvailabilityInput,profileInput,hoursInput,safetyInput,posInput,flagsInput,itemInput,categoryInput,importInput,setupViewSchema,catalogueSchema} from '@restrodock/contracts';
import Link from 'next/link';
import {ArrowUpRight,ChevronRight,FolderOpen,Plus,Search,Utensils} from 'lucide-react';
import {AdminPanel} from './admin-panel';
import {z} from 'zod';
import {accessRequest,AccessError,errorText,writeResultUnknown} from '../access/api';
import {managementClientTimeoutMs} from '../../lib/api-timeout';
import {BulkSelection} from './bulk-selection';
import type {RestaurantEditorSection} from './sections';
import {useFormFeedback,FormErrorSummary,moneyInput} from './validation';
const roleLabels:Record<string,string>={RESTAURANT_ADMIN:'Restaurant admin',MANAGER:'Manager',CHEF:'Chef',WORKER:'Worker / waiter',CASHIER:'Cashier'};
const names=['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const amount=(minor:number)=>(minor/100).toFixed(2);
const format=(minor:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(minor/100);
function readable(error:unknown){return error instanceof z.ZodError?error.issues.map(issue=>`${issue.path.join('.')}: ${issue.message}`).join(' '):errorText(error);}
export function RestaurantWorkbench({tenantId,branchId,csrf,section,staffInvitation,onBranchNameSaved}:{tenantId:string;branchId:string;csrf:string;section:RestaurantEditorSection;staffInvitation?:ReactNode;onBranchNameSaved?:(name:string)=>void}) {
 const dataRoute=section==='menu'?'/menu':section==='menu-preview'?'/preview':'/settings';
 const [setup,setSetup]=useState<SetupView|null>(null),[menu,setMenu]=useState<Catalogue|null>(null),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState(''),[notice,setNotice]=useState<{text:string;saved:boolean}|null>(null);
 const feedback=useFormFeedback(busy);
 const alive=useRef(true),generation=useRef(0);
 const query=new URLSearchParams({tenantId,branchId}).toString();
 const path=(route:string)=>`/restaurant/manage${route}?${query}`;
 async function reload(){const request=++generation.current;setLoading(true);setError('');setNotice(null);try{const result=await accessRequest(path(dataRoute));if(alive.current&&request===generation.current){if(dataRoute==='/settings')setSetup(setupViewSchema.parse(result));else setMenu(catalogueSchema.parse(result));}}catch(error){if(alive.current&&request===generation.current)setError(readable(error));}finally{if(alive.current&&request===generation.current)setLoading(false);}}
 useEffect(()=>{alive.current=true;void reload();return()=>{alive.current=false;generation.current++;};},[tenantId,branchId,dataRoute]);
 async function action(route:string,body:unknown,kind:'setup'|'menu',method='PUT'){
  setBusy(true);setError('');setNotice(null);
  try{const result=await accessRequest(path(route),{method,body,csrf});if(!alive.current)return;if(kind==='setup'){
    const saved=setupViewSchema.parse(result);
    setSetup(saved);
    if(route==='/profile')onBranchNameSaved?.(saved.branch.name);
   }else setMenu(catalogueSchema.parse(result));setNotice({text:route==='/submit'?'Configuration submitted. Branch access is active. Guest ordering remains controlled by its separate QR, session, PIN and checkout-pilot settings.':'Saved to this branch.',saved:true});}
  catch(error){if(alive.current){if(!(error instanceof AccessError&&error.fields.length))setError(readable(error));if(writeResultUnknown(error))setNotice({text:'The change may already have saved. Reload saved values before trying again.',saved:false});}throw error;}finally{if(alive.current)setBusy(false);}
 }
 async function upload(file:File|undefined,route:string,kind:'setup'|'menu',version:number){if(!file)return;setBusy(true);setError('');setNotice(null);try{if(file.size>2*1024*1024)throw new Error('Choose an image no larger than 2 MiB.');if(!['image/jpeg','image/png','image/webp'].includes(file.type))throw new Error('Choose a JPEG, PNG or WebP image.');const response=await fetch('/api/v1'+path(route)+`&v=${version}`,{method:'PUT',headers:{'Content-Type':file.type,'X-CSRF-Token':csrf},credentials:'same-origin',body:file,signal:AbortSignal.timeout(managementClientTimeoutMs)});const data=await response.json().catch(()=>null);if(!response.ok)throw new AccessError(data?.error?.message??'Image upload failed.',response.status);if(!alive.current)return;if(kind==='setup')setSetup(setupViewSchema.parse(data));else{setMenu(catalogueSchema.parse(data));}setNotice({text:'Image saved as a sanitized WebP.',saved:true});}catch(error){if(alive.current){setError(readable(error));if(writeResultUnknown(error)||error instanceof TypeError||(error instanceof Error&&error.name==='TimeoutError'))setNotice({text:'The image may already have saved. Reload saved values before trying again.',saved:false});}}finally{if(alive.current)setBusy(false);}}
 async function submitForm(event:FormEvent<HTMLFormElement>,route:string,parse:(data:FormData)=>unknown){event.preventDefault();const form=event.currentTarget;feedback.clear();try{const input=parse(new FormData(form));await action(route,input,'setup');}catch(error){setError('');feedback.report(form,error);}}

 if(loading)return <p role="status" className="access-note">Loading saved branch data…</p>;
 if(dataRoute==='/settings'?!setup:!menu)return <div role="alert" className="access-error">{error||'Saved branch data is unavailable.'} <button className="text-button" onClick={()=>void reload()}>Retry loading this section</button></div>;
 return <section className="restaurant-workbench rd-admin-stack" aria-label="Branch editor">
  {(error||notice)&&<div className="restaurant-feedback">
   {error&&<p role="alert" className="access-error">{error}</p>}{notice&&<p role="status" className={notice.saved?'restaurant-saved':'access-note'}>{notice.text}</p>}
  </div>}
  {section==='profile'&&setup?.planAccess&&<section className="rd-admin-panel rd-plan-panel" aria-label="Subscription plan">
   <h2>{setup.planAccess.planCode} plan</h2>
   <p>{setup.planAccess.activeOutlets} active {setup.planAccess.activeOutlets===1?'outlet':'outlets'}{setup.planAccess.outletLimit===null?'':` of ${setup.planAccess.outletLimit}`}</p>
   {setup.planAccess.endsAt&&<p>Term ends {setup.planAccess.endsAt.slice(0,10)} at 00:00 UTC.</p>}
   {!setup.planAccess.canOpenTables&&<p>Renewal required to open new tables. Staff can finish service at tables already open.</p>}
  </section>}
  <fieldset disabled={busy} className="restaurant-fieldset rd-admin-stack">
 {section==='profile'&&setup&&<div className="rd-settings-grid"><AdminPanel title="Restaurant details"><form data-validation="profile" key={setup.version} className="access-form access-form-grid" onSubmit={event=>void submitForm(event,'/profile',data=>profileInput.parse({version:setup.version,...Object.fromEntries(data)}))}><FormErrorSummary feedback={feedback} owner="profile"/>{[{name:'displayName',label:'Restaurant display name',value:setup.profile.displayName,max:160},{name:'branchName',label:'Branch name',value:setup.branch.name,max:160},{name:'address',label:'Restaurant address',value:setup.profile.address,max:300},{name:'contactEmail',label:'Business email',value:setup.profile.contactEmail,max:254},{name:'contactPhone',label:'Business phone',value:setup.profile.contactPhone,max:16},{name:'timezone',label:'Timezone',value:setup.branch.timezone,max:80}].map(field=><label key={field.name}>{field.label}<input {...feedback.props('profile',field.name)} name={field.name} defaultValue={field.value} maxLength={field.max} type={field.name==='contactEmail'?'email':'text'}/></label>)}<div className="rd-form-actions"><button className="button primary">Save profile</button></div></form></AdminPanel><AdminPanel title="Restaurant logo">{setup.logoUrl&&<img className="restaurant-logo" src={setup.logoUrl} alt={`${setup.profile.displayName||'Restaurant'} logo`}/>}<label className="restaurant-upload">Upload logo · JPEG, PNG or WebP, up to 2 MiB<input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{void upload(event.target.files?.[0],'/logo','setup',setup.version);event.target.value='';}}/></label>{setup.logoUrl&&<button className="text-button" onClick={()=>void action('/logo',{version:setup.version},'setup','DELETE').catch(()=>{})}>Remove logo</button>}<p className="access-help">The uploaded logo is private to your branch’s admin workspace.</p></AdminPanel></div>}
 {section==='hours'&&setup&&<form data-validation="hours" key={setup.version} className="rd-admin-stack" onSubmit={event=>void submitForm(event,'/hours',data=>hoursInput.parse({version:setup.version,lastSeatingMinutes:Number(data.get('lastSeatingMinutes'))||null,hours:setup.hours.map(day=>({day:day.day,closed:data.get(`closed-${day.day}`)==='on',opens:data.get(`opens-${day.day}`),closes:data.get(`closes-${day.day}`),closesNextDay:data.get(`next-${day.day}`)==='on'}))}))}><FormErrorSummary feedback={feedback} owner="hours"/><AdminPanel title="Weekly opening hours" description="Use Closes next day for overnight service."><div className="restaurant-hours">{setup.hours.map(day=><div className="restaurant-hour-row" key={day.day}><strong>{names[day.day]}</strong><label><input type="checkbox" {...feedback.props('hours',`closed-${day.day}`)} name={`closed-${day.day}`} defaultChecked={day.closed}/>Closed</label><label>Opens<input type="time" aria-label={`${names[day.day]} opens`} {...feedback.props('hours',`opens-${day.day}`)} name={`opens-${day.day}`} defaultValue={day.opens} required/></label><label>Closes<input type="time" aria-label={`${names[day.day]} closes`} {...feedback.props('hours',`closes-${day.day}`)} name={`closes-${day.day}`} defaultValue={day.closes} required/></label><label><input type="checkbox" {...feedback.props('hours',`next-${day.day}`)} name={`next-${day.day}`} defaultChecked={day.closesNextDay}/>Closes next day</label></div>)}</div></AdminPanel><AdminPanel title="Last seating" description="Tables already seated can keep ordering after the cutoff."><div className="access-form rd-compact-fields"><label>Last seating cutoff<select name="lastSeatingMinutes" defaultValue={setup.lastSeatingMinutes??0}><option value="0">Off</option><option value="15">15 minutes before closing</option><option value="30">30 minutes before closing</option></select></label></div></AdminPanel><div className="rd-form-actions"><button className="button primary">Save weekly hours</button></div></form>}
 {section==='safety-pos'&&setup&&<><AdminPanel title="Ordering safeguards" description="Set checkout limits, approval thresholds and PIN validity." actions={<Link className="button secondary" href="/restaurant/order-review">Order intake <ArrowUpRight size={15} aria-hidden="true"/></Link>}><form data-validation="safety" key={`safety-${setup.version}`} className="access-form access-form-grid" onSubmit={event=>void submitForm(event,'/safety',data=>safetyInput.parse({version:setup.version,maxItemQuantity:Number(data.get('maxItemQuantity')),maxOrderQuantity:Number(data.get('maxOrderQuantity')),maxOrderValueMinor:moneyInput(String(data.get('maxOrderValue')),['maxOrderValue']),approvalQuantity:setup.planAccess?.advancedControls===false?undefined:String(data.get('approvalQuantity')??'').trim()?Number(data.get('approvalQuantity')):null,approvalValueMinor:setup.planAccess?.advancedControls===false?undefined:String(data.get('approvalValueMinor')??'').trim()?moneyInput(String(data.get('approvalValueMinor')),['approvalValueMinor']):null,pinExpiryMinutes:Number(data.get('pinExpiryMinutes')),acknowledged:data.get('acknowledged')==='on'}))}><FormErrorSummary feedback={feedback} owner="safety"/>{[{name:'maxItemQuantity',label:'Maximum quantity per item',value:setup.safety.maxItemQuantity,min:1,max:50},{name:'maxOrderQuantity',label:'Maximum quantity per order',value:setup.safety.maxOrderQuantity,min:1,max:100},{name:'pinExpiryMinutes',label:'PIN validity (minutes)',value:setup.safety.pinExpiryMinutes,min:5,max:30}].map(field=><label key={field.name}>{field.label}<input {...feedback.props('safety',field.name)} type="number" name={field.name} defaultValue={field.value} min={field.min} max={field.max} step="1" required/></label>)}{setup.planAccess?.advancedControls===false?<p className="rd-form-wide">Custom approval thresholds are available on Growth and Pro.</p>:<><label>Approval above total item quantity<input {...feedback.props('safety','approvalQuantity')} type="number" min="1" max="100" step="1" name="approvalQuantity" defaultValue={setup.safety.approvalQuantity??''}/></label><label>Approval above estimated order value (INR)<input {...feedback.props('safety','approvalValueMinor')} name="approvalValueMinor" inputMode="decimal" defaultValue={setup.safety.approvalValueMinor==null?'':amount(setup.safety.approvalValueMinor)}/></label><p className="rd-form-wide access-help">Leave an approval threshold blank to disable it. Suspicious patterns can still require approval.</p></>}<label>Maximum order value (INR)<input {...feedback.props('safety','maxOrderValue')} name="maxOrderValue" inputMode="decimal" defaultValue={amount(setup.safety.maxOrderValueMinor)} required/></label><label className="restaurant-check"><input {...feedback.props('safety','acknowledged')} type="checkbox" name="acknowledged" required/>I reviewed these limits for this branch.</label><div className="rd-form-actions"><button className="button primary">Save safeguards</button></div></form></AdminPanel><div className="rd-settings-grid"><AdminPanel title="Existing POS workflow" description="Your existing POS issues official invoices and collects payments."><form data-validation="pos" key={`pos-${setup.version}`} className="access-form" onSubmit={event=>void submitForm(event,'/pos',data=>posInput.parse({version:setup.version,billingMode:'EXTERNAL_POS_MANUAL',kitchenSource:'RESTRODOCK',posName:data.get('posName'),posInstructions:data.get('posInstructions'),acknowledged:data.get('acknowledged')==='on'}))}><FormErrorSummary feedback={feedback} owner="pos"/><label>Existing POS / billing system<input {...feedback.props('pos','posName')} name="posName" maxLength={100} defaultValue={setup.pos.posName}/></label><label>Cashier handoff instructions<textarea {...feedback.props('pos','posInstructions')} name="posInstructions" maxLength={500} defaultValue={setup.pos.posInstructions}/></label><label className="restaurant-check"><input {...feedback.props('pos','acknowledged')} type="checkbox" name="acknowledged" required/>The existing POS owns official billing and payment confirmation.</label><button className="button primary">Save POS workflow</button></form></AdminPanel><AdminPanel title="Branch preferences"><form data-validation="flags" key={`flags-${setup.version}`} className="access-form" onSubmit={event=>void submitForm(event,'/flags',data=>flagsInput.parse({version:setup.version,assistanceEnabled:data.get('assistanceEnabled')==='on',menuPhotosEnabled:data.get('menuPhotosEnabled')==='on',orderingPaused:true}))}><FormErrorSummary feedback={feedback} owner="flags"/><label className="restaurant-check"><input type="checkbox" name="menuPhotosEnabled" defaultChecked={setup.flags.menuPhotosEnabled}/>Show photos in the menu preview</label><label className="restaurant-check"><input type="checkbox" name="assistanceEnabled" defaultChecked={setup.flags.assistanceEnabled}/>Allow guests to request staff help</label><p className="access-help">Staff see help requests on the table board. Saving preferences keeps restaurant service paused.</p><button className="button primary">Save preferences</button></form></AdminPanel></div></>}
 {section==='staff'&&setup&&<AdminPanel title="Assigned staff" description={setup.staff.length+' assigned to this branch'}>{setup.staff.length===0&&<p className="access-note">No staff are assigned to this branch yet.</p>}<ul className="restaurant-staff">{setup.staff.map(member=><li key={member.membershipId}><div><strong>{member.email}</strong><p>{roleLabels[member.role]} · {member.active?'Active':'Inactive'}</p></div>{member.canChangeRole&&<form className="rd-staff-role" key={setup.version} onSubmit={event=>{
  event.preventDefault();
  const role=new FormData(event.currentTarget).get('role');
  if(role===member.role)return;
  const input=staffRoleInput.safeParse({version:setup.version,role});
  if(input.success)void action(`/staff/${member.membershipId}/role`,input.data,'setup').catch(()=>{});
 }}><label>Role for {member.email}<select name="role" defaultValue={member.role}>{branchStaffRoles.map(role=><option key={role} value={role}>{roleLabels[role]}</option>)}</select></label><button className="button secondary">Save role</button></form>}{member.role!=='RESTAURANT_ADMIN'&&<button className="text-button" onClick={()=>void action(`/staff/${member.membershipId}`,{version:setup.version},'setup','DELETE').catch(()=>{})}>Remove from this branch</button>}</li>)}</ul>{setup.staff.some(member=>member.role!=='RESTAURANT_ADMIN')&&<p className="access-help">You can change roles for active staff assigned only to this branch. Removing an assignment preserves the account and its other branch assignments.</p>}</AdminPanel>}
 {section==='menu'&&menu&&<MenuEditor key={`${tenantId}:${branchId}`} catalogue={menu} busy={busy} write={(route,body,method)=>action(route,body,'menu',method)} upload={(file,route)=>upload(file,route,'menu',menu.revision)}/>}
  {section==='menu-preview'&&menu&&<MenuPreview catalogue={menu}/>}
 </fieldset>
  {section==='staff'&&staffInvitation}
 {section==='profile'&&setup&&<details className="rd-admin-panel restaurant-disclosure restaurant-readiness"><summary>Setup progress <span>{setup.checklist.filter(check=>check.complete).length} of {setup.checklist.length} complete</span></summary><ul className="access-checklist">{setup.checklist.map(check=><li key={check.key}><span>{check.complete?'Complete':'Pending'}</span>{check.label}</li>)}</ul><p>{setup.branch.active?'Branch active for staff access.':setup.submittedAt&&setup.configurationReady?'Configuration submitted.':'Submit once all required setup checks are complete.'}</p><button className="button primary" disabled={busy||!setup.configurationReady||(setup.branch.active&&!!setup.submittedAt)} onClick={()=>void action('/submit',{version:setup.version},'setup','POST').catch(()=>{})}>{setup.branch.active&&setup.submittedAt?'Configuration submitted':'Submit configuration'}</button><p className="access-help">Once all checks are complete, submitting activates this branch automatically. This does not change the separate QR, session, PIN or checkout-pilot controls.</p></details>}
  <div className="restaurant-toolbar"><button className="text-button" disabled={busy} onClick={()=>void reload()}>Reload saved values</button></div>
 </section>;
}
export function MenuPreview({catalogue}:{catalogue:Catalogue}){
 const groups=catalogue.categories.map(category=>({
  ...category,items:catalogue.items.filter(item=>item.categoryId===category.id),
 })).filter(category=>category.items.length>0);
 return <div className="rd-admin-stack">
  <AdminPanel title="Published menu" description="Guest-facing dishes and prices in INR."
   actions={<Link className="button secondary" href="/restaurant/menu">Manage menu <ArrowUpRight size={15} aria-hidden="true"/></Link>}>
   {groups.length>1&&<nav className="rd-menu-summary-links" aria-label="Published categories">
    {groups.map(category=><a key={category.id} href={`#preview-${category.id}`}>{category.name}</a>)}
   </nav>}
   {groups.length===0&&<p className="rd-admin-empty">Publish a reviewed item to see it here.</p>}
  </AdminPanel>
  {groups.map(category=><div key={category.id} id={`preview-${category.id}`}>
   <AdminPanel title={category.name} description={category.items.length+' published items'} className="rd-preview-group">
    {category.items.map(item=><article className="restaurant-preview-item" key={item.id}>
     {item.photoUrl&&<img src={item.photoUrl} alt={item.name}/>}
     <div><h3>{item.name}</h3><p>{item.description}</p>
      <span>{item.foodType.replaceAll('_',' ')} · {item.available?'Available':'Sold out'}</span>
      {item.variants.length>0&&<p>Portions: {item.variants.map(option=>`${option.name} ${format(option.priceMinor)}${option.available?'':' (sold out)'}`).join(' · ')}</p>}
      {item.addons.length>0&&<p>Add-ons: {item.addons.map(option=>`${option.name} +${format(option.priceMinor)}${option.available?'':' (sold out)'}`).join(' · ')}</p>}
     </div><strong>{format(item.priceMinor)}</strong>
    </article>)}
   </AdminPanel>
  </div>)}
 </div>;
}
function MenuEditor({catalogue,busy,write,upload}:{catalogue:Catalogue;busy:boolean;write:(route:string,body:unknown,method?:string)=>Promise<void>;upload:(file:File|undefined,route:string)=>Promise<void>}) {
 const [selected,setSelected]=useState('');
 const [editing,setEditing]=useState(false);
 const [categoryId,setCategoryId]=useState('');
 const [search,setSearch]=useState('');
 const [addingCategory,setAddingCategory]=useState(false);
 const itemHeading=useRef<HTMLHeadingElement>(null);
 const itemTrigger=useRef<HTMLButtonElement>(null);
 const newItemButton=useRef<HTMLButtonElement>(null);
 const categoryName=useRef<HTMLInputElement>(null);
 const categoryButton=useRef<HTMLButtonElement>(null);
 useEffect(()=>{
  if(!editing&&!busy&&itemTrigger.current){
   const trigger=itemTrigger.current;
   itemTrigger.current=null;
   if(trigger.isConnected)trigger.focus();
   else newItemButton.current?.focus();
  }
 },[editing,selected,busy]);
 useEffect(()=>{if(editing)itemHeading.current?.focus();},[editing,selected]);
 const returnCategoryFocus=useRef(false);
 useEffect(()=>{
  if(!addingCategory&&!busy&&returnCategoryFocus.current){
   returnCategoryFocus.current=false;
   categoryButton.current?.focus();
  }
 },[addingCategory,busy]);
 useEffect(()=>{if(addingCategory)categoryName.current?.focus();},[addingCategory]);
 const feedback=useFormFeedback(busy);
 const importAttempt=useRef<{content:string;key:string}|null>(null);
 const current=catalogue.items.find(item=>item.id===selected);
 const categories=catalogue.categories.filter(category=>!category.archived);
 async function saveCategory(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget;feedback.clear();try{const input=categoryInput.parse({revision:catalogue.revision,name:new FormData(form).get('name'),sortOrder:0,archived:false});await write('/categories',input,'POST');returnCategoryFocus.current=true;setAddingCategory(false);}catch(error){feedback.report(form,error);}}
 async function importRows(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);feedback.clear();try{const content=String(data.get('rows')),categoryId=String(data.get('categoryId'));if(content.length>14000)throw new Error('Use a smaller import batch (up to 20 items and 14,000 characters).');const fingerprint=categoryId+content;if(importAttempt.current?.content!==fingerprint)importAttempt.current={content:fingerprint,key:crypto.randomUUID()};const input=importInput.parse({revision:catalogue.revision,requestKey:importAttempt.current!.key,categoryId,rows:JSON.parse(content)});await write('/imports',input,'POST');importAttempt.current=null;form.reset();}catch(error){feedback.report(form,error);}}
 const visible=catalogue.items.filter(item=>
  (!categoryId||item.categoryId===categoryId)&&item.name.toLocaleLowerCase('en-IN').includes(search.trim().toLocaleLowerCase('en-IN'))
 );
 function openItem(id:string,trigger:HTMLButtonElement){
  itemTrigger.current=trigger;
  setSelected(id);
  setEditing(true);
 }
 function closeItem(){setEditing(false);}

 return <>
  <AdminPanel title="Menu editor" description={catalogue.items.length+' items · '+categories.length+' active categories'}
   actions={<Link className="button secondary" href="/restaurant/menu-preview">Preview as guest <ArrowUpRight size={15} aria-hidden="true"/></Link>}
   className="rd-menu-summary">
   <div className="rd-menu-summary-links" aria-label="Menu sections">
    <a href="#menu-items">Menu items <ChevronRight size={14} aria-hidden="true"/></a>
    <a href="#menu-categories">Categories <ChevronRight size={14} aria-hidden="true"/></a>
    <a href="#menu-tools">Menu tools <ChevronRight size={14} aria-hidden="true"/></a>
   </div>
  </AdminPanel>
  <div id="menu-items">
   <AdminPanel title="Menu items" actions={<button ref={newItemButton} className="button primary" type="button"
    disabled={categories.length===0} onClick={event=>openItem('',event.currentTarget)}><Plus size={16} aria-hidden="true"/>New item</button>}>
    {editing&&categories.length>0&&<section className="rd-menu-editor" aria-labelledby="menu-item-title">
     <div className="rd-admin-panel-heading">
      <h3 ref={itemHeading} id="menu-item-title" tabIndex={-1}>{current?'Edit '+current.name:'Create a menu item'}</h3>
      <button className="button secondary" type="button" onClick={closeItem}>Close editor</button>
     </div>
     <MenuItemForm key={`${selected}:${catalogue.revision}`} item={current} categories={categories}
      initialCategory={categoryId} revision={catalogue.revision} busy={busy}
      save={async(route,body,method)=>{await write(route,body,method);if(method==='POST'&&route==='/items')closeItem();}}/>
     {current&&<div className="restaurant-photo-editor">
      <h3>Item photo</h3>
      {current.photoUrl&&<img src={current.photoUrl} alt={`${current.name} saved photo`}/>}
      <label className="restaurant-upload">Upload item photo · JPEG, PNG or WebP, up to 2 MiB
       <input type="file" accept="image/jpeg,image/png,image/webp" onChange={event=>{
        void upload(event.target.files?.[0],`/items/${current.id}/photo`);
        event.target.value='';
       }}/>
      </label>
      {current.photoUrl&&<button type="button" className="text-button" onClick={()=>void write(`/items/${current.id}/photo`,{revision:catalogue.revision},'DELETE').catch(()=>{})}>Remove item photo</button>}
     </div>}
    </section>}
    <div className="rd-menu-filters">
     <label><Search size={16} aria-hidden="true"/><span className="sr-only">Search items</span>
      <input type="search" placeholder="Search items" value={search} onChange={event=>setSearch(event.target.value)}/>
     </label>
     <label><span className="sr-only">Filter by category</span>
      <select value={categoryId} onChange={event=>setCategoryId(event.target.value)}>
       <option value="">All categories</option>
       {catalogue.categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}
      </select>
     </label>
    </div>
    {visible.length>0?<ul className="rd-menu-library" aria-label="Menu items">
     {visible.map(item=>{
      const status=item.reviewRequired?'Needs review':item.state==='PUBLISHED'?(item.available?'Available':'Sold out'):item.state==='ARCHIVED'?'Archived':'Draft';
      return <li key={item.id}>
       <button type="button" className="rd-menu-row" aria-label={'Edit '+item.name} aria-expanded={editing&&selected===item.id}
        onClick={event=>openItem(item.id,event.currentTarget)}>
        {item.photoUrl?<img src={item.photoUrl} alt="" width={44} height={44}/>:<span className="rd-menu-thumbnail"><Utensils size={19} aria-hidden="true"/></span>}
        <span className="rd-menu-row-name"><strong>{item.name}</strong><span>{catalogue.categories.find(category=>category.id===item.categoryId)?.name}</span></span>
        <span className="rd-menu-price">{format(item.priceMinor)}</span>
        <span className="rd-menu-status" data-status={status}>{status}</span>
        <ChevronRight size={16} aria-hidden="true"/>
       </button>
      </li>;
     })}
    </ul>:<div className="rd-admin-empty">
     <p>{catalogue.items.length?'No items match your filters.':categories.length?'No items yet. Use New item to add your first dish.':'Add a category before creating a menu item.'}</p>
     {!categories.length&&<a className="text-button" href="#menu-categories">Go to categories</a>}
    </div>}
   </AdminPanel>
  </div>
  <div id="menu-categories">
   <AdminPanel title="Categories" description="Group dishes and set the order guests see them."
    actions={<button ref={categoryButton} className="button primary" type="button" aria-expanded={addingCategory}
     onClick={()=>setAddingCategory(!addingCategory)}><Plus size={16} aria-hidden="true"/>{addingCategory?'Close form':'Add category'}</button>}>
    {addingCategory&&<form data-validation="new-category" className="access-form rd-inline-add" onSubmit={saveCategory}>
     <FormErrorSummary feedback={feedback} owner="new-category"/>
     <label>New category name<input ref={categoryName} {...feedback.props('new-category','name')} name="name" required maxLength={100}/></label>
     <button className="button primary">Save new category</button>
    </form>}
    {catalogue.categories.length?<ul className="rd-category-list">
     {catalogue.categories.map(category=><li key={category.id}>
      <details>
       <summary><FolderOpen size={18} aria-hidden="true"/><strong>{category.name}</strong>
        <span>{category.archived?'Archived':catalogue.items.filter(item=>item.categoryId===category.id&&item.state!=='ARCHIVED').length+' items'}</span>
        <ChevronRight size={16} aria-hidden="true"/>
       </summary>
       <CategoryRow key={catalogue.revision} category={category} revision={catalogue.revision} busy={busy} save={write}/>
      </details>
     </li>)}
    </ul>:<p className="rd-admin-empty">No categories yet. Add one to start organising your menu.</p>}
   </AdminPanel>
  </div>
  <div id="menu-tools">
   <AdminPanel title="Menu tools" className="rd-menu-tools">
    <details className="restaurant-import">
     <summary>Import items as drafts</summary>
     <p>Import up to 20 JSON rows with name, priceMinor (integer paise), foodType (VEG, NON_VEG, EGG or UNSPECIFIED) and optional description. Review each draft before publishing.</p>
     <form data-validation="import" className="access-form" onSubmit={importRows}>
      <FormErrorSummary feedback={feedback} owner="import"/>
      <label>Import category<select {...feedback.props('import','categoryId')} name="categoryId" required>
       {categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}
      </select></label>
      <label>Draft import JSON<textarea {...feedback.props('import','rows')} name="rows" required maxLength={14000} rows={7}/></label>
      <button className="button secondary" disabled={busy||!categories.length}>Import drafts for review</button>
     </form>
    </details>
    <BulkSelection title="Bulk item availability" busy={busy}
     items={visible.filter(item=>item.state==='PUBLISHED'&&!item.reviewRequired&&categories.some(category=>category.id===item.categoryId))
      .map(item=>({id:item.id,label:item.name+(item.available?' · Available':' · Sold out')}))}
     onApply={async(ids,fields)=>{
      try{
       await write('/items/availability',menuAvailabilityInput.parse({revision:catalogue.revision,ids,available:fields.get('availability')==='available'}));
       return true;
      }catch{return false;}
     }}>
     <label>Availability<select name="availability" defaultValue="sold-out"><option value="sold-out">Sold out</option><option value="available">Available</option></select></label>
    </BulkSelection>
   </AdminPanel>
  </div>
 </>;
}
function CategoryRow({category,revision,busy,save}:{category:Catalogue['categories'][number];revision:number;busy:boolean;save:(route:string,body:unknown,method?:string)=>Promise<void>}) {
 const feedback=useFormFeedback(busy);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);feedback.clear();try{await save(`/categories/${category.id}`,categoryInput.parse({revision,name:data.get('name'),sortOrder:Number(data.get('sortOrder')),archived:data.get('archived')==='on'}));}catch(error){feedback.report(form,error);}}
 return <form data-validation="category" className="restaurant-category-row" onSubmit={submit}><FormErrorSummary feedback={feedback} owner="category"/><label>Category name<input {...feedback.props('category','name')} name="name" aria-label={`Category name: ${category.name}`} defaultValue={category.name} required maxLength={100}/></label><label>Order<input {...feedback.props('category','sortOrder')} type="number" name="sortOrder" aria-label={`Category order: ${category.name}`} defaultValue={category.sortOrder} min={0} max={9999}/></label><label className="restaurant-check"><input {...feedback.props('category','archived')} name="archived" type="checkbox" defaultChecked={category.archived}/>Archived</label><button className="button secondary">Save category</button></form>;
}
type OptionDraft={name:string;price:string;available:boolean};
function OptionFields({name,rows,setRows,feedback}:{name:'variants'|'addons';rows:OptionDraft[];setRows:(rows:OptionDraft[])=>void;feedback:ReturnType<typeof useFormFeedback>}) {
 const label=name==='variants'?'Portion / variant':'Add-on';
 return <fieldset className="restaurant-options"><legend>{name==='variants'?'Portions and variants':'Optional add-ons'}</legend><p className="access-help">{name==='variants'?'Each portion has its own full price.':'Add-on prices are added to the item price.'} Up to 12 entries.</p>{rows.map((row,index)=><div className="restaurant-option-row" key={index}><label>{label} name<input {...feedback.props('item',`${name}.${index}.name`)} name={`${name}.${index}.name`} aria-label={`${label} ${index+1} name`} value={row.name} maxLength={80} required onChange={event=>setRows(rows.map((r,i)=>i===index?{...r,name:event.target.value}:r))}/></label><label>Price (INR)<input {...feedback.props('item',`${name}.${index}.price`)} name={`${name}.${index}.price`} aria-label={`${label} ${index+1} price`} inputMode="decimal" value={row.price} required onChange={event=>setRows(rows.map((r,i)=>i===index?{...r,price:event.target.value}:r))}/></label><label className="restaurant-check"><input type="checkbox" checked={row.available} onChange={event=>setRows(rows.map((r,i)=>i===index?{...r,available:event.target.checked}:r))}/>Available</label><button type="button" className="text-button" aria-label={`Remove ${label.toLowerCase()} ${index+1}`} onClick={()=>setRows(rows.filter((_,i)=>i!==index))}>Remove</button></div>)}<button className="button secondary" type="button" disabled={rows.length>=12} onClick={()=>setRows([...rows,{name:'',price:'',available:true}])}>Add {label.toLowerCase()}</button></fieldset>;
}
function MenuItemForm({item,categories,initialCategory,revision,busy,save}:{item:Catalogue['items'][number]|undefined;categories:Catalogue['categories'];initialCategory:string;revision:number;busy:boolean;save:(route:string,body:unknown,method?:string)=>Promise<void>}) {
 const [variants,setVariants]=useState<OptionDraft[]>(item?.variants.map(row=>({name:row.name,price:amount(row.priceMinor),available:row.available}))??[]),[addons,setAddons]=useState<OptionDraft[]>(item?.addons.map(row=>({name:row.name,price:amount(row.priceMinor),available:row.available}))??[]);
 const feedback=useFormFeedback(busy);
 async function submit(event:FormEvent<HTMLFormElement>){event.preventDefault();const form=event.currentTarget,data=new FormData(form);feedback.clear();try{const input=itemInput.parse({revision,categoryId:data.get('categoryId'),name:data.get('name'),description:data.get('description'),priceMinor:moneyInput(String(data.get('price')),['price']),foodType:data.get('foodType'),available:data.get('available')==='on',state:data.get('state'),sortOrder:Number(data.get('sortOrder')),variants:variants.map((row,index)=>({name:row.name,priceMinor:moneyInput(row.price,['variants',index,'priceMinor']),available:row.available})),addons:addons.map((row,index)=>({name:row.name,priceMinor:moneyInput(row.price,['addons',index,'priceMinor']),available:row.available}))});await save(item?`/items/${item.id}`:'/items',input,item?'PUT':'POST');}catch(error){feedback.report(form,error);}}
 return <><form data-validation="item" className="access-form restaurant-item-form" onSubmit={submit}><FormErrorSummary feedback={feedback} owner="item"/><h4>Item details</h4><div className="access-form-grid"><label>Item name<input {...feedback.props('item','name')} name="name" defaultValue={item?.name??''} maxLength={160} required/></label><label>Category<select {...feedback.props('item','categoryId')} name="categoryId" defaultValue={item?.categoryId??(categories.some(category=>category.id===initialCategory)?initialCategory:categories[0]?.id)}>{categories.map(category=><option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Base price (INR)<input {...feedback.props('item','price')} name="price" defaultValue={item?amount(item.priceMinor):''} inputMode="decimal" required/></label><label>Food classification<select {...feedback.props('item','foodType')} name="foodType" defaultValue={item?.foodType??'UNSPECIFIED'}>{foodTypes.map(food=><option key={food} value={food}>{food.replaceAll('_',' ')}</option>)}</select></label></div><label>Description<textarea {...feedback.props('item','description')} name="description" defaultValue={item?.description??''} maxLength={1000}/></label><div className="rd-item-publishing"><h4>Publishing &amp; availability</h4><div className="access-form-grid"><label>Publication state<select {...feedback.props('item','state')} name="state" defaultValue={item?.state??'DRAFT'}><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option><option value="ARCHIVED">Archived</option></select></label><label>Display order<input type="number" {...feedback.props('item','sortOrder')} name="sortOrder" defaultValue={item?.sortOrder??0} min={0} max={9999} step={1}/></label></div><label className="restaurant-check"><input {...feedback.props('item','available')} name="available" type="checkbox" defaultChecked={item?.available??false}/>Available when published</label></div><OptionFields name="variants" rows={variants} setRows={setVariants} feedback={feedback}/><OptionFields name="addons" rows={addons} setRows={setAddons} feedback={feedback}/><button className="button primary">{item?'Save item changes':'Create menu item'}</button></form>{item&&<div className="restaurant-item-actions">{item.reviewRequired&&<p>Save the imported draft’s details, then confirm review before publishing.</p>}{item.reviewRequired&&<button className="button secondary" onClick={()=>void save(`/items/${item.id}/review`,{revision,confirmed:true},'POST').catch(()=>{})}>Confirm imported draft reviewed</button>}{item.state!=='ARCHIVED'&&<button className="text-button" onClick={()=>void save(`/items/${item.id}`,{revision},'DELETE').catch(()=>{})}>Archive item</button>}</div>}</>;
}
