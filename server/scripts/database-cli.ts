import 'dotenv/config';
import {spawn} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createDatabase} from '../src/db.js';
import {databaseSettings,DatabaseConfigurationError,redactDatabaseSecrets} from '../src/database/settings.js';
import {checkDatabaseSchema} from '../src/database/readiness.js';
import {seedDemoDatabase,DemoSeedError} from '../src/database/demo-seed.js';
export async function runDatabaseCommand(action:string,env:NodeJS.ProcessEnv=process.env):Promise<number> {
 let db:ReturnType<typeof createDatabase>=null;
 try{
  if(!['deploy','status','doctor','seed'].includes(action))throw new DatabaseConfigurationError('Use db:deploy, db:status, db:doctor or db:seed. Destructive reset is not exposed.');
  if(action==='seed'&&(!['development','test'].includes(env.NODE_ENV??'development')||env.ALLOW_DEMO_SEED!=='true'))throw new DemoSeedError('Demo seed requires development/test and ALLOW_DEMO_SEED=true. It is disabled in production.');
  const settings=databaseSettings(env,action!=='doctor');
  if(action==='deploy'||action==='status'){
   const child=spawn(process.execPath,[fileURLToPath(new URL('../../node_modules/prisma/build/index.js',import.meta.url)),'migrate',action],{cwd:fileURLToPath(new URL('../',import.meta.url)),env:{...env,DIRECT_URL:settings.direct},stdio:['ignore','pipe','pipe']});
   let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=String(chunk);});
   const timer=setTimeout(()=>child.kill('SIGTERM'),90000);timer.unref();
   try{const code=await new Promise<number>((done,fail)=>{child.once('error',fail);child.once('exit',status=>done(status??1));});process.stdout.write(redactDatabaseSecrets(output,env));return code;}finally{clearTimeout(timer);}
  }
  if(action==='seed'){
   db=createDatabase(settings.direct)!;
   if(await checkDatabaseSchema(db)!=='current')throw new DemoSeedError('Apply all committed migrations before seeding.');
   const result=await seedDemoDatabase(db);console.log(JSON.stringify({status:'seeded_synthetic_drafts',...result}));return 0;
  }
  if(!settings.runtime)throw new DatabaseConfigurationError('DATABASE_URL is required for db:doctor. Put the pooled URL in server/.env.');
  db=createDatabase(settings.runtime)!;const schema=await checkDatabaseSchema(db);
  console.log(JSON.stringify({database:'connected',schema,directConfigured:!!settings.direct,pooledRuntime:new URL(settings.runtime).hostname.includes('-pooler.')}));
  return schema==='current'?0:1;
 }catch(error){
  console.error(error instanceof DatabaseConfigurationError||error instanceof DemoSeedError?redactDatabaseSecrets(error.message,env):'Database operation failed. Check connectivity, credentials and migration state. Driver details are suppressed to protect credentials.');return 1;
 }finally{await db?.$disconnect();}
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runDatabaseCommand(process.argv[2]??'');
