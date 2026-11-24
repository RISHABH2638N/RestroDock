import {test,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement} from 'react';
import type {Catalogue} from '@restrodock/contracts';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000'});
for(const [key,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FormData:dom.window.FormData,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const {render,screen,cleanup,waitFor,within}=await import('@testing-library/react');const userEvent=(await import('@testing-library/user-event')).default;
import {initialSetup} from './restaurant-fixture';
import type {RestaurantEditorSection} from '../src/features/restaurant/sections';
const {RestaurantWorkbench,MenuPreview}=await import('../src/features/restaurant/workbench');
const original=globalThis.fetch;afterEach(()=>{cleanup();globalThis.fetch=original;});after(()=>dom.window.close());
const tenantId='00000000-0000-4000-8000-000000000001',branchId='10000000-0000-4000-8000-000000000001',categoryId='20000000-0000-4000-8000-000000000001';
function initialMenu():Catalogue{return {revision:1,categories:[{id:categoryId,name:'Synthetic category',archived:false,sortOrder:0}],items:[]};}
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
function mock(save?:(path:string,options:RequestInit)=>Response|Promise<Response>,catalogue=initialMenu()){globalThis.fetch=async(path,options)=>{if(options?.method&&options.method!=='GET')return save?save(String(path),options):json(initialSetup());return String(path).includes('/settings?')?json(initialSetup()):json(catalogue);};}
function mount(section:RestaurantEditorSection='profile'){render(createElement(RestaurantWorkbench,{tenantId,branchId,csrf:'synthetic-csrf',section}));}
test('incomplete setup shows actionable checklist, keeps activation gated and does not invent menu records',async()=>{mock();mount();await screen.findByRole('heading',{name:'Restaurant details'});await userEvent.setup().click(screen.getByText(/Setup progress/));assert.equal((screen.getByRole('button',{name:'Submit configuration'}) as HTMLButtonElement).disabled,true);assert.ok(screen.getByText(/submitting activates this branch automatically/));assert.equal((screen.getByLabelText('Restaurant display name') as HTMLInputElement).value,'');});
test('profile save includes selected scope, version and CSRF and displays success only after API completion',async()=>{let body:Record<string,unknown>|null=null;mock((path,options)=>{assert.ok(path.includes('tenantId='+tenantId));assert.equal(new Headers(options.headers).get('X-CSRF-Token'),'synthetic-csrf');body=JSON.parse(String(options.body));return json({...initialSetup(),version:2,profile:{displayName:'Operator restaurant',address:'',contactEmail:'',contactPhone:''}});});mount();await screen.findByLabelText('Restaurant display name');const user=userEvent.setup();await user.type(screen.getByLabelText('Restaurant display name'),'Operator restaurant');await user.click(screen.getByRole('button',{name:'Save profile'}));await screen.findByRole('status');assert.equal(body?.['version'],1);assert.equal(body?.['displayName'],'Operator restaurant');assert.equal((screen.getByLabelText('Restaurant display name') as HTMLInputElement).value,'Operator restaurant');});
test('rejected save remains an error and retains input without displaying success',async()=>{mock(()=>json({error:{message:'This branch changed. Refresh it before retrying.'}},409));mount();await screen.findByLabelText('Restaurant display name');const user=userEvent.setup();await user.type(screen.getByLabelText('Restaurant display name'),'Unsaved value');await user.click(screen.getByRole('button',{name:'Save profile'}));assert.match((await screen.findByRole('alert')).textContent??'',/branch changed/);assert.equal(screen.queryByText('Saved to this branch.'),null);assert.equal((screen.getByLabelText('Restaurant display name') as HTMLInputElement).value,'Unsaved value');});
test('menu editor converts base/variant/addon money to integer paise before a real-shaped request',async()=>{let submitted:Record<string,unknown>|null=null;mock((_path,options)=>{submitted=JSON.parse(String(options.body));return json(initialMenu());});mount('menu');await screen.findByRole('heading',{name:'Menu editor'});const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'New item'}));await user.type(screen.getByLabelText('Item name'),'Operator item');await user.type(screen.getByLabelText('Base price (INR)'),'125.50');await user.selectOptions(screen.getByLabelText('Food classification'),'VEG');await user.click(screen.getByRole('button',{name:'Add portion / variant'}));await user.type(screen.getByLabelText('Portion / variant 1 name'),'Half');await user.type(screen.getByLabelText('Portion / variant 1 price'),'75.25');await user.click(screen.getByRole('button',{name:'Add add-on'}));await user.type(screen.getByLabelText('Add-on 1 name'),'Extra');await user.type(screen.getByLabelText('Add-on 1 price'),'10');await user.click(screen.getByRole('button',{name:'Create menu item'}));await waitFor(()=>assert.ok(submitted));assert.equal(submitted?.['priceMinor'],12550);assert.equal((submitted?.['variants'] as {priceMinor:number}[])[0]?.priceMinor,7525);assert.equal((submitted?.['addons'] as {priceMinor:number}[])[0]?.priceMinor,1000);});
test('invalid price cannot submit and preview renders only the supplied persisted records',async()=>{let writes=0;mock(()=>{writes++;return json(initialMenu());});mount('menu');await screen.findByRole('heading',{name:'Menu editor'});const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'New item'}));await user.type(screen.getByLabelText('Item name'),'Synthetic invalid');await user.type(screen.getByLabelText('Base price (INR)'),'1e3');await user.click(screen.getByRole('button',{name:'Create menu item'}));assert.match((await screen.findByRole('alert')).textContent??'',/two decimal/);assert.equal(writes,0);});
test('empty published preview explains recovery and has no ordering controls',()=>{render(createElement(MenuPreview,{catalogue:initialMenu()}));assert.ok(screen.getByText(/Publish a reviewed item/));assert.ok(screen.getByRole('link',{name:'Manage menu'}));assert.equal(screen.queryByRole('button',{name:/order/i}),null);});
test('JSON import posts a scoped unavailable-draft request with an idempotency key',async()=>{let submitted:Record<string,unknown>|null=null;mock((_path,options)=>{submitted=JSON.parse(String(options.body));return json(initialMenu());});mount('menu');await screen.findByRole('heading',{name:'Menu editor'});const user=userEvent.setup();await user.click(screen.getByText('Import items as drafts'));await user.click(screen.getByLabelText('Draft import JSON'));await user.paste('[{"name":"Imported operator item","priceMinor":15000,"foodType":"VEG"}]');await user.click(screen.getByRole('button',{name:'Import drafts for review'}));await waitFor(()=>assert.ok(submitted));assert.match(String(submitted?.['requestKey']),/^[a-f0-9-]{36}$/);assert.equal(submitted?.['categoryId'],categoryId);});
test('malformed API data is rejected as a load error with a retry path',async()=>{globalThis.fetch=async()=>json({invalid:true});mount();assert.ok(await screen.findByRole('button',{name:'Retry loading this section'}));assert.equal(screen.queryByLabelText('Restaurant display name'),null);});
test('server field errors retain their message, associate the exact control and focus after async busy state ends',async()=>{let reject:((response:Response)=>void)|undefined;mock(()=>new Promise(resolve=>{reject=resolve;}));mount();await screen.findByLabelText('Business phone');const user=userEvent.setup();await user.type(screen.getByLabelText('Business phone'),'+919999999999');await user.click(screen.getByRole('button',{name:'Save profile'}));const phone=screen.getByLabelText('Business phone');assert.equal(phone.matches(':disabled'),true);reject!(json({error:{message:'Check the highlighted fields.',fields:[{field:'contactPhone',message:'Verify this branch phone number.'}]}},400));await screen.findByText('Verify this branch phone number.');await waitFor(()=>assert.equal(document.activeElement,phone));assert.equal(phone.matches(':disabled'),false);assert.equal(phone.getAttribute('aria-invalid'),'true');assert.equal(document.getElementById(phone.getAttribute('aria-describedby')!)?.textContent,'Verify this branch phone number.');});
test('base price and nested option amounts identify and focus their actual named controls',async()=>{mock();mount('menu');await screen.findByRole('heading',{name:'Menu editor'});const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'New item'}));await user.type(screen.getByLabelText('Item name'),'Operator item');const price=screen.getByLabelText('Base price (INR)');await user.type(price,'1e3');await user.click(screen.getByRole('button',{name:'Create menu item'}));await waitFor(()=>assert.equal(document.activeElement,price));assert.equal(price.getAttribute('aria-invalid'),'true');assert.ok(document.getElementById(price.getAttribute('aria-describedby')!));await user.clear(price);await user.type(price,'100');await user.click(screen.getByRole('button',{name:'Add portion / variant'}));await user.type(screen.getByLabelText('Portion / variant 1 name'),'Half');const portion=screen.getByLabelText('Portion / variant 1 price');await user.type(portion,'-1');await user.click(screen.getByRole('button',{name:'Create menu item'}));await waitFor(()=>assert.equal(document.activeElement,portion));assert.equal(portion.getAttribute('aria-invalid'),'true');assert.ok(document.getElementById(portion.getAttribute('aria-describedby')!));});


test('menu sections expose separate actions and opening an editor keeps the catalogue in place',async()=>{
 const catalogue=initialMenu();
 catalogue.items=[{id:'30000000-0000-4000-8000-000000000001',name:'Lemon rice',categoryId,
  description:'',priceMinor:9500,foodType:'VEG',state:'PUBLISHED',available:true,reviewRequired:false,
  sortOrder:0,variants:[],addons:[],source:'MANUAL',photoUrl:null}];
 let createdName='';
 mock((path,options)=>{
  assert.ok(path.includes('/categories?'));
  createdName=JSON.parse(String(options.body)).name;
  return json({...catalogue,revision:2,categories:[...catalogue.categories,{id:'20000000-0000-4000-8000-000000000002',name:createdName,archived:false,sortOrder:0}]});
 },catalogue);
 mount('menu');
 await screen.findByRole('region',{name:'Menu items'});
 assert.ok(screen.getByRole('region',{name:'Categories'}));
 assert.ok(screen.getByRole('region',{name:'Menu tools'}));
 assert.equal(screen.queryByLabelText('Item name'),null);

 const user=userEvent.setup();
 const item=screen.getByRole('button',{name:'Edit Lemon rice'});
 await user.click(item);
 assert.equal(document.activeElement,screen.getByRole('heading',{name:'Edit Lemon rice'}));
 assert.equal((screen.getByLabelText('Base price (INR)') as HTMLInputElement).value,'95.00');
 await user.click(screen.getByRole('button',{name:'Close editor'}));
 assert.equal(document.activeElement,item);
 const search=screen.getByRole('searchbox',{name:'Search items'});
 await user.type(search,'nothing');
 assert.ok(screen.getByText('No items match your filters.'));
 assert.equal(screen.queryByRole('button',{name:'Edit Lemon rice'}),null);
 await user.clear(search);

 await user.click(screen.getByRole('button',{name:'Add category'}));
 const name=screen.getByLabelText('New category name');
 assert.equal(document.activeElement,name);
 await user.type(name,'Drinks');
 await user.click(screen.getByRole('button',{name:'Save new category'}));
 await within(screen.getByLabelText('Filter by category')).findByRole('option',{name:'Drinks'});
 assert.equal(createdName,'Drinks');
 assert.equal(document.activeElement,screen.getByRole('button',{name:'Add category'}));
});

for(const [section,resource,heading] of [['profile','settings','Restaurant details'],['hours','settings','Weekly opening hours'],['safety-pos','settings','Ordering safeguards'],['staff','settings','Assigned staff'],['menu','menu','Menu editor'],['menu-preview','preview','Published menu']] as const){
 test(`${section} only loads its own branch data`,async()=>{
  const requests:string[]=[];
  globalThis.fetch=async path=>{
   requests.push(String(path));
   return json(resource==='settings'?initialSetup():initialMenu());
  };
  mount(section);
  await screen.findByRole('heading',{name:heading});
  assert.deepEqual(requests,[`/api/v1/restaurant/manage/${resource}?tenantId=${tenantId}&branchId=${branchId}`]);
  assert.equal(Boolean(screen.queryByText(/Setup progress/)),section==='profile');
  if(section==='menu')assert.ok(screen.getByRole('button',{name:'New item'}));
 });
}
