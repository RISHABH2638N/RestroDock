import {randomBytes,createHash,scrypt,timingSafeEqual} from 'node:crypto';
export class AuthBusyError extends Error {}
let active=0;
const parameters={N:131072,r:8,p:1,maxmem:160*1024*1024};
async function derive(password:string,salt:Buffer):Promise<Buffer> {
 if(active>=2)throw new AuthBusyError('Authentication is busy. Try again shortly.');
 active++;
 try{return await new Promise<Buffer>((resolve,reject)=>scrypt(password,salt,64,parameters,(error,key)=>error?reject(error):resolve(key)));}finally{active--;}
}
export async function hashPassword(password:string) {
 const salt=randomBytes(16);const key=await derive(password,salt);
 return `scrypt$131072$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}
export async function verifyPassword(password:string,encoded:string|null) {
 const parts=(encoded??'').split('$');
 const valid=parts.length===6&&parts[0]==='scrypt'&&parts[1]==='131072'&&parts[2]==='8'&&parts[3]==='1'&&/^[a-f0-9]{32}$/.test(parts[4]??'')&&/^[a-f0-9]{128}$/.test(parts[5]??'');
 // Missing accounts incur the same memory-hard work; malformed/legacy hashes never authenticate.
 const key=await derive(password,Buffer.from(valid?parts[4]!:'0'.repeat(32),'hex'));
 return valid&&timingSafeEqual(key,Buffer.from(parts[5]!,'hex'));
}
export const randomToken=()=>randomBytes(32).toString('base64url');
export const tokenHash=(value:string)=>createHash('sha256').update(value).digest('hex');
export const csrfFor=(sessionToken:string)=>tokenHash(`restrodock-csrf-v1:${sessionToken}`);
export function equalToken(a:string,b:string) {const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
