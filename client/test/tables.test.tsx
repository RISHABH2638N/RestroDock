import {test,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000/q',pretendToBeVisual:true});
for(const [key,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FormData:dom.window.FormData,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const {render,screen,cleanup,waitFor}=await import('@testing-library/react');const userEvent=(await import('@testing-library/user-event')).default;
const {TableBoardView,TablesPortal}=await import('../src/features/tables/board');const {GuestEntry}=await import('../src/features/tables/guest');
const original=globalThis.fetch;afterEach(()=>{cleanup();globalThis.fetch=original;dom.window.sessionStorage.clear();dom.window.history.replaceState(null,'','/q');});after(()=>dom.window.close());
const id='00000000-0000-4000-8000-000000000001',sid='00000000-0000-4000-8000-000000000002',stamp='2026-12-01T12:00:00.000Z',token='a'.repeat(43);
const table={id,label:'Table 1',section:'Garden',seats:4,archived:false,version:1,qrActive:true,session:null};
const board={revision:1,entryPublished:true,restaurantName:'Synthetic restaurant',branchName:'Synthetic branch',canManage:true,canOpen:true,canClose:true,items:[table]};
const session={id:sid,version:1,pinVersion:1,state:'OPEN',expiresAt:stamp,pinExpiresAt:stamp,locked:false,guestCount:0,entryOnly:true};
const context={restaurantName:'Synthetic restaurant',branchName:'Main',tableLabel:'Table 1',section:'Garden',entryOnly:true,orderingEnabled:false,session:{id:sid,pinVersion:1,expiresAt:stamp,canJoin:true},categories:[{id,name:'Synthetic menu'}],items:[{id,categoryId:id,name:'Synthetic meal',description:'Read only',priceMinor:12550,available:true,foodType:'VEG',variants:[],addons:[]}]};
const guest={joined:true as const,cartId:sid,displayName:'Synthetic guest',expiresAt:stamp,csrfToken:'guest-csrf',entryOnly:true as const,orderingEnabled:false};
const json=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
const mountBoard=(kind:'restaurant'|'staff'='restaurant')=>render(createElement(TableBoardView,{tenantId:id,branchId:id,csrf:'staff-csrf',kind}));
test('table board renders persisted occupancy and role-gated controls without synthetic activity',async()=>{globalThis.fetch=async()=>json({...board,canManage:false,canOpen:false,items:[{...table,session}]});mountBoard('staff');await screen.findByText(/0 verified guests/);assert.equal(screen.queryByRole('button',{name:'Add table'}),null);assert.equal(screen.queryByRole('button',{name:'Issue / rotate QR'}),null);assert.equal(screen.queryByRole('button',{name:'Rotate PIN & revoke guests'}),null);assert.ok(screen.getByRole('button',{name:'Close table & revoke guests'}));});
test('opening table sends current version and CSRF then shows one-time PIN only after success',async()=>{let sent:unknown;globalThis.fetch=async(_path,options={})=>{if(options.method==='POST'){sent=JSON.parse(String(options.body));assert.equal(new Headers(options.headers).get('X-CSRF-Token'),'staff-csrf');return json({board:{...board,items:[{...table,session}]},pin:'123456'});}return json(board);};mountBoard();const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Start table session & generate PIN'}));await screen.findByText('123456');assert.deepEqual(sent,{version:1,durationMinutes:120});assert.equal(screen.queryByRole('button',{name:'Start table session & generate PIN'}),null);await user.click(screen.getByRole('button',{name:'Dismiss issued credentials'}));assert.equal(screen.queryByText('123456'),null);});
test('QR response exposes download/print receipt and refresh discards its raw secret',async()=>{globalThis.fetch=async(_path,options={})=>options.method==='POST'?json({board,qr:{url:'http://localhost:3000/q#'+token,pngDataUrl:'data:image/png;base64,aGVsbG8='}}):json(board);mountBoard();const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Issue / rotate QR'}));await screen.findByRole('link',{name:'Download QR PNG'});assert.ok(screen.getByRole('button',{name:'Print QR card'}));assert.match((screen.getByLabelText('Save the current QR link') as HTMLInputElement).value,/#/);await user.click(screen.getByRole('button',{name:'Refresh saved tables'}));await waitFor(()=>assert.equal(screen.queryByLabelText('Save the current QR link'),null));});
test('failed table mutation does not invent a PIN, QR or success; refresh offers recovery',async()=>{globalThis.fetch=async(_path,options={})=>options.method==='POST'?json({error:{message:'This table changed. Refresh saved tables.'}},409):json(board);mountBoard();await userEvent.setup().click(await screen.findByRole('button',{name:'Issue / rotate QR'}));await screen.findByRole('alert');assert.equal(screen.queryByLabelText('Issued PIN'),null);assert.equal(screen.queryByRole('link',{name:'Download QR PNG'}),null);assert.equal(screen.queryByText('Saved. Current table state reloaded.'),null);});
test('Chef and platform-only users never mount a table board or fetch its records',async()=>{const paths:string[]=[];globalThis.fetch=async path=>{paths.push(String(path));return json({email:'chef@synthetic.test',platformAdmin:true,csrfToken:'x',expiresAt:stamp,memberships:[{role:'CHEF',tenant:{id,name:'Synthetic',status:'DRAFT'},access:[{branch:{id,name:'Main',active:false}}]}]});};render(createElement(TablesPortal,{kind:'staff'}));await screen.findByRole('heading',{name:'Table-service access required'});assert.ok(!paths.some(p=>p.includes('/tables')));});
function guestMock(handler?:(body:Record<string,unknown>)=>Response|Promise<Response>){globalThis.fetch=async(path,options={})=>{if(String(path).endsWith('/lookup')){assert.equal(dom.window.location.hash,'');return json(context);}if(String(path).endsWith('/guest/session'))return json({error:{message:'Not joined'}},401);if(String(path).endsWith('/join'))return handler?handler(JSON.parse(String(options.body))):json(guest);throw Error('Unexpected route');};}
async function fillGuest(){const user=userEvent.setup();await user.type(await screen.findByLabelText('Staff-issued PIN'),'123456');await user.type(screen.getByLabelText('Your name'),'Synthetic guest');await user.type(screen.getByLabelText('Mobile number'),'+919999999999');await user.click(screen.getByRole('checkbox'));return user;}
test('guest QR strips URL fragment, reads scoped menu and never offers order actions',async()=>{dom.window.history.replaceState(null,'','/q#'+token);guestMock();render(createElement(GuestEntry));await screen.findByText('Synthetic meal');assert.equal(dom.window.location.hash,'');assert.ok(screen.getByRole('heading',{name:'Synthetic restaurant'}));assert.equal(screen.queryByRole('button',{name:/place order/i}),null);assert.equal(dom.window.localStorage.length,0);assert.equal(dom.window.sessionStorage.length,0);});
test('guest submit binds current table challenge and consent; successful receipt clears contact form',async()=>{dom.window.history.replaceState(null,'','/q#'+token);let body:Record<string,unknown>={};guestMock(value=>{body=value;return json(guest);});render(createElement(GuestEntry));const user=await fillGuest();await user.click(screen.getByRole('button',{name:'Verify table entry'}));const heading=await screen.findByRole('heading',{name:'Table entry verified'});await waitFor(()=>assert.equal(document.activeElement,heading));assert.equal(body.sessionId,sid);assert.equal(body.pinVersion,1);assert.equal(body.privacyAccepted,true);assert.match(String(body.guestSecret),/^[A-Za-z0-9_-]{43}$/);assert.equal(screen.queryByLabelText('Mobile number'),null);assert.equal(dom.window.localStorage.length,0);});
test('wrong PIN associates error and focus with actual field, retains details and never claims joined',async()=>{dom.window.history.replaceState(null,'','/q#'+token);guestMock(()=>json({error:{message:'Check PIN',fields:[{field:'pin',message:'The staff PIN is incorrect.'}]}},400));render(createElement(GuestEntry));const user=await fillGuest();await user.click(screen.getByRole('button',{name:'Verify table entry'}));await screen.findByText('The staff PIN is incorrect.');const pin=screen.getByLabelText('Staff-issued PIN');await waitFor(()=>assert.equal(document.activeElement,pin));assert.equal(pin.getAttribute('aria-invalid'),'true');assert.equal((screen.getByLabelText('Mobile number') as HTMLInputElement).value,'+919999999999');assert.equal(screen.queryByText('Table entry verified'),null);});
test('closed/locked table remains read-only and has no PIN submission form',async()=>{dom.window.history.replaceState(null,'','/q#'+token);globalThis.fetch=async path=>String(path).endsWith('/lookup')?json({...context,session:null}):json({},401);render(createElement(GuestEntry));await screen.findByText(/Ask your waiter to open this table and generate a PIN/);assert.equal(screen.queryByLabelText('Staff-issued PIN'),null);assert.ok(screen.getByText('Synthetic meal'));});
test('guest can build a cart before the waiter opens the table, then checkout asks for the table code',async()=>{
 const dialog=dom.window.HTMLDialogElement.prototype;
 dialog.showModal=function(){this.setAttribute('open','');};
 dialog.close=function(){this.removeAttribute('open');};
 dom.window.history.replaceState(null,'','/q#'+token);
 let tableOpened=false;
 const requests:string[]=[];
 globalThis.fetch=async(path,_options={})=>{
  const url=String(path);
  if(url.endsWith('/lookup'))return json({...context,deferredVerification:true,session:tableOpened?{...context.session,occupied:false}:null});
  if(url.endsWith('/guest/session'))return json({},401);
  if(url.endsWith('/join')){requests.push('join');return json({...guest,orderingEnabled:true});}
  if(url.endsWith('/guest/orders')){requests.push('order');return json({orderId:id,status:'AWAITING_REVIEW',estimatedTotalMinor:12550,createdAt:stamp},201);}
  throw Error('Unexpected route '+url);
 };
 try{
  render(createElement(GuestEntry));
  const user=userEvent.setup();
  await user.click(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
  await user.click(screen.getByRole('button',{name:/Add to cart/}));
  assert.ok(screen.getByRole('button',{name:/View cart · 1/}));
  await user.click(screen.getByRole('button',{name:'Place order'}));
  assert.ok(screen.getByRole('dialog',{name:'Enter your table code'}));
  assert.ok(screen.getByText('Ask your waiter to open this table and generate a PIN before placing your order.'));
  assert.equal(screen.queryByLabelText('Your name'),null);
  await user.click(screen.getByRole('button',{name:'Back to cart'}));
  tableOpened=true;
  assert.ok(screen.getByRole('button',{name:/View cart · 1/}));
  await user.click(screen.getByRole('button',{name:'Place order'}));
  await user.type(await screen.findByLabelText('Six-digit code from your waiter'),'123456');
  await user.type(screen.getByLabelText('Your name'),'Synthetic guest');
  await user.type(screen.getByLabelText('Mobile number'),'+919999999999');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{name:'Verify and place order'}));
  await screen.findByRole('heading',{name:'Your orders'});
  assert.deepEqual(requests,['join','order']);
 }finally{Reflect.deleteProperty(dialog,'showModal');Reflect.deleteProperty(dialog,'close');}
});
test('quantity controls update the cart estimate and the cart shortcut focuses the review',async()=>{
 dom.window.history.replaceState(null,'','/q#'+token);
 globalThis.fetch=async path=>String(path).endsWith('/lookup')?json({...context,deferredVerification:true}):json({},401);
 render(createElement(GuestEntry));
 const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
 assert.equal((screen.getByRole('button',{name:'Decrease quantity'}) as HTMLButtonElement).disabled,true);
 await user.click(screen.getByRole('button',{name:'Increase quantity'}));
 await user.click(screen.getByRole('button',{name:/Add to cart/}));
 await user.click(screen.getByRole('button',{name:/View cart · 2 · ₹251.00/}));
 assert.equal(document.activeElement,screen.getByRole('heading',{name:'Your cart'}));
});
test('a second device sees the active reservation while the verified customer keeps access',async()=>{
 dom.window.history.replaceState(null,'','/q#'+token);
 globalThis.fetch=async path=>String(path).endsWith('/lookup')?json({...context,deferredVerification:true,session:{...context.session,occupied:true}}):json({},401);
 render(createElement(GuestEntry));
 await screen.findByRole('heading',{name:'This table already has an active guest session'});
 assert.ok(await screen.findByText('Synthetic meal'));
 assert.equal(screen.queryByRole('button',{name:'Customize Synthetic meal'}),null);
 assert.equal(screen.queryByRole('heading',{name:'Your cart'}),null);
 assert.equal(screen.queryByRole('button',{name:/Place order/}),null);
});
test('published menu renders before the guest session check finishes',async()=>{
 dom.window.history.replaceState(null,'','/q#'+token);
 let completeSession:()=>void=()=>{};
 const session=new Promise<Response>(resolve=>{completeSession=()=>resolve(json({},401));});
 globalThis.fetch=async path=>String(path).endsWith('/lookup')?json({...context,deferredVerification:true}):session;
 render(createElement(GuestEntry));
 try{
  assert.ok(await screen.findByText('Synthetic meal'));
  assert.equal(screen.queryByRole('button',{name:'Customize Synthetic meal'}),null);
 }finally{completeSession();}
 assert.ok(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
});
test('missing QR explains rescan without sending a guessed table identifier',async()=>{let calls=0;globalThis.fetch=async()=>{calls++;return json({});};render(createElement(GuestEntry));await screen.findByRole('alert');assert.equal(calls,0);assert.equal(screen.queryByLabelText('Staff-issued PIN'),null);});
test('expired guest credential disappears on refresh instead of retaining a verified claim',async()=>{dom.window.history.replaceState(null,'','/q#'+token);let checks=0;globalThis.fetch=async path=>String(path).endsWith('/lookup')?json(context):++checks===1?json(guest):json({},401);render(createElement(GuestEntry));await screen.findByRole('heading',{name:'Table entry verified'});await userEvent.setup().click(screen.getByRole('button',{name:'Refresh table entry'}));await screen.findByLabelText('Staff-issued PIN');assert.equal(screen.queryByRole('heading',{name:'Table entry verified'}),null);});

test('lost credential response explains refresh-and-rotate recovery and clears ambiguity on refresh',async()=>{globalThis.fetch=async(_path,options={})=>{if(options.method==='POST')throw Error('Synthetic lost response');return json(board);};mountBoard();const user=userEvent.setup();await user.click(await screen.findByRole('button',{name:'Issue / rotate QR'}));await screen.findByText(/The change may already have saved/);assert.equal(screen.queryByRole('link',{name:'Download QR PNG'}),null);await user.click(screen.getByRole('button',{name:'Refresh saved tables'}));await waitFor(()=>assert.equal(screen.queryByText(/The change may already have saved/),null));});

test('verified cart restores on a clean URL, recalculates published prices and handles sold out options',async()=>{
 const user=userEvent.setup();
 const options={
  variants:[{name:'Regular',priceMinor:14000,available:true},{name:'Large',priceMinor:20000,available:true}],
  addons:[{name:'Extra sauce',priceMinor:2500,available:true}],
 };
 const menu={...context,items:[{...context.items[0],...options}]};
 let refreshedMenu=menu;
 const sent:string[]=[];
 globalThis.fetch=async(path,request)=>{
  const url=String(path);
  sent.push(url);
  if(url.endsWith('/lookup'))return json(menu);
  if(url.endsWith('/guest/session'))return json(guest);
  if(url.endsWith('/cart-context')){
   assert.deepEqual(JSON.parse(String(request?.body)),{});
   return json({context:refreshedMenu,guest});
  }
  throw Error('Unexpected request '+url);
 };
 dom.window.history.replaceState(null,'','/q#'+token);
 const first=render(createElement(GuestEntry));
 const customize=await screen.findByRole('button',{name:'Customize Synthetic meal'});
 await user.click(customize);
 await user.click(screen.getByRole('button',{name:'Cancel'}));
 assert.equal(dom.window.document.activeElement,customize);
 await user.click(customize);
 const quantityInput=screen.getByRole<HTMLInputElement>('spinbutton',{name:'Quantity'});
 assert.ok(screen.getByText('Choose 1 to 50.'));
 await user.clear(quantityInput);
 await user.type(quantityInput,'0');
 assert.equal(quantityInput.validity.rangeUnderflow,true);
 await user.click(screen.getByRole('button',{name:'Add to cart'}));
 assert.ok(screen.getByText('Add dishes from the menu to start your order.'));
 await user.click(screen.getByRole('radio',{name:/Large/}));
 await user.click(screen.getByRole('checkbox',{name:/Extra sauce/}));
 await user.clear(screen.getByLabelText('Quantity'));
 await user.type(screen.getByLabelText('Quantity'),'2');
 await user.type(screen.getByLabelText(/Preparation note/),'Mild');
 await user.click(screen.getByRole('button',{name:/Add to cart/}));
 assert.equal(dom.window.document.activeElement,customize);
 assert.ok(screen.getByText('2 × Synthetic meal'));
 assert.ok(screen.getByRole('button',{name:/View cart · 2 · ₹450.00/}));
 assert.ok(screen.getByText('Note: Mild'));
 const saved=dom.window.sessionStorage.getItem('restrodock.guest-cart.v1')!;
 for(const value of [token,'guest-csrf','45000','Synthetic guest'])assert.ok(!saved.includes(value));
 assert.equal(dom.window.location.hash,'');
 first.unmount();

 refreshedMenu={...menu,items:[{...menu.items[0]!,variants:[options.variants[0]!,{...options.variants[1]!,priceMinor:21000}]}]};
 const second=render(createElement(GuestEntry));
 await screen.findByRole('button',{name:/View cart · 2 · ₹470.00/});
 assert.ok(screen.getByText('Note: Mild'));
 second.unmount();

 refreshedMenu={...menu,items:[{...menu.items[0]!,addons:[{...options.addons[0]!,available:false}]}]};
 render(createElement(GuestEntry));
 await screen.findByText('Selection unavailable');
 assert.ok(screen.getByRole('button',{name:/View cart · 2 · ₹0.00/}));
 await user.click(screen.getByRole('button',{name:'Edit Synthetic meal'}));
 assert.ok((screen.getByRole('checkbox',{name:/Extra sauce/}) as HTMLInputElement).disabled);
 await user.click(screen.getByRole('button',{name:/Save changes/}));
 assert.ok(screen.getByRole('button',{name:/View cart · 2 · ₹400.00/}));
 await user.click(screen.getByRole('button',{name:'Remove Synthetic meal'}));
 assert.ok(screen.getByText('Add dishes from the menu to start your order.'));
 assert.equal(dom.window.sessionStorage.length,0);
 assert.ok(sent.every(url=>!url.includes('/orders')));
});

test('cart restore drops a different guest draft and clears storage after denial',async()=>{
 const draft={cartId:sid,lines:[{id:1,itemId:id,variant:null,addons:[],quantity:1,note:'Previous guest'}]};
 dom.window.sessionStorage.setItem('restrodock.guest-cart.v1',JSON.stringify(draft));
 globalThis.fetch=async()=>json({context,guest:{...guest,cartId:id}});
 const first=render(createElement(GuestEntry));
 await screen.findByText('Add dishes from the menu to start your order.');
 assert.equal(screen.queryByText('Note: Previous guest'),null);
 first.unmount();
 dom.window.sessionStorage.setItem('restrodock.guest-cart.v1',JSON.stringify(draft));
 globalThis.fetch=async()=>json({error:{message:'Verify again'}},401);
 render(createElement(GuestEntry));
 await screen.findByText('Verify again');
 assert.equal(dom.window.sessionStorage.length,0);
 assert.equal(screen.queryByRole('heading',{name:'Your cart'}),null);
});

test('checkout is single-flight and keeps the exact attempt after reload, response loss and menu change',async()=>{
 const {fireEvent,act}=await import('@testing-library/react');
 const enabled={...guest,orderingEnabled:true};
 const user=userEvent.setup();
 const requests:string[]=[];
 const receipt={orderId:id,status:'AWAITING_REVIEW',estimatedTotalMinor:12550,createdAt:stamp};
 const changed={...context,items:[{...context.items[0],priceMinor:14000,available:false}]};
 let rejectResponse:(reason:Error)=>void=()=>{};
 const missingResponse=new Promise<Response>((_resolve,reject)=>{rejectResponse=reject;});
 globalThis.fetch=async(path,options={})=>{
  const url=String(path);
  if(url.endsWith('/lookup'))return json(context);
  if(url.endsWith('/guest/session'))return json(enabled);
  if(url.endsWith('/cart-context'))return json({context:changed,guest:enabled});
  if(url.endsWith('/guest/order-status')){
   assert.equal(new Headers(options.headers).get('X-CSRF-Token'),'guest-csrf');
   return json({orders:requests.length===2?[{...receipt,status:'PREPARING'}]:[]});
  }
  if(url.endsWith('/guest/orders')){
   assert.equal(new Headers(options.headers).get('X-CSRF-Token'),'guest-csrf');
   requests.push(String(options.body));
   return requests.length===1?missingResponse:json(receipt);
  }
  throw Error('Unexpected route '+url);
 };
 dom.window.history.replaceState(null,'','/q#'+token);
 const first=render(createElement(GuestEntry));
 await user.click(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
 await user.click(screen.getByRole('button',{name:/Add to cart/}));
 const submit=screen.getByRole('button',{name:'Submit order'});
 act(()=>{fireEvent.click(submit);fireEvent.click(submit);});
 assert.equal(requests.length,1);
 assert.ok(screen.getByRole('button',{name:'Submitting order…'}));
 assert.equal(screen.queryByRole('heading',{name:'Your orders'}),null);
 assert.equal(JSON.parse(requests[0]!).lines[0].expectedUnitPriceMinor,12550);
 assert.equal(JSON.parse(requests[0]!).cartId,sid);
 rejectResponse(new Error('connection interrupted after commit'));
 await screen.findByText(/Retry this same submission/);
 first.unmount();

 const resumed=render(createElement(GuestEntry));
 await screen.findByText('Estimate for this attempt');
 assert.ok(screen.getByRole('button',{name:'View cart · 1 · ₹125.50'}));
 assert.ok(screen.getByText('Sold out'));
 assert.equal(screen.queryByText('Selection unavailable'),null);
 await user.click(await screen.findByRole('button',{name:'Retry same submission'}));
 const confirmation=await screen.findByRole('heading',{name:'Your orders'});
 assert.equal(requests.length,2);
 assert.equal(requests[0],requests[1]);
 await waitFor(()=>assert.equal(document.activeElement,confirmation));
 await screen.findByText('Preparing',{selector:'strong'});
 assert.ok(screen.getByText('Order #'+id.slice(0,8)));
 assert.equal(dom.window.sessionStorage.getItem('restrodock.guest-cart.v1'),null);
 resumed.unmount();

 render(createElement(GuestEntry));
 await screen.findByRole('heading',{name:'Your orders'});
 assert.equal(requests.length,2);
});

test('a changed checkout price requires menu refresh and explicit resubmission',async()=>{
 const enabled={...guest,orderingEnabled:true};
 const updated={...context,items:[{...context.items[0],priceMinor:13000}]};
 const user=userEvent.setup();
 const requests:number[]=[];
 let refreshes=0;
 globalThis.fetch=async(path,options={})=>{
  const url=String(path);
  if(url.endsWith('/lookup'))return json(refreshes++?updated:context);
  if(url.endsWith('/guest/session'))return json(enabled);
  if(url.endsWith('/guest/orders')){
   requests.push(JSON.parse(String(options.body)).lines[0].expectedUnitPriceMinor);
   return requests.length===1?json({error:{code:'CHECKOUT_MENU_CHANGED',message:'Review the new estimate.'}},409)
    :json({orderId:id,status:'AWAITING_REVIEW',estimatedTotalMinor:13000,createdAt:stamp},201);
  }
  throw Error('Unexpected route '+url);
 };
 dom.window.history.replaceState(null,'','/q#'+token);
 render(createElement(GuestEntry));
 await user.click(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
 await user.click(screen.getByRole('button',{name:/Add to cart/}));
 await user.click(screen.getByRole('button',{name:'Submit order'}));
 await screen.findByText('Review the new estimate.');
 assert.equal((screen.getByRole('button',{name:'Submit order'}) as HTMLButtonElement).disabled,true);
 assert.ok(screen.getByText('1 × Synthetic meal'));
 await user.click(screen.getByRole('button',{name:'Refresh menu'}));
 await screen.findByRole('button',{name:/View cart · 1 · ₹130.00/});
 assert.deepEqual(requests,[12550]);
 await user.click(screen.getByRole('button',{name:'Submit order'}));
 await screen.findByRole('heading',{name:'Your orders'});
 assert.deepEqual(requests,[12550,13000]);
});

test('publication timeout asks for refresh and shows the committed state only after reload',async()=>{
 let saved=false,writes=0;
 globalThis.fetch=async(_path,options={})=>{
  if(options.method==='PUT'){
   saved=true;writes++;
   return json({error:{code:'API_TIMEOUT',message:'The API took too long to respond.'}},504);
  }
  return json({...board,entryPublished:saved});
 };
 mountBoard();
 const user=userEvent.setup();
 await user.click(await screen.findByRole('checkbox',{name:/I reviewed this branch/}));
 await user.click(screen.getByRole('button',{name:'Publish table entry'}));
 await screen.findByText(/The change may already have saved/);
 assert.ok(screen.getByText('Table entry unpublished'));
 assert.equal(screen.queryByText('Saved. Current table state reloaded.'),null);
 await user.click(screen.getByRole('button',{name:'Refresh saved tables'}));
 await screen.findByText('Table entry published');
 assert.equal(writes,1);
});

test('reserved checkout keeps the cart and submits it after the code dialog succeeds',async()=>{
 const dialog=dom.window.HTMLDialogElement.prototype;
 dialog.showModal=function(){this.setAttribute('open','');};
 dialog.close=function(){this.removeAttribute('open');};
 const requests:string[]=[];
 dom.window.history.replaceState(null,'','/q#'+token);
 globalThis.fetch=async(path,options={})=>{
  const url=String(path);
  if(url.endsWith('/lookup'))return json({...context,deferredVerification:true});
  if(url.endsWith('/guest/session'))return json({},401);
  if(url.endsWith('/join')){requests.push('join');return json({...guest,orderingEnabled:true});}
  if(url.endsWith('/guest/orders')){
   requests.push('order');
   assert.equal(JSON.parse(String(options.body)).lines[0].itemId,id);
   return json({orderId:id,status:'AWAITING_REVIEW',estimatedTotalMinor:12550,createdAt:stamp},201);
  }
  throw Error('Unexpected route '+url);
 };
 try{
  render(createElement(GuestEntry));
  const user=userEvent.setup();
  await user.click(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
  await user.click(screen.getByRole('button',{name:/Add to cart/}));
  assert.equal(screen.queryByRole('dialog'),null);
  await user.click(screen.getByRole('button',{name:'Place order'}));
  assert.ok(screen.getByRole('dialog',{name:'Enter your table code'}));
  await user.type(screen.getByLabelText('Six-digit code from your waiter'),'123456');
  await user.type(screen.getByLabelText('Your name'),'Synthetic guest');
  await user.type(screen.getByLabelText('Mobile number'),'+919999999999');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{name:'Verify and place order'}));
  await screen.findByRole('heading',{name:'Your orders'});
  assert.deepEqual(requests,['join','order']);
 }finally{
  Reflect.deleteProperty(dialog,'showModal');
  Reflect.deleteProperty(dialog,'close');
 }
});

test('restaurant table grid filters by section and shows controls only for the selected table',async()=>{
 const patio={...table,id:sid,label:'Table 2',section:'Terrace'};
 globalThis.fetch=async()=>json({...board,items:[table,patio]});
 mountBoard();
 const user=userEvent.setup();
 await user.click(await screen.findByRole('button',{name:'Terrace'}));
 assert.equal(screen.queryByRole('button',{name:/Table 1, Garden/}),null);
 assert.equal(screen.getByRole('button',{name:/Table 2, Terrace, Available/}).getAttribute('aria-pressed'),'true');
 assert.ok(screen.getByRole('heading',{name:'Table 2'}));
 assert.equal(screen.queryByRole('heading',{name:'Table 1'}),null);
});

test('cashier queue shows the POS summary and sends explicit settlement confirmation',async()=>{
 const active={...table,session:{...session,billRequestedAt:stamp,orders:[{
  id,status:'SERVED',estimatedTotalMinor:12550,items:[{nameSnapshot:'Paneer',quantity:2,portionNameSnapshot:null}],
 }]}};
 let payload:unknown;
 globalThis.fetch=async(_path,options={})=>{
  if(options.method==='POST'){
   payload=JSON.parse(String(options.body));
   return json({board:{...board,canSettle:true,items:[table]}});
  }
  return json({...board,canSettle:true,items:[active]});
 };
 render(createElement(TableBoardView,{tenantId:id,branchId:id,csrf:'staff-csrf',kind:'staff',view:'billing'}));
 const user=userEvent.setup();
 await screen.findByText('2 × Paneer');
 await user.type(screen.getByLabelText('POS invoice reference'),'POS-018');
 await user.selectOptions(screen.getByLabelText('Payment method'),'UPI');
 await user.click(screen.getByLabelText('I confirmed payment in the POS.'));
 await user.click(screen.getByRole('button',{name:'Confirm payment and release table'}));
 await screen.findByText(/Payment confirmed in the POS/);
 assert.deepEqual(payload,{sessionId:sid,version:1,externalBillReference:'POS-018',paymentMethod:'UPI',confirmed:true});
});

test('staff assistance view lists only tables waiting for help and clears the selected request',async()=>{
 const waiting={...table,session:{...session,assistanceRequestedAt:stamp}};
 const idle={...table,id:sid,label:'Idle table'};
 const queue={...board,canManage:false,canOpen:true,items:[waiting,idle]};
 let resolved=false;
 globalThis.fetch=async(path,options={})=>{
  if(options.method==='POST'){
   assert.match(String(path),/\/assistance\/resolve\?/);
   assert.deepEqual(JSON.parse(String(options.body)),{version:session.version});
   resolved=true;
   return json({board:{...queue,items:[table,idle]}});
  }
  return json(queue);
 };
 render(createElement(TableBoardView,{tenantId:id,branchId:id,csrf:'staff-csrf',kind:'staff',view:'assistance'}));
 const clear=await screen.findByRole('button',{name:'Clear request'});
 assert.equal(screen.queryByRole('button',{name:/Idle table/}),null);
 await userEvent.setup().click(clear);
 await screen.findByText('No tables are waiting for assistance.');
 assert.equal(resolved,true);
});

test('guest bill confirmation is deliberate and switches to a translated receipt',async()=>{
 const {OrderTracker}=await import('../src/features/tables/order-tracker');
 let requests=0;
 let finishRefresh:(value:Response)=>void=()=>{};
 const pendingRefresh=new Promise<Response>(resolve=>{finishRefresh=resolve;});
 const order={orderId:id,status:'SERVED' as const,estimatedTotalMinor:12550,createdAt:stamp};
 globalThis.fetch=async path=>{
  if(String(path).endsWith('/guest/bill')){requests++;return json({});}
  return pendingRefresh;
 };
 render(createElement(OrderTracker,{guest,receipt:order,heading:{current:null}}));
 const user=userEvent.setup();
 await user.click(screen.getByRole('button',{name:'Request bill'}));
 assert.ok(screen.getByText('Request the final bill for this table?'));
 assert.equal(requests,0);
 await user.click(screen.getByRole('button',{name:'Keep ordering'}));
 assert.equal(requests,0);
 await user.click(screen.getByRole('button',{name:'Request bill'}));
 await user.click(screen.getByRole('button',{name:'Request bill'}));
 assert.equal(requests,1);
 await screen.findByText('Bill requested');
 finishRefresh(json({orders:[order],billRequestedAt:null}));
 await screen.findByText('Updates automatically while this page is open.');
 assert.ok(screen.getByText('Bill requested'));
 await user.click(screen.getByRole('button',{name:'हिन्दी'}));
 assert.ok(screen.getByRole('heading',{name:'आपके ऑर्डर'}));
 assert.ok(screen.getByText('बिल माँगा गया'));
});

test('Hindi announcements require opt-in, use the selected voice and suppress duplicate events',async()=>{
 const {useServiceSound}=await import('../src/features/announcements/sound');
 const {act}=await import('@testing-library/react');
 class Utterance {
  constructor(readonly text:string){}
  voice?:{voiceURI:string};
 }
 const spoken:Utterance[]=[];
 const speaker=Object.assign(new dom.window.EventTarget(),{
  getVoices:()=>[{name:'English',lang:'en-IN',voiceURI:'en'},{name:'Hindi one',lang:'hi-IN',voiceURI:'hi1'},{name:'Hindi two',lang:'hi-IN',voiceURI:'hi2'}],
  speak:(utterance:Utterance)=>spoken.push(utterance),cancel:()=>{},
 });
 Object.defineProperty(dom.window,'speechSynthesis',{value:speaker,configurable:true});
 Object.defineProperty(globalThis,'SpeechSynthesisUtterance',{value:Utterance,configurable:true});
 let receive:(event:unknown)=>void=()=>{};
 function Probe(){
  const sound=useServiceSound();
  receive=sound.receive;
  return sound.controls;
 }
 const event={id:'ready:1',text:'टेबल पाँच का ऑर्डर तैयार है।'};
 try{
  render(createElement(Probe));
  const user=userEvent.setup();
  act(()=>receive(event));
  assert.equal(spoken.length,0);
  assert.equal(screen.queryByRole('option',{name:'English'}),null);
  await user.selectOptions(screen.getByLabelText('Hindi voice'),'hi2');
  await user.click(screen.getByRole('button',{name:'Enable sound'}));
  act(()=>{receive(event);receive(event);});
  assert.deepEqual(spoken.map(item=>[item.text,item.voice?.voiceURI]),[['आवाज़ चालू है।','hi2'],[event.text,'hi2']]);
  await user.click(screen.getByRole('button',{name:'Mute announcements'}));
  act(()=>receive({...event,id:'ready:2'}));
  assert.equal(spoken.length,2);
 }finally{
  cleanup();
  Reflect.deleteProperty(dom.window,'speechSynthesis');
  Reflect.deleteProperty(globalThis,'SpeechSynthesisUtterance');
 }
});

test('PIN-free checkout collects guest details and sends the first order to the waiter',async()=>{
 const dialog=dom.window.HTMLDialogElement.prototype;
 dialog.showModal=function(){this.setAttribute('open','');};
 dialog.close=function(){this.removeAttribute('open');};
 dom.window.history.replaceState(null,'','/q#'+token);
 const calls:string[]=[];
 globalThis.fetch=async(path,options={})=>{
  const url=String(path);
  if(url.endsWith('/lookup'))return json({...context,waiterConfirmation:true,deferredVerification:true,session:null});
  if(url.endsWith('/guest/session'))return json({},401);
  if(url.endsWith('/table-entry/request')){
   const body=JSON.parse(String(options.body));
   assert.equal(body.pin,undefined);
   assert.equal(body.sessionId,undefined);
   assert.equal(body.displayName,'Synthetic guest');
   calls.push('request');
   return json({...guest,orderingEnabled:true,awaitingWaiter:true});
  }
  if(url.endsWith('/guest/orders')){calls.push('order');return json({orderId:id,status:'AWAITING_REVIEW',estimatedTotalMinor:12550,createdAt:stamp},201);}
  if(url.endsWith('/guest/order-status'))return json({orders:[{orderId:id,status:'AWAITING_REVIEW',estimatedTotalMinor:12550,createdAt:stamp}],billRequestedAt:null});
  throw Error('Unexpected URL '+url);
 };
 try{
  render(createElement(GuestEntry));
  const user=userEvent.setup();
  await user.click(await screen.findByRole('button',{name:'Customize Synthetic meal'}));
  await user.click(screen.getByRole('button',{name:/Add to cart/}));
  await user.click(screen.getByRole('button',{name:'Place order'}));
  assert.ok(screen.getByRole('dialog',{name:'Confirm your order'}));
  assert.equal(screen.queryByLabelText('Six-digit code from your waiter'),null);
  await user.type(screen.getByLabelText('Your name'),'Synthetic guest');
  await user.type(screen.getByLabelText('Mobile number'),'+919999999999');
  await user.click(screen.getByRole('checkbox'));
  await user.click(screen.getByRole('button',{name:'Send to waiter'}));
  await screen.findByRole('heading',{name:'Waiting for waiter confirmation'});
  await screen.findByRole('heading',{name:'Your orders'});
  assert.deepEqual(calls,['request','order']);
 }finally{Reflect.deleteProperty(dialog,'showModal');Reflect.deleteProperty(dialog,'close');}
});
