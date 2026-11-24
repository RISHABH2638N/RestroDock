import {verifyService} from './service-e2e.mjs';
import {io} from 'socket.io-client';
import {once} from 'node:events';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import sharp from 'sharp';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
const root=fileURLToPath(new URL('../',import.meta.url)),npm=process.env.npm_execpath;
if(!npm)throw new Error('Run npm run test:startup.');
async function freePort(){const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();const port=address.port;await new Promise(resolve=>server.close(resolve));return port;}
const engine=await PGlite.create(),wire=new PGLiteSocketServer({db:engine,host:'127.0.0.1',port:0,maxConnections:8});await wire.start();
const apiPort=await freePort(),webPort=await freePort(),url=`postgresql://postgres:synthetic-startup-only@${wire.getServerConn()}/postgres?sslmode=disable`;
const origin=`http://127.0.0.1:${webPort}`,email='startup@synthetic.test',password='Synthetic startup passphrase 2026';
const environment={...process.env,GUEST_PII_KEY:'53'.repeat(32),NODE_ENV:'development',HOST:'127.0.0.1',PORT:String(apiPort),CLIENT_ORIGIN:origin,DATABASE_URL:url,DIRECT_URL:url,DATABASE_URL_POOLED:'',DATABASE_URL_UNPOOLED:'',NEON_REALTIME_SECRET:'',ALLOW_DEMO_SEED:'false',CHECKOUT_PILOT_ENABLED:'false',BOOTSTRAP_ADMIN_EMAIL:email,BOOTSTRAP_ADMIN_PASSWORD:password,API_PROXY_URL:`http://127.0.0.1:${apiPort}`,NEXT_PUBLIC_API_URL:'',NEXT_TELEMETRY_DISABLED:'1'};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
let child,exited=false;
async function start(){exited=false;child=spawn(process.execPath,[npm,'run','dev','--','--hostname','127.0.0.1','--port',String(webPort)],{cwd:root,env:environment,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});child.on('exit',()=>{exited=true;});for(const stream of [child.stdout,child.stderr])stream.on('data',()=>{});
 for(let attempt=0;attempt<240;attempt++){if(exited)throw new Error('Development startup exited before readiness. Run predev locally for controlled diagnostics.');try{const response=await fetch(origin+'/api/ready',{signal:AbortSignal.timeout(1500)});if(response.status===200){assert.equal((await response.json()).schema,'current');return;}}catch{/* Both processes and first Next compilation must become ready. */}await pause(250);}throw new Error('Development startup timed out.');}
async function stop(){if(!child?.pid)return;if(process.platform==='win32'){await new Promise(resolve=>spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'}).once('exit',resolve));}else{try{process.kill(-child.pid,'SIGTERM');}catch{/* Already stopped. */}}for(let i=0;i<20&&!exited;i++)await pause(100);if(!exited&&process.platform!=='win32'){try{process.kill(-child.pid,'SIGKILL');}catch{/* Already stopped. */}}}
try{
 await start();console.log('PASS npm run dev automatically applies migrations and serves Next/Express readiness without setup/generate/deploy commands');
 const boot=await engine.query('SELECT "passwordHash" FROM "User" WHERE email=$1',[email]);assert.equal(boot.rows.length,1);const originalHash=boot.rows[0].passwordHash;assert.ok(!String(originalHash).includes(password));console.log('PASS development first-admin bootstrap creates one hashed private operator');
 const login=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email,password,portal:'platform'})});assert.equal(login.status,200);const cookie=login.headers.getSetCookie()[0].split(';')[0],loginBody=await login.json();assert.ok(cookie.includes('restrodock_session='));console.log('PASS runtime Next proxy preserves HttpOnly session cookie on real login');
 const me=await fetch(origin+'/api/v1/auth/me',{headers:{Cookie:cookie}});assert.equal(me.status,200);assert.equal((await me.json()).platformAdmin,true);console.log('PASS session cookie authenticates a subsequent frontend-to-API request');
 const publicHeaders={Origin:origin,'Content-Type':'application/json'},platformHeaders={...publicHeaders,Cookie:cookie,'X-CSRF-Token':loginBody.csrfToken};
 const application={restaurantName:'Synthetic startup application',branchName:'Main',ownerName:'Synthetic owner',email:'registered-owner@synthetic.test',phone:'+919999999999',city:'Synthetic city',address:'Synthetic address',password,ownerAuthorised:true,trackingSecret:randomBytes(32).toString('base64url')};
 const applied=await fetch(origin+'/api/v1/registrations',{method:'POST',headers:publicHeaders,body:JSON.stringify(application)});assert.equal(applied.status,201);const applicationResult=await applied.json();
 const reviewed=await fetch(origin+`/api/v1/super-admin/registrations/${applicationResult.id}/decision`,{method:'POST',headers:platformHeaders,body:JSON.stringify({decision:'APPROVE',version:1,slug:'synthetic-registered-startup',planCode:'TRIAL',ownershipConfirmed:true})});assert.equal(reviewed.status,200);assert.equal((await reviewed.json()).status,'APPROVED');
 const tracking=await fetch(origin+'/api/v1/registrations/status',{method:'POST',headers:publicHeaders,body:JSON.stringify({trackingSecret:application.trackingSecret})});assert.equal(tracking.status,200);assert.equal((await tracking.json()).loginReady,true);
 const registeredLogin=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:publicHeaders,body:JSON.stringify({email:application.email,password,portal:'restaurant'})});assert.equal(registeredLogin.status,200);const registeredCookie=registeredLogin.headers.getSetCookie()[0].split(';')[0];const registeredIdentity=await (await fetch(origin+'/api/v1/auth/me',{headers:{Cookie:registeredCookie}})).json();assert.equal(registeredIdentity.platformAdmin,false);assert.equal(registeredIdentity.memberships[0].role,'RESTAURANT_ADMIN');assert.equal(registeredIdentity.memberships[0].tenant.status,'DRAFT');console.log('PASS public registration, atomic platform approval, private tracking and assigned administrator login work through the real Next proxy');
 const rejectedApplication={...application,email:'rejected-startup@synthetic.test',trackingSecret:randomBytes(32).toString('base64url')};const pendingRejection=await (await fetch(origin+'/api/v1/registrations',{method:'POST',headers:publicHeaders,body:JSON.stringify(rejectedApplication)})).json();const rejected=await fetch(origin+`/api/v1/super-admin/registrations/${pendingRejection.id}/decision`,{method:'POST',headers:platformHeaders,body:JSON.stringify({decision:'REJECT',version:1,reason:'Please confirm the restaurant contact.'})});assert.equal(rejected.status,200);const rejectionStatus=await (await fetch(origin+'/api/v1/registrations/status',{method:'POST',headers:publicHeaders,body:JSON.stringify({trackingSecret:rejectedApplication.trackingSecret})})).json();assert.equal(rejectionStatus.status,'REJECTED');assert.equal((await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:publicHeaders,body:JSON.stringify({email:rejectedApplication.email,password,portal:'restaurant'})})).status,401);console.log('PASS rejected registration shares its saved reason and cannot authenticate an account');
 const tenant=await fetch(origin+'/api/v1/super-admin/tenants',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':loginBody.csrfToken},body:JSON.stringify({name:'Synthetic startup restaurant',slug:'synthetic-startup-restaurant',branchName:'Synthetic branch',adminEmail:'owner@synthetic.test',planCode:'TRIAL'})});assert.equal(tenant.status,201);const created=await tenant.json();assert.equal(created.tenant.status,'DRAFT');console.log('PASS authenticated CSRF-protected tenant provisioning through both real processes');
 const accepted=await fetch(origin+'/api/v1/auth/invitations/accept',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({token:created.invitation.token,password})});assert.equal(accepted.status,200);
 const ownerLogin=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({email:'owner@synthetic.test',password,portal:'restaurant'})});assert.equal(ownerLogin.status,200);const ownerCookie=ownerLogin.headers.getSetCookie()[0].split(';')[0],ownerIdentity=await ownerLogin.json();
 const scoped=`tenantId=${created.tenant.id}&branchId=${created.tenant.branches[0].id}`,management=origin+'/api/v1/restaurant/manage';
 const ownerHeaders={Origin:origin,Cookie:ownerCookie,'Content-Type':'application/json','X-CSRF-Token':ownerIdentity.csrfToken};
 const settingsResponse=await fetch(management+'/settings?'+scoped,{headers:{Cookie:ownerCookie}});assert.equal(settingsResponse.status,200);let settings=await settingsResponse.json();assert.equal(settings.configurationReady,false);console.log('PASS invitation acceptance and owner sign-in reach only the assigned draft setup through the real proxy');
 const saveSetup=async(path,body)=>{const response=await fetch(management+path+'?'+scoped,{method:path==='/submit'?'POST':'PUT',headers:ownerHeaders,body:JSON.stringify(body)});assert.equal(response.status,200,await response.clone().text());return response.json();};
 settings=await saveSetup('/profile',{version:settings.version,displayName:'Synthetic startup restaurant',branchName:'Synthetic branch',address:'Synthetic startup address',contactEmail:'owner@synthetic.test',contactPhone:'+919999999999',timezone:'Asia/Kolkata'});
 settings=await saveSetup('/hours',{version:settings.version,hours:Array.from({length:7},(_,day)=>({day,closed:day!==1,opens:'09:00',closes:'22:00',closesNextDay:false}))});
 settings=await saveSetup('/safety',{version:settings.version,maxItemQuantity:10,maxOrderQuantity:30,maxOrderValueMinor:500000,approvalQuantity:1,approvalValueMinor:null,pinExpiryMinutes:15,acknowledged:true});
 settings=await saveSetup('/pos',{version:settings.version,billingMode:'EXTERNAL_POS_MANUAL',kitchenSource:'RESTRODOCK',posName:'Synthetic POS',posInstructions:'Cashier records the final bill in the restaurant POS.',acknowledged:true});
 for(const role of ['CHEF','WORKER','CASHIER']){const invite=await fetch(origin+'/api/v1/restaurant/invitations',{method:'POST',headers:ownerHeaders,body:JSON.stringify({tenantId:created.tenant.id,branchId:created.tenant.branches[0].id,email:`${role.toLowerCase()}-setup@synthetic.test`,role})});assert.equal(invite.status,201,await invite.clone().text());const inviteLink=(await invite.json()).link,token=new URL(inviteLink).hash.slice(1);assert.equal((await fetch(origin+'/api/v1/auth/invitations/accept',{method:'POST',headers:publicHeaders,body:JSON.stringify({token,password})})).status,200);}
 settings=await (await fetch(management+'/settings?'+scoped,{headers:{Cookie:ownerCookie}})).json();assert.equal(settings.configurationReady,true);const submitted=await saveSetup('/submit',{version:settings.version});settings=submitted;assert.equal(submitted.branch.active,true);assert.equal(submitted.branch.orderingPaused,true);const activeIdentity=await (await fetch(origin+'/api/v1/auth/me',{headers:{Cookie:ownerCookie}})).json();assert.equal(activeIdentity.memberships[0].tenant.status,'TRIAL');const workerLogin=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:publicHeaders,body:JSON.stringify({email:'worker-setup@synthetic.test',password,portal:'staff'})});assert.equal(workerLogin.status,200);const workerCookie=workerLogin.headers.getSetCookie()[0].split(';')[0];assert.equal((await fetch(origin+'/api/v1/staff/context?'+scoped,{headers:{Cookie:workerCookie}})).status,200);console.log('PASS complete configuration submission automatically promotes the approved tenant and enables its assigned branch staff through the live proxy');
 const pixels=randomBytes(128*128*3),png=await sharp(pixels,{raw:{width:128,height:128,channels:3}}).png().toBuffer();assert.ok(png.length>16384);
 const uploaded=await fetch(management+'/logo?'+scoped+'&v='+settings.version,{method:'PUT',headers:{Origin:origin,Cookie:ownerCookie,'Content-Type':'image/png','X-CSRF-Token':ownerIdentity.csrfToken},body:png});assert.equal(uploaded.status,200);const uploadedSettings=await uploaded.json();assert.ok(uploadedSettings.logoUrl);console.log('PASS authorized binary image larger than JSON limit passes the scoped upload proxy and is persisted');
 const imageResponse=await fetch(origin+uploadedSettings.logoUrl,{headers:{Cookie:ownerCookie}});assert.equal(imageResponse.status,200);assert.match(imageResponse.headers.get('Content-Type'),/image\/webp/);const imageMeta=await sharp(Buffer.from(await imageResponse.arrayBuffer())).metadata();assert.equal(imageMeta.format,'webp');assert.equal(imageMeta.exif,undefined);assert.equal((await fetch(origin+uploadedSettings.logoUrl)).status,401);console.log('PASS sanitized WebP is retrieved through the proxy and anonymous image access is rejected');
 const tooLarge=await fetch(management+'/logo?'+scoped+'&v='+uploadedSettings.version,{method:'PUT',headers:{Origin:origin,Cookie:ownerCookie,'Content-Type':'image/png','X-CSRF-Token':ownerIdentity.csrfToken},body:Buffer.alloc(2*1024*1024+1)});assert.equal(tooLarge.status,413);
 const nonMedia=await fetch(management+'/profile?'+scoped,{method:'PUT',headers:{Origin:origin,Cookie:ownerCookie,'Content-Type':'image/png','X-CSRF-Token':ownerIdentity.csrfToken},body:png});assert.equal(nonMedia.status,413);console.log('PASS proxy bounds images at 2 MiB and retains 16 KiB for non-media routes');
 const categoryResponse=await fetch(management+'/categories?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({revision:1,name:'Synthetic smoke category',sortOrder:0,archived:false})});assert.equal(categoryResponse.status,201);const categoryData=await categoryResponse.json();
 const itemResponse=await fetch(management+'/items?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({revision:categoryData.revision,categoryId:categoryData.categories[0].id,name:'Synthetic smoke item',description:'Disposable only',priceMinor:12550,foodType:'VEG',available:true,state:'PUBLISHED',sortOrder:0,variants:[],addons:[]})});assert.equal(itemResponse.status,201);const menuItem=(await itemResponse.json()).items[0];
 const preview=await fetch(management+'/preview?'+scoped,{headers:{Cookie:ownerCookie}});assert.equal(preview.status,200);assert.equal((await preview.json()).items[0].priceMinor,12550);console.log('PASS real category/item creation and private persisted menu preview work through Next and Express');
 const tables=origin+'/api/v1/restaurant/tables';const initialBoard=await (await fetch(tables+'?'+scoped,{headers:{Cookie:ownerCookie}})).json();
 const tableCreated=await fetch(tables+'?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({revision:initialBoard.revision,label:'Synthetic table',section:'Main',seats:4})});assert.equal(tableCreated.status,201);let tableBoard=(await tableCreated.json()).board;const tableId=tableBoard.items[0].id;
 const qrResult=await fetch(tables+'/'+tableId+'/qr?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({version:tableBoard.items[0].version})});assert.equal(qrResult.status,200);const qrIssued=await qrResult.json();tableBoard=qrIssued.board;const qrToken=qrIssued.qr.url.split('#')[1];assert.ok(qrIssued.qr.pngDataUrl.startsWith('data:image/png;base64,'));console.log('PASS table and real downloadable QR are created through the proxy');
 const publication=await fetch(tables+'/publication?'+scoped,{method:'PUT',headers:ownerHeaders,body:JSON.stringify({revision:tableBoard.revision,enabled:true,confirmed:true})});assert.equal(publication.status,200);tableBoard=(await publication.json()).board;
 const opened=await fetch(tables+'/'+tableId+'/open?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({version:tableBoard.items[0].version,durationMinutes:120})});assert.equal(opened.status,200);const issued=await opened.json(),session=issued.board.items[0].session;const lookup=await fetch(origin+'/api/v1/table-entry/lookup',{method:'POST',headers:publicHeaders,body:JSON.stringify({qrToken})});assert.equal(lookup.status,200);assert.equal((await lookup.json()).items[0].name,'Synthetic smoke item');console.log('PASS published QR resolves correct menu and a staff-opened session');
 const joined=await fetch(origin+'/api/v1/table-entry/join',{method:'POST',headers:publicHeaders,body:JSON.stringify({qrToken,sessionId:session.id,pinVersion:session.pinVersion,pin:issued.pin,displayName:'Synthetic startup guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomBytes(32).toString('base64url')})});assert.equal(joined.status,200);assert.equal((await joined.json()).orderingEnabled,false);const guestCookie=joined.headers.getSetCookie()[0].split(';')[0];assert.match(joined.headers.getSetCookie()[0],/HttpOnly/);console.log('PASS PIN-verified guest receives a private expiring cookie without order access');
 const guestRead=()=>fetch(origin+'/api/v1/guest/session',{method:'POST',headers:{...publicHeaders,Cookie:guestCookie},body:JSON.stringify({qrToken})});assert.equal((await guestRead()).status,200);const closed=await fetch(tables+'/'+tableId+'/close?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({version:session.version})});assert.equal(closed.status,200);assert.equal((await guestRead()).status,401);console.log('PASS closing a table revokes the previously issued guest cookie');
 await stop();environment.CHECKOUT_PILOT_ENABLED='true';await start();const after=await engine.query('SELECT "passwordHash" FROM "User" WHERE email=$1',[email]);assert.equal(after.rows[0].passwordHash,originalHash);assert.equal((await engine.query('SELECT count(*)::int AS count FROM "PlatformAdmin"')).rows[0].count,1);console.log('PASS restart repeats migrations safely and preserves the existing administrator/password');
 const activeBoard=await (await fetch(tables+'?'+scoped,{headers:{Cookie:ownerCookie}})).json();
 const guestSocketOptions={path:'/restrodock-live',addTrailingSlash:false,autoConnect:false,reconnection:false,transports:['websocket'],extraHeaders:{Origin:origin}};
 const rejectedGuest=io(origin,{...guestSocketOptions,auth:{qrToken:'z'.repeat(43)}});
 try{
  const rejected=once(rejectedGuest,'connect_error',{signal:AbortSignal.timeout(5000)});
  rejectedGuest.connect();
  assert.match((await rejected)[0].message,/AUTH_REQUIRED/);
 }finally{rejectedGuest.disconnect();}
 const waitingGuest=io(origin,{...guestSocketOptions,auth:{qrToken}});
 const lookupGuestTable=async()=>{
  const result=await fetch(origin+'/api/v1/table-entry/lookup',{method:'POST',headers:publicHeaders,body:JSON.stringify({qrToken})});
  assert.equal(result.status,200);
  return result.json();
 };
 let pilotOpened;
 try{
  assert.equal((await lookupGuestTable()).session,null);
  const connected=once(waitingGuest,'connect',{signal:AbortSignal.timeout(5000)});
  waitingGuest.connect();
  await connected;
  const tableChanged=once(waitingGuest,'table-entry:changed',{signal:AbortSignal.timeout(5000)});
  const workerHeaders={...publicHeaders,Cookie:workerCookie,'X-CSRF-Token':(await workerLogin.json()).csrfToken};
  pilotOpened=await fetch(origin+'/api/v1/staff/tables/'+tableId+'/open?'+scoped,{method:'POST',headers:workerHeaders,body:JSON.stringify({version:activeBoard.items[0].version,durationMinutes:120})});
  assert.equal(pilotOpened.status,200);
  assert.deepEqual((await tableChanged)[0],{version:1});
  assert.equal((await lookupGuestTable()).session.canJoin,true);
  console.log('PASS the waiter opening a table notifies its QR guest without sending a PIN');
 }finally{waitingGuest.disconnect();}
 const pilot=await pilotOpened.json(),pilotSession=pilot.board.items[0].session;
 const pilotJoined=await fetch(origin+'/api/v1/table-entry/join',{method:'POST',headers:publicHeaders,body:JSON.stringify({
  qrToken,sessionId:pilotSession.id,pinVersion:pilotSession.pinVersion,pin:pilot.pin,displayName:'Synthetic pilot guest',
  mobile:'+919999999999',privacyAccepted:true,guestSecret:randomBytes(32).toString('base64url'),
 })});
 assert.equal(pilotJoined.status,200);
 const guestPilotCookie=pilotJoined.headers.getSetCookie()[0].split(';')[0],guestPilot=await pilotJoined.json();
 assert.equal(guestPilot.orderingEnabled,true);
 const orderPath=origin+'/api/v1/guest/orders';
 const submit=(key,quantity=2)=>fetch(orderPath,{method:'POST',headers:{...publicHeaders,Cookie:guestPilotCookie,'X-CSRF-Token':guestPilot.csrfToken},body:JSON.stringify({
  key,cartId:guestPilot.cartId,lines:[{itemId:(menuItem.id),quantity,variant:null,addons:[],note:'',expectedUnitPriceMinor:12550}],
 })});
 const auth=Object.fromEntries(new URLSearchParams(scoped));
 const socketOptions={path:'/restrodock-live',addTrailingSlash:false,autoConnect:false,reconnection:false,transports:['websocket'],timeout:3000,auth};
 const chefEmail='kitchen@synthetic.test';
 const invitation=await fetch(origin+'/api/v1/restaurant/invitations',{method:'POST',headers:ownerHeaders,body:JSON.stringify({...auth,email:chefEmail,role:'CHEF'})});
 assert.equal(invitation.status,201);
 const chefToken=new URL((await invitation.json()).link).hash.slice(1);
 assert.equal((await fetch(origin+'/api/v1/auth/invitations/accept',{method:'POST',headers:publicHeaders,body:JSON.stringify({token:chefToken,password})})).status,200);
 const chefLogin=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:publicHeaders,body:JSON.stringify({email:chefEmail,password,portal:'staff'})});
 assert.equal(chefLogin.status,200);
 const chefCookie=chefLogin.headers.getSetCookie()[0].split(';')[0];
 const chefHeaders={...publicHeaders,Cookie:chefCookie,'X-CSRF-Token':(await chefLogin.json()).csrfToken};
 const chefAnnouncements=[];
 const chefSocket=io(origin,{...socketOptions,auth:{...auth,kitchen:true},extraHeaders:{Origin:origin,Cookie:chefCookie}});
 const chefConnected=once(chefSocket,'connect',{signal:AbortSignal.timeout(5000)});
 chefSocket.on('service:announcement',event=>chefAnnouncements.push(event));
 chefSocket.connect();await chefConnected;
 const denied=io(origin,{...socketOptions,extraHeaders:{Origin:origin,Cookie:cookie}});
 try{
  const rejection=once(denied,'connect_error',{signal:AbortSignal.timeout(5000)});
  denied.connect();
  assert.match((await rejection)[0].message,/AUTH_REQUIRED/);
 }finally{denied.disconnect();}
 const live=io(origin,{...socketOptions,extraHeaders:{Origin:origin,Cookie:ownerCookie}});
 async function reconnect(){
  const connected=once(live,'connect',{signal:AbortSignal.timeout(5000)});
  const rejected=once(live,'connect_error',{signal:AbortSignal.timeout(5000)}).then(([error])=>{throw error;});
  live.connect();
  await Promise.race([connected,rejected]);
 }
 try{
 await reconnect();
 const directEvent=once(chefSocket,'branch-orders:changed',{signal:AbortSignal.timeout(5000)});
 const tableSocket=io(origin,{...socketOptions,auth:{...auth,tableService:true},extraHeaders:{Origin:origin,Cookie:workerCookie}});
 const waiterAnnouncements=[];
 tableSocket.on('service:announcement',event=>waiterAnnouncements.push(event));
 let direct;
 try{
  const connected=once(tableSocket,'connect',{signal:AbortSignal.timeout(5000)});
  tableSocket.connect();await connected;
  const tableEvent=once(tableSocket,'branch-orders:changed',{signal:AbortSignal.timeout(5000)});
  const newOrderVoice=once(chefSocket,'service:announcement',{signal:AbortSignal.timeout(5000)});
  const directResponse=await submit(randomUUID(),1);
  assert.equal(directResponse.status,201);
  direct=await directResponse.json();
  assert.equal(direct.status,'PLACED');
  await directEvent;
  assert.deepEqual((await tableEvent)[0],{version:1});
  assert.equal((await newOrderVoice)[0].kind,'new-order');
  assert.match(chefAnnouncements[0].text,/नया ऑर्डर.*Synthetic smoke item/);
  assert.deepEqual(waiterAnnouncements,[]);
  const chefAction=(action,version)=>fetch(origin+'/api/v1/staff/kitchen/'+direct.orderId+'/action?'+scoped,{method:'POST',headers:chefHeaders,body:JSON.stringify({action,version,note:''})});
  const initial=(await (await fetch(origin+'/api/v1/staff/kitchen?'+scoped,{headers:{Cookie:chefCookie}})).json()).tickets.find(ticket=>ticket.id===direct.orderId);
  assert.equal((await chefAction('ACCEPT',initial.version)).status,200);
  assert.equal((await chefAction('PREPARE',initial.version+1)).status,200);
  const readyVoice=once(tableSocket,'service:announcement',{signal:AbortSignal.timeout(5000)});
  assert.equal((await chefAction('READY',initial.version+2)).status,200);
  assert.equal((await readyVoice)[0].kind,'ready');
  await engine.query('UPDATE "BranchSettings" SET "assistanceEnabled"=true WHERE "branchId"=$1',[auth.branchId]);
  const assistance=()=>fetch(origin+'/api/v1/guest/assistance',{method:'POST',headers:{...publicHeaders,Cookie:guestPilotCookie,'X-CSRF-Token':guestPilot.csrfToken},body:'{}'});
  const helpVoice=once(tableSocket,'service:announcement',{signal:AbortSignal.timeout(5000)});
  assert.equal((await assistance()).status,200);
  assert.equal((await helpVoice)[0].kind,'assistance');
  assert.equal((await assistance()).status,200);
  assert.deepEqual(waiterAnnouncements.map(event=>event.kind),['ready','assistance']);
  assert.equal(chefAnnouncements.length,1);
  console.log('PASS Chef gets new-order announcements; Waiter gets only ready and one alert per assistance request');
 }finally{tableSocket.disconnect();}
 const directQueue=await (await fetch(origin+'/api/v1/staff/kitchen?'+scoped,{headers:{Cookie:chefCookie}})).json();
 assert.equal(directQueue.tickets.find(ticket=>ticket.id===direct.orderId)?.status,'READY');
 console.log('PASS order at the approval threshold reaches the Chef without review and can be marked ready');
 const changed=once(live,'branch-orders:changed',{signal:AbortSignal.timeout(5000)});
 const chefOrderChanged=once(chefSocket,'branch-orders:changed',{signal:AbortSignal.timeout(5000)});
 const orderKey=randomUUID(),recorded=await submit(orderKey);assert.equal(recorded.status,201,await recorded.clone().text());
 assert.deepEqual((await changed)[0],{version:1});
 assert.deepEqual((await chefOrderChanged)[0],{version:1});
 assert.equal(chefAnnouncements.length,1);
 live.disconnect();
 const receipt=await recorded.json();
 const review=origin+'/api/v1/restaurant/order-review';
 const loadReview=async()=>await (await fetch(review+'?'+scoped,{headers:{Cookie:ownerCookie}})).json();
 const reviewBoard=await loadReview();
 assert.equal(reviewBoard.pending[0].id,receipt.orderId);
  const incoming=await fetch(origin+'/api/v1/staff/kitchen?'+scoped,{headers:{Cookie:chefCookie}});
  assert.equal(incoming.status,200);
  assert.equal((await incoming.json()).tickets.find(ticket=>ticket.id===receipt.orderId)?.status,'AWAITING_REVIEW');
  console.log('PASS assigned Chef receives a live checkout event and sees its held order immediately');
  const approvalVoice=once(chefSocket,'service:announcement',{signal:AbortSignal.timeout(5000)});
  const approved=once(chefSocket,'branch-orders:changed',{signal:AbortSignal.timeout(5000)});
 const decision=await fetch(review+'/'+receipt.orderId+'/decision?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({version:reviewBoard.pending[0].version,decision:'APPROVE',override:true})});
 assert.equal(decision.status,200);assert.equal((await decision.json()).status,'PLACED');
  assert.deepEqual((await approved)[0],{version:1});
  assert.equal((await approvalVoice)[0].id,'order:'+receipt.orderId);
  const queue=await fetch(origin+'/api/v1/staff/kitchen?'+scoped,{headers:{Cookie:chefCookie}});
  assert.equal(queue.status,200);
  const placedTickets=(await queue.json()).tickets;
  assert.equal(placedTickets.find(ticket=>ticket.id===receipt.orderId)?.status,'PLACED');
  console.log('PASS assigned Chef sees the held order immediately, then receives approval and reads the persisted KOT');
 const tracked=await fetch(origin+'/api/v1/guest/order-status',{method:'POST',headers:{
  ...publicHeaders,Cookie:guestPilotCookie,'X-CSRF-Token':guestPilot.csrfToken,
 },body:'{}'});
 assert.equal(tracked.status,200);
 assert.equal((await tracked.json()).orders.find(order=>order.orderId===receipt.orderId)?.status,'PLACED');
 console.log('PASS verified guest reads the approved order status through the live proxy');
 await reconnect();
 assert.equal((await loadReview()).recent[0].id,receipt.orderId);
 console.log('PASS scoped WebSocket through Next, versioned checkout notification, and REST catch-up after reconnect');
 console.log('PASS pilot guest checkout enters assigned review and approval is persisted through both processes');
 const paused=await fetch(review+'/intake?'+scoped,{method:'PUT',headers:ownerHeaders,body:JSON.stringify({version:reviewBoard.intake.version,paused:true})});
 assert.equal(paused.status,200);assert.equal((await loadReview()).intake.paused,true);
 assert.equal((await submit(randomUUID())).status,409);
 const replay=await submit(orderKey);assert.equal(replay.status,200);assert.deepEqual(await replay.json(),receipt);
 console.log('PASS branch pause blocks new guest checkout but preserves same-key receipt replay');
 if(process.argv.includes('--service-e2e')){
  const intake=(await loadReview()).intake;
  assert.equal((await fetch(review+'/intake?'+scoped,{method:'PUT',headers:ownerHeaders,body:JSON.stringify({version:intake.version,paused:false})})).status,200);
  const staffHeaders=async(email)=>{
   const response=await fetch(origin+'/api/v1/auth/login',{method:'POST',headers:publicHeaders,body:JSON.stringify({email,password,portal:'staff'})});
   assert.equal(response.status,200);
   return {...publicHeaders,Cookie:response.headers.getSetCookie()[0].split(';')[0],'X-CSRF-Token':(await response.json()).csrfToken};
  };
  await verifyService({origin,engine,auth,tableId,qrToken,menuItem,ownerHeaders,platformHeaders,pilotSession,
   orders:[direct.orderId,receipt.orderId],guestHeaders:{...publicHeaders,Cookie:guestPilotCookie,'X-CSRF-Token':guestPilot.csrfToken},
   workerHeaders:await staffHeaders('worker-setup@synthetic.test'),
   chefHeaders:await staffHeaders(chefEmail),cashierHeaders:await staffHeaders('cashier-setup@synthetic.test')});
 }

 const currentIntake=await loadReview();
 assert.equal((await fetch(review+'/intake?'+scoped,{method:'PUT',headers:ownerHeaders,body:JSON.stringify({version:currentIntake.intake.version,paused:false})})).status,200);
 const tableState=await (await fetch(tables+'?'+scoped,{headers:{Cookie:ownerCookie}})).json();
 const newTableResponse=await fetch(tables+'?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({revision:tableState.revision,label:'First-order confirmation',section:'Main',seats:4})});
 assert.equal(newTableResponse.status,201);
 const newTable=(await newTableResponse.json()).board.items.find(item=>item.label==='First-order confirmation');
 const newQrResponse=await fetch(tables+'/'+newTable.id+'/qr?'+scoped,{method:'POST',headers:ownerHeaders,body:JSON.stringify({version:newTable.version})});
 assert.equal(newQrResponse.status,200);
 const newQr=(await newQrResponse.json()).qr.url.split('#')[1];
 const requestResponse=await fetch(origin+'/api/v1/table-entry/request',{method:'POST',headers:publicHeaders,body:JSON.stringify({qrToken:newQr,displayName:'Synthetic no-PIN guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomBytes(32).toString('base64url')})});
 assert.equal(requestResponse.status,200,await requestResponse.clone().text());
 const requestedGuest=await requestResponse.json();
 assert.equal(requestedGuest.awaitingWaiter,true);
 const requestedHeaders={...publicHeaders,Cookie:requestResponse.headers.getSetCookie()[0].split(';')[0],'X-CSRF-Token':requestedGuest.csrfToken};
 const waiterIdentity=await (await fetch(origin+'/api/v1/auth/me',{headers:{Cookie:workerCookie}})).json();
 const waiterHeaders={...publicHeaders,Cookie:workerCookie,'X-CSRF-Token':waiterIdentity.csrfToken};
 const waiterSocket=io(origin,{...socketOptions,auth,extraHeaders:{Origin:origin,Cookie:workerCookie}});
 try{
  const waiterConnected=once(waiterSocket,'connect',{signal:AbortSignal.timeout(5000)});
  waiterSocket.connect();await waiterConnected;
  const confirmationVoice=once(waiterSocket,'service:announcement',{signal:AbortSignal.timeout(5000)});
  const sent=await fetch(orderPath,{method:'POST',headers:requestedHeaders,body:JSON.stringify({key:randomUUID(),cartId:requestedGuest.cartId,lines:[{itemId:menuItem.id,quantity:1,variant:null,addons:[],note:'Confirm at table',expectedUnitPriceMinor:12550}]})});
  assert.equal(sent.status,201,await sent.clone().text());
  const pending=await sent.json();
  assert.equal(pending.status,'AWAITING_REVIEW');
  assert.equal((await confirmationVoice)[0].kind,'confirmation');
  const beforeKitchen=await (await fetch(origin+'/api/v1/staff/kitchen?'+scoped,{headers:{Cookie:chefCookie}})).json();
  assert.ok(!beforeKitchen.tickets.some(ticket=>ticket.id===pending.orderId));
  const waiterQueue=await (await fetch(origin+'/api/v1/staff/order-review?'+scoped,{headers:waiterHeaders})).json();
  const pendingOrder=waiterQueue.pending.find(order=>order.id===pending.orderId);
  assert.ok(pendingOrder.awaitingWaiter);
  const chefVoice=once(chefSocket,'service:announcement',{signal:AbortSignal.timeout(5000)});
  const accepted=await fetch(origin+'/api/v1/staff/order-review/'+pending.orderId+'/decision?'+scoped,{method:'POST',headers:waiterHeaders,body:JSON.stringify({version:pendingOrder.version,decision:'APPROVE',override:true})});
  assert.equal(accepted.status,200,await accepted.clone().text());
  assert.equal((await accepted.json()).status,'PLACED');
  assert.equal((await chefVoice)[0].id,'order:'+pending.orderId);
  const afterKitchen=await (await fetch(origin+'/api/v1/staff/kitchen?'+scoped,{headers:{Cookie:chefCookie}})).json();
  assert.ok(afterKitchen.tickets.some(ticket=>ticket.id===pending.orderId));
  console.log('PASS PIN-free first order alerts the waiter, stays hidden from Chef, then reaches Chef after waiter approval');
 }finally{waiterSocket.disconnect();}
 const logout=await fetch(origin+'/api/v1/auth/logout',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':loginBody.csrfToken},body:'{}'});assert.equal(logout.status,200);assert.equal((await fetch(origin+'/api/v1/auth/me',{headers:{Cookie:cookie}})).status,401);console.log('PASS proxy forwards CSRF logout and revoked session replay is rejected');
 }finally{live.disconnect();chefSocket.disconnect();}
 console.log('Development startup smoke passed.');
}catch(error){console.error(error instanceof Error?error.message:'Startup smoke failed.');process.exitCode=1;}
finally{await stop();await wire.stop();await engine.close();}
