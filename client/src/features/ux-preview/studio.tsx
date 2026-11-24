'use client';
import { useState } from 'react';
import { ArrowRight, RotateCcw } from 'lucide-react';
import { Badge,Button,EmptyState,ErrorState,LoadingState,Notice,OfflineState } from '../../components/ui/primitives';
import { GuestPreview } from './guest';
import { KitchenPreview } from './kitchen';
import { CashierPreview } from './cashier';
import { PlatformPreview,RestaurantPreview } from './admin';
import { ComponentGallery } from './gallery';
import type { PreviewView,Scenario } from './model';
const sections:readonly {view:PreviewView;title:string;description:string}[]=[
 {view:'overview',title:'Review guide',description:'Use these prototypes to review the intended workflows before the backend is enabled.'},
 {view:'guest',title:'Guest experience',description:'Mobile menu, cart, table verification and order-status wireframes.'},
 {view:'kitchen',title:'Kitchen & worker',description:'Readable tickets, role-specific actions and held-order boundaries.'},
 {view:'cashier',title:'Cashier handoff',description:'A consolidated estimate, external POS reference and staff-confirmation flow.'},
 {view:'restaurant',title:'Restaurant admin',description:'Menu, table/QR, staff and safeguard layouts for the proposed first tenant.'},
 {view:'platform',title:'Platform admin',description:'Tenant directory and onboarding gates, separate from restaurant operations.'},
 {view:'ui-kit',title:'Component gallery',description:'Reusable actions, status labels, forms and loading/error/empty states.'}
];
export function Studio({view}:{view:PreviewView}){
 const [scenario,setScenario]=useState<Scenario>('normal');const [resetKey,setResetKey]=useState(0);
 const section=sections.find(s=>s.view===view)!;
 return <div className="ux-studio"><div className="studio-heading"><div><h1>Service, designed around people.</h1><p>Day 2 · role flows and reusable interface patterns</p></div><Badge tone="warning">Development-only UX preview</Badge></div><Notice tone="warning">Synthetic data. Local interactions only. No orders, accounts, table sessions, invoices or payments are created. Role previews are independent and reset when you leave or reload.</Notice><nav className="studio-nav" aria-label="UX preview navigation">{sections.map(s=><a key={s.view} href={s.view==='overview'?'/design':`/design/${s.view}`} aria-current={s.view===view?'page':undefined}>{s.title}</a>)}</nav><div className="studio-section-heading"><div><h2>{section.title}</h2><p>{section.description}</p></div>{view!=='overview'&&<div className="scenario-controls"><label htmlFor="preview-scenario">Scenario<select id="preview-scenario" value={scenario} onChange={e=>setScenario(e.target.value as Scenario)}><option value="normal">Normal</option><option value="loading">Loading</option><option value="empty">Empty</option><option value="error">Error</option><option value="offline">Offline</option></select></label><Button variant="secondary" onClick={()=>{setScenario('normal');setResetKey(n=>n+1);}}><RotateCcw size={15}/>Reset preview</Button></div>}</div><div className={`studio-surface ${view==='guest'?'studio-surface--guest':''}`} key={`${view}-${resetKey}`}>
 {scenario==='loading'?<LoadingState/>:scenario==='empty'?<EmptyState title="Nothing to show in this sample">This state should explain the next useful step without inventing data. Choose Normal to continue the walkthrough.</EmptyState>:scenario==='error'?<ErrorState retry={()=>setScenario('normal')}/>:scenario==='offline'?<OfflineState retry={()=>setScenario('normal')}/>:view==='guest'?<GuestPreview/>:view==='kitchen'?<KitchenPreview/>:view==='cashier'?<CashierPreview/>:view==='restaurant'?<RestaurantPreview/>:view==='platform'?<PlatformPreview/>:view==='ui-kit'?<ComponentGallery/>:<Overview/>}
 </div><p className="studio-footer">Preview interactions demonstrate UI behavior only. Server-side permissions and workflow acceptance remain future release gates.</p></div>;
}
function Overview(){return <div className="studio-overview"><section><h3>Walk through one service.</h3><p>Start with a guest building a sample order, inspect how a chef and worker would handle a ticket, then review the cashier’s manual POS handoff.</p><ol className="walkthrough-links">{sections.filter(s=>['guest','kitchen','cashier'].includes(s.view)).map((s,index)=><li key={s.view}><span>{index+1}</span><a href={`/design/${s.view}`}><strong>{s.title}</strong><p>{s.description}</p></a><ArrowRight size={18}/></li>)}</ol></section><aside className="preview-flow-note"><h3>Review, then validate.</h3><p>Check navigation, wording, role boundaries, estimates and recovery states. The hallway-test script is included in docs/day2/HALLWAY_TEST.md.</p><p>Human review and backend acceptance have not been performed by clicking through these local samples.</p><a className="studio-text-link" href="/design/ui-kit">Inspect the UI kit<ArrowRight size={15}/></a></aside></div>;}
