import {test,afterEach,after} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {createElement} from 'react';
const dom=new JSDOM('<!doctype html><html><body></body></html>',{url:'http://localhost:3000'});
for(const [key,value] of Object.entries({window:dom.window,self:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,FormData:dom.window.FormData,getComputedStyle:dom.window.getComputedStyle,IS_REACT_ACT_ENVIRONMENT:true}))Object.defineProperty(globalThis,key,{value,writable:true,configurable:true});
const {render,screen,cleanup,waitFor}=await import('@testing-library/react');
const userEvent=(await import('@testing-library/user-event')).default;
const Home=(await import('../src/app/page')).default;
const {PublicFrame}=await import('../src/components/public-frame');
const {SignIn}=await import('../src/features/access/auth');
const original=globalThis.fetch;
afterEach(()=>{cleanup();globalThis.fetch=original;});after(()=>dom.window.close());
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
test('public entry links to a dedicated sign-in and provides FAQ and policy navigation',()=>{
 globalThis.fetch=async()=>{throw Error('Public page must not contact the API');};
 render(createElement(PublicFrame,{children:createElement(Home)}));
 assert.equal(screen.getByRole('link',{name:'Log in'}).getAttribute('href'),'/sign-in');
 assert.equal(screen.getByRole('link',{name:'Terms & Conditions'}).getAttribute('href'),'/terms');
 assert.equal(screen.getByRole('link',{name:'Privacy Policy'}).getAttribute('href'),'/privacy');
 assert.ok(screen.getByRole('heading',{name:'Frequently asked questions'}));
 assert.equal(screen.queryByText('DEVELOPMENT WORKSPACE'),null);
});
test('sign-in exposes all three role entries and marks the current one',()=>{
 render(createElement(SignIn,{portal:'staff'}));
 for(const [label,portal] of [['Platform Admin','platform'],['Restaurant Admin','restaurant'],['Staff login','staff']] as const){
  assert.equal(screen.getByRole('link',{name:label}).getAttribute('href'),'/sign-in?portal='+portal);
 }
 assert.equal(screen.getByRole('link',{name:'Staff login'}).getAttribute('aria-current'),'page');
});
test('illustrative menu filters change local examples and remain labelled rather than placing orders',async()=>{let requests=0;globalThis.fetch=async()=>{requests++;throw Error('No public menu API');};render(createElement(Home));const user=userEvent.setup();await user.click(screen.getByRole('button',{name:'From the kitchen'}));assert.ok(screen.getByRole('heading',{name:'Dal tadka'}));assert.equal(screen.queryByRole('heading',{name:'Paneer tikka'}),null);assert.equal(screen.getByRole('button',{name:'From the kitchen'}).getAttribute('aria-pressed'),'true');assert.ok(screen.getByText(/Illustrative menu/));assert.equal(requests,0);});
test('visibility toggle keeps the password value and changes the accessible button name',async()=>{render(createElement(SignIn,{portal:'restaurant'}));const user=userEvent.setup();const password=screen.getByLabelText('Password') as HTMLInputElement;await user.type(password,'Synthetic value');assert.equal(password.type,'password');await user.click(screen.getByRole('button',{name:'Show password'}));assert.equal(password.type,'text');assert.equal(password.value,'Synthetic value');await user.click(screen.getByRole('button',{name:'Hide password'}));assert.equal(password.type,'password');});
test('failed authentication retains email, focuses the error and releases the busy form',async()=>{globalThis.fetch=async()=>json({error:{message:'Email or password is incorrect.'}},401);render(createElement(SignIn,{portal:'restaurant'}));const user=userEvent.setup();await user.type(screen.getByLabelText('Email address'),'synthetic@synthetic.test');await user.type(screen.getByLabelText('Password'),'Synthetic password');await user.click(screen.getByRole('button',{name:'Sign in'}));const alert=await screen.findByRole('alert');await waitFor(()=>assert.equal(document.activeElement,alert));assert.equal((screen.getByLabelText('Email address') as HTMLInputElement).value,'synthetic@synthetic.test');assert.equal((screen.getByRole('button',{name:'Sign in'}) as HTMLButtonElement).disabled,false);});

test('pricing switches between monthly rates and yearly totals without changing the application link', async () => {
 render(createElement(Home));
 const user = userEvent.setup();
 for (const price of ['₹999', '₹1,499', '₹1,999']) assert.ok(screen.getByText(price));
 await user.click(screen.getByRole('radio', {name: /Annually/}));
 for (const price of ['₹799', '₹1,299', '₹1,799']) assert.ok(screen.getByText(price));
 for (const total of ['₹9,588', '₹15,588', '₹21,588']) assert.ok(screen.getByText(total + ' billed yearly'));
 assert.equal(screen.getByRole('link', {name: 'Apply for restaurant access'}).getAttribute('href'), '/register');
 await user.click(screen.getByRole('radio', {name: 'Monthly'}));
 assert.ok(screen.getByText('₹999'));
});

test('public menu can be opened and dismissed with Escape, returning focus to its button', async () => {
 render(createElement(PublicFrame, {children: createElement('h1', null, 'RestroDock')}));
 const user = userEvent.setup();
 const toggle = screen.getByRole('button', {name: 'Menu'});
 await user.click(toggle);
 assert.equal(toggle.getAttribute('aria-expanded'), 'true');
 const nav = screen.getByRole('navigation', {name: 'Public navigation'});
 assert.equal(nav.id, toggle.getAttribute('aria-controls'));
 const login = screen.getByRole('link', {name: 'Log in'});
 login.focus();
 await user.keyboard('{Escape}');
 assert.equal(toggle.getAttribute('aria-expanded'), 'false');
 assert.equal(document.activeElement, toggle);
});

test('QR entries use a guest frame with privacy and a focusable content target', () => {
 render(createElement(PublicFrame, {guest: true, children: createElement('h1', null, 'Your table entry')}));
 assert.equal(screen.queryByRole('navigation', {name: 'Public navigation'}), null);
 assert.equal(screen.getByRole('link', {name: 'Privacy Policy'}).getAttribute('href'), '/privacy');
 assert.equal(screen.getByRole('main').tabIndex, -1);
});
test('admin form sends its portal and shows the server denial without navigating',async()=>{
 let target='', body:Record<string,unknown>={};
 globalThis.fetch=async(_path,options)=>{
  body=JSON.parse(String(options?.body));
  return json({error:{message:'This account cannot sign in to the selected portal.'}},403);
 };
 render(createElement(SignIn,{portal:'platform',navigate:path=>{target=path;}}));
 const user=userEvent.setup();
 await user.type(screen.getByLabelText('Email address'),'worker@synthetic.test');
 await user.type(screen.getByLabelText('Password'),'Synthetic password only');
 await user.click(screen.getByRole('button',{name:'Sign in'}));
 await screen.findByRole('alert');
 assert.equal(body.portal,'platform');
 assert.equal(target,'');
});
