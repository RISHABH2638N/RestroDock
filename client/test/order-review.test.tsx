import {test,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement} from 'react';
import type {ReviewOrder} from '@restrodock/contracts';

const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000',pretendToBeVisual:true});
for(const [key,value] of Object.entries({
 window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,
 HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FormData:dom.window.FormData,
 getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true,
}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const {render,screen,cleanup,waitFor}=await import('@testing-library/react');
const userEvent=(await import('@testing-library/user-event')).default;
const {ReviewBoardView}=await import('../src/features/order-review/portal');
const original=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=original;});after(()=>dom.window.close());
const id='10000000-0000-4000-8000-000000000001';
const order:ReviewOrder={id,version:1,status:'AWAITING_REVIEW',tableLabel:'Table 4',createdAt:'2026-11-10T12:00:00.000Z',estimatedTotalMinor:250000,
 riskSignals:['HIGH_VALUE'],reviewReason:null,reviewedAt:null,items:[{name:'Paneer',quantity:4,portion:'Large',addOns:['Mint dip'],note:'Mild'}]};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
const board={intake:{version:1,paused:false},pending:[order],hasMore:false,recent:[]};
const mount=()=>render(createElement(ReviewBoardView,{kind:'staff',tenantId:id,branchId:id,csrf:'synthetic-csrf'}));

test('flagged order requires a confirmation, sends the scoped decision and only then shows approval',async()=>{
 let writes=0;
 globalThis.fetch=async(path,opts)=>{
  if(opts?.method==='POST'){
   writes++;
   assert.match(String(path),/\/staff\/order-review\/.*\/decision\?tenantId=/);
   assert.equal(new Headers(opts.headers).get('X-CSRF-Token'),'synthetic-csrf');
   assert.deepEqual(JSON.parse(String(opts.body)),{version:1,decision:'APPROVE',override:true});
   return json({...order,status:'PLACED',version:2,reviewReason:'VERIFIED_AT_TABLE',reviewedAt:order.createdAt});
  }
  return json(board);
 };
 mount();
 const user=userEvent.setup();
 await screen.findByText('High estimate');
 await user.click(screen.getByText('Review order',{exact:true}));
 await user.click(screen.getByRole('button',{name:'Approve flagged order'}));
 assert.equal(writes,0);
 await user.click(screen.getByRole('checkbox',{name:/I verified this order/}));
 await user.click(screen.getByRole('button',{name:'Approve flagged order'}));
 await screen.findByText('Order approved.');
 assert.equal(writes,1);
 assert.ok(screen.getByText('No orders awaiting review.'));
 assert.ok(screen.getByText('Approved · Verified with the table'));
});

test('intake pause reflects the saved server state and can be reversed with the new version',async()=>{
 let paused=false,version=1;
 globalThis.fetch=async(path,opts)=>{
  if(opts?.method==='PUT'){
   assert.match(String(path),/\/staff\/order-review\/intake\?/);
   assert.deepEqual(JSON.parse(String(opts.body)),{version,paused:!paused});
   paused=!paused;version++;
   return json({paused,version});
  }
  return json(board);
 };
 mount();
 const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Pause new orders'}));
 await screen.findByText('Paused for this branch.');
 await user.click(screen.getByRole('button',{name:'Resume new orders'}));
 await screen.findByText('New orders resumed.');
 assert.equal(version,3);
 assert.equal(document.activeElement,screen.getByRole('button',{name:'Pause new orders'}));
});

test('uncertain decision response offers refresh and keeps the order visible',async()=>{
 globalThis.fetch=async(_path,opts)=>opts?.method==='POST'?json({error:{code:'API_TIMEOUT',message:'The API took too long.'}},504):json(board);
 mount();
 const user=userEvent.setup();
 await screen.findByText('High estimate');
 await user.click(screen.getByText('Review order',{exact:true}));
 await user.selectOptions(screen.getByRole('combobox',{name:'Rejection reason'}),'DUPLICATE');
 await user.click(screen.getByRole('button',{name:'Reject order'}));
 assert.match((await screen.findByRole('alert')).textContent??'',/Refresh orders/);
 assert.ok(screen.getByText('High estimate'));
 await waitFor(()=>assert.equal(document.activeElement,screen.getByRole('alert')));
 assert.equal(screen.queryByText('Order rejected.'),null);
});


test('intake status remains unknown until the branch board responds',async()=>{
 let respond:(response:Response)=>void=()=>{};
 globalThis.fetch=async()=>new Promise(resolve=>{respond=resolve;});
 mount();
 assert.ok(screen.getByText('Checking intake status…'));
 respond(json({error:{message:'Backend unavailable'}},502));
 await screen.findByText(/Intake status is unavailable/);
 assert.equal(screen.queryByText(/Accepting new pilot orders/),null);
 assert.equal(screen.queryByRole('button',{name:'Pause new orders'}),null);
 assert.ok(screen.getByRole('button',{name:'Refresh orders'}));
});

test('disconnected board refreshes from the HTTP fallback without pressing Refresh',async t=>{
 t.mock.timers.enable({apis:['setInterval']});
 let reads=0;
 globalThis.fetch=async()=>json({...board,pending:++reads===1?[]:[order]});
 mount();
 await screen.findByText('No orders awaiting review.');
 assert.ok(screen.getByText('Checking for updates periodically'));
 const {act}=await import('@testing-library/react');
 await act(async()=>t.mock.timers.tick(10000));
 assert.ok(screen.getByText('High estimate'));
 assert.equal(reads,2);
});

test('kitchen ticket displays preparation details and waiting time to chefs',async()=>{
 const {KitchenBoard}=await import('../src/features/kitchen/portal');
 globalThis.fetch=async()=>json({hasMore:false,tickets:[{
  id,version:2,status:'PLACED',tableLabel:'Table 4',items:order.items,
  queuedAt:new Date(Date.now()-16.5*60000).toISOString(),updatedAt:null,kitchenNote:null,
 }]});
 render(createElement(KitchenBoard,{tenantId:id,branchId:id,role:'CHEF',csrf:'synthetic-csrf'}));
 await screen.findByText('Waiting 16 min');
 assert.ok(screen.getByText('Guest preparation note: Mild'));
 assert.ok(screen.getByRole('button',{name:'Accept ticket'}));
 assert.equal(screen.queryByRole('button',{name:'Mark served'}),null);
});

test('kitchen and worker workspaces show newly submitted orders read-only until verification',async()=>{
 const {KitchenBoard}=await import('../src/features/kitchen/portal');
 globalThis.fetch=async()=>json({hasMore:false,tickets:[{
  id,version:1,status:'AWAITING_REVIEW',tableLabel:'Table 4',items:order.items,
  queuedAt:new Date().toISOString(),updatedAt:null,kitchenNote:null,
 }]});
 render(createElement(KitchenBoard,{tenantId:id,branchId:id,role:'CHEF',csrf:'synthetic-csrf'}));
 assert.ok(await screen.findByText('Awaiting verification'));
 assert.ok(screen.getByText(/visible to the kitchen/i));
 assert.equal(screen.queryByRole('button',{name:'Accept ticket'}),null);
});
