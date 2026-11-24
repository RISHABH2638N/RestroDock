import {z} from 'zod';
import type {Database} from '../../db.js';
import {hashPassword} from './crypto.js';
import {BootstrapError} from './bootstrap-errors.js';
export async function bootstrapAdmin(db:Database,env:NodeJS.ProcessEnv) {
 if(await db.authBootstrap.findUnique({where:{id:1}}))return 'already_initialized';
 const email=env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
 const password=env.BOOTSTRAP_ADMIN_PASSWORD;
 if(!email&&!password)return 'not_configured';
 if(!email)throw new BootstrapError('BOOTSTRAP_EMAIL_REQUIRED');
 if(!z.email().max(254).safeParse(email).success)throw new BootstrapError('BOOTSTRAP_EMAIL_INVALID');
 if(!password)throw new BootstrapError('BOOTSTRAP_PASSWORD_REQUIRED');
 if(password.length<15||password.length>128)throw new BootstrapError('BOOTSTRAP_PASSWORD_LENGTH');
 const passwordHash=await hashPassword(password);
 try{
  await db.$transaction(async tx=>{
   // A unique singleton prevents concurrent startup from granting two bootstrap administrators.
   await tx.authBootstrap.create({data:{id:1}});
   if(await tx.platformAdmin.count())throw new BootstrapError('BOOTSTRAP_PLATFORM_EXISTS');
   if(await tx.user.findUnique({where:{email:email!}}))throw new BootstrapError('BOOTSTRAP_ACCOUNT_EXISTS');
   const user=await tx.user.create({data:{email:email!,passwordHash,active:true}});
   await tx.platformAdmin.create({data:{userId:user.id}});
   await tx.controlAudit.create({data:{actorId:user.id,action:'PLATFORM_BOOTSTRAPPED',resourceReference:user.id}});
  },{maxWait:10000,timeout:15000});
 }catch(error){
  // A concurrent bootstrap may have completed. Preserve the original failure if recovery lookup also fails.
  try{if(await db.authBootstrap.findUnique({where:{id:1}}))return 'already_initialized';}catch{/* Report the original failure without driver details. */}
  throw error;
 }
 return 'created';
}
