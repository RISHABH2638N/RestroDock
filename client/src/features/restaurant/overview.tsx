'use client';
import Link from 'next/link';
import {ArrowUpRight,ClipboardCheck,TableProperties} from 'lucide-react';
import {AdminPanel} from './admin-panel';
import {useState} from 'react';
import {tableBoardSchema,type TableBoard,type StaffIdentity} from '@restrodock/contracts';
import {SessionGate} from '../access/session';
import {assignedMemberships} from '../access/policy';
import {accessRequest,errorText} from '../access/api';
import {useOrderUpdates} from '../order-review/live';
import {RestaurantBranchPicker} from './branch-picker';
import {useBranchSelection} from './branch-selection';
import {serviceOrders,tableStatus} from './service';

export function RestaurantOverview(){
 return <SessionGate>{identity=><Overview key={identity.email} identity={identity}/>}</SessionGate>;
}
function Overview({identity}:{identity:StaffIdentity}){
 const branches=assignedMemberships(identity).filter(member=>member.role==='RESTAURANT_ADMIN').flatMap(member=>member.access.map(({branch})=>({
  tenantId:member.tenant.id,branchId:branch.id,label:member.tenant.name+' · '+branch.name,active:branch.active,
 })));
 const [selected,select]=useBranchSelection(branches,identity.email);
 const branch=branches.find(branch=>branch.branchId===selected);
 return <div className="restaurant-admin">
  <div className="restaurant-page-heading"><div><h1>Today’s Service</h1><p>See what needs attention across your tables.</p></div>
   {branch&&<RestaurantBranchPicker assignments={branches} selected={branch} onChange={select}/>}
  </div>
  {branch?branch.active?<ServiceBoard key={branch.branchId} {...branch}/>:<section className="rd-admin-panel"><h2>Get ready for service</h2><p>Complete branch setup before opening tables.</p><Link className="button primary" href="/restaurant/profile">Continue setup</Link></section>:<p>No administrator assignment.</p>}
 </div>;
}
function ServiceBoard({tenantId,branchId}:{tenantId:string;branchId:string}){
 const [board,setBoard]=useState<TableBoard|null>(null),[error,setError]=useState('');
 useOrderUpdates(tenantId,branchId,'tables',async current=>{
  try{
   const data=tableBoardSchema.parse(await accessRequest('/restaurant/tables?'+new URLSearchParams({tenantId,branchId})));
   if(current()){setBoard(data);setError('');}
  }catch(error){if(current())setError(errorText(error));}
  return true;
 },true);
 if(!board)return error?<p role="alert" className="access-error">{error} Refresh the page to retry.</p>:<p role="status">Loading table activity…</p>;
 const occupied=board.items.filter(table=>table.session&&!table.archived);
 const orders=occupied.flatMap(serviceOrders);
 const attention=occupied.filter(table=>table.session?.assistanceRequestedAt||table.session?.billRequestedAt||['Ready for payment','Ready to serve','Needs review'].includes(tableStatus(table)));
 return <>
  {error&&<p role="alert" className="access-error">Table activity could not refresh. Showing the last saved view.</p>}
  <div className="rd-service-overview">
   <AdminPanel title="Service at a glance" className="rd-service-snapshot" actions={<Link className="button secondary" href="/restaurant/tables">View tables <ArrowUpRight size={15} aria-hidden="true"/></Link>}>
    <dl>
     {[['Occupied tables',occupied.length],['Active orders',orders.filter(order=>order.status!=='SERVED').length],['Ready to serve',orders.filter(order=>order.status==='READY').length]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
    </dl>
   </AdminPanel>
   <AdminPanel title="Service shortcuts" className="rd-service-shortcuts">
    <Link href="/restaurant/order-review"><ClipboardCheck size={19} aria-hidden="true"/>Review orders <ArrowUpRight size={15} aria-hidden="true"/></Link>
    <Link href="/restaurant/tables"><TableProperties size={19} aria-hidden="true"/>Manage tables &amp; QR <ArrowUpRight size={15} aria-hidden="true"/></Link>
   </AdminPanel>
  </div>
  <AdminPanel title="Needs attention" className="rd-service-attention">
   {attention.length?<ul className="rd-service-list">{attention.map(table=>{
    const status=tableStatus(table);
    return <li key={table.id}><div><strong>{table.label}</strong><p>{table.session?.assistanceRequestedAt?'Guest requested help':status}</p></div><Link className="button secondary" href={status==='Needs review'&&!table.session?.assistanceRequestedAt?'/restaurant/order-review':'/restaurant/tables?table='+table.id}>View {status==='Needs review'&&!table.session?.assistanceRequestedAt?'review queue':table.label}</Link></li>;
   })}</ul>:<p>No tables need attention.</p>}
  </AdminPanel>
  <AdminPanel title="Live service" className="rd-live-service">{occupied.length?<ul className="rd-service-list">{occupied.map(table=><li key={table.id}><div><strong>{table.label}</strong><p>{table.section} · {serviceOrders(table).length} orders</p></div><span>{tableStatus(table)}</span><Link className="button secondary" href={'/restaurant/tables?table='+table.id}>View {table.label}</Link></li>)}</ul>:<p>No occupied tables. <Link className="text-button" href="/restaurant/tables">Open table board</Link></p>}</AdminPanel>
 </>;
}
