import {isManagementWrite,managementClientTimeoutMs} from '../../lib/api-timeout';
import {identitySchema} from '@restrodock/contracts';
export class AccessError extends Error {
 constructor(message:string,public status:number,public fields:{field:string;message:string}[]=[],public code=''){super(message);}
}
// Staff authentication is supported through the same-origin Next proxy. No browser token storage.
export async function accessRequest(path:string,options:{method?:string;body?:unknown;csrf?:string}={}):Promise<unknown> {
 const method=options.method??'GET',url='/api/v1'+path;
 const management=isManagementWrite(method,url);
 let response:Response;
 try{response=await fetch(url,{method,credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(management?managementClientTimeoutMs:12000),headers:{...(options.body?{'Content-Type':'application/json'}:{}),...(options.csrf?{'X-CSRF-Token':options.csrf}:{})},...(options.body?{body:JSON.stringify(options.body)}:{})});}
 catch{throw new AccessError(management?'The server response was interrupted.':'Cannot reach RestroDock. Check your connection and that the server is running, then retry.',0);}
 const data=await response.json().catch(()=>null);
 if(!response.ok)throw new AccessError(data?.error?.message??'The request failed. Retry after checking the server.',response.status,data?.error?.fields??[],data?.error?.code??'');
 return data;
}
export const loadIdentity=async()=>identitySchema.parse(await accessRequest('/auth/me'));
export const errorText=(error:unknown)=>error instanceof Error?error.message:'The request failed. Try again.';

export const writeResultUnknown=(error:unknown)=>error instanceof AccessError&&(error.status===0||error.status>=500);
