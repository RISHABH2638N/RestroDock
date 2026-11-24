import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { once } from 'node:events';
import assert from 'node:assert/strict';
const reservation=createServer();await new Promise((resolve,reject)=>{reservation.once('error',reject);reservation.listen(0,'127.0.0.1',resolve);});
const address=reservation.address();if(!address||typeof address==='string')throw new Error('No smoke-test port');
const port=address.port;await new Promise(resolve=>reservation.close(resolve));
const apiReservation=createServer();await new Promise(resolve=>apiReservation.listen(0,'127.0.0.1',resolve));
const apiAddress=apiReservation.address();if(!apiAddress||typeof apiAddress==='string')throw new Error('No API smoke port');
const apiPort=apiAddress.port;await new Promise(resolve=>apiReservation.close(resolve));
const api=spawn(process.execPath,[fileURLToPath(new URL('../server/dist/index.js',import.meta.url))],{cwd:fileURLToPath(new URL('../server',import.meta.url)),env:{...process.env,NODE_ENV:'test',HOST:'127.0.0.1',PORT:String(apiPort),CLIENT_ORIGIN:`http://127.0.0.1:${port}`,DATABASE_URL:'',DIRECT_URL:'',DATABASE_URL_POOLED:'',DEMO_MODE:'true'},stdio:['ignore','pipe','pipe']});
let apiExited=false;api.on('exit',()=>{apiExited=true;});for(const stream of [api.stdout,api.stderr])stream.on('data',()=>{});
const next=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'start','--hostname','127.0.0.1','--port',String(port)],{cwd:fileURLToPath(new URL('../client',import.meta.url)),env:{...process.env,NODE_ENV:'production',ENABLE_UX_PREVIEW:'true',NEXT_TELEMETRY_DISABLED:'1',API_PROXY_URL:`http://127.0.0.1:${apiPort}`},stdio:['ignore','pipe','pipe']});
let exited=false,output='';next.on('exit',()=>{exited=true;});for(const stream of [next.stdout,next.stderr])stream.on('data',chunk=>{output+=chunk.toString();});
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
 let online=false;
 for(let attempt=0;attempt<80;attempt++){
  if(exited)throw new Error('Production server exited before smoke checks: '+output.slice(-2000));
  try{const res=await fetch(`http://127.0.0.1:${port}/`,{signal:AbortSignal.timeout(1000)});if(res.status===200){const html=await res.text();if(html.includes('href="/design"'))throw new Error('Production navigation exposes the UX studio');online=true;break;}}catch(error){if(error instanceof Error&&error.message.includes('exposes'))throw error;}
  await pause(250);
 }
 if(!online)throw new Error('Production server did not become ready');
 console.log('PASS production home returns 200 and hides UX studio navigation');
 let apiOnline=false;
 for(let attempt=0;attempt<40;attempt++){if(apiExited)throw new Error('Independent API process exited early');try{if((await fetch(`http://127.0.0.1:${apiPort}/api/health`,{signal:AbortSignal.timeout(1000)})).status===200){apiOnline=true;break;}}catch{/* Startup is still pending. */}await pause(100);}
 assert.ok(apiOnline,'Independent API did not become ready');
 const web=`http://127.0.0.1:${port}`;
 const securityResponse=await fetch(web);
 assert.match(securityResponse.headers.get('content-security-policy')??'',/frame-ancestors 'none'/);
 assert.match(securityResponse.headers.get('strict-transport-security')??'',/max-age=31536000/);
 assert.equal(securityResponse.headers.get('x-content-type-options'),'nosniff');
 assert.match(securityResponse.headers.get('permissions-policy')??'',/microphone=\(\)/);
 for(const path of ['/.env','/.env.local','/.git/config','/server/.env','/package-lock.json']){
  assert.equal((await fetch(web+path)).status,404,path);
 }
 console.log('PASS production security headers and private file paths');
 const landing=await (await fetch(web)).text();assert.ok(landing.includes('Digitize Your Dining Floor'));assert.ok(landing.includes('href="/sign-in"'));assert.ok(landing.includes('Frequently asked questions'));assert.ok(landing.includes('href="/terms"'));assert.ok(landing.includes('href="/privacy"'));const signIn=await (await fetch(web+'/sign-in')).text();for(const portal of ['restaurant','platform','staff'])assert.ok(signIn.includes('/sign-in?portal='+portal));assert.ok(!landing.includes('DEVELOPMENT WORKSPACE'));console.log('PASS public landing links to the three-role sign-in without development chrome');
 for(const [route,heading] of [['/terms','Terms &amp; Conditions'],['/privacy','Privacy']]){
  const policy=await fetch(web+route);
  assert.equal(policy.status,200);
  assert.ok((await policy.text()).includes(heading));
 }
 for(const [query,title] of [['restaurant','Restaurant Admin'],['platform','Platform Admin'],['https%3A%2F%2Fattacker.invalid','Staff login']]){const response=await fetch(`${web}/sign-in?portal=${query}`);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(`<h1>${title}</h1>`));console.log(`PASS login context ${query} has a bounded presentation and no redirect`);}
 const workspace=await fetch(`${web}/workspace`);assert.equal(workspace.status,404);console.log('PASS development diagnostics are 404 in production');
 for(const [path,heading] of [['/register','Bring your restaurant aboard.'],['/registration/status','Your restaurant application'],['/super-admin/registrations','Loading workspace']]){const response=await fetch(web+path);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(heading));assert.ok(!html.includes('passwordHash'));if(path.startsWith('/super-admin'))assert.ok(!html.includes('aria-label="Workspace navigation"'));console.log(`PASS ${path} renders its public or session-gated registration entry`);}
 assert.equal((await fetch(`${web}/api/v1/super-admin/registrations`)).status,401);console.log('PASS anonymous registration review is denied');
 const analyticsPage=await fetch(web+'/super-admin/analytics');
 assert.equal(analyticsPage.status,200);
 assert.match(await analyticsPage.text(),/Loading workspace/);
 assert.equal((await fetch(web+'/api/v1/super-admin/analytics')).status,401);
 console.log('PASS Platform Analytics renders a gated page and denies anonymous API requests');
 const applicationBody={restaurantName:'Synthetic application',branchName:'Main',ownerName:'Synthetic owner',email:'application@synthetic.test',phone:'+919999999999',city:'Synthetic city',address:'Synthetic address',password:'Synthetic registration passphrase',ownerAuthorised:true,trackingSecret:'a'.repeat(43)};
 const unavailableApplication=await fetch(`${web}/api/v1/registrations`,{method:'POST',headers:{Origin:web,'Content-Type':'application/json'},body:JSON.stringify(applicationBody)});assert.equal(unavailableApplication.status,503);console.log('PASS unconfigured registration fails closed without claiming a saved request');
 const unavailableStatus=await fetch(`${web}/api/v1/registrations/status`,{method:'POST',headers:{Origin:web,'Content-Type':'application/json'},body:JSON.stringify({trackingSecret:applicationBody.trackingSecret})});assert.equal(unavailableStatus.status,503);assert.ok(!(await unavailableStatus.text()).includes(applicationBody.trackingSecret));console.log('PASS tracking fails closed without echoing the private capability');
 const foreignApplication=await fetch(`${web}/api/v1/registrations`,{method:'POST',headers:{Origin:'https://attacker.invalid','Content-Type':'application/json'},body:JSON.stringify(applicationBody)});assert.equal(foreignApplication.status,403);console.log('PASS public registration retains configured-Origin enforcement');
 const health=await fetch(`${web}/api/health`);assert.equal(health.status,200);assert.equal((await health.json()).service,'restrodock-api');console.log('PASS independent Express API and runtime Next proxy return real health JSON');
 const readiness=await fetch(`${web}/api/ready`);assert.equal(readiness.status,503);assert.equal((await readiness.json()).database,'unconfigured');console.log('PASS unconfigured database remains 503 through frontend proxy');
 const sample=await fetch(`${web}/api/v1/demo/workspace`);assert.equal(sample.status,200);assert.equal((await sample.json()).source,'synthetic_fixture');console.log('PASS sample client API call returns synthetic workspace through frontend');
 const denied=await fetch(`${web}/api/v1/restaurant/menu`,{headers:{'X-Tenant-ID':'spoofed'}});assert.equal(denied.status,401);console.log('PASS frontend proxy does not authenticate tenant header spoofing');
 const large=await fetch(`${web}/api/v1/orders`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:'x'.repeat(20000)})});assert.equal(large.status,413);console.log('PASS frontend proxy enforces 16 KiB request-body bound');
 const traversal=await fetch(`${web}/api/http%3A%2F%2Fattacker.invalid`);assert.equal(traversal.status,400);console.log('PASS encoded path cannot replace the fixed API target');
 const crossOrigin=await fetch(`${web}/api/health`,{headers:{Origin:'https://attacker.invalid'}});assert.equal(crossOrigin.status,403);console.log('PASS unapproved Origin is rejected through the proxy');

 for(const path of ['/sign-in','/accept-invite','/super-admin','/restaurant','/staff']){const response=await fetch(web+path);assert.equal(response.status,200);const html=await response.text();assert.ok(!html.includes('passwordHash'));if(['/super-admin','/restaurant','/staff'].includes(path)){assert.ok(html.includes('Loading workspace'));assert.ok(!html.includes('aria-label="Workspace navigation"'));assert.ok(!html.includes('DEVELOPMENT WORKSPACE'));}console.log(`PASS ${path} renders without leaking authenticated records or cross-role navigation`);}
 const signedOut=await fetch(`${web}/api/v1/auth/me`);assert.equal(signedOut.status,401);console.log('PASS same-origin session lookup rejects anonymous production requests');
 const unconfiguredLogin=await fetch(`${web}/api/v1/auth/login`,{method:'POST',headers:{Origin:web,'Content-Type':'application/json'},body:JSON.stringify({email:'test@synthetic.test',portal:'staff',password:'Synthetic password only'})});assert.equal(unconfiguredLogin.status,503);console.log('PASS unconfigured login fails closed through runtime proxy');
 const privateSetup=await fetch(`${web}/api/v1/restaurant/manage/settings`);assert.equal(privateSetup.status,401);const privateLogo=await fetch(`${web}/api/v1/restaurant/manage/logo`);assert.equal(privateLogo.status,401);console.log('PASS restaurant management settings and media remain private without a session');
 const anonymousUpload=await fetch(`${web}/api/v1/restaurant/manage/logo?v=1`,{method:'PUT',headers:{Origin:web,'Content-Type':'image/png'},body:Buffer.alloc(20000)});assert.equal(anonymousUpload.status,401);console.log('PASS binary upload allowance does not bypass authentication');
 for(const [path,text] of [['/q','Your table entry'],['/restaurant/tables','Loading workspace'],['/staff/tables','Loading workspace']]){const response=await fetch(web+path);assert.equal(response.status,200);const html=await response.text();assert.ok(html.includes(text));console.log(`PASS ${path} renders its public or gated entry`);}
 for(const kind of ['restaurant','staff']){
  const path='/'+kind+'/order-review';
  assert.match(await (await fetch(web+path)).text(),/Loading workspace/);
  assert.equal((await fetch(web+'/api/v1'+path)).status,401);
 }
 console.log('PASS order review pages and APIs keep anonymous users outside');
 assert.equal((await fetch(web+'/api/v1/restaurant/tables?tenantId=00000000-0000-4000-8000-000000000001&branchId=00000000-0000-4000-8000-000000000001')).status,401);console.log('PASS anonymous table management denied');
 assert.equal((await fetch(web+'/api/v1/table-entry/lookup',{method:'POST',headers:{Origin:web,'Content-Type':'application/json'},body:JSON.stringify({qrToken:'a'.repeat(43)})})).status,503);console.log('PASS unconfigured QR lookup fails closed');
 assert.equal((await fetch(web+'/api/v1/guest/orders',{method:'POST',headers:{Origin:web,'Content-Type':'application/json'},body:'{}'})).status,404);console.log('PASS guest order endpoint remains unavailable');
 api.kill('SIGTERM');await Promise.race([once(api,'exit'),pause(2000)]);if(!apiExited){api.kill('SIGKILL');await pause(100);}
 const outage=await fetch(`${web}/api/health`);assert.equal(outage.status,502);assert.equal((await outage.json()).error.code,'API_UNAVAILABLE');console.log('PASS stopped API yields a controlled 502 instead of fake success');
 const offlineLanding=await fetch(web);assert.equal(offlineLanding.status,200);assert.ok((await offlineLanding.text()).includes('Digitize Your Dining Floor'));console.log('PASS public landing renders with the API stopped');
 const paths=['/design','/design/guest','/design/kitchen','/design/cashier','/design/restaurant','/design/platform','/design/ui-kit','/design/guest/extra'];
 for(const path of paths){const res=await fetch(`http://127.0.0.1:${port}${path}`,{signal:AbortSignal.timeout(5000)});await res.arrayBuffer();if(res.status!==404)throw new Error(`${path} must be 404 in production, received ${res.status}`);console.log(`PASS ${path} is 404 even with ENABLE_UX_PREVIEW=true`);}
 const seoPaths=['/','/register','/privacy','/terms','/sign-in','/register/thank-you','/registration/status','/staff/tables','/restaurant/profile','/restaurant/hours','/super-admin/analytics','/q'];
 const titles=new Set(),descriptions=new Set();
 const indexing=process.env.RESTRODOCK_PUBLIC_INDEXING==='true'&&(!process.env.VERCEL_ENV||process.env.VERCEL_ENV==='production');
 const publicSeoPaths=seoPaths.slice(0,4);
 for(const path of seoPaths){
  const response=await fetch(web+path);
  assert.equal(response.status,200,path);
  const html=await response.text();
  const title=html.match(/<title>(.*?)<\/title>/)?.[1];
  const description=html.match(/name="description" content="([^"]+)"/)?.[1];
  assert.ok(title&&!titles.has(title),path+' title');
  assert.ok(description&&!descriptions.has(description),path+' description');
  titles.add(title);descriptions.add(description);
  assert.equal(response.headers.get('x-robots-tag'),indexing&&publicSeoPaths.includes(path)?'index, follow':'noindex, nofollow',path);
  if(publicSeoPaths.includes(path))assert.match(html,/property="og:image" content="https:\/\/restrodock\.com\/brand\/restrodock-share\.png"/);
 }
 const robots=await fetch(web+'/robots.txt');
 assert.equal(robots.status,200);
 assert.match(await robots.text(),indexing?/Sitemap: https:\/\/restrodock\.com\/sitemap\.xml/:/Disallow: \/\s/);
 const sitemap=await fetch(web+'/sitemap.xml');
 assert.equal(sitemap.status,200);
 const locations=[...(await sitemap.text()).matchAll(/<loc>(.*?)<\/loc>/g)].map(match=>match[1]);
 assert.deepEqual(locations,indexing?publicSeoPaths.map(path=>'https://restrodock.com'+path):[]);
 for(const path of ['/brand/restrodock-logo.png','/brand/restrodock-share.png']){
  const asset=await fetch(web+path);
  assert.equal(asset.status,200);
  assert.equal(asset.headers.get('content-type'),'image/png');
 }
 assert.match(landing,/<img(?=[^>]*alt="RestroDock")(?=[^>]*restrodock-logo\.png)[^>]+>/);
 const missing=await fetch(web+'/page-that-does-not-exist');
 assert.equal(missing.status,404);
 assert.match(await missing.text(),/Back to home/);
 console.log('PASS public SEO and private indexing separation, branded images and custom 404');
 console.log(`Production HTTP smoke: ${paths.length+39} check groups passed.`);
}finally{
 if(!apiExited){api.kill('SIGTERM');await Promise.race([once(api,'exit'),pause(2000)]);if(!apiExited)api.kill('SIGKILL');}
 if(!exited){next.kill('SIGTERM');await Promise.race([once(next,'exit'),pause(2000)]);if(!exited)next.kill('SIGKILL');}
}
