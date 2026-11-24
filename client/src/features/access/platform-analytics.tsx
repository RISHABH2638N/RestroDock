'use client';

import {useState,Fragment,type FormEvent} from 'react';
import Link from 'next/link';
import {useQuery} from '@tanstack/react-query';
import {ArrowUpRight,ChevronDown,Search} from 'lucide-react';
import {
 platformAnalyticsSchema,platformDirectorySchema,platformBranchesSchema,platformTenantStatuses,platformAnalyticsPageSize,
 type platformRestaurantSchema,
} from '@restrodock/contracts';
import type {z} from 'zod';
import {SessionGate} from './session';
import {accessRequest,errorText} from './api';

type Overview=z.infer<typeof platformAnalyticsSchema>;
type Restaurant=z.infer<typeof platformRestaurantSchema>;
type Attention=keyof Overview['attention'];
const attentionLabels:Record<Attention,string>={
 setup:'Draft restaurants',qr:'Restaurants missing published QR coverage',
 renewal:'Subscriptions ending in 30 days',idle:'Restaurants with published QR and no orders',
};
const units=new Intl.NumberFormat('en-IN');
const dateFormat=new Intl.DateTimeFormat('en-IN',{timeZone:'UTC',day:'numeric',month:'short',year:'numeric'});
const date=(iso:string)=>dateFormat.format(new Date(iso));
const label=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1).toLowerCase();
const planLabel=(value:string|null)=>value===null?'No assigned plan':label(value);
const route='/super-admin/analytics';

export function PlatformAnalytics(){
 return <SessionGate showSessionBar={false}>{identity=>identity.platformAdmin
  ?<AnalyticsWorkspace/>
  :<section className="access-auth"><h1>Platform access required</h1><p>Platform Analytics is available to platform administrators.</p></section>}</SessionGate>;
}

function QueryMessage({error,retry,loading}:{error:unknown;retry:()=>void;loading:string}){
 return error?<div className="pa-message"><p role="alert">{errorText(error)}</p><button className="button secondary" type="button" onClick={retry}>Try again</button></div>
  :<p role="status" className="pa-message">{loading}</p>;
}

function AnalyticsWorkspace(){
 const [days,setDays]=useState('30');
 const [search,setSearch]=useState('');
 const [filters,setFilters]=useState<{q:string;plan:string;status:string;attention:Attention|''}>({q:'',plan:'',status:'',attention:''});
 const [page,setPage]=useState(1);
 const [expanded,setExpanded]=useState<string|null>(null);
 const overview=useQuery({queryKey:['platform-analytics',days],queryFn:async()=>platformAnalyticsSchema.parse(await accessRequest(route+'?days='+days)),retry:false,gcTime:0});
 const params=new URLSearchParams({days,page:String(page)});
 for(const [key,value] of Object.entries(filters))if(value)params.set(key,value);
 const directory=useQuery({queryKey:['platform-analytics-directory',params.toString()],queryFn:async()=>platformDirectorySchema.parse(await accessRequest(route+'/restaurants?'+params)),retry:false,gcTime:0});
 const report=overview.data;
 const plans=[...new Set(report?.plans.map(row=>row.plan)??[])];
 const changeFilters=(next:Partial<typeof filters>)=>{setFilters(previous=>({...previous,...next}));setPage(1);setExpanded(null);};
 const drill=(next:Partial<typeof filters>)=>{
  setSearch('');
  changeFilters({q:'',plan:'',status:'',attention:'',...next});
  const target=document.getElementById('restaurant-comparison');
  target?.focus();
  target?.scrollIntoView?.({block:'start'});
 };
 const submit=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();changeFilters({q:search.trim()});};
 return <div className="pa-workspace">
  <header className="restaurant-page-heading">
   <div><h1>Platform Analytics</h1><p>Restaurant coverage, subscription plans and recorded activity across RestroDock.</p></div>
   <label className="pa-period">Activity period<select value={days} onChange={event=>{setDays(event.target.value);setPage(1);setExpanded(null);}}>
    <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option>
   </select></label>
  </header>
  {report?<><section className="rd-panel" aria-labelledby="snapshot-title">
    <div className="pa-sectionHead"><div><h2 id="snapshot-title">Platform overview</h2><p>Current snapshot. Tables exclude archived entries.</p></div></div>
    <dl className="pa-metrics">
     <div><dt>Restaurants</dt><dd>{units.format(Object.values(report.restaurants).reduce((sum,value)=>sum+value,0))}</dd></div>
     <div><dt>Branches</dt><dd>{units.format(report.branches)}</dd></div>
     <div><dt>Configured tables</dt><dd>{units.format(report.tables)}</dd></div>
     <div><dt>Tables with active QR codes</dt><dd>{units.format(report.qrTables)}</dd></div>
    </dl>
    <div className="pa-statusLinks">{platformTenantStatuses.map(status=><button type="button" className="button secondary" key={status} onClick={()=>drill({status})}>{label(status)} <strong>{units.format(report.restaurants[status])}</strong></button>)}</div>
   </section>
   <div className="pa-columns">
    <section className="rd-panel" aria-labelledby="activity-title">
     <h2 id="activity-title">Order activity</h2>
     <p>{date(report.from)} to {date(report.to)} · UTC</p>
     <div className="pa-activityTotals"><strong>{units.format(report.activity.total)} orders</strong><span>Across {units.format(report.activity.restaurants)} restaurants</span></div>
     {report.activity.total>0?<OrderHistory days={report.activity.days}/>:<p className="pa-message">No RestroDock orders recorded in this period.</p>}
    </section>
    <section className="rd-panel" aria-labelledby="attention-title">
     <h2 id="attention-title">Needs attention</h2>
     <ul className="pa-queue">
      <li><Link href="/super-admin/registrations"><span>Applications to review</span><strong>{units.format(report.applications.pending)}</strong><ArrowUpRight size={15} aria-hidden="true"/></Link></li>
      {(Object.keys(attentionLabels) as Attention[]).map(key=><li key={key}><button type="button" onClick={()=>drill({attention:key})}><span>{attentionLabels[key]}</span><strong>{units.format(report.attention[key])}</strong><ArrowUpRight size={15} aria-hidden="true"/></button></li>)}
     </ul>
    </section>
   </div>
   <div className="pa-columns">
    <section className="rd-panel">
     <h2>Plan breakdown</h2>
     <p>Current plan assignments and subscription status.</p>
     <ul className="pa-queue">{plans.map(plan=>{
      const rows=report.plans.filter(row=>row.plan===plan);
      return <li key={plan??'~unassigned'}><button type="button" onClick={()=>drill({plan:plan??'~unassigned'})}>
       <span>{planLabel(plan)}{plan!==null&&<small>{rows.map(row=>label(row.status??'')+' '+units.format(row.count)).join(' · ')}</small>}</span>
       <strong>{units.format(rows.reduce((sum,row)=>sum+row.count,0))}</strong><ArrowUpRight size={15} aria-hidden="true"/>
      </button></li>;
     })}</ul>
    </section>
    <section className="rd-panel">
     <h2>Onboarding</h2>
     <p>Applications received and decisions made in the selected period.</p>
     <dl className="pa-onboarding">
      <div><dt>Received</dt><dd>{units.format(report.applications.received)}</dd></div>
      <div><dt>Approved</dt><dd>{units.format(report.applications.approved)}</dd></div>
      <div><dt>Rejected</dt><dd>{units.format(report.applications.rejected)}</dd></div>
     </dl>
     <Link className="button secondary" href="/super-admin/registrations">Open registration requests <ArrowUpRight size={15} aria-hidden="true"/></Link>
    </section>
   </div></>:<section className="rd-panel"><QueryMessage error={overview.error} retry={()=>void overview.refetch()} loading="Loading platform overview…"/></section>}
  <section id="restaurant-comparison" tabIndex={-1} className="rd-panel" aria-labelledby="comparison-title">
   <div className="pa-sectionHead"><div><h2 id="comparison-title">Restaurant comparison</h2><p>Select a restaurant to view its branches. Order counts follow the activity period.</p></div>
    <Link href="/super-admin" className="button secondary">Restaurants &amp; Plans <ArrowUpRight size={15} aria-hidden="true"/></Link></div>
   <form className="pa-filters" onSubmit={submit}>
    <label>Restaurant name or slug<input type="search" value={search} maxLength={100} onChange={event=>setSearch(event.target.value)}/></label>
    <label>Plan<select value={filters.plan} onChange={event=>changeFilters({plan:event.target.value})}><option value="">All plans</option>
     {plans.map(plan=><option key={plan??'~unassigned'} value={plan??'~unassigned'}>{planLabel(plan)}</option>)}</select></label>
    <label>Restaurant status<select value={filters.status} onChange={event=>changeFilters({status:event.target.value})}><option value="">All statuses</option>
     {platformTenantStatuses.map(status=><option key={status} value={status}>{label(status)}</option>)}</select></label>
    <button className="button primary"><Search size={16} aria-hidden="true"/> Search</button>
   </form>
   {filters.attention&&<div className="pa-filterNotice"><span>{attentionLabels[filters.attention]}</span><button type="button" className="text-button" onClick={()=>changeFilters({attention:''})}>Clear attention filter</button></div>}
   {directory.data?directory.data.items.length>0?<>
    <div className="rd-report-scroll" tabIndex={0} role="region" aria-label="Restaurant comparison table">
     <table className="rd-report-table pa-comparison">
      <thead><tr>{['Restaurant','Plan / subscription','Term ends','Branches','Tables','Active QR','Orders'].map(item=><th scope="col" key={item}>{item}</th>)}</tr></thead>
      <tbody>{directory.data.items.map(row=><Fragment key={row.id}>
       <tr><th scope="row"><button type="button" className="pa-restaurantButton" aria-expanded={expanded===row.id} aria-controls={expanded===row.id?'branches-'+row.id:undefined} onClick={()=>setExpanded(expanded===row.id?null:row.id)}>
        <ChevronDown size={16} aria-hidden="true"/><span>{row.name}<small>{label(row.status)} · {row.slug}</small></span>
       </button></th>
       <td>{planLabel(row.plan)}{row.subscriptionStatus&&<small>{label(row.subscriptionStatus)}</small>}</td>
       <td>{row.endsAt?date(row.endsAt):'—'}</td><td>{units.format(row.branches)}</td><td>{units.format(row.tables)}</td><td>{units.format(row.qrTables)}</td><td>{units.format(row.orders)}</td></tr>
       {expanded===row.id&&<tr><td colSpan={7} className="pa-expanded" id={'branches-'+row.id}><BranchDetails restaurant={row} days={days}/></td></tr>}
      </Fragment>)}</tbody>
     </table>
    </div>
    <div className="pa-pagination"><span>{units.format(directory.data.total)} results · Page {page}</span>
     <button type="button" className="button secondary" disabled={page<=1} onClick={()=>{setPage(page-1);setExpanded(null);}}>Previous</button>
     <button type="button" className="button secondary" disabled={page*platformAnalyticsPageSize>=directory.data.total||page>=10000} onClick={()=>{setPage(page+1);setExpanded(null);}}>Next</button>
    </div>
   </>:<p className="pa-message">No restaurants match these filters.</p>
    :<QueryMessage error={directory.error} retry={()=>void directory.refetch()} loading="Loading restaurants…"/>}
  </section>
 </div>;
}

function OrderHistory({days}:{days:Overview['activity']['days']}){
 const maximum=Math.max(...days.map(day=>day.orders),1);
 return <>
  <div className="pa-chart" aria-hidden="true">{days.map(day=><div key={day.date} className="pa-barSlot" title={date(day.date)+' · '+units.format(day.orders)+' orders'}>
   <span className="pa-bar" style={{height:(day.orders/maximum*100)+'%'}}/>
  </div>)}</div>
  <div className="pa-axis"><span>{date(days[0]!.date)}</span><span>{date(days.at(-1)!.date)}</span></div>
  <details className="pa-history"><summary>Daily order counts</summary>
   <div className="rd-report-scroll" tabIndex={0} role="region" aria-label="Daily order counts">
    <table className="rd-report-table"><thead><tr><th scope="col">Date (UTC)</th><th scope="col">Orders</th></tr></thead><tbody>
     {days.map(day=><tr key={day.date}><th scope="row">{date(day.date)}</th><td>{units.format(day.orders)}</td></tr>)}
    </tbody></table>
   </div>
  </details>
 </>;
}

function BranchDetails({restaurant,days}:{restaurant:Restaurant;days:string}){
 const branches=useQuery({queryKey:['platform-analytics-branches',restaurant.id,days],
  queryFn:async()=>platformBranchesSchema.parse(await accessRequest(route+'/restaurants/'+restaurant.id+'/branches?days='+days)),retry:false,gcTime:0});
 return <div className="pa-branchDetails">
  <div className="pa-sectionHead"><h3>Branches for {restaurant.name}</h3><Link className="button secondary" href={'/super-admin?restaurant='+restaurant.id}>Manage restaurant <ArrowUpRight size={15} aria-hidden="true"/></Link></div>
  {branches.data?branches.data.items.length>0?<ul className="pa-branchList">{branches.data.items.map(branch=><li key={branch.id}>
   <div><strong>{branch.name}</strong><small>{branch.active?'Active':'Inactive'} · {branch.published?'QR entry published':'QR entry unpublished'}</small></div>
   <span>{units.format(branch.tables)} tables</span><span>{units.format(branch.qrTables)} with active QR</span><span>{units.format(branch.orders)} orders</span>
  </li>)}</ul>:<p>No branches configured.</p>:<QueryMessage error={branches.error} retry={()=>void branches.refetch()} loading="Loading branches…"/>}
 </div>;
}
