import { test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createServer } from 'node:http';
import { io as connect } from 'socket.io-client';
import { createApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createRealtime } from '../../src/realtime.js';
import { healthSchema, demoWorkspaceSchema } from '@restrodock/contracts';
const config=loadConfig({NODE_ENV:'test',DEMO_MODE:'true'});
const app=createApp(config);
test('health is contract-valid and has a server-generated request ID',async()=>{ const r=await request(app).get('/api/health').set('X-Request-ID','attacker'); assert.equal(r.status,200);healthSchema.parse(r.body);assert.notEqual(r.body.requestId,'attacker');assert.equal(r.headers['x-powered-by'],undefined);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['x-content-type-options'],'nosniff'); });
test('database absence is a 503 readiness failure, not fake healthy',async()=>{ const r=await request(app).get('/api/ready');assert.equal(r.status,503);assert.equal(r.body.database,'unconfigured'); });
test('configured database ping success marks readiness',async()=>{const r=await request(createApp({...config,DATABASE_URL:'postgresql://example'},async()=>{})).get('/api/ready');assert.equal(r.status,200);assert.equal(r.body.database,'connected');});
test('database failure redacts details',async()=>{const r=await request(createApp({...config,DATABASE_URL:'postgresql://example'},async()=>{throw new Error('password=secret');})).get('/api/ready');assert.equal(r.status,503);assert.equal(r.body.database,'unavailable');assert.ok(!r.text.includes('secret'));});
test('fixture endpoint is explicitly synthetic and contract-valid',async()=>{const r=await request(app).get('/api/v1/demo/workspace');assert.equal(r.status,200);demoWorkspaceSchema.parse(r.body);assert.equal(r.body.source,'synthetic_fixture');});
test('fixtures are absent unless enabled',async()=>{assert.equal((await request(createApp({...config,DEMO_MODE:false})).get('/api/v1/demo/workspace')).status,404);});
for(const route of ['restaurant','staff','super-admin']) test(`${route} rejects spoofed identity and tenant headers`,async()=>{const r=await request(app).get(`/api/v1/${route}/menu?tenantId=other`).set('X-Tenant-ID','other').set('X-User-ID','admin').set('Authorization','Bearer demo');assert.equal(r.status,401);});
test('guest orders cannot be submitted with just a QR',async()=>{const r=await request(app).post('/api/v1/orders').send({qr:'saved-photo',quantity:1000});assert.equal(r.status,404);});
test('CORS rejects unapproved browser origins',async()=>{assert.equal((await request(app).get('/api/health').set('Origin','https://attacker.test')).status,403);});
test('CORS preflight allows only configured origin',async()=>{const r=await request(app).options('/api/health').set('Origin',config.CLIENT_ORIGIN).set('Access-Control-Request-Method','GET');assert.equal(r.status,204);assert.equal(r.headers['access-control-allow-origin'],config.CLIENT_ORIGIN);});
test('malformed JSON returns controlled 400',async()=>{const r=await request(app).post('/api/none').set('Content-Type','application/json').send('{broken');assert.equal(r.status,400);assert.equal(r.body.error.code,'INVALID_REQUEST');});
test('oversized payload rejected before routing',async()=>{const r=await request(app).post('/api/v1/orders').send({data:'x'.repeat(20000)});assert.equal(r.status,413);});
test('unknown routes are JSON 404 without stack trace',async()=>{const r=await request(app).get('/missing');assert.equal(r.status,404);assert.equal(r.body.error.code,'NOT_FOUND');assert.equal(r.body.stack,undefined);});
test('foundation contract reports database sessions while ordering remains disabled',async()=>{const r=await request(app).get('/api/v1/foundation');assert.equal(r.body.orderingEnabled,false);assert.equal(r.body.staffAuthentication,'database_sessions');assert.equal(r.body.billingMode,'EXTERNAL_POS_MANUAL');});
test('production refuses demo fixtures',()=>{assert.throws(()=>loadConfig({NODE_ENV:'production',DEMO_MODE:'true',DATABASE_URL:'postgresql://example',CLIENT_ORIGIN:'https://restrodock.com'}),/forbidden/);});
test('production requires database and HTTPS',()=>{assert.throws(()=>loadConfig({NODE_ENV:'production'}));});
test('invalid config fails rather than guessing',()=>{assert.throws(()=>loadConfig({PORT:'abc'}));assert.throws(()=>loadConfig({DATABASE_URL:'mongodb://bad'}));assert.throws(()=>loadConfig({CLIENT_ORIGIN:'http://localhost:3000/path'}));});
test('HTTP rate limiter returns 429',async()=>{const isolated=createApp(config);let status=0;for(let i=0;i<121;i++)status=(await request(isolated).get('/api/health')).status;assert.equal(status,429);});
test('Socket.IO refuses unauthenticated and spoofed tenant handshakes',async()=>{
 const server=createServer();const {io:socketServer}=createRealtime(server,config,null);
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();assert.ok(address&&typeof address==='object');
 const socket=connect(`http://127.0.0.1:${address.port}`,{extraHeaders:{Origin:config.CLIENT_ORIGIN},auth:{tenantId:'other',role:'SUPER_ADMIN'},transports:['websocket'],reconnection:false,timeout:3000});
 try{await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('Socket rejection timed out')),4000);socket.on('connect',()=>{clearTimeout(timer);reject(new Error('Unauthorized socket connected'));});socket.on('connect_error',error=>{clearTimeout(timer);try{assert.match(error.message,/AUTH_REQUIRED/);resolve();}catch(e){reject(e);}});});}finally{socket.disconnect();await new Promise<void>(resolve=>socketServer.close(()=>resolve()));}
});

test('connected database with pending migrations is not application-ready',async()=>{const r=await request(createApp({...config,DATABASE_URL:'postgresql://example'},async()=>'pending')).get('/api/ready');assert.equal(r.status,503);assert.equal(r.body.database,'connected');assert.equal(r.body.schema,'pending');});

test('production refuses the checkout pilot',()=>{
 assert.throws(()=>loadConfig({NODE_ENV:'production',CHECKOUT_PILOT_ENABLED:'true',DATABASE_URL:'postgresql://example',CLIENT_ORIGIN:'https://restrodock.com'}),/forbidden/);
});

test('development allows two exact origins through HTTP and auth guards',async()=>{
 const lan='http://192.168.31.16:3000',local='http://localhost:3000';
 const api=createApp(loadConfig({NODE_ENV:'development',CLIENT_ORIGIN:lan,DEV_CLIENT_ORIGIN:local}));
 for(const origin of [lan,local]){
  const health=await request(api).get('/api/health').set('Origin',origin);
  assert.equal(health.status,200);
  assert.equal(health.headers['access-control-allow-origin'],origin);
  const login=await request(api).post('/api/v1/auth/login').set('Origin',origin).send({email:'staff@example.test',portal:'staff',password:'sample-password'});
  assert.equal(login.status,503);
 }
 const denied=await request(api).get('/api/health').set('Origin','http://192.168.31.16:3001');
 assert.equal(denied.body.error.code,'ORIGIN_DENIED');
 assert.throws(()=>loadConfig({NODE_ENV:'production',CLIENT_ORIGIN:'https://restrodock.com',DEV_CLIENT_ORIGIN:local}),/only allowed in development/);
});
