import assert from 'node:assert/strict';
import {test} from 'node:test';
import {NextRequest} from 'next/server';
import {GET,PUT} from '../src/app/api/[...path]/route';
import {accessRequest} from '../src/features/access/api';

const publication=['v1','restaurant','tables','publication'];
const makeRequest=(method:string,path:string[])=>new NextRequest('http://localhost:3000/api/'+path.join('/'),{method});

test('table and logo writes can outlast the standard proxy deadline, with a larger browser budget',async t=>{
 const timeouts:number[]=[];
 const original=AbortSignal.timeout;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{
  timeouts.push(ms);
  return original(ms===6000?1:1000);
 });
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{
  return new Promise<Response>((resolve,reject)=>{
   const timer=setTimeout(()=>resolve(Response.json({saved:true})),25);
   options.signal!.addEventListener('abort',()=>{clearTimeout(timer);reject(options.signal!.reason);},{once:true});
  });
 });
 for(const path of [publication,['v1','restaurant','manage','logo']]){
  const response=await PUT(makeRequest('PUT',path),{params:Promise.resolve({path})});
  assert.deepEqual(await response.json(),{saved:true});
 }
 const health=['health'];
 const timedOut=await GET(makeRequest('GET',health),{params:Promise.resolve({path:health})});
 assert.equal(timedOut.status,504);
 assert.equal((await timedOut.json()).error.code,'API_TIMEOUT');
 assert.deepEqual(await accessRequest('/restaurant/tables/publication',{method:'PUT',body:{}}),{saved:true});
 assert.deepEqual(timeouts,[60_000,60_000,6_000,70_000]);
});

test('a connection failure still yields API_UNAVAILABLE',async t=>{
 t.mock.method(globalThis,'fetch',async()=>{throw new TypeError('Synthetic upstream connection failure');});
 const response=await PUT(makeRequest('PUT',publication),{params:Promise.resolve({path:publication})});
 assert.equal(response.status,502);
 assert.equal((await response.json()).error.code,'API_UNAVAILABLE');
});

test('client address is forwarded to the API only when the operator opts in',async t=>{
 const seen:(string|null)[]=[];
 t.mock.method(globalThis,'fetch',async(_url:unknown,options:RequestInit)=>{seen.push(new Headers(options.headers).get('x-forwarded-for'));return Response.json({ok:true});});
 const health=['health'];
 const request=()=>new NextRequest('http://localhost:3000/api/health',{method:'GET',headers:{'x-forwarded-for':'203.0.113.7'}});
 const original=process.env.API_PROXY_FORWARD_CLIENT_IP;
 try{
  delete process.env.API_PROXY_FORWARD_CLIENT_IP;
  await GET(request(),{params:Promise.resolve({path:health})});
  process.env.API_PROXY_FORWARD_CLIENT_IP='true';
  await GET(request(),{params:Promise.resolve({path:health})});
 }finally{if(original===undefined)delete process.env.API_PROXY_FORWARD_CLIENT_IP;else process.env.API_PROXY_FORWARD_CLIENT_IP=original;}
 assert.deepEqual(seen,[null,'203.0.113.7']);
});
