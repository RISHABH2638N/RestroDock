import type {Config} from '../../config.js';
import type {Database} from '../../db.js';
import {hashPassword,randomToken,tokenHash} from './crypto.js';
import {HttpError} from './session.js';

async function sendResetLink(config:Config,email:string,token:string) {
 const url=new URL('/reset-password',config.CLIENT_ORIGIN);
 url.hash=token;
 const result=await fetch('https://api.brevo.com/v3/smtp/email',{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(8000),
  headers:{'api-key':config.BREVO_API_KEY,'Content-Type':'application/json'},
  body:JSON.stringify({
   sender:{name:'RestroDock',email:config.BREVO_SENDER_EMAIL},to:[{email}],
   subject:'Reset your RestroDock password',
   textContent:`Open this link to reset your password:\n\n${url.href}\n\nIt expires in 20 minutes. If you did not request it, ignore this message.`,
  }),
 });
 if(!result.ok)throw new Error('Brevo did not accept the message');
}

export async function requestPasswordReset(db:Database,config:Config,email:string) {
 const now=Date.now(), token=randomToken(), hash=tokenHash(token);
 const issued=await db.user.updateMany({
  where:{email,active:true,passwordHash:{not:null},
   OR:[{resetRequestedAt:null},{resetRequestedAt:{lte:new Date(now-120_000)}}]},
  data:{resetTokenHash:hash,resetExpiresAt:new Date(now+20*60_000),resetRequestedAt:new Date(now)},
 });
 if(issued.count===1){
  // Keep the provider request off the public response path. This runs in the persistent Express process.
  void sendResetLink(config,email,token).catch(()=>{
   console.warn(JSON.stringify({event:'password_reset_delivery_failed'}));
  });
 }
}

export async function resetPassword(db:Database,token:string,password:string) {
 const resetTokenHash=tokenHash(token);
 const eligible={resetTokenHash,active:true,resetExpiresAt:{gt:new Date()}};
 const user=await db.user.findFirst({where:eligible,select:{id:true}});
 const invalid=()=>new HttpError(400,'RESET_INVALID','This reset link is invalid or expired. Request a new one.');
 if(!user)throw invalid();
 const passwordHash=await hashPassword(password);
 await db.$transaction(async tx=>{
  const claimed=await tx.user.updateMany({
   where:{...eligible,id:user.id,resetExpiresAt:{gt:new Date()}},
   data:{passwordHash,resetTokenHash:null,resetExpiresAt:null},
  });
  if(claimed.count!==1)throw invalid();
  await tx.staffSession.updateMany({where:{userId:user.id,revokedAt:null},data:{revokedAt:new Date()}});
 });
}
