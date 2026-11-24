import type {NextRequest} from 'next/server';
import {isManagementWrite,managementProxyTimeoutMs} from '../../../lib/api-timeout';
export const runtime='nodejs';
export const dynamic='force-dynamic';
const maximumBody=16*1024;
const requestHeaders=['accept','content-type','authorization','cookie','origin','x-csrf-token','idempotency-key'];
const responseHeaders=['content-type','x-request-id','retry-after','ratelimit','ratelimit-policy'];
async function forward(request:NextRequest,{params}:{params:Promise<{path:string[]}>}) {
 let upstreamSignal:AbortSignal|undefined;
 try{
  const configured=process.env.API_PROXY_URL||'http://127.0.0.1:4000';
  const origin=new URL(configured);
  if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.search||origin.hash||!['','/'].includes(origin.pathname))return Response.json({error:{code:'PROXY_CONFIGURATION',message:'Configure API_PROXY_URL as an HTTP(S) origin.'}},{status:503});
  if(process.env.NODE_ENV==='production' && origin.protocol==='http:' && !['localhost','127.0.0.1','[::1]'].includes(origin.hostname)){
   return Response.json({error:{code:'PROXY_CONFIGURATION',message:'The API connection requires HTTPS.'}},{status:503});
  }
  const segments=(await params).path;
  if(segments.some(s=>!s||s==='.'||s==='..'||s.includes('/')||s.includes('\\')||[...s].some(char=>char.charCodeAt(0)<32)))return Response.json({error:{code:'INVALID_PATH',message:'Invalid API path.'}},{status:400});
  const target=new URL(`/api/${segments.map(encodeURIComponent).join('/')}`,origin);
  target.search=request.nextUrl.search;
  const headers=new Headers();for(const name of requestHeaders){const value=request.headers.get(name);if(value)headers.set(name,value);}
  // Opt-in only: pass the ingress-appended client address so the API rate-limits each visitor instead of this proxy.
  // Enable ONLY behind an ingress you control that appends/overwrites X-Forwarded-For, and set TRUST_PROXY_HOPS on the API.
  if(process.env.API_PROXY_FORWARD_CLIENT_IP==='true'){const forwarded=request.headers.get('x-forwarded-for');if(forwarded&&forwarded.length<=512)headers.set('x-forwarded-for',forwarded);}
  const imageUpload=request.method==='PUT'&&segments[0]==='v1'&&segments[1]==='restaurant'&&segments[2]==='manage'&&((segments.length===4&&segments[3]==='logo')||(segments.length===6&&segments[3]==='items'&&/^[a-f0-9-]{36}$/.test(segments[4]??'')&&segments[5]==='photo'))&&['image/jpeg','image/png','image/webp'].includes(request.headers.get('content-type')??'');
  const bodyLimit=imageUpload?2*1024*1024:maximumBody;
  let body:Uint8Array|undefined;
  if(!['GET','HEAD'].includes(request.method)&&request.body){
   const reader=request.body.getReader();const chunks:Uint8Array[]=[];let length=0;
   while(true){const part=await reader.read();if(part.done)break;length+=part.value.byteLength;if(length>bodyLimit){await reader.cancel();return Response.json({error:{code:'PAYLOAD_TOO_LARGE',message:imageUpload?'Image exceeds 2 MiB.':'Request body exceeds 16 KiB.'}},{status:413});}chunks.push(part.value);}
   body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.byteLength;}
  }
  upstreamSignal=AbortSignal.timeout(isManagementWrite(request.method,target.pathname)?managementProxyTimeoutMs:6000);
  const upstream=await fetch(target,{method:request.method,headers,cache:'no-store',redirect:'manual',signal:upstreamSignal,...(body?{body:body as BodyInit}:{})});
  if(upstream.status>=300&&upstream.status<400&&upstream.status!==304){
   await upstream.body?.cancel();
   return Response.json({error:{code:'API_REDIRECT',message:'Unexpected API response.'}},{status:502,headers:{'Cache-Control':'no-store'}});
  }
  const outgoing=new Headers({'Cache-Control':'no-store'});for(const name of responseHeaders){const value=upstream.headers.get(name);if(value)outgoing.set(name,value);}
  for(const cookie of upstream.headers.getSetCookie())outgoing.append('Set-Cookie',cookie);
  return new Response(upstream.body,{status:upstream.status,headers:outgoing});
 }catch{
  if(upstreamSignal?.aborted)return Response.json({error:{code:'API_TIMEOUT',message:'The API took too long to respond.'}},{status:504,headers:{'Cache-Control':'no-store'}});
  return Response.json({error:{code:'API_UNAVAILABLE',message:'The API is unavailable. Check that the server process is running.'}},{status:502,headers:{'Cache-Control':'no-store'}});}
}
export const GET=forward;export const HEAD=forward;export const POST=forward;export const PUT=forward;export const PATCH=forward;export const DELETE=forward;export const OPTIONS=forward;
