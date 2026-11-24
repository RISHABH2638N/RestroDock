import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import request from 'supertest';
import {PGlite} from '@electric-sql/pglite';
import {PGLiteSocketServer} from '@electric-sql/pglite-socket';
import {createDatabase,type Database} from '../../src/db.js';
import {demoTenants} from '../../src/database/demo-seed.js';
import {checkDatabaseSchema,migrationManifest} from '../../src/database/readiness.js';
import {scopeForVerifiedUser} from '../../src/security/membership.js';
import {menuRepository} from '../../src/repositories/menu.js';
import {createApp} from '../../src/app.js';
import {loadConfig} from '../../src/config.js';
let engine:PGlite,wire:PGLiteSocketServer,db:Database,env:NodeJS.ProcessEnv;
const prismaCode=(code:string)=>(error:unknown)=>!!error&&typeof error==='object'&&'code'in error&&error.code===code;
const a=demoTenants[0]!,b=demoTenants[1]!;
async function cli(action:string,overrides:NodeJS.ProcessEnv={}) {
 const child=spawn(process.execPath,['--import','tsx',fileURLToPath(new URL('../../scripts/database-cli.ts',import.meta.url)),action],{cwd:fileURLToPath(new URL('../../',import.meta.url)),env:{...env,...overrides},stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=String(chunk);});
 const timer=setTimeout(()=>child.kill('SIGTERM'),30000);timer.unref();
 try{return {code:await new Promise<number>((done,fail)=>{child.once('error',fail);child.once('exit',code=>done(code??1));}),output};}finally{clearTimeout(timer);}
}
before(async()=>{
 engine=await PGlite.create();wire=new PGLiteSocketServer({db:engine,host:'127.0.0.1',port:0,maxConnections:8});await wire.start();
 const url=`postgresql://postgres:synthetic-test-only@${wire.getServerConn()}/postgres?sslmode=disable`;
 env={...process.env,NODE_ENV:'test',DATABASE_URL:url,DIRECT_URL:url,DATABASE_URL_POOLED:'',DATABASE_URL_UNPOOLED:'',NEON_REALTIME_SECRET:'',ALLOW_DEMO_SEED:'true',DEMO_MODE:'false'};
 db=createDatabase(url)!;
},{timeout:60000});
after(async()=>{await db?.$disconnect();await wire?.stop();await engine?.close();});
test('Prisma pg adapter connects; readiness distinguishes empty database from migrated schema',async()=>{const rows=await db.$queryRaw<{n:number}[]>`SELECT 1::int AS n`;assert.equal(rows[0]?.n,1);assert.equal(await checkDatabaseSchema(db),'pending');});
test('real Prisma CLI deploys both versioned migrations over PostgreSQL TCP',async()=>{const result=await cli('deploy');assert.equal(result.code,0,result.output);assert.equal(await checkDatabaseSchema(db),'current');assert.equal(await db.tenant.count(),0);});
test('migration deploy is repeatable; status and doctor report current schema',async()=>{for(const action of ['deploy','status','doctor']){const result=await cli(action);assert.equal(result.code,0,result.output);}assert.equal(await checkDatabaseSchema(db),'current');});
test('guarded seed CLI creates two distinct inactive tenant datasets',async()=>{const result=await cli('seed');assert.equal(result.code,0,result.output);assert.equal(await db.tenant.count(),2);assert.deepEqual((await db.tenant.findMany({orderBy:{slug:'asc'}})).map(t=>t.status),['DRAFT','DRAFT']);assert.equal(await db.branch.count({where:{active:false,orderingPaused:true}}),2);assert.equal(await db.menuItem.count({where:{available:false}}),2);assert.equal(await db.restaurantTable.count(),2);assert.notEqual((await db.menuItem.findUniqueOrThrow({where:{id:a.itemId}})).name,(await db.menuItem.findUniqueOrThrow({where:{id:b.itemId}})).name);});
test('seed membership placeholders have no working credentials and use reserved fixture addresses',async()=>{const users=await db.user.findMany();assert.equal(users.length,2);assert.ok(users.every(u=>!u.active&&!u.passwordHash&&u.email.endsWith('.example.invalid')));assert.equal(await db.membership.count({where:{active:false}}),2);assert.equal(await db.branchAccess.count(),2);assert.equal(await db.qrCode.count(),0);assert.equal(await db.diningSession.count(),0);assert.equal(await db.order.count(),0);});
test('seeding twice does not duplicate tenants, memberships, menus or tables',async()=>{const result=await cli('seed');assert.equal(result.code,0,result.output);for(const count of [await db.tenant.count(),await db.branch.count(),await db.user.count(),await db.membership.count(),await db.menuItem.count(),await db.restaurantTable.count()])assert.equal(count,2);});
test('seed without explicit opt-in is refused before opening an invalid database URL',async()=>{const result=await cli('seed',{ALLOW_DEMO_SEED:'false',DIRECT_URL:'invalid-url'});assert.equal(result.code,1);assert.match(result.output,/requires development\/test/);assert.equal(await db.tenant.count(),2);});
test('production refuses seed even when opt-in flag is true',async()=>{const result=await cli('seed',{NODE_ENV:'production'});assert.equal(result.code,1);assert.match(result.output,/disabled in production/);});
test('failed second-tenant guard rolls back earlier fixture inserts atomically',async()=>{await db.menuItem.delete({where:{id:a.itemId}});await db.tenant.update({where:{id:b.tenantId},data:{status:'ACTIVE'}});const result=await cli('seed');assert.equal(result.code,1);assert.match(result.output,/Refusing to seed/);assert.equal(await db.menuItem.count({where:{id:a.itemId}}),0);await db.tenant.update({where:{id:b.tenantId},data:{status:'DRAFT'}});assert.equal((await cli('seed')).code,0);});
test('seed refuses fixture records reassigned to another tenant/branch',async()=>{await db.menuItem.delete({where:{id:a.itemId}});await db.menuCategory.update({where:{id:a.categoryId},data:{tenantId:b.tenantId,branchId:b.branchId,name:'Reassigned fixture category'}});const result=await cli('seed');assert.equal(result.code,1);assert.match(result.output,/different tenant or branch/);assert.equal(await db.menuItem.count({where:{id:a.itemId}}),0);await db.menuCategory.update({where:{id:a.categoryId},data:{tenantId:a.tenantId,branchId:a.branchId,name:'Sample category'}});assert.equal((await cli('seed')).code,0);});
test('Prisma rejects cross-tenant menu-category and membership-branch references',async()=>{await assert.rejects(db.menuItem.create({data:{tenantId:a.tenantId,branchId:a.branchId,categoryId:b.categoryId,name:'Forbidden relation',priceMinor:100}}),prismaCode('P2003'));await assert.rejects(db.branchAccess.create({data:{tenantId:a.tenantId,branchId:a.branchId,membershipId:b.membershipId}}),prismaCode('P2003'));});
test('Prisma/database rejects duplicate and noncanonical tenant slugs',async()=>{await assert.rejects(db.tenant.create({data:{name:'Duplicate',slug:a.slug}}),prismaCode('P2002'));await assert.rejects(db.tenant.create({data:{name:'Invalid',slug:'Upper Case'}}));});
test('active-table uniqueness covers OPEN and BILL_REQUESTED and releases on closure',async()=>{const data={tenantId:a.tenantId,branchId:a.branchId,tableId:a.tableId,expiresAt:new Date(Date.now()+3600000)};const session=await db.diningSession.create({data});await assert.rejects(db.diningSession.create({data}));await db.diningSession.update({where:{id:session.id},data:{state:'BILL_REQUESTED'}});await assert.rejects(db.diningSession.create({data}));await db.diningSession.update({where:{id:session.id},data:{state:'CLOSED',closedAt:new Date()}});await db.diningSession.create({data});});
test('raw QR material cannot be persisted in the SHA-256 hex field',async()=>{const data={tenantId:a.tenantId,branchId:a.branchId,tableId:a.tableId};await assert.rejects(db.qrCode.create({data:{...data,secretHash:'g'.repeat(64)}}));await db.qrCode.create({data:{...data,secretHash:'1'.repeat(64)}});await assert.rejects(db.qrCode.create({data:{...data,secretHash:'1'.repeat(64)}}));});
test('Day 4 reverse-lookup indexes and migration checksums exist',async()=>{const indexes=await db.$queryRaw<{indexname:string}[]>`SELECT indexname FROM pg_indexes WHERE schemaname='public'`;for(const name of ['Membership_userId_idx','BranchAccess_tenantId_membershipId_idx','Order_tenantId_branchId_diningSessionId_createdAt_idx'])assert.ok(indexes.some(i=>i.indexname===name));const names=(await migrationManifest()).map(m=>m.name);assert.ok(names.includes('20261101000000_foundation'));assert.ok(names.includes('20261102000000_day4_constraints'));});
test('inactive drafts cannot produce a verified membership scope',async()=>{await assert.rejects(scopeForVerifiedUser(db,a.userId,a.tenantId,a.branchId),/access denied/);});
test('real repository list/ID reads isolate two tenants after explicit test-only activation',async()=>{
 for(const f of demoTenants){await db.tenant.update({where:{id:f.tenantId},data:{status:'ACTIVE'}});await db.branch.update({where:{id:f.branchId},data:{active:true}});await db.user.update({where:{id:f.userId},data:{active:true}});await db.membership.update({where:{id:f.membershipId},data:{active:true}});await db.menuItem.update({where:{id:f.itemId},data:{available:true,state:'PUBLISHED',foodType:'VEG'}});}
 const scopeA=await scopeForVerifiedUser(db,a.userId,a.tenantId,a.branchId),scopeB=await scopeForVerifiedUser(db,b.userId,b.tenantId,b.branchId);
 const menuA=menuRepository(db,scopeA),menuB=menuRepository(db,scopeB);
 assert.deepEqual((await menuA.list()).map(i=>i.id),[a.itemId]);assert.deepEqual((await menuB.list()).map(i=>i.id),[b.itemId]);assert.equal(await menuA.find(b.itemId),null);assert.equal(await menuB.find(a.itemId),null);
 assert.deepEqual(Object.keys((await menuA.list())[0]!).sort(),['categoryId','id','name','priceMinor']);
});
test('restaurant admin has no implicit access to another branch or another tenant',async()=>{const branch=await db.branch.create({data:{tenantId:a.tenantId,name:'Other test branch',active:true}});const category=await db.menuCategory.create({data:{tenantId:a.tenantId,branchId:branch.id,name:'Other branch'}});await db.menuItem.create({data:{tenantId:a.tenantId,branchId:branch.id,categoryId:category.id,name:'Hidden other-branch item',priceMinor:100,available:true}});await assert.rejects(scopeForVerifiedUser(db,a.userId,a.tenantId,branch.id));await assert.rejects(scopeForVerifiedUser(db,a.userId,b.tenantId,b.branchId));const scope=await scopeForVerifiedUser(db,a.userId,a.tenantId,a.branchId);assert.equal((await menuRepository(db,scope).list()).length,1);});
test('fresh scope resolution denies suspended tenants and revoked user/membership/branch state',async()=>{
 for(const [disable,restore] of [
  [()=>db.tenant.update({where:{id:a.tenantId},data:{status:'SUSPENDED'}}),()=>db.tenant.update({where:{id:a.tenantId},data:{status:'ACTIVE'}})],
  [()=>db.user.update({where:{id:a.userId},data:{active:false}}),()=>db.user.update({where:{id:a.userId},data:{active:true}})],
  [()=>db.membership.update({where:{id:a.membershipId},data:{active:false}}),()=>db.membership.update({where:{id:a.membershipId},data:{active:true}})],
  [()=>db.branch.update({where:{id:a.branchId},data:{active:false}}),()=>db.branch.update({where:{id:a.branchId},data:{active:true}})]
 ]){await disable!();await assert.rejects(scopeForVerifiedUser(db,a.userId,a.tenantId,a.branchId));await restore!();}
});
test('API readiness fails on a connected database with changed migration checksum',async()=>{const app=createApp(loadConfig(env),()=>checkDatabaseSchema(db));assert.equal((await request(app).get('/api/ready')).status,200);const first=(await migrationManifest())[0]!;await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${'0'.repeat(64)} WHERE migration_name=${first.name}`;try{const response=await request(app).get('/api/ready');assert.equal(response.status,503);assert.equal(response.body.database,'connected');assert.equal(response.body.schema,'pending');}finally{await db.$executeRaw`UPDATE public._prisma_migrations SET checksum=${first.checksum} WHERE migration_name=${first.name}`;}});
test('HTTP private routes stay denied even with valid test tenant IDs and live database',async()=>{const app=createApp(loadConfig(env),()=>checkDatabaseSchema(db));assert.equal((await request(app).get('/api/v1/restaurant/menu').set('X-Tenant-ID',a.tenantId).set('X-User-ID',a.userId)).status,401);});
test('missing direct migration URL fails locally without credential disclosure',async()=>{const result=await cli('deploy',{DIRECT_URL:''});assert.equal(result.code,1);assert.match(result.output,/DIRECT_URL is required/);assert.ok(!result.output.includes('synthetic-test-only'));});
