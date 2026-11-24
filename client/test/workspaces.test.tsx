import {initialSetup} from './restaurant-fixture';
import {test,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement,type ReactNode} from 'react';
import {PathnameContext} from 'next/dist/shared/lib/hooks-client-context.shared-runtime';
import type {StaffIdentity,Role} from '@restrodock/contracts';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000',pretendToBeVisual:true});
for(const [key,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FormData:dom.window.FormData,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const {render,screen,cleanup,waitFor,within}=await import('@testing-library/react');
const userEvent=(await import('@testing-library/user-event')).default;
const {SessionGate}=await import('../src/features/access/session');
const {Shell,WorkspaceFrame}=await import('../src/components/shell');
const {TenantPortal}=await import('../src/features/access/tenant');
const {PlatformPortal}=await import('../src/features/access/platform');
const {workspacesFor,defaultWorkspace}=await import('../src/features/access/policy');
const original=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=original;});after(()=>dom.window.close());
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const base:StaffIdentity={email:'member@synthetic.test',platformAdmin:false,csrfToken:'synthetic-csrf',expiresAt:new Date(Date.now()+10000).toISOString(),memberships:[]};
const member=(role:Role,active=true):StaffIdentity=>({...base,memberships:[{role,tenant:{id:'tenant-a',name:'Synthetic',status:active?'ACTIVE':'DRAFT'},access:[{branch:{id:'branch-a',name:'Main',active}}]}]});
function workspace(path:string,children:ReactNode){return createElement(SessionGate,{showSessionBar:false,children:identity=>createElement(WorkspaceFrame,{identity,path,children})});}
function navigation(){return within(screen.getByRole('navigation',{name:'Workspace navigation'})).getAllByRole('link').map(link=>link.getAttribute('href'));}

test('pending identity reveals no role navigation or protected page content',()=>{globalThis.fetch=()=>new Promise(()=>{});render(workspace('/super-admin',createElement('h1',null,'Private directory')));assert.ok(screen.getByRole('status',{name:'Loading workspace'}));assert.equal(screen.queryByText(/Checking your session/),null);assert.equal(screen.queryByRole('navigation',{name:'Workspace navigation'}),null);assert.equal(screen.queryByText('Private directory'),null);});
test('platform-only identity gets only platform navigation; tenant URL cannot mount its API client',async()=>{const requests:string[]=[];globalThis.fetch=async path=>{requests.push(String(path));return json({...base,platformAdmin:true});};render(workspace('/restaurant',createElement(TenantPortal,{kind:'restaurant'})));await screen.findByRole('heading',{name:'Workspace access required'});assert.deepEqual(navigation(),['/super-admin','/super-admin/registrations','/super-admin/analytics']);assert.equal(requests.filter(path=>!path.endsWith('/me')).length,0);assert.equal(screen.queryByRole('button',{name:'Manage setup & menu'}),null);assert.equal(screen.queryByRole('link',{name:/Development|Guest|Sign in/}),null);});
test('restaurant sidebar lists all sections, highlights the active page and isolates staff invitation',async()=>{
 let sessionLookups=0;
 globalThis.fetch=async(path,options)=>{
  if(String(path).endsWith('/me')){sessionLookups++;return json(member('RESTAURANT_ADMIN',false));}
  if(String(path).includes('/restaurant/context'))return json({role:'RESTAURANT_ADMIN',message:'Synthetic branch verified'});
  if(String(path).includes('/manage/profile')&&options?.method==='PUT')return json({...initialSetup(undefined,'Renamed branch'),version:2});
  assert.ok(String(path).includes('/manage/settings'));
  return json(initialSetup(undefined,'Main'));
 };
 render(workspace('/restaurant/profile',createElement(TenantPortal,{kind:'restaurant'})));
 await screen.findByRole('heading',{name:'Restaurant details'});
 assert.deepEqual(navigation(),['/restaurant','/restaurant/order-review','/restaurant/tables','/restaurant/menu','/restaurant/menu-preview','/restaurant/staff','/restaurant/profile','/restaurant/hours','/restaurant/safety-pos','/restaurant/analytics','/restaurant/audit']);
 assert.equal(screen.getByRole('link',{name:'Profile'}).getAttribute('aria-current'),'page');
 assert.equal(sessionLookups,1);
 assert.ok(screen.getByText('Synthetic · Main'));
 assert.equal(screen.queryByRole('combobox',{name:'Switch branch'}),null);
 assert.equal(screen.queryByRole('button',{name:'Create staff invitation'}),null);
 const user=userEvent.setup();
 await user.clear(screen.getByLabelText('Branch name'));
 await user.type(screen.getByLabelText('Branch name'),'Renamed branch');
 await user.click(screen.getByRole('button',{name:'Save profile'}));
 await screen.findByText('Synthetic · Renamed branch');
 cleanup();
 render(workspace('/restaurant/staff',createElement(TenantPortal,{kind:'restaurant',section:'staff'})));
 await screen.findByRole('button',{name:'Create staff invitation'});
 assert.equal(screen.getByRole('link',{name:'Manage staff'}).getAttribute('aria-current'),'page');
 assert.equal(screen.queryByRole('heading',{name:'Restaurant details'}),null);
});

const drilldown={
 previousStart:'2026-11-11',previousEnd:'2026-11-11',
 current:{orders:1,eligible:1,estimatedMinor:18000,cancelled:0,rejected:0},
 previous:{orders:0,eligible:0,estimatedMinor:0,cancelled:0,rejected:0},
 dailyValue:[{date:'2026-11-12',eligible:1,estimatedMinor:18000}],
 hours:Array.from({length:24},(_,hour)=>({hour,orders:hour===12?1:0})),
 menu:[{id:'550e8400-e29b-41d4-a716-446655440000',name:'Paneer Tikka',category:'Starters',quantity:2,estimatedMinor:18000,orders:1}],
 categories:[{name:'Starters',quantity:2,estimatedMinor:18000}],
 preparation:{sample:0,medianSeconds:null,p90Seconds:null},
};

test('analytics loads the assigned branch, filters by date and labels unavailable confirmed amounts',async()=>{
 const requests:string[]=[];
 globalThis.fetch=async path=>{
  requests.push(String(path));
  if(String(path).endsWith('/me'))return json(member('RESTAURANT_ADMIN'));
  const params=new URL(String(path),'https://test.example').searchParams;
  const singleDay=params.has('period')||params.has('start');
  return json({timezone:'Asia/Kolkata',start:singleDay?'2026-11-12':'2026-11-06',end:'2026-11-12',
   days:singleDay?[{date:'2026-11-12',orders:1,held:0}]:[{date:'2026-11-06',orders:0,held:0},{date:'2026-11-12',orders:1,held:0}],
   drilldown,demand:[{name:'Paneer',quantity:2}],
   totals:{orders:1,held:0,pendingReview:0,estimatedMinor:18000,billRequests:1,confirmedSettlements:1,confirmedMinor:null,kitchenSample:0,kitchenAverageSeconds:null}});
 };
 render(workspace('/restaurant/analytics',createElement(TenantPortal,{kind:'restaurant',section:'analytics'})));
 await screen.findByRole('heading',{name:'Orders by day'});
 assert.equal(screen.getByRole('link',{name:'Analytics'}).getAttribute('aria-current'),'page');
 assert.ok(screen.getByText('Paneer'));
 assert.ok(screen.getByText('Confirmed payment amount'));
 assert.ok(screen.getByRole('button',{name:'Export CSV'}));
 const user=userEvent.setup();
 assert.equal(screen.getByRole('button',{name:'Last 7 days'}).getAttribute('aria-pressed'),'true');
 await user.click(screen.getByRole('button',{name:'Today'}));
 await screen.findByRole('heading',{name:'Orders by hour'});
 assert.ok(requests.includes('/api/v1/restaurant/analytics?tenantId=tenant-a&branchId=branch-a&period=today'));
 assert.equal(screen.getByRole('button',{name:'Today'}).getAttribute('aria-pressed'),'true');
 assert.equal((screen.getByLabelText('Start date') as HTMLInputElement).value,'2026-11-12');
 assert.equal((screen.getByLabelText('End date') as HTMLInputElement).value,'2026-11-12');

 await user.click(screen.getByText('Orders & estimated value'));
 assert.ok(screen.getByRole('table',{name:'Order period comparison'}));
 await user.click(screen.getByText('Menu performance'));
 await user.click(screen.getByText('Paneer Tikka'));
 assert.ok(screen.getByText('1 orders included this item.'));
 await user.click(screen.getByText('Kitchen performance'));
 assert.ok(screen.getByText(/Peak order hours: 12:00/));
 await user.click(screen.getByRole('button',{name:'Apply dates'}));
 await waitFor(()=>assert.ok(requests.includes('/api/v1/restaurant/analytics?tenantId=tenant-a&branchId=branch-a&start=2026-11-12&end=2026-11-12')));
 await screen.findByRole('heading',{name:'Orders by hour'});
 assert.equal(screen.getByRole('button',{name:'Today'}).getAttribute('aria-pressed'),'false');
 await user.click(screen.getByRole('button',{name:'Last 7 days'}));
 await screen.findByRole('heading',{name:'Orders by day'});
 assert.equal(screen.getByRole('button',{name:'Last 7 days'}).getAttribute('aria-pressed'),'true');
});
test('analytics CSV escapes item labels and keeps confirmed money unavailable',async()=>{
 const {reportCsv}=await import('../src/features/restaurant/analytics');
 const csv=reportCsv({timezone:'Asia/Kolkata',start:'2026-11-12',end:'2026-11-12',days:[],
  drilldown,demand:[{name:'=HYPERLINK("example","item")',quantity:2}],
  totals:{orders:1,held:0,pendingReview:0,estimatedMinor:18050,billRequests:1,confirmedSettlements:1,confirmedMinor:null,kitchenSample:0,kitchenAverageSeconds:null}});
 assert.ok(csv.includes('"Estimated order value (INR)","180.50"'));
 assert.ok(csv.includes('"Confirmed payment amount (INR)","Unavailable"'));
 assert.ok(csv.includes('"Menu performance","Paneer Tikka","Starters","2","180.00","1"'));
 assert.ok(csv.includes('"Kitchen","Median preparation (seconds)","Unavailable"'));
 assert.ok(csv.includes(`"'=HYPERLINK(""example"",""item"")"`));
});
test('worker cannot mount a manually entered platform page or fetch the tenant directory',async()=>{const requests:string[]=[];globalThis.fetch=async path=>{requests.push(String(path));return json(member('WORKER'));};render(workspace('/super-admin',createElement(PlatformPortal)));await screen.findByRole('heading',{name:'Workspace access required'});assert.deepEqual(navigation(),['/staff/tables','/staff/assistance','/staff/kitchen','/staff/order-review','/staff/billing']);assert.ok(!requests.some(path=>path.includes('/super-admin/')));assert.equal(screen.queryByRole('heading',{name:'Restaurant directory'}),null);});
test('waiter sidebar opens and highlights Manage tables; Chef has no table-management navigation',async()=>{
 globalThis.fetch=async()=>json(member('WORKER'));
 render(workspace('/staff/tables',createElement('h1',null,'Table management')));
 await screen.findByRole('heading',{name:'Table management'});
 const link=screen.getByRole('link',{name:'Manage tables'});
 assert.equal(link.getAttribute('href'),'/staff/tables');
 assert.equal(link.getAttribute('aria-current'),'page');
 cleanup();
 globalThis.fetch=async()=>json(member('CHEF'));
 render(workspace('/staff/tables',createElement('h1',null,'Must not mount')));
 await screen.findByRole('heading',{name:'Workspace access required'});
 assert.equal(screen.queryByRole('link',{name:'Manage tables'}),null);
 assert.equal(screen.queryByText('Must not mount'),null);
});
test('staff default destinations match the verified role',()=>{
 const destinations={CHEF:'/staff/kitchen',WORKER:'/staff/tables',CASHIER:'/staff/billing',MANAGER:'/staff/order-review'} as const;
 for(const role of Object.keys(destinations) as (keyof typeof destinations)[]){
  assert.equal(defaultWorkspace(member(role)),destinations[role]);
  assert.equal(defaultWorkspace(member(role,false)),'/staff');
 }
});
test('inactive staff branches explain how to get access without fetching an operational queue',async()=>{
 const {StaffStart}=await import('../src/features/access/staff-start');
 const requests:string[]=[];
 globalThis.fetch=async path=>{requests.push(String(path));return json(member('CHEF',false));};
 render(workspace('/staff',createElement(StaffStart)));
 await screen.findByRole('heading',{name:'Branch not active'});
 assert.ok(requests.every(path=>path.endsWith('/me')));
 assert.equal(screen.queryByRole('link',{name:'Kitchen tickets'}),null);
});
test('only explicit multiple assignments add workspaces; suspended membership is ignored',()=>{const identity={...member('RESTAURANT_ADMIN'),platformAdmin:true};assert.deepEqual(workspacesFor(identity),['platform','restaurant']);assert.equal(defaultWorkspace(identity),'/super-admin');assert.deepEqual(workspacesFor({...identity,memberships:identity.memberships.map(m=>({...m,tenant:{...m.tenant,status:'SUSPENDED' as const}}))}),['platform']);assert.deepEqual(workspacesFor({...base,platformAdmin:true}),['platform']);});
test('shared header logout revokes with CSRF and removes the entire role shell and page',async()=>{let revoked=false;globalThis.fetch=async(path,options)=>{if(String(path).endsWith('/logout')){assert.equal(new Headers(options?.headers).get('X-CSRF-Token'),'synthetic-csrf');revoked=true;return json({signedOut:true});}return json(member('CHEF'));};render(workspace('/staff',createElement('h1',null,'Assigned content')));await screen.findByRole('heading',{name:'Assigned content'});await userEvent.setup().click(screen.getByRole('button',{name:'Sign out'}));await screen.findByRole('link',{name:'Sign in'});assert.equal(revoked,true);assert.equal(screen.queryByRole('navigation',{name:'Workspace navigation'}),null);assert.equal(screen.queryByText('Assigned content'),null);});
test('malformed identity fails closed with retry and no role navigation',async()=>{globalThis.fetch=async()=>json({email:'synthetic',platformAdmin:true,memberships:[]});render(workspace('/super-admin',createElement('h1',null,'Sensitive directory')));await screen.findByRole('heading',{name:'Could not verify your session'});assert.ok(screen.getByRole('button',{name:'Check session again'}));assert.equal(screen.queryByText('Sensitive directory'),null);assert.equal(screen.queryByRole('navigation',{name:'Workspace navigation'}),null);await waitFor(()=>assert.ok(screen.getByRole('alert')));});


test('restaurant drawer contains focus and restores it after dismissal or selecting the current page',async()=>{
 globalThis.fetch=async()=>json(member('RESTAURANT_ADMIN'));
 render(workspace('/restaurant',createElement('h1',null,'Profile')));
 const toggle=await screen.findByRole('button',{name:/Workspace menu/});
 const user=userEvent.setup();
 await user.click(toggle);
 assert.equal(toggle.getAttribute('aria-expanded'),'true');
 const drawer=screen.getByRole('dialog',{name:'Workspace menu'});
 assert.equal(drawer.id,toggle.getAttribute('aria-controls'));
 assert.equal(drawer.getAttribute('aria-modal'),'true');
 assert.ok(toggle.closest('.main-wrap')?.hasAttribute('inert'));
 assert.equal(document.activeElement,within(drawer).getByRole('button',{name:'Close workspace menu'}));
 within(drawer).getByRole('link',{name:'RestroDock home'}).focus();
 await user.tab({shift:true});
 assert.equal(document.activeElement,within(drawer).getByRole('link',{name:'Audit log'}));
 await user.keyboard('{Escape}');
 assert.equal(toggle.getAttribute('aria-expanded'),'false');
 assert.equal(document.activeElement,toggle);
 assert.equal(screen.queryByRole('dialog'),null);
 assert.ok(!toggle.closest('.main-wrap')?.hasAttribute('inert'));
 await user.click(toggle);
 const backdrop=document.querySelector<HTMLElement>('.workspace-drawer-backdrop');
 assert.ok(backdrop);
 await user.click(backdrop);
 assert.equal(document.activeElement,toggle);
 await user.click(toggle);
 const current=screen.getByRole('link',{name:'Overview'});
 current.addEventListener('click',event=>event.preventDefault(),{once:true});
 await user.click(current);
 assert.equal(toggle.getAttribute('aria-expanded'),'false');
 assert.equal(document.activeElement,toggle);
});

test('dashboard navigation reuses the verified session and opens the new section',async()=>{
 const requests:string[]=[];
 globalThis.fetch=async path=>{
  requests.push(String(path));
  return json({...member('RESTAURANT_ADMIN'),platformAdmin:true});
 };
 const route=(path:string,title:string)=>createElement(PathnameContext.Provider,{value:path},
  createElement(Shell,null,createElement('h1',null,title)));
 const view=render(route('/restaurant','Profile content'));
 await screen.findByRole('heading',{name:'Profile content'});
 view.rerender(route('/restaurant/menu','Menu content'));
 assert.ok(screen.getByRole('heading',{name:'Menu content'}));
 assert.equal(screen.getByRole('link',{name:'Menu'}).getAttribute('aria-current'),'page');
 view.rerender(route('/super-admin','Platform content'));
 assert.ok(screen.getByRole('heading',{name:'Platform content'}));
 assert.deepEqual(requests,['/api/v1/auth/me']);
});

test('restaurant overview shows assigned table activity and links to its selected table',async()=>{
 const {RestaurantOverview}=await import('../src/features/restaurant/overview');
 const id='00000000-0000-4000-8000-000000000011';
 globalThis.fetch=async path=>String(path).endsWith('/me')?json(member('RESTAURANT_ADMIN')):json({
  revision:1,entryPublished:true,restaurantName:'Synthetic',branchName:'Main',canManage:true,canOpen:true,canClose:true,
  items:[{id,label:'T07',section:'Main hall',seats:4,archived:false,version:1,qrActive:true,session:{
   id,version:1,pinVersion:1,state:'OPEN',expiresAt:'2026-12-01T12:00:00.000Z',pinExpiresAt:null,locked:false,
   guestCount:1,entryOnly:true,orders:[{id,status:'READY',estimatedTotalMinor:12000}],
  }}],
 });
 render(workspace('/restaurant',createElement(RestaurantOverview)));
 await screen.findByRole('heading',{name:'Needs attention'});
 assert.equal(screen.getByRole('link',{name:'Overview'}).getAttribute('aria-current'),'page');
 assert.equal(within(screen.getByRole('region',{name:'Needs attention'})).getByRole('link',{name:'View T07'}).getAttribute('href'),'/restaurant/tables?table='+id);
});

test('Platform Admin uses the shared workspace menu with role-scoped destinations',async()=>{
 globalThis.fetch=async()=>json({...base,platformAdmin:true});
 render(workspace('/super-admin/registrations',createElement('h1',null,'Review queue')));
 await screen.findByRole('heading',{name:'Review queue'});
 const toggle=screen.getByRole('button',{name:/Workspace menu/});
 await userEvent.setup().click(toggle);
 assert.equal(toggle.getAttribute('aria-expanded'),'true');
 assert.deepEqual(navigation(),['/super-admin','/super-admin/registrations','/super-admin/analytics']);
 assert.equal(screen.getByRole('link',{name:'Registration requests'}).getAttribute('aria-current'),'page');
});

test('platform analytics filters plans and opens branch counts on demand',async()=>{
 const {PlatformAnalytics}=await import('../src/features/access/platform-analytics');
 const {Providers}=await import('../src/app/providers');
 const id='00000000-0000-4000-8000-000000000011';
 const calls:string[]=[];
 globalThis.fetch=async path=>{
  const url=String(path);calls.push(url);
  if(url.endsWith('/me'))return json({...base,platformAdmin:true});
  if(url.includes('/branches?'))return json({items:[{id,name:'Main dining room',active:true,published:true,tables:8,qrTables:6,orders:2}]});
  if(url.includes('/restaurants?'))return json({items:[{id,name:'Synthetic Eatery',slug:'synthetic-eatery',status:'ACTIVE',plan:'PRO',subscriptionStatus:'ACTIVE',endsAt:null,branches:1,tables:8,qrTables:6,orders:2}],total:1});
  return json({from:'2026-11-08',to:'2026-11-14',restaurants:{ACTIVE:1,TRIAL:0,DRAFT:0,SUSPENDED:0},branches:1,tables:8,qrTables:6,
   plans:[{plan:'PRO',status:'ACTIVE',count:1},{plan:null,status:null,count:0}],applications:{received:0,approved:0,rejected:0,pending:0},
   attention:{setup:0,qr:0,renewal:0,idle:0},activity:{restaurants:1,total:2,days:[{date:'2026-11-14',orders:2}]}});
 };
 render(createElement(Providers,{children:workspace('/super-admin/analytics',createElement(PlatformAnalytics))}));
 const user=userEvent.setup();
 assert.equal((await screen.findByRole('link',{name:'Platform Analytics'})).getAttribute('aria-current'),'page');
 await user.click(await screen.findByRole('button',{name:/^Pro/}));
 await waitFor(()=>assert.ok(calls.some(url=>url.includes('/restaurants?')&&url.includes('plan=PRO'))));
 assert.ok(!calls.some(url=>url.includes('/branches?')));
 await user.click(await screen.findByRole('button',{name:/Synthetic Eatery/}));
 assert.ok(await screen.findByText('Main dining room'));
 assert.equal(screen.getByRole('link',{name:'Manage restaurant'}).getAttribute('href'),'/super-admin?restaurant='+id);
 await user.selectOptions(screen.getByLabelText('Activity period'),'7');
 await waitFor(()=>assert.ok(calls.some(url=>url.endsWith('/analytics?days=7'))));
});
