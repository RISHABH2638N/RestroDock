'use client';

import {useEffect,useState} from 'react';
import {History,RotateCw} from 'lucide-react';
import {AdminPanel} from './admin-panel';
import {auditPageSchema} from '@restrodock/contracts';
import type {z} from 'zod';
import {accessRequest,errorText} from '../access/api';

type Page=z.infer<typeof auditPageSchema>;
const actionLabels:Record<string,string>={
 BRANCH_STAFF_ROLE_CHANGED:'Staff role changed',
 MENU_ITEMS_AVAILABLE:'Menu items marked available',
 MENU_ITEMS_SOLD_OUT:'Menu items marked sold out',
 TABLE_SECTION_MOVED:'Table moved to another section',
};

export function BranchAudit({tenantId,branchId}:{tenantId:string;branchId:string}){
 const [page,setPage]=useState<Page|null>(null);
 const [cursor,setCursor]=useState<string|null>(null);
 const [attempt,setAttempt]=useState(0);
 const [loading,setLoading]=useState(true);
 const [error,setError]=useState('');
 useEffect(()=>{
  let current=true;
  const query=new URLSearchParams({tenantId,branchId,...(cursor?{cursor}:{})});
  void accessRequest('/restaurant/manage/audit?'+query)
   .then(result=>{if(current)setPage(auditPageSchema.parse(result));})
   .catch(reason=>{if(current)setError(errorText(reason));})
   .finally(()=>{if(current)setLoading(false);});
  return ()=>{current=false;};
 },[tenantId,branchId,cursor,attempt]);
 function load(next:string|null){
  setCursor(next);
  setPage(null);
  setError('');
  setLoading(true);
  setAttempt(value=>value+1);
 }
 const time=page&&new Intl.DateTimeFormat('en-IN',{dateStyle:'medium',timeStyle:'short',timeZone:page.timezone});
 return <div aria-busy={loading}>
  <AdminPanel title="Branch activity" description={page?'Times shown in '+page.timezone:'Recent changes recorded for this branch.'}
   className="rd-audit" actions={<button type="button" className="button secondary" onClick={()=>load(null)} disabled={loading}><RotateCw size={15} aria-hidden="true"/>Latest activity</button>}>
  {loading&&<p role="status">Loading branch activity…</p>}
  {error&&<p role="alert" className="access-error">{error} <button type="button" className="text-button" onClick={()=>load(cursor)}>Retry</button></p>}
  {page&&page.events.length===0&&<p className="rd-analytics-empty">No branch activity recorded on this page.</p>}
  {page&&page.events.length>0&&<ul className="rd-service-list rd-audit-events">
   {page.events.map(event=><li key={event.id}>
    <History size={17} aria-hidden="true"/><div><strong>{actionLabels[event.action]??event.action.toLowerCase().replaceAll('_',' ')}</strong>
     <p>{event.actor} · Reference <span title={event.resource}>{event.resource}</span></p>
    </div>
    <time dateTime={event.createdAt}>{time?.format(new Date(event.createdAt))}</time>
   </li>)}
  </ul>}
  {page?.nextCursor&&<button type="button" className="button secondary" onClick={()=>load(page.nextCursor)}>Older activity</button>}
  </AdminPanel>
 </div>;
}
