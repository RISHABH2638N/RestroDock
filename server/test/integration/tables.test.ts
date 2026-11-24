import {test,before,after,beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {checkoutReceiptSchema,type CheckoutRequest} from '@restrodock/contracts';
import {fileURLToPath} from 'node:url';
import request from 'supertest';
import sharp from 'sharp';
import jsQRModule from 'jsqr';
const decodeQR=jsQRModule as unknown as (data:Uint8ClampedArray,width:number,height:number)=>{data:string}|null;
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createDatabase,type Database} from '../../src/db.js';
import {createApp} from '../../src/app.js';
import {loadConfig,type Config} from '../../src/config.js';
import {randomToken,tokenHash,csrfFor,hashPassword} from '../../src/modules/auth/crypto.js';
import {decryptMobile} from '../../src/modules/tables/privacy.js';
let engine:PGlite,wire:PGLiteSocketServer,db:Database,config:Config,app:ReturnType<typeof createApp>;
type Actor={cookie:string;csrf:string};const actors:Record<string,Actor>={};let tenantId:string,branchId:string,foreignBranch:string,foreignTenant:string,tableId:string,otherTable:string,qrToken:string,pin:string,sessionId:string,guestCookie:string,guestCsrf:string,joinBody:Record<string,unknown>;
const api='/api/v1',query=()=>`?tenantId=${tenantId}&branchId=${branchId}`;
const headers=(actor=actors.admin!)=>({Cookie:actor.cookie,Origin:config.CLIENT_ORIGIN,'X-CSRF-Token':actor.csrf});
const tablePath=(actor:Actor)=>actor===actors.admin||actor===actors.foreign?'/restaurant/tables':'/staff/tables';
const board=(actor=actors.admin!)=>request(app).get(api+tablePath(actor)+query()).set(headers(actor));
const post=(path:string,body:object,actor=actors.admin!)=>request(app).post(api+tablePath(actor)+path+query()).set(headers(actor)).send(body);
const put=(path:string,body:object)=>request(app).put(api+'/restaurant/tables'+path+query()).set(headers()).send(body);
const lookup=(secret=qrToken)=>request(app).post(api+'/table-entry/lookup').set('Origin',config.CLIENT_ORIGIN).send({qrToken:secret});
const join=(body=joinBody)=>request(app).post(api+'/table-entry/join').set('Origin',config.CLIENT_ORIGIN).send(body);
const guest=()=>request(app).post(api+'/guest/session').set('Origin',config.CLIENT_ORIGIN).set('Cookie',guestCookie).send({qrToken});
async function row(id=tableId){return (await board()).body.items.find((t:{id:string})=>t.id===id);}
async function rotateQr(id=tableId){const r=await post('/'+id+'/qr',{version:(await row(id)).version});assert.equal(r.status,200,r.text);return r;}
async function open(id=tableId){const r=await post('/'+id+'/open',{version:(await row(id)).version,durationMinutes:120},actors.worker);assert.equal(r.status,200,r.text);return r;}
async function rotatePin(){const r=await post('/'+tableId+'/pin',{version:(await row()).session.version},actors.manager);assert.equal(r.status,200,r.text);pin=r.body.pin;sessionId=(await row()).session.id;return r;}
before(async()=>{
 engine=await PGlite.create();wire=new PGLiteSocketServer({db:engine,host:'127.0.0.1',port:0,maxConnections:8});await wire.start();const url=`postgresql://postgres:synthetic@${wire.getServerConn()}/postgres?sslmode=disable`;
 const env={...process.env,NODE_ENV:'test',DATABASE_URL:url,DIRECT_URL:url,DATABASE_URL_POOLED:'',BOOTSTRAP_ADMIN_EMAIL:'',BOOTSTRAP_ADMIN_PASSWORD:'',GUEST_PII_KEY:'a7'.repeat(32)};
 const child=spawn(process.execPath,['--import','tsx','scripts/database-cli.ts','deploy'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env,stdio:['ignore','pipe','pipe']});let log='';for(const stream of [child.stdout,child.stderr])stream.on('data',c=>{log+=String(c);});assert.equal(await new Promise(r=>child.once('exit',r)),0,log);
 db=createDatabase(url)!;config=loadConfig(env);app=createApp(config,async()=>{},db);
 const one=await db.tenant.create({data:{name:'Synthetic table tenant',status:'TRIAL',slug:'synthetic-table-entry'}}),two=await db.tenant.create({data:{name:'Synthetic foreign tenant',slug:'synthetic-foreign-entry'}});tenantId=one.id;foreignTenant=two.id;
 const branch=await db.branch.create({data:{tenantId,active:true,name:'Synthetic entry branch'}});branchId=branch.id;foreignBranch=(await db.branch.create({data:{tenantId:two.id,name:'Foreign'}})).id;
 const hash=await hashPassword('Synthetic test account password');
 for(const [name,role]of [['admin','RESTAURANT_ADMIN'],['manager','MANAGER'],['worker','WORKER'],['cashier','CASHIER'],['chef','CHEF'],['platform',null],['foreign','RESTAURANT_ADMIN']] as const){const user=await db.user.create({data:{email:name+'@synthetic.test',passwordHash:hash,active:true}});if(role){const member=await db.membership.create({data:{tenantId:name==='foreign'?foreignTenant:tenantId,userId:user.id,role,active:true}});await db.branchAccess.create({data:{tenantId:member.tenantId,branchId:name==='foreign'?foreignBranch:branchId,membershipId:member.id}});}else await db.platformAdmin.create({data:{userId:user.id}});const token=randomToken();await db.staffSession.create({data:{userId:user.id,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+3600000)}});actors[name]={cookie:'restrodock_session='+token,csrf:csrfFor(token)};}
 const category=await db.menuCategory.create({data:{tenantId,branchId,name:'Synthetic menu'}});
 await db.menuItem.create({data:{tenantId,branchId,categoryId:category.id,name:'Published meal',priceMinor:12550,state:'PUBLISHED',available:true,foodType:'VEG'}});
 await db.menuItem.create({data:{tenantId,branchId,categoryId:category.id,name:'Private draft',priceMinor:100,state:'DRAFT',available:true}});
 await db.menuItem.create({data:{tenantId,branchId,categoryId:category.id,name:'Unreviewed import',priceMinor:100,state:'DRAFT',reviewRequired:true}});
},{timeout:60000});
beforeEach(()=>{app=createApp(config,async()=>{},db);});after(async()=>{await db?.$disconnect();await wire?.stop();await engine?.close();});
test('table board denies anonymous, platform-only, Chef and foreign-branch identities',async()=>{assert.equal((await request(app).get(api+'/restaurant/tables'+query())).status,401);for(const actor of [actors.platform,actors.chef,actors.foreign])assert.equal((await board(actor)).status,403);assert.equal((await board(actors.worker)).status,200);});
test('admin creates scoped tables with section/seats; staff cannot administer and writes require CSRF',async()=>{assert.equal((await post('',{label:'1',section:'Main',seats:4,revision:1},actors.worker)).status,403);assert.equal((await request(app).post(api+'/restaurant/tables'+query()).set('Cookie',actors.admin!.cookie).set('Origin',config.CLIENT_ORIGIN).send({label:'1',section:'Main',seats:4,revision:1})).status,403);const r=await post('',{label:'Table 1',section:'Garden',seats:4,revision:1});assert.equal(r.status,201,r.text);tableId=r.body.board.items[0].id;assert.equal(r.body.board.items[0].section,'Garden');const r2=await post('',{label:'Table 2',section:'Main',seats:2,revision:r.body.board.revision});assert.equal(r2.status,201);otherTable=r2.body.board.items.find((t:{id:string})=>t.id!==tableId).id;});
test('stale branch revision, duplicate label and overposting fail without phantom tables',async()=>{assert.equal((await post('',{label:'stale',section:'Main',seats:4,revision:1})).status,409);const b=(await board()).body;assert.equal((await post('',{label:'Table 1',section:'Garden',seats:4,revision:b.revision})).status,409);assert.equal((await post('',{label:'bad',section:'Main',seats:4,revision:b.revision,tenantId:foreignTenant})).status,400);assert.equal((await board()).body.items.length,2);});
test('QR is truly decodable, stores only secret hash, and unpublished QR exposes no menu',async()=>{const r=await rotateQr();const secret=r.body.qr.url.split('#')[1];qrToken=secret;const {data,info}=await sharp(Buffer.from(r.body.qr.pngDataUrl.split(',')[1],'base64')).ensureAlpha().raw().toBuffer({resolveWithObject:true});const decoded=decodeQR(new Uint8ClampedArray(data),info.width,info.height);assert.equal(decoded?.data,r.body.qr.url);assert.equal((await lookup()).status,404);const row=await db.qrCode.findFirstOrThrow({where:{tableId,revokedAt:null}});assert.equal(row.secretHash,tokenHash(secret));assert.ok(!(await board()).text.includes(secret));});
test('publication is explicit; QR reveals correct scoped published menu but no identity/PIN/order rights',async()=>{const b=(await board()).body;assert.equal((await put('/publication',{revision:b.revision,enabled:true,confirmed:false})).status,400);assert.equal((await put('/publication',{revision:b.revision,enabled:true,confirmed:true})).status,200);const r=await lookup();assert.equal(r.status,200);assert.equal(r.body.restaurantName,'Synthetic table tenant');assert.deepEqual(r.body.items.map((i:{name:string})=>i.name),['Published meal']);assert.equal(r.body.session,null);assert.equal(r.body.orderingEnabled,false);assert.equal(r.headers['set-cookie'],undefined);assert.ok(!r.text.includes('pinHash'));assert.equal((await request(app).post(api+'/guest/orders').set('Origin',config.CLIENT_ORIGIN).send({qrToken})).status,404);});
test('only authorized table staff can open sessions; concurrent opens create exactly one active session',async()=>{assert.equal((await post('/'+tableId+'/open',{version:(await row()).version,durationMinutes:120},actors.cashier)).status,403);const version=(await row()).version;const results=await Promise.all([post('/'+tableId+'/open',{version,durationMinutes:120},actors.worker),post('/'+tableId+'/open',{version,durationMinutes:120},actors.manager)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const r=results.find(r=>r.status===200)!;pin=r.body.pin;sessionId=(await row()).session.id;assert.match(pin,/^\d{6}$/);assert.equal(await db.diningSession.count({where:{tableId,state:'OPEN'}}),1);assert.ok(!(await board()).text.includes('pinHash'));});
test('leaked QR without PIN, mismatched table/session and foreign Origin cannot join',async()=>{joinBody={qrToken,sessionId,pinVersion:1,pin,displayName:'Synthetic guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken()};assert.equal((await join({...joinBody,pin:'wrong'})).status,400);const other=await rotateQr(otherTable);assert.equal((await join({...joinBody,qrToken:other.body.qr.url.split('#')[1]})).status,409);assert.equal((await request(app).post(api+'/table-entry/join').set('Origin','https://foreign.invalid').send(joinBody)).status,403);});
test('verified guest gets HttpOnly cookie with scoped expiring access; mobile is encrypted and never projected',async()=>{const r=await join();assert.equal(r.status,200,r.text);guestCookie=String(r.headers['set-cookie']![0]).split(';')[0]!;guestCsrf=r.body.csrfToken;assert.match(String(r.headers['set-cookie']![0]!),/HttpOnly/);assert.match(String(r.headers['set-cookie']![0]!),/SameSite=Strict/);const saved=await db.guestSession.findUniqueOrThrow({where:{tokenHash:tokenHash(String(joinBody.guestSecret))}});assert.ok(saved.mobileCiphertext&&!saved.mobileCiphertext.includes('9999999999'));assert.equal(decryptMobile(saved.mobileCiphertext!,Buffer.from(config.GUEST_PII_KEY,'hex'),[tenantId,branchId,sessionId,saved.tokenHash].join(':')),joinBody.mobile);assert.ok(!r.text.includes(String(joinBody.mobile)));assert.ok(!r.text.includes(String(joinBody.guestSecret)));assert.equal((await guest()).status,200);assert.equal((await db.tenant.findUniqueOrThrow({where:{id:tenantId}})).status,'TRIAL');assert.equal((await db.branch.findUniqueOrThrow({where:{id:branchId}})).active,true);});
test('cart context resumes the cookie-scoped table with current published prices and rejects client scope',async()=>{
 const resume=()=>request(app).post(api+'/guest/cart-context').set('Origin',config.CLIENT_ORIGIN).set('Cookie',guestCookie).send({});
 const anonymous=await request(app).post(api+'/guest/cart-context').set('Origin',config.CLIENT_ORIGIN).send({});
 assert.equal(anonymous.status,401);
 const first=await resume();
 assert.equal(first.status,200,first.text);
 assert.equal(first.body.context.tableLabel,'Table 1');
 assert.equal(first.body.context.orderingEnabled,false);
 assert.equal(first.body.guest.cartId,(await guest()).body.cartId);
 assert.ok(!first.text.includes(qrToken));
 const item=await db.menuItem.findFirstOrThrow({where:{id:first.body.context.items[0].id}});
 await db.menuItem.update({where:{id:item.id},data:{priceMinor:item.priceMinor+100}});
 try{assert.equal((await resume()).body.context.items[0].priceMinor,item.priceMinor+100);}
 finally{await db.menuItem.update({where:{id:item.id},data:{priceMinor:item.priceMinor}});}
 assert.equal((await request(app).post(api+'/guest/cart-context').set('Origin',config.CLIENT_ORIGIN)
  .set('Cookie',guestCookie).send({tenantId:foreignTenant})).status,400);
 assert.equal((await request(app).post(api+'/guest/cart-context').set('Origin','https://wrong.example')
  .set('Cookie',guestCookie).send({})).status,403);
});
test('join retries reuse one scoped guest credential and changed payload cannot overwrite contact',async()=>{assert.equal((await join()).status,200);assert.equal(await db.guestSession.count({where:{diningSessionId:sessionId}}),1);assert.equal((await join({...joinBody,mobile:'+918888888888'})).status,409);});
test('PIN rotation invalidates old challenges and revokes/clears existing guests',async()=>{const oldPin=pin;await rotatePin();assert.equal((await guest()).status,401);
 assert.equal((await request(app).post(api+'/guest/cart-context').set('Origin',config.CLIENT_ORIGIN).set('Cookie',guestCookie).send({})).status,401);const old=await db.guestSession.findUniqueOrThrow({where:{tokenHash:tokenHash(String(joinBody.guestSecret))}});assert.equal(old.mobileCiphertext,null);assert.ok(old.revokedAt);assert.equal((await join({...joinBody,guestSecret:randomToken(),pin:oldPin})).status,409);});
test('five incorrect PIN attempts persist atomically and lock even across fresh process limiter instances',async()=>{const pv=(await row()).session.pinVersion,bad=pin==='000000'?'111111':'000000';for(let n=0;n<5;n++){app=createApp(config,async()=>{},db);const r=await join({...joinBody,pin:bad,pinVersion:pv,guestSecret:randomToken()});assert.equal(r.status,n===4?429:403,r.text);}assert.equal((await db.diningSession.findUniqueOrThrow({where:{id:sessionId}})).failedJoinAttempts,5);assert.equal((await join({...joinBody,pin,pinVersion:pv,guestSecret:randomToken()})).status,429);});
test('staff rotation recovers a locked table; stale rotation cannot reset the new challenge',async()=>{const old=(await row()).session.version;await rotatePin();assert.equal((await post('/'+tableId+'/pin',{version:old},actors.manager)).status,409);assert.equal((await row()).session.locked,false);joinBody={...joinBody,pin,pinVersion:(await row()).session.pinVersion,guestSecret:randomToken()};const r=await join();assert.equal(r.status,200);guestCookie=String(r.headers['set-cookie']![0]!).split(';')[0]!;guestCsrf=r.body.csrfToken;});
test('expired PIN blocks new joins independently of the longer dining session',async()=>{await db.diningSession.update({where:{id:sessionId},data:{pinExpiresAt:new Date(Date.now()-1000)}});assert.equal((await join({...joinBody,guestSecret:randomToken()})).status,409);assert.equal((await guest()).status,200);await rotatePin();});
test('guest leave enforces CSRF and clears contact material without affecting staff sessions',async()=>{joinBody={...joinBody,pin,pinVersion:(await row()).session.pinVersion,guestSecret:randomToken()};const r=await join();guestCookie=String(r.headers['set-cookie']![0]!).split(';')[0]!;guestCsrf=r.body.csrfToken;assert.equal((await request(app).post(api+'/guest/leave').set('Cookie',guestCookie).set('Origin',config.CLIENT_ORIGIN).send({})).status,403);assert.equal((await request(app).post(api+'/guest/leave').set('Cookie',guestCookie).set('Origin',config.CLIENT_ORIGIN).set('X-CSRF-Token',guestCsrf).send({})).status,200);assert.equal((await guest()).status,401);assert.equal((await board()).status,200);});
test('cashier closes only assigned entry session; old PIN and guest access then fail',async()=>{const r=await post('/'+tableId+'/close',{version:(await row()).session.version},actors.cashier);assert.equal(r.status,200);assert.equal((await row()).session,null);assert.equal((await join({...joinBody,guestSecret:randomToken()})).status,409);assert.equal((await db.diningSession.findUniqueOrThrow({where:{id:sessionId}})).pinHash,null);});
test('QR replacement closes pilot session, revoked QR lookup fails and raw code remains unrecoverable',async()=>{await open();const old=qrToken;const r=await rotateQr();qrToken=r.body.qr.url.split('#')[1];assert.equal((await lookup(old)).status,404);assert.equal((await row()).session,null);assert.equal((await lookup()).status,200);assert.equal(await db.qrCode.count({where:{tableId,revokedAt:null}}),1);assert.ok(!(await board()).text.includes(qrToken));});
test('QR revocation and table archival preserve history while preventing entry',async()=>{const saved=qrToken;assert.equal((await post('/'+tableId+'/qr/revoke',{version:(await row()).version})).status,200);assert.equal((await lookup(saved)).status,404);assert.equal((await put('/'+tableId,{version:(await row()).version,label:'Table 1',section:'Garden',seats:6,archived:true})).status,200);assert.equal((await post('/'+tableId+'/qr',{version:(await row()).version})).status,409);assert.ok(await db.restaurantTable.findUnique({where:{id:tableId}}));});
test('unpublishing revokes active sessions; suspension blocks even current public QR',async()=>{await put('/'+tableId,{version:(await row()).version,label:'Table 1',section:'Garden',seats:6,archived:false});qrToken=(await rotateQr()).body.qr.url.split('#')[1];await open();const b=(await board()).body;assert.equal((await put('/publication',{revision:b.revision,enabled:false,confirmed:true})).status,200);assert.equal((await lookup()).status,404);assert.equal((await row()).session,null);await put('/publication',{revision:(await board()).body.revision,enabled:true,confirmed:true});await db.tenant.update({where:{id:tenantId},data:{status:'SUSPENDED'}});assert.equal((await lookup()).status,404);assert.equal((await board()).status,403);await db.tenant.update({where:{id:tenantId},data:{status:'TRIAL'}});});
test('absolute session expiry closes and purges expired guests on next entry access',async()=>{const r=await open();const s=(await row()).session;pin=r.body.pin;const body={...joinBody,qrToken,sessionId:s.id,pinVersion:s.pinVersion,pin,guestSecret:randomToken()};assert.equal((await join(body)).status,200);await db.diningSession.update({where:{id:s.id},data:{openedAt:new Date(Date.now()-3600000),expiresAt:new Date(Date.now()-1000),pinExpiresAt:new Date(Date.now()-2000)}});assert.equal((await lookup()).body.session,null);const g=await db.guestSession.findUniqueOrThrow({where:{tokenHash:tokenHash(String(body.guestSecret))}});assert.equal(g.mobileCiphertext,null);assert.ok(g.revokedAt);});
test('table board cleans expired guest contact and closes expired entry sessions',async()=>{
 const opened=await open(),session=(await row()).session;
 const guestSecret=randomToken();
 assert.equal((await join({...joinBody,qrToken,sessionId:session.id,pinVersion:session.pinVersion,pin:opened.body.pin,guestSecret})).status,200);
 const token=tokenHash(guestSecret),past=new Date(Date.now()-1000);
 await db.guestSession.update({where:{tokenHash:token},data:{expiresAt:past}});
 assert.equal((await row()).session.id,session.id);
 const guest=await db.guestSession.findUniqueOrThrow({where:{tokenHash:token}});
 assert.equal(guest.mobileCiphertext,null);
 assert.equal(guest.displayName,'Guest');
 await db.diningSession.update({where:{id:session.id},data:{openedAt:new Date(Date.now()-3600000),expiresAt:past,pinExpiresAt:new Date(Date.now()-2000)}});
 assert.equal((await row()).session,null);
 assert.ok((await db.guestSession.findUniqueOrThrow({where:{tokenHash:token}})).revokedAt);
});
test('table-entry audit records references, never guest name/mobile/PIN/raw capabilities',async()=>{const log=JSON.stringify(await db.auditEvent.findMany({where:{tenantId,branchId}}));for(const value of [String(joinBody.mobile),String(joinBody.guestSecret),'Synthetic guest',qrToken])assert.ok(!log.includes(value));assert.ok(!log.includes('pinHash'));});

test('guest bearer cookie never authenticates staff APIs and cannot create orders',async()=>{assert.equal((await request(app).get(api+'/restaurant/tables'+query()).set('Cookie',guestCookie)).status,401);assert.equal((await request(app).post(api+'/guest/orders').set('Cookie',guestCookie).set('Origin',config.CLIENT_ORIGIN).send({})).status,404);});

test('expired guest-read denial commits contact cleanup instead of rolling it back',async()=>{const opened=await open(),session=(await row()).session;const body={...joinBody,qrToken,sessionId:session.id,pinVersion:session.pinVersion,pin:opened.body.pin,guestSecret:randomToken()};const joined=await join(body);assert.equal(joined.status,200);const cookie=String(joined.headers['set-cookie']![0]!).split(';')[0]!;const saved=await db.guestSession.findUniqueOrThrow({where:{tokenHash:tokenHash(String(body.guestSecret))}});await db.guestSession.update({where:{id:saved.id},data:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await request(app).post(api+'/guest/session').set('Origin',config.CLIENT_ORIGIN).set('Cookie',cookie).send({qrToken})).status,401);const after=await db.guestSession.findUniqueOrThrow({where:{id:saved.id}});assert.equal(after.mobileCiphertext,null);assert.equal(after.displayName,'Guest');await post('/'+tableId+'/close',{version:session.version});});
test('expired dining join denial commits closure and revocation without a successful lookup',async()=>{const opened=await open(),session=(await row()).session;const body={...joinBody,qrToken,sessionId:session.id,pinVersion:session.pinVersion,pin:opened.body.pin,guestSecret:randomToken()};assert.equal((await join(body)).status,200);await db.diningSession.update({where:{id:session.id},data:{openedAt:new Date(Date.now()-3600000),expiresAt:new Date(Date.now()-1000),pinExpiresAt:new Date(Date.now()-2000)}});assert.equal((await join({...body,guestSecret:randomToken()})).status,409);assert.equal((await db.diningSession.findUniqueOrThrow({where:{id:session.id}})).state,'CLOSED');const guest=await db.guestSession.findUniqueOrThrow({where:{tokenHash:tokenHash(String(body.guestSecret))}});assert.equal(guest.mobileCiphertext,null);assert.ok(guest.revokedAt);});

type PilotActor=Actor&{cartId:string};
let pilotSession:{id:string;pinVersion:number;version:number};
let pilotPin:string,pilotGuest:PilotActor,mealId:string,variantId:string;
const pilotApp=()=>createApp({...config,CHECKOUT_PILOT_ENABLED:true},async()=>{},db);
const orderLine=(overrides:Partial<CheckoutRequest['lines'][number]>={})=>({
 itemId:mealId,variant:'Large',addons:['Mint dip'],quantity:2,note:'Mild spice',expectedUnitPriceMinor:22500,...overrides,
});
const orderBody=(lines=[orderLine()],cartId=pilotGuest.cartId):CheckoutRequest=>({key:randomUUID(),cartId,lines});
const sendOrder=(payload:object,actor:Actor=pilotGuest)=>request(app).post(api+'/guest/orders').set(headers(actor)).send(payload);
async function joinPilot(){
 const response=await join({qrToken,sessionId:pilotSession.id,pinVersion:pilotSession.pinVersion,pin:pilotPin,
  displayName:'Synthetic checkout guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken()});
 assert.equal(response.status,200,response.text);
 assert.equal(response.body.orderingEnabled,true);
 return {cookie:String(response.headers['set-cookie']![0]).split(';')[0]!,csrf:String(response.body.csrfToken),cartId:String(response.body.cartId)};
}

test('checkout requires a pilot table, verified guest, same Origin and guest CSRF',async()=>{
 const legacy=await open();
 const old=legacy.body.board.items.find((item:{id:string})=>item.id===tableId).session;
 const beforePilot=await join({qrToken,sessionId:old.id,pinVersion:old.pinVersion,pin:legacy.body.pin,
  displayName:'Synthetic guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken()});
 assert.equal(beforePilot.status,200,beforePilot.text);
 assert.equal(beforePilot.body.orderingEnabled,false);
 app=pilotApp();
 mealId=(await db.menuItem.findFirstOrThrow({where:{tenantId,branchId,name:'Published meal'}})).id;
 const oldActor={cookie:String(beforePilot.headers['set-cookie']![0]).split(';')[0]!,csrf:String(beforePilot.body.csrfToken)};
 assert.equal((await sendOrder(orderBody([orderLine()],String(beforePilot.body.cartId)),oldActor)).body.error.code,'CHECKOUT_UNAVAILABLE');
 assert.equal((await post('/'+tableId+'/close',{version:old.version},actors.cashier)).status,200);
 await db.tenant.update({where:{id:tenantId},data:{status:'TRIAL'}});
 await db.branch.update({where:{id:branchId},data:{active:true}});
 const opened=await open();
 pilotSession=opened.body.board.items.find((item:{id:string})=>item.id===tableId).session;
 pilotPin=opened.body.pin;
 const ready=await lookup();
 assert.equal(ready.body.deferredVerification,true);
 assert.equal(ready.body.session.occupied,false);
 assert.equal(ready.body.session.canJoin,true);
 const scope={tenantId,branchId,menuItemId:mealId};
 variantId=(await db.menuVariant.create({data:{...scope,name:'Large',priceMinor:20000}})).id;
 await db.menuAddon.create({data:{...scope,name:'Mint dip',priceMinor:2500}});
 pilotGuest=await joinPilot();
 const occupied=await lookup();
 assert.equal(occupied.body.session.occupied,true);
 const secondGuest=await join({...joinBody,qrToken,sessionId:pilotSession.id,pinVersion:pilotSession.pinVersion,pin:pilotPin,guestSecret:randomToken()});
 assert.equal(secondGuest.status,409,secondGuest.text);
 assert.equal(secondGuest.body.error.code,'PIN_EXPIRED');
 assert.equal((await lookup()).body.orderingEnabled,false);
 const resumed=await request(app).post(api+'/guest/cart-context').set(headers(pilotGuest)).send({});
 assert.equal(resumed.status,200,resumed.text);
 assert.equal(resumed.body.guest.orderingEnabled,true);
 const body=orderBody();
 assert.equal((await request(app).post(api+'/guest/orders').set('Origin',config.CLIENT_ORIGIN).send(body)).status,401);
 assert.equal((await sendOrder(body,actors.worker)).status,401);
 assert.equal((await sendOrder(body,{...pilotGuest,csrf:'wrong'})).status,403);
 assert.equal((await request(app).post(api+'/guest/orders').set(headers(pilotGuest)).set('Origin','https://foreign.invalid').send(body)).status,403);
 assert.equal(await db.order.count(),0);
});

test('foreign items, overposting, stale options and altered estimates leave no order',async()=>{
 app=pilotApp();
 const category=await db.menuCategory.create({data:{tenantId:foreignTenant,branchId:foreignBranch,name:'Foreign food'}});
 const meal=await db.menuItem.create({data:{tenantId:foreignTenant,branchId:foreignBranch,categoryId:category.id,
  name:'Foreign meal',state:'PUBLISHED',available:true,priceMinor:20000,foodType:'VEG'}});
 const foreign=await sendOrder(orderBody([orderLine({itemId:meal.id})]));
 assert.equal(foreign.body.error.code,'CHECKOUT_MENU_CHANGED');
 assert.ok(!foreign.text.includes('Foreign meal'));
 assert.equal((await sendOrder({...orderBody(),tenantId:foreignTenant})).status,400);
 assert.equal((await sendOrder({...orderBody(),lines:[{...orderLine(),unitPriceMinor:1}]})).status,400);
 assert.equal((await sendOrder(orderBody([orderLine({expectedUnitPriceMinor:1})]))).body.error.code,'CHECKOUT_MENU_CHANGED');
 await db.menuVariant.update({where:{id:variantId},data:{priceMinor:20100}});
 assert.equal((await sendOrder(orderBody())).body.error.code,'CHECKOUT_MENU_CHANGED');
 await db.menuVariant.update({where:{id:variantId},data:{priceMinor:20000,available:false}});
 assert.equal((await sendOrder(orderBody())).body.error.code,'CHECKOUT_MENU_CHANGED');
 await db.menuVariant.update({where:{id:variantId},data:{available:true}});
 assert.equal((await sendOrder(orderBody([orderLine({addons:['Unknown option']})]))).body.error.code,'CHECKOUT_MENU_CHANGED');
 assert.equal(await db.order.count(),0);
 assert.equal(await db.orderItem.count(),0);
});

test('checkout rolls back order and lines when its audit write fails',async()=>{
 app=pilotApp();
 await engine.exec(`
 CREATE FUNCTION block_checkout_audit() RETURNS trigger LANGUAGE plpgsql AS $$
 BEGIN
  IF NEW.action='CHECKOUT_ORDER_RECORDED' THEN RAISE EXCEPTION 'synthetic test failure'; END IF;
  RETURN NEW;
 END $$;
 CREATE TRIGGER block_checkout_audit BEFORE INSERT ON "AuditEvent" FOR EACH ROW EXECUTE FUNCTION block_checkout_audit();
 `);
 try{
  assert.equal((await sendOrder(orderBody())).status,500);
  assert.equal(await db.order.count(),0);
  assert.equal(await db.orderItem.count(),0);
 }finally{await engine.exec('DROP TRIGGER block_checkout_audit ON "AuditEvent"; DROP FUNCTION block_checkout_audit();');}
});

test('concurrent same-key checkout creates one order and replays the saved receipt after a menu change',async()=>{
 app=pilotApp();
 const body=orderBody();
 const results=await Promise.all([sendOrder(body),sendOrder(body)]);
 assert.deepEqual(results.map(result=>result.status).sort(),[200,201],results.map(result=>result.text).join(' '));
 const first=checkoutReceiptSchema.parse(results[0]!.body);
 assert.deepEqual(results[1]!.body,first);
 assert.equal(first.estimatedTotalMinor,45000);
 const order=await db.order.findUniqueOrThrow({where:{id:first.orderId},include:{items:true}});
 assert.equal(order.diningSessionId,pilotSession.id);
 assert.equal(order.tenantId,tenantId);
 assert.equal(order.branchId,branchId);
 assert.equal(order.status,'PLACED');
 assert.equal(order.reviewReason,'AUTO_DISPATCHED');
 assert.deepEqual(order.items.map(item=>[item.nameSnapshot,item.portionNameSnapshot,item.portionPriceMinor,item.unitPriceMinor,
  item.quantity,item.preparationNote,item.addOnSnapshots]),[['Published meal','Large',20000,22500,2,'Mild spice',[{name:'Mint dip',priceMinor:2500}]]]);
 await db.menuVariant.update({where:{id:variantId},data:{priceMinor:20100,available:false}});
 try{
  assert.deepEqual((await sendOrder(body)).body,first);
  assert.equal((await sendOrder({...body,lines:[orderLine({quantity:3})]})).body.error.code,'CHECKOUT_KEY_CONFLICT');
 }finally{await db.menuVariant.update({where:{id:variantId},data:{priceMinor:20000,available:true}});}
 assert.equal(await db.order.count(),1);
 assert.equal(await db.orderItem.count(),1);
 assert.equal(await db.auditEvent.count({where:{action:'CHECKOUT_ORDER_RECORDED',resourceReference:order.id}}),1);
});

test('each checkout table is reserved to one verified browser, which can place bounded repeat orders',async()=>{
 app=pilotApp();
 await freshPilot();
 assert.equal((await sendOrder(orderBody([orderLine({quantity:6}),orderLine({quantity:5})]))).body.error.code,'CHECKOUT_QUANTITY_LIMIT');
 await db.branchSettings.upsert({where:{tenantId_branchId:{tenantId,branchId}},create:{tenantId,branchId,maxOrderValueMinor:10000},update:{maxOrderValueMinor:10000}});
 try{assert.equal((await sendOrder(orderBody())).body.error.code,'CHECKOUT_VALUE_LIMIT');}
 finally{await db.branchSettings.delete({where:{tenantId_branchId:{tenantId,branchId}}});}
 const responses=await Promise.all([sendOrder(orderBody()),sendOrder(orderBody()),sendOrder(orderBody())]);
 assert.deepEqual(responses.map(response=>response.status).sort(),[201,201,201],responses.map(response=>response.text).join(' '));
 const secondGuest=await join({...joinBody,qrToken,sessionId:pilotSession.id,pinVersion:pilotSession.pinVersion,pin:pilotPin,guestSecret:randomToken()});
 assert.equal(secondGuest.status,409);
 assert.equal((await db.guestSession.count({where:{diningSessionId:pilotSession.id,revokedAt:null}})),1);
 const fourth=await sendOrder(orderBody());
 assert.equal(fourth.status,409);
 assert.equal(fourth.body.error.code,'CHECKOUT_SESSION_LIMIT');
 assert.equal(await db.order.count({where:{diningSessionId:pilotSession.id}}),3);
});

test('expired guest credentials cannot check out and resolved orders retain snapshots after table closure',async()=>{
 await freshPilot();
 await db.branchSettings.upsert({where:{tenantId_branchId:{tenantId,branchId}},create:{tenantId,branchId,approvalQuantity:1},update:{approvalQuantity:1}});
 const held=await sendOrder(orderBody([orderLine({quantity:2})]));
 assert.equal(held.status,201,held.text);
 assert.equal(held.body.status,'AWAITING_REVIEW');
 const expired=pilotGuest;
 const old=await db.guestSession.findUniqueOrThrow({where:{tokenHash:tokenHash(expired.cookie.split('=')[1]!)}}); 
 await db.guestSession.update({where:{id:old.id},data:{expiresAt:new Date(Date.now()-1000)}});
 assert.equal((await sendOrder(orderBody([orderLine()],expired.cartId),expired)).status,401);
 assert.equal((await db.guestSession.findUniqueOrThrow({where:{id:old.id}})).mobileCiphertext,null);
 await db.order.update({where:{id:held.body.orderId},data:{status:'REJECTED',reviewReason:'OTHER_RISK',reviewedAt:new Date()}});
 const closed=await post('/'+tableId+'/close',{version:(await row()).session.version},actors.cashier);
 assert.equal(closed.status,200,closed.text);
 assert.equal((await sendOrder(orderBody())).status,401);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:held.body.orderId}})).status,'REJECTED');
 assert.equal(await db.orderItem.count({where:{orderId:held.body.orderId}}),1);
 await db.branchSettings.delete({where:{tenantId_branchId:{tenantId,branchId}}});
});


const reviewBase=api+'/restaurant/order-review';
const reviewBoard=(actor=actors.admin!)=>request(app).get(reviewBase+query()).set(headers(actor));
const decision=(id:string,body:object,actor=actors.admin!)=>request(app).post(reviewBase+'/'+id+'/decision'+query()).set(headers(actor)).send(body);
const intake=(paused:boolean,version:number,actor=actors.admin!)=>request(app).put(reviewBase+'/intake'+query()).set(headers(actor)).send({paused,version});

async function freshPilot(){
 app=pilotApp();
 await db.order.updateMany({where:{tenantId,branchId},data:{createdAt:new Date(Date.now()-120000)}});
 const previous=(await row()).session;
 if(previous){
  const placed=previous.orders.some((order:{status:string})=>!['REJECTED','CANCELLED'].includes(order.status));
  if(placed){
   // Test isolation emulates completed service and external POS settlement for prior tickets.
   await db.order.updateMany({where:{tenantId,branchId,diningSessionId:previous.id,status:{notIn:['REJECTED','CANCELLED']}},data:{status:'SERVED'}});
   await db.diningSession.update({where:{id:previous.id},data:{billRequestedAt:new Date()}});
   const current=await db.diningSession.findUniqueOrThrow({where:{id:previous.id}});
   const settled=await post('/'+tableId+'/settle',{sessionId:previous.id,version:current.version,externalBillReference:'SYNTHETIC-TEST-CLEANUP-'+previous.id,paymentMethod:'CASH',confirmed:true},actors.cashier);
   assert.equal(settled.status,200,settled.text);
  }else assert.equal((await post('/'+tableId+'/close',{version:previous.version},actors.cashier)).status,200);
 }
 const opened=await open();
 pilotSession=opened.body.board.items.find((item:{id:string})=>item.id===tableId).session;
 pilotPin=opened.body.pin;
 pilotGuest=await joinPilot();
}

test('a 1,000-item cart is refused, while threshold-crossing and repeated orders are held for review',async()=>{
 await freshPilot();
 const oversized=orderBody(Array.from({length:20},()=>orderLine({quantity:50})));
 const before=await db.order.count();
 assert.equal((await sendOrder(oversized)).status,400);
 assert.equal(await db.order.count(),before);
 await db.branchSettings.upsert({where:{tenantId_branchId:{tenantId,branchId}},create:{tenantId,branchId,maxItemQuantity:10,maxOrderQuantity:10,maxOrderValueMinor:220000,approvalQuantity:7,approvalValueMinor:179999},update:{maxItemQuantity:10,maxOrderQuantity:10,maxOrderValueMinor:220000,approvalQuantity:7,approvalValueMinor:179999}});
 try{
  const body=orderBody([orderLine({quantity:8})]);
  const first=await sendOrder(body),second=await sendOrder({...body,key:randomUUID()});
  assert.equal(first.status,201,first.text);assert.equal(second.status,201,second.text);
  const pending=(await reviewBoard()).body.pending;
  const original=pending.find((item:{id:string})=>item.id===first.body.orderId);
  const duplicate=pending.find((item:{id:string})=>item.id===second.body.orderId);
  assert.deepEqual(original.riskSignals,['LARGE_QUANTITY','HIGH_VALUE']);
  assert.deepEqual(duplicate.riskSignals,['LARGE_QUANTITY','HIGH_VALUE','REPEATED_CART']);
  assert.equal(duplicate.status,'AWAITING_REVIEW');
  assert.equal(duplicate.estimatedTotalMinor,180000);
 }finally{await db.branchSettings.delete({where:{tenantId_branchId:{tenantId,branchId}}});}
});

test('review requires the correct role, branch and CSRF, and records one confirmed decision',async()=>{
 app=pilotApp();
 const boardResult=await reviewBoard();
 assert.equal(boardResult.status,200);
 const [first,second]=boardResult.body.pending;
 assert.ok(first&&second);
 assert.ok(!boardResult.text.includes('mobileCiphertext')&&!boardResult.text.includes('requestHash')&&!boardResult.text.includes('guestSessionId'));
 assert.equal((await request(app).get(reviewBase+query())).status,401);
 for(const role of ['worker','chef','cashier','platform','foreign','manager']){
  assert.equal((await reviewBoard(actors[role])).status,403,role);
 }
 assert.equal((await request(app).get(api+'/staff/order-review'+query()).set(headers(actors.manager))).status,200);
 assert.equal((await request(app).get(api+'/staff/order-review'+query()).set(headers(actors.admin))).status,403);
 assert.equal((await decision(first.id,{version:first.version,decision:'APPROVE',override:true},{...actors.admin!,csrf:'bad'})).status,403);
 assert.equal((await request(app).post(reviewBase+'/'+first.id+'/decision?tenantId='+foreignTenant+'&branchId='+foreignBranch).set(headers(actors.foreign)).send({version:first.version,decision:'APPROVE',override:true})).status,404);
 assert.equal((await decision(first.id,{version:first.version,decision:'APPROVE',override:false})).body.error.code,'REVIEW_OVERRIDE_REQUIRED');
 const approve=()=>request(app).post(api+'/staff/order-review/'+first.id+'/decision'+query()).set(headers(actors.manager)).send({version:first.version,decision:'APPROVE',override:true});
 const parallel=await Promise.all([approve(),approve()]);
 assert.deepEqual(parallel.map(result=>result.status).sort(),[200,409],parallel.map(result=>result.text).join(' '));
 assert.equal(parallel.find(result=>result.status===200)?.body.status,'PLACED');
 assert.equal(await db.auditEvent.count({where:{tenantId,branchId,action:'CHECKOUT_RISK_OVERRIDDEN',resourceReference:first.id}}),1);
 const rejected=await decision(second.id,{version:second.version,decision:'REJECT',reason:'DUPLICATE'});
 assert.equal(rejected.status,200,rejected.text);
 assert.equal(rejected.body.status,'REJECTED');
 assert.equal((await decision(second.id,{version:second.version,decision:'REJECT',reason:'DUPLICATE'})).status,409);
 await db.order.update({where:{id:first.id},data:{status:'SERVED'}});
 await db.diningSession.update({where:{id:pilotSession.id},data:{billRequestedAt:new Date()}});
 const current=await db.diningSession.findUniqueOrThrow({where:{id:pilotSession.id}});
 const closed=await post('/'+tableId+'/settle',{sessionId:pilotSession.id,version:current.version,externalBillReference:'SYNTHETIC-TEST-REVIEW',paymentMethod:'CASH',confirmed:true},actors.cashier);
 assert.equal(closed.status,200,closed.text);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:first.id}})).status,'SERVED');
 assert.equal((await db.order.findUniqueOrThrow({where:{id:second.id}})).status,'REJECTED');
});

test('pause blocks new checkout while an idempotent retry still returns its original receipt',async()=>{
 await freshPilot();
 const body=orderBody(),submitted=await sendOrder(body);
 assert.equal(submitted.status,201,submitted.text);
 const version=(await reviewBoard()).body.intake.version;
 assert.equal((await intake(true,version,actors.worker)).status,403);
 const paused=await intake(true,version);
 assert.equal(paused.status,200,paused.text);
 assert.deepEqual(paused.body,{paused:true,version:version+1});
 assert.equal((await intake(false,version)).status,409);
 const replay=await sendOrder(body);
 assert.equal(replay.status,200);
 assert.deepEqual(replay.body,submitted.body);
 const blocked=await sendOrder(orderBody());
 assert.equal(blocked.body.error.code,'CHECKOUT_PAUSED');
 assert.equal((await reviewBoard()).body.pending.length,0);
 assert.equal((await intake(false,paused.body.version)).status,200);
 assert.equal((await sendOrder(orderBody())).status,201);
});

test('platform deactivation blocks new orders from an already verified guest',async()=>{
 await freshPilot();
 const placedOrder=orderBody();
 const original=await sendOrder(placedOrder);
 assert.equal(original.status,201,original.text);
 const orders={tenantId,branchId,diningSessionId:pilotSession.id};
 const platformTenant=api+'/super-admin/tenants/'+tenantId;
 for(const status of ['DRAFT','SUSPENDED'] as const){
  const tenant=await db.tenant.findUniqueOrThrow({where:{id:tenantId}});
  const changed=await request(app).patch(platformTenant).set(headers(actors.platform)).send({status,version:tenant.version});
  assert.equal(changed.status,200,changed.text);
  try{
   const guest=await db.guestSession.findUniqueOrThrow({where:{id:pilotGuest.cartId}});
   assert.equal(guest.revokedAt,null);
   const blocked=await sendOrder(orderBody());
   assert.equal(blocked.status,409,blocked.text);
   assert.equal(blocked.body.error.code,'CHECKOUT_UNAVAILABLE');
   if(status==='DRAFT'){
    const replay=await sendOrder(placedOrder);
    assert.equal(replay.status,200,replay.text);
    assert.deepEqual(replay.body,original.body);
   }
   assert.equal(await db.order.count({where:orders}),1);
  }finally{
   await db.tenant.update({where:{id:tenantId},data:{status:'TRIAL'}});
   await db.branch.update({where:{id:branchId},data:{active:true}});
  }
 }
});

test('the same verified guest can repeat checkout without a second PIN while table burst controls still apply',async()=>{
 await freshPilot();
 const first=await sendOrder(orderBody([orderLine()],pilotGuest.cartId),pilotGuest);
 assert.equal(first.status,201,first.text);
 assert.equal((await request(app).post(api+'/guest/session').set(headers(pilotGuest)).send({qrToken})).status,200);
 const repeats=await Promise.all([sendOrder(orderBody([orderLine()],pilotGuest.cartId),pilotGuest),sendOrder(orderBody([orderLine()],pilotGuest.cartId),pilotGuest)]);
 assert.deepEqual(repeats.map(result=>result.status).sort(),[201,201],repeats.map(result=>result.text).join(' '));
 const fourth=await sendOrder(orderBody([orderLine()],pilotGuest.cartId),pilotGuest);
 assert.equal(fourth.status,409);
 assert.equal(fourth.body.error.code,'CHECKOUT_SESSION_LIMIT');
 const pending=(await reviewBoard()).body.pending;
 assert.equal(pending.length,2);
 assert.equal(pending.filter((item:{riskSignals:string[]})=>item.riskSignals.includes('TABLE_BURST')).length,1);
});

test('branch burst ceiling is serialized across separate tables and does not count another tenant',async()=>{
 await freshPilot();
 const secondQr=await rotateQr(otherTable);
 const secondToken=secondQr.body.qr.url.split('#')[1];
 const secondOpen=await open(otherTable);
 const session=secondOpen.body.board.items.find((item:{id:string})=>item.id===otherTable).session;
 const secondJoin=await join({qrToken:secondToken,sessionId:session.id,pinVersion:session.pinVersion,pin:secondOpen.body.pin,
  displayName:'Second test guest',mobile:'+919999999998',privacyAccepted:true,guestSecret:randomToken()});
 assert.equal(secondJoin.status,200,secondJoin.text);
 const secondGuest={cookie:String(secondJoin.headers['set-cookie']![0]).split(';')[0]!,csrf:secondJoin.body.csrfToken,cartId:secondJoin.body.cartId};
 // Seed durable background orders at another table, so neither tested table hits its individual ceiling.
 const another=await db.restaurantTable.create({data:{tenantId,branchId,label:'Background table',section:'Main',seats:4}});
 const oldSession=await db.diningSession.create({data:{tenantId,branchId,tableId:another.id,entryOnly:true,checkoutPilot:true,state:'CLOSED',closedAt:new Date(),expiresAt:new Date(Date.now()+60000)}});
 const oldGuest=await db.guestSession.create({data:{tenantId,branchId,diningSessionId:oldSession.id,tokenHash:tokenHash(randomToken()),displayName:'Guest',expiresAt:new Date(Date.now()+60000)}});
 const syntheticOrders=(scope:{tenantId:string;branchId:string},diningSessionId:string,guestSessionId:string,n:number)=>
  Array.from({length:n},()=>({...scope,diningSessionId,guestSessionId,idempotencyKey:randomUUID(),requestHash:tokenHash(randomToken()),status:'CANCELLED' as const,estimatedTotalMinor:0}));
 await db.order.createMany({data:syntheticOrders({tenantId,branchId},oldSession.id,oldGuest.id,19)});
 const foreignTable=await db.restaurantTable.create({data:{tenantId:foreignTenant,branchId:foreignBranch,label:'Foreign table',section:'Main',seats:4}});
 const foreignSession=await db.diningSession.create({data:{tenantId:foreignTenant,branchId:foreignBranch,tableId:foreignTable.id,entryOnly:true,checkoutPilot:true,state:'CLOSED',closedAt:new Date(),expiresAt:new Date(Date.now()+60000)}});
 const foreignGuest=await db.guestSession.create({data:{tenantId:foreignTenant,branchId:foreignBranch,diningSessionId:foreignSession.id,tokenHash:tokenHash(randomToken()),displayName:'Guest',expiresAt:new Date(Date.now()+60000)}});
 await db.order.createMany({data:syntheticOrders({tenantId:foreignTenant,branchId:foreignBranch},foreignSession.id,foreignGuest.id,3)});
 const results=await Promise.all([pilotGuest,secondGuest].map(actor=>sendOrder(orderBody([orderLine()],actor.cartId),actor)));
 assert.deepEqual(results.map(result=>result.status).sort(),[201,429],results.map(result=>result.text).join(' '));
 const orders=(await reviewBoard()).body.pending;
 assert.equal(orders.length,1);
 assert.ok(orders[0].riskSignals.includes('BRANCH_BURST'));
});

test('reserved checkout enforces cutoff, consumes the code once, and releases the table on POS settlement',async()=>{
 await freshPilot();
 const tablePath='/'+tableId;
 assert.equal((await post(tablePath+'/close',{version:(await row()).session.version},actors.cashier)).status,200);
 const slots=Array.from({length:7},(_,day)=>({day,closed:true,opens:'00:00',closes:'00:00',closesNextDay:true}));
 await db.branchSettings.upsert({where:{tenantId_branchId:{tenantId,branchId}},create:{tenantId,branchId,businessHours:slots,lastSeatingMinutes:15},update:{businessHours:slots,lastSeatingMinutes:15}});
 try{
  const denied=await post(tablePath+'/open',{version:(await row()).version,durationMinutes:120},actors.worker);
  assert.equal(denied.body.error.code,'SEATING_CLOSED');
  const hour=Number(new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Kolkata',hour:'numeric',hourCycle:'h23'}).format(new Date()));
  const boundary=hour>=23?'12:00':'00:00';
  await db.branchSettings.update({where:{tenantId_branchId:{tenantId,branchId}},data:{businessHours:slots.map(slot=>({...slot,closed:false,opens:boundary,closes:boundary}))}});
  const opened=await open();
  pilotSession=(await row()).session;
  pilotPin=opened.body.pin;
  pilotGuest=await joinPilot();
  const other=await join({...joinBody,qrToken,sessionId:pilotSession.id,pinVersion:pilotSession.pinVersion,pin:pilotPin,guestSecret:randomToken()});
  assert.equal(other.status,409,other.text);
  const order=await sendOrder(orderBody());
  assert.equal(order.status,201,order.text);
  assert.equal((await sendOrder(orderBody())).status,201);
  const track=(actor:Actor=pilotGuest)=>request(app).post(api+'/guest/order-status').set(headers(actor)).send({});
  assert.equal((await track({...pilotGuest,csrf:'wrong'})).status,403);
  assert.equal((await track(actors.cashier)).status,401);
  const tracked=await track();
  assert.equal(tracked.status,200,tracked.text);
  assert.equal(tracked.body.orders.length,2);
  assert.ok(tracked.body.orders.some((item:{orderId:string})=>item.orderId===order.body.orderId));
  const version=(await row()).session.version;
  assert.equal((await post(tablePath+'/close',{version},actors.cashier)).status,409);
  const bill=()=>request(app).post(api+'/guest/bill').set(headers(pilotGuest)).send({});
  assert.equal((await bill()).status,200);
  assert.equal((await bill()).status,200);
  const requested=(await row()).session;
  assert.ok(requested.billRequestedAt);
  const resume={sessionId:pilotSession.id,version:requested.version};
  assert.equal((await post(tablePath+'/bill/resume',resume,actors.cashier)).status,403);
  assert.equal((await post(tablePath+'/bill/resume',resume,actors.manager)).status,200);
  assert.equal((await row()).session.billRequestedAt,null);
  assert.equal((await bill()).status,200);
  assert.equal((await sendOrder(orderBody())).body.error.code,'BILL_REQUESTED');
  const settlement={sessionId:pilotSession.id,version:(await row()).session.version,externalBillReference:'TEST-POS-18',paymentMethod:'UPI',confirmed:true};
  const settle=()=>post(tablePath+'/settle',settlement,actors.cashier);
  const waiterBeforeService=await post(tablePath+'/settle',settlement,actors.worker);
  assert.equal(waiterBeforeService.status,409);
  assert.equal(waiterBeforeService.body.error.code,'ORDERS_NOT_SERVED');
  assert.equal((await settle()).status,409);
  await db.order.updateMany({where:{tenantId,branchId,diningSessionId:pilotSession.id},data:{status:'SERVED'}});
  assert.ok((await track()).body.orders.every((item:{status:string})=>item.status==='SERVED'));
  const waiterSettle=()=>post(tablePath+'/settle',settlement,actors.worker);
  assert.deepEqual((await Promise.all([settle(),waiterSettle()])).map(result=>result.status).sort(),[200,409]);
  assert.equal(await db.billingHandoff.count({where:{diningSessionId:pilotSession.id}}),1);
  assert.equal((await track()).status,401);
  assert.equal((await row()).session,null);
  assert.equal((await sendOrder(orderBody())).status,401);
  const handoff=await db.billingHandoff.findFirstOrThrow({where:{diningSessionId:pilotSession.id}});
  assert.equal(handoff.status,'EXTERNALLY_SETTLED');
  assert.equal(handoff.paymentMethod,'UPI');
  const retryTable=await db.restaurantTable.findFirstOrThrow({where:{tenantId,branchId,id:tableId}});
  const internalSession=await db.diningSession.create({data:{
   tenantId,branchId,tableId:retryTable.id,entryOnly:true,checkoutPilot:true,billRequestedAt:new Date(),
   pinHash:await hashPassword("123456"),pinExpiresAt:new Date(Date.now()+30_000),
   expiresAt:new Date(Date.now()+60_000),
  }});
  const original=await db.order.findFirstOrThrow({where:{diningSessionId:pilotSession.id,status:'SERVED'},include:{items:true}});
  const receiptGuest=await db.guestSession.create({data:{
   tenantId,branchId,diningSessionId:internalSession.id,displayName:'Synthetic',
   tokenHash:tokenHash(randomToken()),expiresAt:internalSession.expiresAt,
  }});
  await db.order.create({data:{
   tenantId,branchId,diningSessionId:internalSession.id,guestSessionId:receiptGuest.id,
   idempotencyKey:'internal-receipt',requestHash:'a'.repeat(64),status:'SERVED',
   estimatedTotalMinor:original.estimatedTotalMinor,items:{createMany:{data:original.items.map(item=>({
    menuItemId:item.menuItemId,nameSnapshot:item.nameSnapshot,quantity:item.quantity,unitPriceMinor:item.unitPriceMinor,
   }))}},
  }});
  const internal={sessionId:internalSession.id,version:internalSession.version,billingMode:'RESTRODOCK',paymentMethod:'CASH',confirmed:true};
  const issue=()=>post(tablePath+'/settle',internal,actors.cashier);
  assert.equal((await issue()).body.error.code,'BILLING_MODE_CHANGED');
  await db.tenant.update({where:{id:tenantId},data:{billingMode:'RESTRODOCK'}});
  await engine.exec(`CREATE FUNCTION reject_receipt_close() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'synthetic table closure failure'; END $$;
   CREATE TRIGGER reject_receipt_close BEFORE UPDATE ON "DiningSession"
    FOR EACH ROW WHEN (NEW.state = 'CLOSED') EXECUTE FUNCTION reject_receipt_close();`);
  try {
   assert.equal((await issue()).status,500);
   assert.equal(await db.billingHandoff.count({where:{diningSessionId:internalSession.id}}),0);
   assert.equal((await db.guestSession.findUniqueOrThrow({where:{id:receiptGuest.id}})).revokedAt,null);
  } finally {
   await engine.exec('DROP TRIGGER reject_receipt_close ON "DiningSession"; DROP FUNCTION reject_receipt_close();');
  }
  const issued=await issue();
  assert.equal(issued.status,200,issued.text);
  const paid=issued.body.board.items.find((item:{id:string})=>item.id===tableId).receipt;
  assert.equal(paid.totalMinor,original.estimatedTotalMinor);
  assert.equal(paid.paymentMethod,'CASH');
  assert.equal((await issue()).status,200);
  assert.equal((await post(tablePath+'/settle',{...internal,paymentMethod:'UPI'},actors.cashier)).status,409);
  assert.equal(await db.billingHandoff.count({where:{diningSessionId:internalSession.id}}),1);
  await db.tenant.update({where:{id:tenantId},data:{billingMode:'EXTERNAL_POS'}});
  const reopen={version:(await row()).version,durationMinutes:120,settledSessionId:internalSession.id,approved:true};
  assert.equal((await post(tablePath+'/reopen-settled',reopen,actors.worker)).status,403);
  assert.equal((await post(tablePath+'/reopen-settled',reopen,actors.manager)).status,200);
  assert.notEqual((await row()).session.id,pilotSession.id);
  assert.equal((await track()).status,401);
  assert.equal((await db.billingHandoff.findUniqueOrThrow({where:{id:handoff.id}})).status,'EXTERNALLY_SETTLED');
 }finally{
  await db.branchSettings.delete({where:{tenantId_branchId:{tenantId,branchId}}});
 }
});

test('expired subscriptions block new tables while open tables can still order and replay',async()=>{
 await freshPilot();
 const {id:newTable}=await db.restaurantTable.create({data:{tenantId,branchId,label:'Subscription test table',section:'Main',seats:2}});
 await rotateQr(newTable);
 const prior=await db.subscription.findUnique({where:{tenantId}});
 const order=orderBody([orderLine()],pilotGuest.cartId);
 const first=await sendOrder(order,pilotGuest);
 assert.equal(first.status,201,first.text);
 try{
  await db.subscription.upsert({
   where:{tenantId},
   create:{tenantId,planCode:'STARTER',status:'ACTIVE',endsAt:new Date(0)},
   update:{planCode:'STARTER',status:'ACTIVE',endsAt:new Date(0)},
  });
  const blocked=await post('/'+newTable+'/open',{version:(await row(newTable)).version,durationMinutes:120},actors.worker);
  assert.equal(blocked.status,409,blocked.text);
  assert.equal(blocked.body.error.code,'SUBSCRIPTION_ENDED');
  const followup=await sendOrder(orderBody([orderLine()],pilotGuest.cartId),pilotGuest);
  assert.equal(followup.status,201,followup.text);
  const replay=await sendOrder(order,pilotGuest);
  assert.equal(replay.status,200,replay.text);
  assert.deepEqual(replay.body,first.body);
  const bill=await request(app).post(api+'/guest/bill').set(headers(pilotGuest)).send({});
  assert.equal(bill.status,200,bill.text);
  await db.subscription.update({where:{tenantId},data:{endsAt:new Date(Date.now()+86400000)}});
  await open(newTable);
 }finally{
  if(prior)await db.subscription.update({where:{tenantId},data:{planCode:prior.planCode,status:prior.status,endsAt:prior.endsAt}});
  else await db.subscription.deleteMany({where:{tenantId}});
 }
});

test('assigned kitchen staff operate one approved ticket through pickup without exposing guest data',async()=>{
 await freshPilot();
 const ask=(actor:Actor=pilotGuest)=>request(app).post(api+'/guest/assistance').set(headers(actor)).send({});
 await db.branchSettings.upsert({where:{tenantId_branchId:{tenantId,branchId}},create:{tenantId,branchId,assistanceEnabled:true,approvalQuantity:1},update:{assistanceEnabled:true,approvalQuantity:1}});
 assert.equal((await ask({...pilotGuest,csrf:'wrong'})).status,403);
 assert.deepEqual((await Promise.all([ask(),ask()])).map(result=>result.status),[200,200]);
 const requesting=(await row()).session;
 assert.ok(requesting.assistanceRequestedAt);
 assert.equal(requesting.version,pilotSession.version+2);
 const clear=(version:number)=>post('/'+tableId+'/assistance/resolve',{version},actors.worker);
 assert.equal((await clear(pilotSession.version)).status,409);
 assert.equal((await clear(requesting.version)).status,200);
 assert.equal((await row()).session.assistanceRequestedAt,null);
 const kitchen=api+'/staff/kitchen';
 const queue=(actor:Actor)=>request(app).get(kitchen+query()).set(headers(actor));
 const change=(actor:Actor,id:string,version:number,action:string,note?:string)=>request(app)
  .post(kitchen+'/'+id+'/action'+query()).set(headers(actor)).send({version,action,note});
 const submit=await sendOrder(orderBody());
 assert.equal(submit.status,201,submit.text);
 const id=submit.body.orderId;
 const ticket=async(actor=actors.chef!)=>{
  const result=await queue(actor);
  assert.equal(result.status,200,result.text);
  return result.body.tickets.find((item:{id:string})=>item.id===id);
 };
 assert.equal((await ticket()).status,'AWAITING_REVIEW');
 assert.equal((await ticket(actors.worker!)).status,'AWAITING_REVIEW');
 for(const role of ['platform','cashier','foreign','admin'])assert.equal((await queue(actors[role]!)).status,403);
 assert.equal((await decision(id,{version:1,decision:'APPROVE',override:true})).status,200);
 const placed=await ticket();
 assert.equal(placed.status,'PLACED');
 assert.equal(placed.items[0].note,'Mild spice');
 assert.deepEqual(placed.items[0].addOns,['Mint dip']);
 assert.equal('guestSessionId' in placed,false);
 assert.equal(await ticket(actors.worker!),undefined);
 assert.equal((await change(actors.worker!,id,2,'ACCEPT')).status,403);
 assert.equal((await change(actors.chef!,id,2,'REJECT','   ')).status,400);
 assert.equal((await change(actors.chef!,id,2,'READY')).status,409);
 const race=await Promise.all([change(actors.chef!,id,2,'ACCEPT','Use separate pan'),change(actors.chef!,id,2,'ACCEPT','Use separate pan')]);
 assert.deepEqual(race.map(response=>response.status).sort(),[200,409]);
 assert.equal((await ticket()).kitchenNote,'Use separate pan');
 const close=await post('/'+tableId+'/close',{version:(await row()).session.version},actors.cashier);
 assert.equal(close.status,409);
 assert.equal(close.body.error.code,'SERVICE_HANDOFF_REQUIRED');
 assert.equal((await change(actors.chef!,id,3,'PREPARE')).status,200);
 const second=await sendOrder(orderBody());
 assert.equal(second.status,201,second.text);
 const secondId=second.body.orderId;
 assert.deepEqual((await row()).session.orders.map((order:{id:string})=>order.id).sort(),[id,secondId].sort());
 assert.equal((await decision(secondId,{version:1,decision:'APPROVE',override:true})).status,200);
 assert.equal((await change(actors.chef!,secondId,2,'REJECT','Item unavailable')).status,200);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:secondId}})).kitchenNote,'Item unavailable');
 const expiredAt=new Date(Date.now()-1000);
 await db.diningSession.update({where:{id:pilotSession.id},data:{openedAt:new Date(expiredAt.getTime()-3600000),expiresAt:expiredAt,pinExpiresAt:expiredAt}});
 assert.equal((await board()).status,200);
 const expiredGuest=await db.guestSession.findFirstOrThrow({where:{diningSessionId:pilotSession.id}});
 assert.ok(expiredGuest.revokedAt);
 assert.equal(expiredGuest.mobileCiphertext,null);
 assert.equal((await change(actors.chef!,id,4,'READY')).status,200);
 assert.equal((await ticket(actors.worker!)).status,'READY');
 assert.equal((await change(actors.chef!,id,5,'SERVE')).status,403);
 assert.equal((await change(actors.worker!,id,5,'SERVE')).status,200);
 assert.equal((await ticket(actors.worker!)).status,'SERVED');
 assert.equal((await reviewBoard()).body.recent.find((item:{id:string})=>item.id===id).status,'SERVED');
 const events=await db.auditEvent.findMany({where:{tenantId,branchId,resourceReference:id,action:{startsWith:'KITCHEN_'}},select:{action:true}});
 assert.deepEqual(events.map(event=>event.action).sort(),['KITCHEN_ACCEPTED','KITCHEN_PREPARING','KITCHEN_READY','KITCHEN_SERVED']);
});

test('analytics scopes operational metrics and groups dates at branch-local midnight',async()=>{
 await db.tenant.update({where:{id:tenantId},data:{status:'ACTIVE'}});
 await db.branch.update({where:{id:branchId},data:{active:true}});
 const template=await db.order.findFirstOrThrow({where:{tenantId,branchId,items:{some:{}}},include:{items:true}});
 const sample=template.items[0]!;
 const createdAt=new Date('2030-01-01T18:30:00Z');
 const order=await db.order.create({data:{tenantId,branchId,diningSessionId:template.diningSessionId,
  guestSessionId:template.guestSessionId,idempotencyKey:randomUUID(),requestHash:tokenHash('analytics-test'),status:'SERVED',
  estimatedTotalMinor:24600,createdAt,items:{createMany:{data:[{menuItemId:sample.menuItemId,nameSnapshot:'Analytics paneer',quantity:2,unitPriceMinor:12300}]}}}});
 const {id:held}=await db.order.create({data:{tenantId,branchId,diningSessionId:template.diningSessionId,
  guestSessionId:template.guestSessionId,idempotencyKey:randomUUID(),requestHash:tokenHash('analytics-held'),status:'AWAITING_REVIEW',estimatedTotalMinor:99999,createdAt}});
 const {id:previous}=await db.order.create({data:{tenantId,branchId,diningSessionId:template.diningSessionId,
  guestSessionId:template.guestSessionId,idempotencyKey:randomUUID(),requestHash:tokenHash('analytics-previous'),
  status:'PLACED',estimatedTotalMinor:12000,createdAt:new Date('2029-12-31T18:29:59Z')}});
 await db.auditEvent.createMany({data:[
  {tenantId,branchId,actorReference:'test',resourceReference:order.id,action:'KITCHEN_ACCEPTED',createdAt},
  {tenantId,branchId,actorReference:'test',resourceReference:order.id,action:'KITCHEN_PREPARING',createdAt:new Date('2030-01-01T18:31:00Z')},
  {tenantId,branchId,actorReference:'test',resourceReference:previous,action:'KITCHEN_READY',createdAt},
  {tenantId,branchId,actorReference:'test',resourceReference:order.id,action:'KITCHEN_READY',createdAt:new Date('2030-01-01T18:35:00Z')},
  {tenantId,branchId,actorReference:'test',resourceReference:template.diningSessionId,action:'BILL_REQUESTED',createdAt},
  {tenantId:foreignTenant,branchId:foreignBranch,actorReference:'test',resourceReference:held,action:'BILL_REQUESTED',createdAt},
 ]});
 const settled=await db.billingHandoff.findFirstOrThrow({where:{tenantId,branchId,status:'EXTERNALLY_SETTLED'}});
 await db.billingHandoff.update({where:{id:settled.id},data:{staffConfirmedAt:createdAt}});
 const url=api+'/restaurant/analytics'+query()+'&start=2030-01-01&end=2030-01-02';
 assert.equal((await request(app).get(url)).status,401);
 for(const actor of [actors.manager,actors.worker,actors.foreign,actors.platform]){
  assert.equal((await request(app).get(url).set(headers(actor))).status,403);
 }
 assert.equal((await request(app).get(api+'/restaurant/analytics'+query()+'&start=2030-01-01&end=2030-02-01').set(headers())).status,400);
 const result=await request(app).get(url).set(headers());
 assert.equal(result.status,200,result.text);
 assert.deepEqual(result.body.days,[{date:'2030-01-01',orders:0,held:0},{date:'2030-01-02',orders:2,held:1}]);
 assert.deepEqual(result.body.demand,[{name:'Analytics paneer',quantity:2}]);
 assert.deepEqual(result.body.totals,{orders:2,held:1,pendingReview:1,estimatedMinor:24600,billRequests:1,
  confirmedSettlements:1,confirmedMinor:null,kitchenSample:1,kitchenAverageSeconds:300});
 const drilldown=result.body.drilldown;
 assert.equal(drilldown.previousStart,'2029-12-30');
 assert.equal(drilldown.previousEnd,'2029-12-31');
 assert.deepEqual(drilldown.previous,{orders:1,eligible:1,estimatedMinor:12000,cancelled:0,rejected:0});
 assert.deepEqual(drilldown.current,{orders:2,eligible:1,estimatedMinor:24600,cancelled:0,rejected:0});
 assert.deepEqual(drilldown.dailyValue,[{date:'2030-01-01',eligible:0,estimatedMinor:0},{date:'2030-01-02',eligible:1,estimatedMinor:24600}]);
 assert.equal(drilldown.hours.length,24);
 assert.deepEqual(drilldown.hours.filter((hour:{orders:number})=>hour.orders>0),[{hour:0,orders:2}]);
 const item=await db.menuItem.findUniqueOrThrow({where:{id:sample.menuItemId},include:{category:true}});
 assert.deepEqual(drilldown.menu,[{id:item.id,name:item.name,category:item.category.name,orders:1,quantity:2,estimatedMinor:24600}]);
 assert.deepEqual(drilldown.categories,[{name:item.category.name,quantity:2,estimatedMinor:24600}]);
 assert.deepEqual(drilldown.preparation,{sample:1,medianSeconds:240,p90Seconds:240});
 const empty=await request(app).get(api+'/restaurant/analytics'+query()+'&start=2030-01-10&end=2030-01-10').set(headers());
 assert.equal(empty.status,200,empty.text);
 assert.deepEqual(empty.body.drilldown.preparation,{sample:0,medianSeconds:null,p90Seconds:null});
 assert.deepEqual(empty.body.drilldown.menu,[]);
 const analytics=api+'/restaurant/analytics'+query();
 const todayUrl=analytics+'&period=today';
 const [boundary]=await db.$queryRaw<{today:string;previous:string;start:Date}[]>`
  SELECT (CURRENT_TIMESTAMP AT TIME ZONE timezone)::date::text AS today,
    ((CURRENT_TIMESTAMP AT TIME ZONE timezone)::date-1)::text AS previous,
    date_trunc('day',CURRENT_TIMESTAMP AT TIME ZONE timezone) AT TIME ZONE timezone AS start
  FROM "Branch" WHERE id=${branchId}::uuid
 `;
 assert.ok(boundary);
 const fixtureValue=74321;
 const fixtureOrders=await db.order.createManyAndReturn({data:[0,-1].map(offset=>({
  tenantId,branchId,diningSessionId:template.diningSessionId,guestSessionId:template.guestSessionId,
  idempotencyKey:randomUUID(),requestHash:tokenHash('analytics-today-'+offset),status:'SERVED',
  estimatedTotalMinor:fixtureValue,createdAt:new Date(boundary.start.getTime()+offset)
 }))});
 try{
  const today=await request(app).get(todayUrl).set(headers());
  assert.equal(today.status,200,today.text);
  assert.equal(today.headers['cache-control'],'private, no-store');
  assert.equal(today.body.start,boundary.today);
  assert.equal(today.body.end,boundary.today);
  assert.equal(today.body.drilldown.previousStart,boundary.previous);
  assert.equal(today.body.drilldown.previousEnd,boundary.previous);
  assert.deepEqual(today.body.days.map((day:{date:string})=>day.date),[boundary.today]);
  assert.equal((await request(app).get(todayUrl).set(headers(actors.foreign))).status,403);
  assert.equal((await request(app).get(todayUrl+'&start=2030-01-01&end=2030-01-02').set(headers())).status,400);
  const week=await request(app).get(analytics).set(headers());
  assert.equal(week.status,200,week.text);
  assert.equal(week.body.days.length,7);
  await db.order.deleteMany({where:{id:{in:fixtureOrders.map(order=>order.id)}}});
  const baseline=await request(app).get(todayUrl).set(headers());
  assert.equal(baseline.status,200,baseline.text);
  for(const period of ['current','previous']){
   assert.equal(today.body.drilldown[period].orders-baseline.body.drilldown[period].orders,1);
   assert.equal(today.body.drilldown[period].estimatedMinor-baseline.body.drilldown[period].estimatedMinor,fixtureValue);
  }
 }finally{
  await db.order.deleteMany({where:{id:{in:fixtureOrders.map(order=>order.id)}}});
 }
 await db.subscription.create({data:{tenantId,planCode:'STARTER'}});
 try{
  const denied=await request(app).get(url).set(headers());
  assert.equal(denied.status,403,denied.text);
  assert.equal(denied.body.error.code,'PLAN_FEATURE_REQUIRED');
  assert.equal((await request(app).get(todayUrl).set(headers())).body.error.code,'PLAN_FEATURE_REQUIRED');
 }finally{
  await db.subscription.delete({where:{tenantId}});
 }
});

test('bulk table moves are admin-only and roll back on a stale table',async()=>{
 const create=(label:string)=>db.restaurantTable.create({data:{tenantId,branchId,label,section:'Old section',seats:2}});
 const [one,two]=await Promise.all([create('Bulk table 1'),create('Bulk table 2')]);
 const tables=[one,two].map(({id,version})=>({id,version}));
 const payload={section:'New section',tables};
 const denied=await request(app).put(api+'/restaurant/tables/section'+query()).set(headers(actors.worker)).send(payload);
 assert.equal(denied.status,403);
 assert.equal((await put('/section',{...payload,tables:[...tables.slice(0,1),{id:two.id,version:two.version+1}]})).status,409);
 assert.equal(await db.restaurantTable.count({where:{id:{in:[one.id,two.id]},section:'Old section'}}),2);
 const saved=await put('/section',payload);
 assert.equal(saved.status,200,saved.text);
 assert.equal(await db.restaurantTable.count({where:{id:{in:[one.id,two.id]},section:'New section'}}),2);
});


test('PIN-free first orders stay private to the waiter until one guest is confirmed at the table',async()=>{
 app=pilotApp();
 await db.tenant.update({where:{id:tenantId},data:{status:'TRIAL'}});
 await db.branch.update({where:{id:branchId},data:{active:true}});
 await db.branchSettings.updateMany({where:{tenantId,branchId},data:{lastSeatingMinutes:null,approvalQuantity:null,approvalValueMinor:null}});
 await db.checkoutIntake.updateMany({where:{tenantId,branchId},data:{paused:false}});
 await db.order.updateMany({where:{tenantId,branchId},data:{createdAt:new Date(Date.now()-120000)}});
 const saved=(await post('',{revision:(await board()).body.revision,label:'Waiter confirmation table',section:'Main',seats:4})).body.board;
 const table=saved.items.find((item:{label:string})=>item.label==='Waiter confirmation table');
 const qr=(await post('/'+table.id+'/qr',{version:table.version})).body.qr.url.split('#')[1];
 const requestGuest=async(name:string)=>{
  const response=await request(app).post(api+'/table-entry/request').set('Origin',config.CLIENT_ORIGIN).send({
   qrToken:qr,displayName:name,mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken(),
  });
  assert.equal(response.status,200,response.text);
  assert.equal(response.body.awaitingWaiter,true);
  return {cookie:String(response.headers['set-cookie']![0]).split(';')[0]!,csrf:response.body.csrfToken,cartId:response.body.cartId};
 };
 const first=await requestGuest('Synthetic first guest');
 const second=await requestGuest('Synthetic second guest');
 const opened=await db.diningSession.findFirstOrThrow({where:{tenantId,branchId,tableId:table.id,state:'OPEN'}});
 assert.equal((await post('/'+table.id+'/pin',{version:opened.version},actors.worker)).body.error.code,'PIN_NOT_REQUIRED');
 const body=orderBody([orderLine({quantity:1,note:'First request'})],first.cartId);
 const placed=await sendOrder(body,first);
 assert.equal(placed.status,201,placed.text);
 assert.equal(placed.body.status,'AWAITING_REVIEW');
 const competing=await sendOrder(orderBody([orderLine({quantity:1,note:'Other guest'})],second.cartId),second);
 assert.equal(competing.status,201,competing.text);
 assert.equal((await sendOrder(orderBody([orderLine()],first.cartId),first)).body.error.code,'WAITER_REVIEW_PENDING');
 const kitchen=()=>request(app).get(api+'/staff/kitchen'+query()).set(headers(actors.chef));
 assert.ok(!(await kitchen()).body.tickets.some((ticket:{id:string})=>ticket.id===placed.body.orderId||ticket.id===competing.body.orderId));
 const reviewPath=api+'/staff/order-review';
 const load=await request(app).get(reviewPath+query()).set(headers(actors.worker));
 assert.equal(load.status,200,load.text);
 const pending=load.body.pending.find((order:{id:string})=>order.id===placed.body.orderId);
 assert.equal(pending.guestName,'Synthetic first guest');
 assert.equal((await request(app).put(reviewPath+'/intake'+query()).set(headers(actors.worker)).send({version:load.body.intake.version,paused:true})).status,403);
 const decisionPath=reviewPath+'/'+pending.id+'/decision'+query();
 assert.equal((await request(app).post(decisionPath).set(headers(actors.chef)).send({version:pending.version,decision:'APPROVE',override:true})).status,403);
 assert.equal((await request(app).post(decisionPath).set({...headers(actors.worker),'X-CSRF-Token':'wrong'}).send({version:pending.version,decision:'APPROVE',override:true})).status,403);
 const decisions=await Promise.all([0,1].map(()=>request(app).post(decisionPath).set(headers(actors.worker)).send({version:pending.version,decision:'APPROVE',override:true})));
 assert.equal(decisions.filter(response=>response.status===200).length,1,decisions.map(response=>response.text).join(' '));
 assert.ok(decisions.every(response=>[200,404,409].includes(response.status)));
 const approved=decisions.find(response=>response.status===200)!;
 assert.equal(approved.body.status,'PLACED');
 assert.equal(approved.body.awaitingWaiter,false);
 assert.ok((await kitchen()).body.tickets.some((ticket:{id:string})=>ticket.id===pending.id));
 assert.equal((await db.order.findUniqueOrThrow({where:{id:competing.body.orderId}})).status,'REJECTED');
 assert.ok((await db.guestSession.findUniqueOrThrow({where:{id:first.cartId}})).waiterConfirmedAt);
 assert.equal((await sendOrder(body,first)).status,200);
 await db.order.updateMany({where:{tenantId,branchId},data:{createdAt:new Date(Date.now()-120000)}});
 const repeat=await sendOrder(orderBody([orderLine({quantity:1,note:'Follow-up dish'})],first.cartId),first);
 assert.equal(repeat.status,201,repeat.text);
 assert.equal(repeat.body.status,'PLACED');
 const blocked=await sendOrder(orderBody([orderLine({quantity:1,note:'Foreign phone'})],second.cartId),second);
 assert.equal(blocked.body.error.code,'TABLE_OCCUPIED');
 const left=await request(app).post(api+'/guest/leave').set(headers(first)).send({});
 assert.equal(left.status,200,left.text);
 const takeover=await request(app).post(api+'/table-entry/request').set('Origin',config.CLIENT_ORIGIN).send({
  qrToken:qr,displayName:'Synthetic replacement phone',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken(),
 });
 assert.equal(takeover.status,409,takeover.text);
 assert.equal(takeover.body.error.code,'TABLE_OCCUPIED');
 assert.equal((await lookup(qr)).body.session.occupied,true);
});

test('waiter confirmation preserves manager quantity thresholds',async()=>{
 app=pilotApp();
 await db.order.updateMany({where:{tenantId,branchId},data:{createdAt:new Date(Date.now()-120000)}});
 await db.branchSettings.updateMany({where:{tenantId,branchId},data:{approvalQuantity:1}});
 const saved=(await post('',{revision:(await board()).body.revision,label:'Waiter risk table',section:'Main',seats:4})).body.board;
 const table=saved.items.find((item:{label:string})=>item.label==='Waiter risk table');
 const qr=(await post('/'+table.id+'/qr',{version:table.version})).body.qr.url.split('#')[1];
 const response=await request(app).post(api+'/table-entry/request').set('Origin',config.CLIENT_ORIGIN).send({
  qrToken:qr,displayName:'Synthetic risk guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken(),
 });
 assert.equal(response.status,200,response.text);
 const guest={cookie:String(response.headers['set-cookie']![0]).split(';')[0]!,csrf:response.body.csrfToken,cartId:response.body.cartId};
 const placed=await sendOrder(orderBody([orderLine({quantity:2})],guest.cartId),guest);
 assert.equal(placed.status,201,placed.text);
 const path=api+'/staff/order-review';
 const worker=await request(app).get(path+query()).set(headers(actors.worker));
 const pending=worker.body.pending.find((order:{id:string})=>order.id===placed.body.orderId);
 assert.ok(pending.riskSignals.includes('LARGE_QUANTITY'));
 const confirmed=await request(app).post(path+'/'+pending.id+'/decision'+query()).set(headers(actors.worker)).send({version:pending.version,decision:'APPROVE',override:true});
 assert.equal(confirmed.status,200,confirmed.text);
 assert.equal(confirmed.body.status,'AWAITING_REVIEW');
 assert.equal(confirmed.body.awaitingWaiter,false);
 assert.equal((await request(app).post(path+'/'+pending.id+'/decision'+query()).set(headers(actors.worker)).send({version:confirmed.body.version,decision:'APPROVE',override:true})).status,404);
 const approved=await request(app).post(path+'/'+pending.id+'/decision'+query()).set(headers(actors.manager)).send({version:confirmed.body.version,decision:'APPROVE',override:true});
 assert.equal(approved.status,200,approved.text);
 assert.equal(approved.body.status,'PLACED');
});

test('expired unconfirmed requests cannot be approved and their table can be released',async()=>{
 app=pilotApp();
 await db.order.updateMany({where:{tenantId,branchId},data:{createdAt:new Date(Date.now()-120000)}});
 const saved=(await post('',{revision:(await board()).body.revision,label:'Expired waiter request',section:'Main',seats:4})).body.board;
 const table=saved.items.find((item:{label:string})=>item.label==='Expired waiter request');
 const qr=(await post('/'+table.id+'/qr',{version:table.version})).body.qr.url.split('#')[1];
 const response=await request(app).post(api+'/table-entry/request').set('Origin',config.CLIENT_ORIGIN).send({
  qrToken:qr,displayName:'Synthetic expired guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken(),
 });
 assert.equal(response.status,200,response.text);
 const guest={cookie:String(response.headers['set-cookie']![0]).split(';')[0]!,csrf:response.body.csrfToken,cartId:response.body.cartId};
 const placed=await sendOrder(orderBody([orderLine({quantity:1})],guest.cartId),guest);
 assert.equal(placed.status,201,placed.text);
 await db.guestSession.update({where:{id:guest.cartId},data:{createdAt:new Date(Date.now()-11*60000)}});
 const failed=await request(app).post(api+'/staff/order-review/'+placed.body.orderId+'/decision'+query()).set(headers(actors.manager)).send({version:1,decision:'APPROVE',override:true});
 assert.equal(failed.status,409,failed.text);
 assert.equal(failed.body.error.code,'REVIEW_SESSION_CLOSED');
 const dining=await db.diningSession.findFirstOrThrow({where:{tenantId,branchId,tableId:table.id,state:'OPEN'}});
 const closed=await post('/'+table.id+'/close',{version:dining.version},actors.worker);
 assert.equal(closed.status,200,closed.text);
 assert.equal((await db.order.findUniqueOrThrow({where:{id:placed.body.orderId}})).status,'CANCELLED');
 assert.equal((await db.diningSession.findUniqueOrThrow({where:{id:dining.id}})).state,'CLOSED');
});

test('PIN-free guest request caps preserve idempotent retry and deny disabled branch entry',async()=>{
 app=pilotApp();
 const saved=(await post('',{revision:(await board()).body.revision,label:'Bounded waiter queue',section:'Main',seats:4})).body.board;
 const table=saved.items.find((item:{label:string})=>item.label==='Bounded waiter queue');
 const qr=(await post('/'+table.id+'/qr',{version:table.version})).body.qr.url.split('#')[1];
 const payload={qrToken:qr,displayName:'Synthetic queue guest',mobile:'+919999999999',privacyAccepted:true,guestSecret:randomToken()};
 const send=(body:object)=>request(app).post(api+'/table-entry/request').set('Origin',config.CLIENT_ORIGIN).send(body);
 assert.equal((await send({...payload,pin:'123456'})).status,400);
 const first=await send(payload);
 assert.equal(first.status,200,first.text);
 for(let index=1;index<10;index++)assert.equal((await send({...payload,guestSecret:randomToken()})).status,200);
 const blocked=await send({...payload,guestSecret:randomToken()});
 assert.equal(blocked.status,429,blocked.text);
 assert.equal(blocked.body.error.code,'TABLE_REQUEST_LIMIT');
 const retry=await send(payload);
 assert.equal(retry.status,200,retry.text);
 assert.equal(retry.body.cartId,first.body.cartId);
 await db.branch.update({where:{id:branchId},data:{active:false}});
 try{
  const disabled=await send({...payload,guestSecret:randomToken()});
  assert.equal(disabled.status,409,disabled.text);
  assert.equal(disabled.body.error.code,'CHECKOUT_UNAVAILABLE');
 }finally{await db.branch.update({where:{id:branchId},data:{active:true}});}
});

test('table API enforces the selected portal even for assigned branch members',async()=>{
 for(const [path,actor] of [['/restaurant/tables',actors.worker!],['/staff/tables',actors.admin!]] as const){
  const result=await request(app).get(api+path+query()).set(headers(actor));
  assert.equal(result.status,403);
 }
});

test('staff table access ends when the assigned branch is deactivated',async()=>{
 await db.branch.update({where:{id:branchId},data:{active:false}});
 try{assert.equal((await board(actors.worker)).status,403);}
 finally{await db.branch.update({where:{id:branchId},data:{active:true}});}
});
