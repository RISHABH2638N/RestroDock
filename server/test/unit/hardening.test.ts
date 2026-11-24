import {test} from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../../src/app.js';
import {loadConfig} from '../../src/config.js';
import {purgeStaleAuthRecords} from '../../src/database/maintenance.js';
import {registrationInput,guestJoin,checkoutRequestSchema,tableFields} from '@restrodock/contracts';
import type {Database} from '../../src/db.js';

const config=loadConfig({NODE_ENV:'test'});

test('trusted proxy hop count defaults to none and rejects unsafe values',()=>{
 assert.equal(config.TRUST_PROXY_HOPS,0);
 assert.equal(loadConfig({NODE_ENV:'test',TRUST_PROXY_HOPS:'1'}).TRUST_PROXY_HOPS,1);
 for(const value of ['-1','4','1.5','many'])assert.throws(()=>loadConfig({NODE_ENV:'test',TRUST_PROXY_HOPS:value}),/TRUST_PROXY_HOPS/);
});

test('with one trusted hop each client address has its own rate-limit bucket',async()=>{
 const app=createApp({...config,TRUST_PROXY_HOPS:1});
 let status=0;
 for(let i=0;i<121;i++)status=(await request(app).get('/api/health').set('X-Forwarded-For','203.0.113.10')).status;
 assert.equal(status,429);
 assert.equal((await request(app).get('/api/health').set('X-Forwarded-For','203.0.113.11')).status,200);
});

test('unexpected failures are logged by class only, never with driver messages',async()=>{
 const events:unknown[]=[];
 const logger={info:()=>{},warn:()=>{},error:(...args:unknown[])=>{events.push(args);}} as never;
 const database={authThrottle:{findUnique:async()=>{throw new Error('postgresql://owner:hunter2@db.internal/app failed');}}} as unknown as Database;
 const app=createApp(config,undefined,database,undefined,logger);
 const response=await request(app).post('/api/v1/auth/login').set('Origin',config.CLIENT_ORIGIN).send({email:'owner@example.com',portal:'staff',password:'correct horse battery staple'});
 assert.equal(response.status,500);
 assert.equal(response.body.error.code,'INTERNAL_ERROR');
 assert.ok(!JSON.stringify(response.body).includes('hunter2'));
 assert.ok(events.length>=1);
 assert.ok(!JSON.stringify(events).includes('hunter2'));
});

test('stale authentication records are purged with bounded cutoffs',async()=>{
 const calls:{model:string;where:unknown}[]=[];
 const database={
  staffSession:{deleteMany:async(args:{where:unknown})=>{calls.push({model:'session',where:args.where});return {count:3};}},
  authThrottle:{deleteMany:async(args:{where:unknown})=>{calls.push({model:'throttle',where:args.where});return {count:5};}},
 } as unknown as Database;
 const now=new Date('2026-11-14T00:00:00.000Z');
 assert.deepEqual(await purgeStaleAuthRecords(database,now),{sessions:3,throttles:5});
 assert.deepEqual(calls.find(call=>call.model==='session')?.where,{OR:[{expiresAt:{lt:new Date('2026-11-07T00:00:00.000Z')}},{revokedAt:{lt:new Date('2026-11-07T00:00:00.000Z')}}]});
 assert.deepEqual(calls.find(call=>call.model==='throttle')?.where,{windowStart:{lt:new Date('2026-11-13T00:00:00.000Z')}});
});

const registration={restaurantName:'Salimar Darbar',branchName:'Main',ownerName:'Asha Rao',email:'asha@example.com',phone:'+919876543210',city:'Lucknow',address:'12 MG Road',password:'a long private passphrase',ownerAuthorised:true,trackingSecret:'a'.repeat(43)};
test('free-text fields reject control, line-separator and bidirectional-override characters',()=>{
 assert.equal(registrationInput.safeParse(registration).success,true);
 for(const bad of ['\u0000','\u0007','\n','‮','⁦','​','﻿',' '])
  for(const field of ['restaurantName','branchName','ownerName','city','address'] as const)
   assert.equal(registrationInput.safeParse({...registration,[field]:'Valid '+bad+' text'}).success,false,`${field} accepted ${JSON.stringify(bad)}`);
});

test('legitimate multilingual names, including joiners used by Indic scripts, still validate',()=>{
 assert.equal(registrationInput.safeParse({...registration,restaurantName:'सलीमार दरबार',ownerName:'क्‍ष त्रिपाठी'}).success,true);
 assert.equal(tableFields.shape.label.safeParse('Table 01').success,true);
 assert.equal(tableFields.shape.label.safeParse('Table‮01').success,false);
 const join={qrToken:'b'.repeat(43),sessionId:'11111111-1111-4111-8111-111111111111',pinVersion:1,pin:'123456',displayName:'Guest One',mobile:'+919876543210',privacyAccepted:true,guestSecret:'c'.repeat(43)};
 assert.equal(guestJoin.safeParse(join).success,true);
 assert.equal(guestJoin.safeParse({...join,displayName:'Guest‮One'}).success,false);
});

test('order notes may contain a line break but not other control characters',()=>{
 const note=checkoutRequestSchema.shape.lines.element.shape.note;
 assert.equal(note.safeParse('less spicy\nno onion').success,true);
 assert.equal(note.safeParse('bad\u0000note').success,false);
 assert.equal(note.safeParse('bad‮note').success,false);
});

test('production refuses debug logging and inspector options',()=>{
 for(const value of [{DEBUG:'*'},{NODE_DEBUG:'http'},{NODE_OPTIONS:'--inspect=0.0.0.0:9229'}]){
  assert.throws(()=>loadConfig({NODE_ENV:'production',...value}),/Disable debug/);
 }
});
