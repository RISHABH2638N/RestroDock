import {test,before,after,beforeEach} from 'node:test';
import type {Prisma} from '@prisma/client';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createDatabase,type Database} from '../../src/db.js';
import {createApp} from '../../src/app.js';
import {loadConfig,type Config} from '../../src/config.js';
import {bootstrapAdmin} from '../../src/modules/auth/bootstrap.js';
import {hashPassword,verifyPassword,tokenHash,csrfFor} from '../../src/modules/auth/crypto.js';
import {checkDatabaseSchema} from '../../src/database/readiness.js';
let engine:PGlite,wire:PGLiteSocketServer,db:Database,config:Config,app:ReturnType<typeof createApp>;
const adminEmail='platform@synthetic.test',password='Synthetic passphrase 2026 only';
let alpha:{id:string;branchId:string;link:string},beta:typeof alpha;
const tokenFrom=(link:string)=>link.split('#')[1]!;
const portalFor=(email:string)=>email===adminEmail?'platform':['alpha@synthetic.test','beta@synthetic.test'].includes(email)?'restaurant':'staff';
async function login(email=adminEmail,pw=password,rememberDevice=false){const response=await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email,password:pw,rememberDevice,portal:portalFor(email)});assert.equal(response.status,200,response.text);const cookie=(response.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;return {cookie,csrf:response.body.csrfToken as string};}
type Session=Awaited<ReturnType<typeof login>>;
function get(path:string,session:Session){return request(app).get('/api/v1'+path).set('Cookie',session.cookie);}
function post(path:string,session:Session,body:object){return request(app).post('/api/v1'+path).set('Cookie',session.cookie).set('Origin',config.CLIENT_ORIGIN).set('X-CSRF-Token',session.csrf).send(body);}
function patch(path:string,session:Session,body:object){return request(app).patch('/api/v1'+path).set('Cookie',session.cookie).set('Origin',config.CLIENT_ORIGIN).set('X-CSRF-Token',session.csrf).send(body);}
function accept(link:string,pw=password){return request(app).post('/api/v1/auth/invitations/accept').set('Origin',config.CLIENT_ORIGIN).send({token:tokenFrom(link),password:pw});}
const selector=(tenant:typeof alpha)=>`tenantId=${tenant.id}&branchId=${tenant.branchId}`;
before(async()=>{
 engine=await PGlite.create();wire=new PGLiteSocketServer({db:engine,host:'127.0.0.1',port:0,maxConnections:8});await wire.start();
 const url=`postgresql://postgres:synthetic-only@${wire.getServerConn()}/postgres?sslmode=disable`;
 const env={...process.env,NODE_ENV:'test',DATABASE_URL:url,DIRECT_URL:url,DATABASE_URL_POOLED:'',DEMO_MODE:'false',BOOTSTRAP_ADMIN_EMAIL:'',BOOTSTRAP_ADMIN_PASSWORD:''};
 const child=spawn(process.execPath,['--import','tsx','scripts/database-cli.ts','deploy'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env,stdio:['ignore','pipe','pipe']});let log='';child.stdout.on('data',data=>log+=String(data));child.stderr.on('data',data=>log+=String(data));assert.equal(await new Promise(resolve=>child.on('exit',resolve)),0,log);
 db=createDatabase(url)!;config=loadConfig(env);
},{timeout:60000});
beforeEach(()=>{app=createApp(config,()=>checkDatabaseSchema(db),db);});
after(async()=>{await db?.$disconnect();await wire?.stop();await engine?.close();});
test('bootstrap CLI reports password length safely and leaves an uninitialized database unchanged',async()=>{const url=`postgresql://postgres:synthetic-cli-database-secret@${wire.getServerConn()}/postgres?sslmode=disable`;const child=spawn(process.execPath,['--import','tsx','scripts/bootstrap.ts'],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...process.env,NODE_ENV:'test',DATABASE_URL:url,DIRECT_URL:url,DATABASE_URL_POOLED:'',BOOTSTRAP_ADMIN_EMAIL:adminEmail,BOOTSTRAP_ADMIN_PASSWORD:'short-secret'},stdio:['ignore','pipe','pipe']});let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=String(chunk);});assert.equal(await new Promise(resolve=>child.once('exit',resolve)),1);assert.match(output,/BOOTSTRAP_PASSWORD_LENGTH/);assert.ok(!output.includes('short-secret'));assert.ok(!output.includes('synthetic-cli-database-secret'));assert.equal(await db.user.count(),0);assert.equal(await db.authBootstrap.count(),0);});
test('bootstrap is opt-in, rejects weak credentials, and succeeds with provisioning latency beyond five seconds',async()=>{assert.equal(await bootstrapAdmin(db,{}),'not_configured');await assert.rejects(bootstrapAdmin(db,{BOOTSTRAP_ADMIN_EMAIL:adminEmail,BOOTSTRAP_ADMIN_PASSWORD:'weak'}));assert.equal(await db.user.count(),0);const slowDatabase=new Proxy(db,{get(target,key){if(key==='$transaction')return (callback:(tx:Prisma.TransactionClient)=>Promise<unknown>,options:{maxWait?:number;timeout?:number})=>target.$transaction(async tx=>{await new Promise(resolve=>setTimeout(resolve,5500));return callback(tx);},options);return Reflect.get(target,key,target);}});assert.equal(await bootstrapAdmin(slowDatabase,{BOOTSTRAP_ADMIN_EMAIL:adminEmail,BOOTSTRAP_ADMIN_PASSWORD:password}),'created');assert.equal(await db.platformAdmin.count(),1);assert.equal(await db.membership.count(),0);});
test('restart bootstrap cannot change the password or grant another platform administrator',async()=>{const before=await db.user.findUniqueOrThrow({where:{email:adminEmail}});assert.equal(await bootstrapAdmin(db,{BOOTSTRAP_ADMIN_EMAIL:'attacker@synthetic.test',BOOTSTRAP_ADMIN_PASSWORD:'Different long passphrase 999'}),'already_initialized');assert.equal(await db.user.count(),1);assert.equal((await db.user.findUniqueOrThrow({where:{email:adminEmail}})).passwordHash,before.passwordHash);});
test('password hashes use unique salts and memory-hard verification, never plaintext',async()=>{const a=await hashPassword(password),b=await hashPassword(password);assert.notEqual(a,b);assert.ok(a.startsWith('scrypt$131072$8$1$'));assert.ok(!a.includes(password));assert.equal(await verifyPassword(password,a),true);assert.equal(await verifyPassword('incorrect',a),false);assert.equal(await verifyPassword(password,'malformed'),false);});
test('login enforces JSON/exact Origin and denies wrong passwords without identity details',async()=>{assert.equal((await request(app).post('/api/v1/auth/login').send({email:adminEmail,portal:'platform',password})).status,403);assert.equal((await request(app).post('/api/v1/auth/login').set('Origin','https://evil.test').send({email:adminEmail,portal:'platform',password})).status,403);const a=await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email:adminEmail,portal:'platform',password:'wrong'});const b=await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email:'missing@synthetic.test',portal:'platform',password:'wrong'});assert.equal(a.status,401);assert.equal(a.body.error.message,b.body.error.message);});
test('login issues a fresh HttpOnly Strict cookie with only a hash persisted',async()=>{const session=await login();const value=session.cookie.split('=')[1]!;assert.equal(value.length,43);assert.equal(session.csrf,csrfFor(value));const stored=await db.staffSession.findUniqueOrThrow({where:{tokenHash:tokenHash(value)}});assert.notEqual(stored.tokenHash,value);const response=await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email:adminEmail,portal:'platform',password});const cookie=String(response.headers['set-cookie']);assert.match(cookie,/HttpOnly/);assert.match(cookie,/SameSite=Strict/);assert.match(cookie,/Path=\//);assert.ok(!cookie.includes('Domain='));assert.ok(!response.text.includes('passwordHash'));});
test('production session cookie is Secure and has a __Host prefix',async()=>{const production=createApp({...config,NODE_ENV:'production',CLIENT_ORIGIN:'https://restrodock.com'},()=>checkDatabaseSchema(db),db);const response=await request(production).post('/api/v1/auth/login').set('Origin','https://restrodock.com').send({email:adminEmail,portal:'platform',password});assert.equal(response.status,200);assert.match(String(response.headers['set-cookie']),/__Host-restrodock_session=/);assert.match(String(response.headers['set-cookie']),/; Secure;/);});
test('anonymous, forged bearer and duplicate cookies cannot enter the control plane',async()=>{for(const headers of [{},{Authorization:'Bearer SUPER_ADMIN','X-User-ID':'admin','X-Tenant-ID':'other'},{Cookie:'restrodock_session=wrong'}])assert.equal((await request(app).get('/api/v1/super-admin/tenants').set(headers)).status,401);const session=await login();assert.equal((await request(app).get('/api/v1/auth/me').set('Cookie',`${session.cookie}; ${session.cookie}`)).status,401);});
test('session writes require a session-bound CSRF token and exact Origin',async()=>{const session=await login();const path='/api/v1/super-admin/tenants';assert.equal((await request(app).post(path).set('Cookie',session.cookie).set('Origin',config.CLIENT_ORIGIN).send({})).status,403);assert.equal((await request(app).post(path).set('Cookie',session.cookie).set('X-CSRF-Token',session.csrf).send({})).status,403);const other=await login();assert.equal((await request(app).post(path).set('Cookie',session.cookie).set('Origin',config.CLIENT_ORIGIN).set('X-CSRF-Token',other.csrf).send({})).status,403);});
test('Super Admin provisions two distinct draft tenants, inactive branches, plans and administrator invitations transactionally',async()=>{const session=await login();for(const slug of ['alpha','beta']){const response=await post('/super-admin/tenants',session,{name:`Synthetic ${slug}`,slug:`synthetic-${slug}`,branchName:'Initial test branch',adminEmail:`${slug}@synthetic.test`,planCode:'TRIAL'});assert.equal(response.status,201,response.text);assert.equal(response.body.tenant.status,'DRAFT');assert.equal(response.body.tenant.branches[0].active,false);assert.equal(response.body.tenant.branches[0].orderingPaused,true);assert.equal(response.body.tenant.activationAllowed,false);const tenant={id:response.body.tenant.id,branchId:response.body.tenant.branches[0].id,link:response.body.invitation.link};if(slug==='alpha')alpha=tenant;else beta=tenant;assert.ok(!JSON.stringify(await db.staffInvitation.findMany()).includes(tokenFrom(tenant.link)));}assert.equal(await db.tenant.count(),2);assert.equal((await get('/super-admin/tenants',session)).body.items.length,2);});
test('invalid and duplicate slugs fail without partial tenants/branches/invitations',async()=>{const session=await login(),before=await db.branch.count();const body={name:'Duplicate',slug:'synthetic-alpha',branchName:'Hidden',adminEmail:'nobody@synthetic.test',planCode:'TRIAL'};assert.equal((await post('/super-admin/tenants',session,body)).status,409);assert.equal((await post('/super-admin/tenants',session,{...body,slug:'UPPER bad'})).status,400);assert.equal(await db.branch.count(),before);});
test('invitation preview is token-bound; acceptance sets a password and cannot replay or grant platform rights',async()=>{const preview=await request(app).post('/api/v1/auth/invitations/preview').set('Origin',config.CLIENT_ORIGIN).send({token:tokenFrom(alpha.link)});assert.equal(preview.body.email,'alpha@synthetic.test');assert.equal((await accept(alpha.link)).status,200);assert.equal((await accept(alpha.link)).status,400);assert.equal((await accept(beta.link)).status,200);assert.equal(await db.platformAdmin.count(),1);const user=await db.user.findUniqueOrThrow({where:{email:'alpha@synthetic.test'}});assert.equal(await verifyPassword(password,user.passwordHash),true);assert.equal(await db.branchAccess.count({where:{tenantId:alpha.id}}),1);});
test('restaurant admin can inspect only assigned draft setup and has no platform rights',async()=>{const session=await login('alpha@synthetic.test');const own=await get('/restaurant/context?'+selector(alpha),session);assert.equal(own.status,200,own.text);assert.equal(own.body.setupOnly,true);assert.equal((await get('/super-admin/tenants',session)).status,403);assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,403);assert.equal((await get('/restaurant/menu?'+selector(alpha),session)).status,403);assert.equal((await get('/staff/context?'+selector(alpha),session)).status,403);});
test('platform privilege does not create implicit tenant/branch access',async()=>{const session=await login();assert.equal((await get('/restaurant/context?'+selector(alpha),session)).status,403);assert.equal((await get('/staff/context?'+selector(alpha),session)).status,403);});
test('plan/status writes use optimistic versions, audit changes and block premature activation',async()=>{
 const session=await login();
 const path=`/super-admin/tenants/${alpha.id}`;
 const detail=await get(path,session);
 const version=detail.body.version;
 assert.equal((await patch(path,session,{version,status:'ACTIVE'})).status,409);
 const saved=await patch(path,session,{version,planCode:'PRO',subscriptionStatus:'ACTIVE',endsOn:'2099-01-31'});
 assert.equal(saved.status,200,saved.text);
 assert.equal(saved.body.subscription.planCode,'PRO');
 assert.equal(saved.body.subscription.status,'ACTIVE');
 assert.equal(saved.body.subscription.endsAt,'2099-01-31T00:00:00.000Z');
 assert.equal(saved.body.usage.branches,1);
 assert.equal(saved.body.usage.tables,0);
 assert.equal(saved.body.status,detail.body.status);
 assert.equal((await patch(path,session,{version,planCode:'STARTER'})).status,409);
 const additional=await db.branch.create({data:{tenantId:alpha.id,name:'Plan test outlet',active:true}});
 try{
  await db.branch.update({where:{id:detail.body.branches[0].id},data:{active:true}});
  const blocked=await patch(path,session,{version:saved.body.version,planCode:'STARTER'});
  assert.equal(blocked.status,409,blocked.text);
  assert.equal(blocked.body.error.code,'PLAN_OUTLET_LIMIT');
 }finally{
  await db.branch.update({where:{id:detail.body.branches[0].id},data:{active:false}});
  await db.branch.delete({where:{id:additional.id}});
 }
 assert.ok(await db.controlAudit.count({where:{tenantId:alpha.id,action:'TENANT_UPDATED'}}));
});
test('only Platform Admin can change a restaurant billing mode, with tenant isolation and version checks',async()=>{
 const platform=await login(), owner=await login('alpha@synthetic.test');
 const path=`/super-admin/tenants/${alpha.id}`;
 const detail=(await get(path,platform)).body;
 assert.equal(detail.billingMode,'EXTERNAL_POS');
 const input={version:detail.version,billingMode:'RESTRODOCK'};
 assert.equal((await patch(path,owner,input)).status,403);
 assert.equal((await patch(path,platform,{...input,billingMode:'UNKNOWN'})).status,400);
 const enabled=await patch(path,platform,input);
 assert.equal(enabled.status,200,enabled.text);
 assert.equal(enabled.body.billingMode,'RESTRODOCK');
 assert.equal(enabled.body.version,detail.version+1);
 assert.equal((await get(path,platform)).body.billingMode,'RESTRODOCK');
 assert.equal((await get(`/super-admin/tenants/${beta.id}`,platform)).body.billingMode,'EXTERNAL_POS');
 assert.equal((await patch(path,platform,{...input,billingMode:'EXTERNAL_POS'})).status,409);
 const disabled=await patch(path,platform,{version:enabled.body.version,billingMode:'EXTERNAL_POS'});
 assert.equal(disabled.status,200,disabled.text);
 assert.equal(disabled.body.billingMode,'EXTERNAL_POS');
 assert.equal(disabled.body.status,detail.status);
 const actions=await db.controlAudit.findMany({where:{tenantId:alpha.id,action:{in:['RESTRODOCK_BILLING_ENABLED','EXTERNAL_POS_BILLING_SELECTED']}},select:{action:true}});
 assert.deepEqual(actions.map(row=>row.action).sort(),['EXTERNAL_POS_BILLING_SELECTED','RESTRODOCK_BILLING_ENABLED']);
});
test('reissuing an invitation revokes its earlier link; expired tokens and foreign branches fail',async()=>{const session=await login();const body={email:'new@synthetic.test',branchId:alpha.branchId};const first=await post(`/super-admin/tenants/${alpha.id}/invitations`,session,body);const second=await post(`/super-admin/tenants/${alpha.id}/invitations`,session,body);assert.equal((await accept(first.body.link)).status,400);await db.staffInvitation.update({where:{tokenHash:tokenHash(tokenFrom(second.body.link))},data:{expiresAt:new Date(0)}});assert.equal((await accept(second.body.link)).status,400);assert.equal((await post(`/super-admin/tenants/${alpha.id}/invitations`,session,{...body,branchId:beta.branchId})).status,404);});
test('restaurant administrator issues branch-bound worker invite; elevated roles and foreign tenant selection fail',async()=>{const session=await login('alpha@synthetic.test');const body={tenantId:alpha.id,branchId:alpha.branchId,email:'worker@synthetic.test',role:'WORKER'};const response=await post('/restaurant/invitations',session,body);assert.equal(response.status,201,response.text);assert.equal((await post('/restaurant/invitations',session,{...body,role:'RESTAURANT_ADMIN'})).status,400);assert.equal((await post('/restaurant/invitations',session,{...body,role:'SUPER_ADMIN'})).status,400);assert.equal((await post('/restaurant/invitations',session,{...body,tenantId:beta.id,branchId:beta.branchId})).status,403);assert.equal((await accept(response.body.link)).status,200);});
test('staff credentials cannot create a session through either admin portal',async()=>{
 const email='worker@synthetic.test';
 const user=await db.user.findUniqueOrThrow({where:{email}});
 const count=()=>db.staffSession.count({where:{userId:user.id}});
 const initial=await count();
 const send=(portal?:string)=>request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email,password,portal});
 for(const portal of ['platform','restaurant']){
  const denied=await send(portal);
  assert.equal(denied.status,403,denied.text);
  assert.equal(denied.body.error.code,'PORTAL_FORBIDDEN');
  assert.equal(denied.headers['set-cookie'],undefined);
 }
 assert.equal((await send()).status,400);
 assert.equal(await count(),initial);
 assert.equal((await send('staff')).status,200);
});
test('worker role cannot access restaurant or platform administration',async()=>{const session=await login('worker@synthetic.test');assert.equal((await get('/restaurant/context?'+selector(alpha),session)).status,403);assert.equal((await get('/super-admin/tenants',session)).status,403);assert.equal((await post('/restaurant/invitations',session,{tenantId:alpha.id,branchId:alpha.branchId,email:'evil@synthetic.test',role:'WORKER'})).status,403);});
test('active test-only branches support verified worker route and real tenant-isolated menu reads',async()=>{for(const tenant of [alpha,beta]){await db.tenant.update({where:{id:tenant.id},data:{status:'ACTIVE'}});await db.branch.update({where:{id:tenant.branchId},data:{active:true}});const category=await db.menuCategory.create({data:{tenantId:tenant.id,branchId:tenant.branchId,name:'Synthetic category'}});await db.menuItem.create({data:{tenantId:tenant.id,branchId:tenant.branchId,categoryId:category.id,name:tenant.id,priceMinor:100,available:true,state:'PUBLISHED',foodType:'VEG'}});}const worker=await login('worker@synthetic.test');assert.equal((await get('/staff/context?'+selector(alpha),worker)).status,200);assert.equal((await get('/staff/context?'+selector(beta),worker)).status,403);const restaurant=await login('alpha@synthetic.test'),own=await get('/restaurant/menu?'+selector(alpha),restaurant);assert.equal(own.status,200);assert.deepEqual(own.body.items.map((item:{name:string})=>item.name),[alpha.id]);assert.equal((await get('/restaurant/menu?'+selector(beta),restaurant)).status,403);});
test('active restaurant administrator does not gain a staff-role context',async()=>{const session=await login('alpha@synthetic.test');assert.equal((await get('/restaurant/context?'+selector(alpha),session)).status,200);assert.equal((await get('/staff/context?'+selector(alpha),session)).status,403);});
test('suspension blocks already-issued staff and admin sessions immediately; return-to-draft stays paused',async()=>{const platform=await login(),restaurant=await login('alpha@synthetic.test'),worker=await login('worker@synthetic.test');let detail=await get(`/super-admin/tenants/${alpha.id}`,platform);assert.equal((await patch(`/super-admin/tenants/${alpha.id}`,platform,{version:detail.body.version,status:'SUSPENDED'})).status,200);assert.equal((await get('/staff/context?'+selector(alpha),worker)).status,403);assert.equal((await get('/restaurant/context?'+selector(alpha),restaurant)).status,403);detail=await get(`/super-admin/tenants/${alpha.id}`,platform);assert.equal((await patch(`/super-admin/tenants/${alpha.id}`,platform,{version:detail.body.version,status:'DRAFT'})).status,200);assert.equal((await get('/restaurant/context?'+selector(alpha),restaurant)).status,200);assert.equal((await get('/staff/context?'+selector(alpha),worker)).status,403);const branch=await db.branch.findUniqueOrThrow({where:{id:detail.body.branches[0].id}});assert.equal(branch.active,false);assert.equal(branch.orderingPaused,true);});
test('existing-account invitation cannot replace its password or change role silently',async()=>{const platform=await login();const invitation=await post(`/super-admin/tenants/${alpha.id}/invitations`,platform,{email:'beta@synthetic.test',branchId:alpha.branchId});const wrong=await accept(invitation.body.link,'A different long passphrase 99');assert.equal(wrong.status,400);const user=await db.user.findUniqueOrThrow({where:{email:'beta@synthetic.test'}});const before=user.passwordHash;assert.equal((await accept(invitation.body.link)).status,200);assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).passwordHash,before);});
test('logout revokes the database session and blocks replay',async()=>{const session=await login();assert.equal((await post('/auth/logout',session,{})).status,200);assert.equal((await get('/auth/me',session)).status,401);});
test('absolute/idle expiry, inactive user and removed platform privilege are rechecked',async()=>{for(const change of ['absolute','idle','inactive','platform']){const session=await login(),hash=tokenHash(session.cookie.split('=')[1]!);const user=await db.user.findUniqueOrThrow({where:{email:adminEmail}});if(change==='absolute')await db.staffSession.update({where:{tokenHash:hash},data:{expiresAt:new Date(0)}});if(change==='idle')await db.staffSession.update({where:{tokenHash:hash},data:{lastSeenAt:new Date(Date.now()-31*60*1000)}});if(change==='inactive')await db.user.update({where:{id:user.id},data:{active:false}});if(change==='platform')await db.platformAdmin.update({where:{userId:user.id},data:{active:false}});assert.equal((await get('/super-admin/tenants',session)).status,change==='platform'?403:401);await db.user.update({where:{id:user.id},data:{active:true}});await db.platformAdmin.update({where:{userId:user.id},data:{active:true}});}});
test('six failed passwords create a durable account throttle, including correct password until expiry',async()=>{const address='beta@synthetic.test';for(let i=0;i<6;i++)assert.equal((await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email:address,portal:'restaurant',password:'wrong'})).status,401);assert.equal((await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email:address,portal:'restaurant',password})).status,429);await db.authThrottle.update({where:{key:tokenHash('login:'+address)},data:{windowStart:new Date(0)}});await login(address);});
test('audit records contain references and actions without raw bearer tokens or passwords',async()=>{const events=await db.controlAudit.findMany();assert.ok(events.length>=10);const json=JSON.stringify(events);assert.ok(!json.includes(password));assert.ok(!json.includes(tokenFrom(alpha.link)));assert.ok(events.some(event=>event.action==='INVITATION_ACCEPTED'));});
test('manager, chef and cashier templates reach their own staff context and cannot administer another tenant',async()=>{const admin=await login('beta@synthetic.test');for(const role of ['MANAGER','CHEF','CASHIER']){const address=role.toLowerCase()+'@synthetic.test';const invite=await post('/restaurant/invitations',admin,{tenantId:beta.id,branchId:beta.branchId,email:address,role});assert.equal(invite.status,201,invite.text);assert.equal((await accept(invite.body.link)).status,200);const session=await login(address);const own=await get('/staff/context?'+selector(beta),session);assert.equal(own.status,200);assert.equal(own.body.role,role);assert.equal((await get('/staff/context?'+selector(alpha),session)).status,403);assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,403);assert.equal((await get('/super-admin/tenants',session)).status,403);}});
test('all staff roles are denied platform, restaurant setup/menu and staff-invitation administration',async()=>{
 const admin=await login('beta@synthetic.test');
 for(const role of ['MANAGER','CHEF','WORKER','CASHIER']){
  const address='matrix-'+role.toLowerCase()+'@synthetic.test';
  const invite=await post('/restaurant/invitations',admin,{tenantId:beta.id,branchId:beta.branchId,email:address,role});assert.equal(invite.status,201,invite.text);assert.equal((await accept(invite.body.link)).status,200);
  const session=await login(address);assert.equal((await get('/staff/context?'+selector(beta),session)).status,200);
  for(const path of ['/super-admin/tenants','/restaurant/context?'+selector(beta),'/restaurant/manage/settings?'+selector(beta),'/restaurant/menu?'+selector(beta)])assert.equal((await get(path,session)).status,403,role+' '+path);
  assert.equal((await post('/restaurant/invitations',session,{tenantId:beta.id,branchId:beta.branchId,email:'denied@synthetic.test',role:'WORKER'})).status,403);
 }
});
test('existing HTTP sessions lose access when branch assignment, membership, role or user is revoked',async()=>{const session=await login('beta@synthetic.test');const user=await db.user.findUniqueOrThrow({where:{email:'beta@synthetic.test'}}),member=await db.membership.findUniqueOrThrow({where:{tenantId_userId:{tenantId:beta.id,userId:user.id}}});const access={tenantId:beta.id,branchId:beta.branchId,membershipId:member.id};await db.branchAccess.delete({where:{tenantId_branchId_membershipId:access}});assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,403);await db.branchAccess.create({data:access});await db.membership.update({where:{id:member.id},data:{active:false}});assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,403);await db.membership.update({where:{id:member.id},data:{active:true,role:'CHEF'}});assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,403);await db.membership.update({where:{id:member.id},data:{role:'RESTAURANT_ADMIN'}});await db.user.update({where:{id:user.id},data:{active:false}});assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,401);await db.user.update({where:{id:user.id},data:{active:true}});assert.equal((await get('/restaurant/context?'+selector(beta),session)).status,200);});
test('one-time invitation claim permits one concurrent acceptance and creates one membership',async()=>{const admin=await login('beta@synthetic.test');const invite=await post('/restaurant/invitations',admin,{tenantId:beta.id,branchId:beta.branchId,email:'concurrent@synthetic.test',role:'WORKER'});const results=await Promise.all([accept(invite.body.link),accept(invite.body.link)]);assert.equal(results.filter(result=>result.status===200).length,1);assert.ok(results.every(result=>[200,400,409].includes(result.status)),results.map(r=>r.text).join('\n'));const user=await db.user.findUniqueOrThrow({where:{email:'concurrent@synthetic.test'}});assert.equal(await db.membership.count({where:{tenantId:beta.id,userId:user.id}}),1);});

test('bootstrap conflicts roll back the marker and preserve existing user credentials',async()=>{const user=await db.user.findUniqueOrThrow({where:{email:adminEmail}});await db.authBootstrap.delete({where:{id:1}});try{await assert.rejects(bootstrapAdmin(db,{BOOTSTRAP_ADMIN_EMAIL:'different@synthetic.test',BOOTSTRAP_ADMIN_PASSWORD:password}),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='BOOTSTRAP_PLATFORM_EXISTS');assert.equal(await db.authBootstrap.count(),0);await db.platformAdmin.delete({where:{userId:user.id}});try{await assert.rejects(bootstrapAdmin(db,{BOOTSTRAP_ADMIN_EMAIL:adminEmail,BOOTSTRAP_ADMIN_PASSWORD:password}),error=>!!error&&typeof error==='object'&&'code' in error&&error.code==='BOOTSTRAP_ACCOUNT_EXISTS');assert.equal(await db.authBootstrap.count(),0);assert.equal((await db.user.findUniqueOrThrow({where:{id:user.id}})).passwordHash,user.passwordHash);}finally{await db.platformAdmin.create({data:{userId:user.id}});}}finally{await db.authBootstrap.create({data:{id:1}});}});

test('remembered devices survive ordinary idle expiry, expire absolutely, and sign out independently',async()=>{
 const signIn=async(email:string,rememberDevice:boolean)=>{
  const response=await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email,password,rememberDevice,portal:portalFor(email)});
  assert.equal(response.status,200,response.text);
  const header=(response.headers['set-cookie'] as unknown as string[])[0]!;
  return {header,cookie:header.split(';')[0]!,csrf:response.body.csrfToken as string};
 };
 const normal=await signIn('alpha@synthetic.test',false);
 const remembered=await signIn('alpha@synthetic.test',true);
 const second=await signIn('alpha@synthetic.test',true);
 const platform=await signIn(adminEmail,true);
 for(const session of [normal,platform])assert.doesNotMatch(session.header,/Max-Age|Expires=/);
 assert.match(remembered.header,/Max-Age=2592000;/);
 const hash=(session:Session)=>tokenHash(session.cookie.split('=')[1]!);
 for(const session of [normal,remembered,platform]){
  await db.staffSession.update({where:{tokenHash:hash(session)},data:{lastSeenAt:new Date(Date.now()-31*60_000)}});
 }
 assert.equal((await get('/auth/me',normal)).status,401);
 assert.equal((await get('/auth/me',platform)).status,401);
 assert.equal((await get('/auth/me',remembered)).status,200);
 assert.equal((await post('/auth/logout',remembered,{})).status,200);
 assert.equal((await get('/auth/me',remembered)).status,401);
 assert.equal((await get('/auth/me',second)).status,200);
 await db.staffSession.update({where:{tokenHash:hash(second)},data:{expiresAt:new Date(0)}});
 assert.equal((await get('/auth/me',second)).status,401);
});

test('Brevo recovery accepts generic requests and consumes a reset link once',async()=>{
 app=createApp({...config,BREVO_API_KEY:'synthetic-key',BREVO_SENDER_EMAIL:'accounts@synthetic.test'},()=>checkDatabaseSchema(db),db);
 const originalFetch=globalThis.fetch;
 const messages:{textContent:string}[]=[];
 globalThis.fetch=async(input,init)=>{
  if(String(input)!=='https://api.brevo.com/v3/smtp/email')return originalFetch(input,init);
  messages.push(JSON.parse(String(init?.body)));
  return new Response(null,{status:201});
 };
 try{
  const account='alpha@synthetic.test';
  const first=await login(account);
  const second=await login(account,password,true);
  const send=(path:string,body:object)=>request(app).post('/api/v1/auth/password-reset/'+path).set('Origin',config.CLIENT_ORIGIN).send(body);
  const known=await send('request',{email:account});
  const unknown=await send('request',{email:'unknown-recovery@synthetic.test'});
  assert.equal(known.status,202);
  assert.equal(unknown.status,202);
  assert.deepEqual(known.body,unknown.body);
  assert.equal((await send('request',{email:account})).status,202);
  assert.equal(messages.length,1);
  const link=messages[0]!.textContent.match(/https?:\/\/[^\s]+/)?.[0];
  assert.ok(link);
  const url=new URL(link);
  assert.equal(url.origin,config.CLIENT_ORIGIN);
  const token=url.hash.slice(1);
  const user=await db.user.findUniqueOrThrow({where:{email:account}});
  assert.equal(user.resetTokenHash,tokenHash(token));
  const payload={token,password:'New synthetic recovery password'};
  await db.user.update({where:{id:user.id},data:{resetExpiresAt:new Date(0)}});
  assert.equal((await send('complete',payload)).status,400);
  await db.user.update({where:{id:user.id},data:{resetExpiresAt:new Date(Date.now()+60_000)}});
  assert.deepEqual((await Promise.all([send('complete',payload),send('complete',payload)])).map(r=>r.status).sort(),[200,400]);
  for(const session of [first,second])assert.equal((await get('/auth/me',session)).status,401);
  assert.equal((await send('complete',payload)).status,400);
  await login(account,payload.password);
 }finally{globalThis.fetch=originalFetch;}
});

test('password reset endpoints have tighter network rate limits than general authentication',async()=>{
 app=createApp({...config,BREVO_API_KEY:'synthetic-key',BREVO_SENDER_EMAIL:'accounts@synthetic.test'},()=>checkDatabaseSchema(db),db);
 const send=(path:string,body:object)=>request(app).post('/api/v1/auth/password-reset/'+path).set('Origin',config.CLIENT_ORIGIN).send(body);
 for(let i=0;i<10;i++)assert.equal((await send('request',{email:`reset-limit-${i}@synthetic.test`})).status,202);
 const limitedRequest=await send('request',{email:'reset-limit-final@synthetic.test'});
 assert.equal(limitedRequest.status,429);
 assert.equal(limitedRequest.body.error.code,'RESET_RATE_LIMITED');
 for(let i=0;i<20;i++)assert.equal((await send('complete',{token:randomTokenForTest(i),password:'Synthetic replacement password'})).status,400);
 const limitedCompletion=await send('complete',{token:'A'.repeat(43),password:'Synthetic replacement password'});
 assert.equal(limitedCompletion.status,429);
 assert.equal(limitedCompletion.body.error.code,'RESET_RATE_LIMITED');
});

function randomTokenForTest(index:number){return index.toString(2).padStart(43,'A').replace(/0/g,'A').replace(/1/g,'B');}

test('platform analytics counts real records and exposes no guest or account details',async()=>{
 const root='/super-admin/analytics';
 const platform=await login(),owner=await login('alpha@synthetic.test','New synthetic recovery password');
 for(const path of [root,root+'/restaurants',root+'/restaurants/'+alpha.id+'/branches']){
  assert.equal((await request(app).get('/api/v1'+path)).status,401);
  assert.equal((await get(path,owner)).status,403);
 }
 assert.equal((await get(root+'?days=365',platform)).status,400);
 const owned={tenantId:alpha.id,branchId:alpha.branchId};
 const table=await db.restaurantTable.create({data:{...owned,label:'Analytics fixture',seats:4}});
 const archived=await db.restaurantTable.create({data:{...owned,label:'Archived analytics fixture',seats:4,archived:true}});
 const qr=await db.qrCode.create({data:{...owned,tableId:table.id,secretHash:tokenHash('synthetic-analytics-qr')}});
 const expiresAt=new Date(Date.now()+3600000);
 const dining=await db.diningSession.create({data:{...owned,tableId:table.id,expiresAt}});
 const guest=await db.guestSession.create({data:{...owned,diningSessionId:dining.id,displayName:'Private synthetic analytics guest',expiresAt,tokenHash:tokenHash('synthetic-analytics-guest')}});
 const order=await db.order.create({data:{...owned,diningSessionId:dining.id,guestSessionId:guest.id,idempotencyKey:'analytics-test',requestHash:tokenHash('synthetic-analytics-order'),estimatedTotalMinor:15000}});
 try{
  const overview=await get(root+'?days=7',platform);
  assert.equal(overview.status,200,overview.text);
  assert.equal(overview.body.tables,1);
  assert.equal(overview.body.qrTables,1);
  assert.equal(overview.body.activity.days.length,7);
  assert.equal(overview.body.activity.total,1);
  assert.equal(overview.body.activity.restaurants,1);
  assert.equal(overview.body.activity.days.at(-1).orders,1);
  assert.ok(overview.body.plans.some((row:{plan:string;count:number})=>row.plan==='PRO'&&row.count===1));
  const directory=await get(root+'/restaurants?days=7&q=synthetic%20alpha&plan=PRO',platform);
  assert.equal(directory.status,200,directory.text);
  assert.equal(directory.body.total,1);
  assert.equal(directory.body.items[0].orders,1);
  assert.equal(directory.body.items[0].id,alpha.id);
  const branches=await get(root+'/restaurants/'+alpha.id+'/branches?days=7',platform);
  assert.equal(branches.status,200,branches.text);
  assert.deepEqual(branches.body.items.map(({tables,qrTables,orders}:Record<string,number>)=>[tables,qrTables,orders]),[[1,1,1]]);
  for(const response of [overview,directory,branches])assert.doesNotMatch(response.text,/Private synthetic analytics guest|passwordHash|tokenHash|@synthetic\.test/);
 }finally{
  await db.order.delete({where:{id:order.id}});
  await db.guestSession.delete({where:{id:guest.id}});
  await db.diningSession.delete({where:{id:dining.id}});
  await db.qrCode.delete({where:{id:qr.id}});
  await db.restaurantTable.deleteMany({where:{id:{in:[table.id,archived.id]}}});
 }
});
