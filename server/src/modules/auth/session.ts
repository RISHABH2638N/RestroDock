import type {Response} from 'express';
import type {IncomingMessage} from 'node:http';
import type {Database} from '../../db.js';
import type {Config} from '../../config.js';
import {tokenHash,csrfFor} from './crypto.js';
export class HttpError extends Error {constructor(public status:number,public code:string,message:string){super(message);}}
export const cookieName=(config:Config)=>config.NODE_ENV==='production'?'__Host-restrodock_session':'restrodock_session';
export function readSessionToken(req:Pick<IncomingMessage,"headers">,config:Config):string|null {
 const values=(req.headers.cookie??'').split(';').map(v=>v.trim()).filter(v=>v.startsWith(`${cookieName(config)}=`));
 if(values.length!==1)return null;
 const value=values[0]!.slice(cookieName(config).length+1);
 return /^[A-Za-z0-9_-]{43}$/.test(value)?value:null;
}
export const sessionLifetimeMs=(rememberDevice:boolean)=> (rememberDevice?30*24:12)*60*60*1000;
export function setSessionCookie(res:Response,config:Config,token:string,rememberDevice:boolean) {
 res.cookie(cookieName(config),token,{httpOnly:true,secure:config.NODE_ENV==='production',sameSite:'strict',path:'/',...(rememberDevice?{maxAge:sessionLifetimeMs(true)}:{})});
}
export async function authenticate(db:Database,req:Pick<IncomingMessage,"headers">,config:Config) {
 const token=readSessionToken(req,config);
 if(!token)throw new HttpError(401,'AUTH_REQUIRED','Sign in to continue.');
 const session=await db.staffSession.findUnique({where:{tokenHash:tokenHash(token)},include:{user:{include:{platformAdmin:true}}}});
 const now=new Date();
 if(!session||session.revokedAt||!session.user.active||session.expiresAt<=now||(session.rememberDevice?!!session.user.platformAdmin?.active:session.lastSeenAt.getTime()<now.getTime()-30*60*1000))throw new HttpError(401,'SESSION_EXPIRED','Your session expired. Sign in again.');
 // Recheck database identity/privilege on every request. Idle expiry is independent of absolute expiry.
 await db.staffSession.update({where:{id:session.id},data:{lastSeenAt:now}});
 return {session,user:session.user,token,csrfToken:csrfFor(token)};
}
export type Identity=Awaited<ReturnType<typeof authenticate>>;
export function platformOnly(identity:Identity) {if(!identity.user.platformAdmin?.active)throw new HttpError(403,'FORBIDDEN','Platform administrator access is required.');}
