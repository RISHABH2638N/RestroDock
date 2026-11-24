import {mkdir,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {redactDatabaseSecrets} from '../server/src/database/settings.ts';
const root=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run this recorder with npm run verify:report.');
const directory=join(root,'qa-results',`day-13-${new Date().toISOString().replace(/[:.]/g,'-')}`);await mkdir(directory,{recursive:true});
const commands=[['schema',['run','db:validate']],['lint',['run','lint']],['typecheck',['run','typecheck']],['unit',['test']],['ui',['run','test:ui']],['sql',['run','test:db']],['integration',['run','test:integration']],['build',['run','build']],['http-smoke',['run','test:production']],['startup',['run','test:startup']],['audit',['audit','--json']]];
const checks=[];
// Verification never uses an operator's Neon secrets, even when server/.env contains them.
const environment={...process.env,DATABASE_URL:'',DIRECT_URL:'',DATABASE_URL_POOLED:'',DATABASE_URL_UNPOOLED:'',PGPASSWORD:'',NEON_REALTIME_SECRET:'',BOOTSTRAP_ADMIN_EMAIL:'',BOOTSTRAP_ADMIN_PASSWORD:'',ALLOW_DEMO_SEED:'false',CHECKOUT_PILOT_ENABLED:'false',NEXT_PUBLIC_API_URL:'',API_PROXY_URL:'http://127.0.0.1:4000',NEXT_TELEMETRY_DISABLED:'1'};
for(const [name,args] of commands){
 console.log(`Running ${name}…`);const start=Date.now();
 const child=spawn(process.execPath,[npm,...args],{cwd:root,env:environment,stdio:['ignore','pipe','pipe']});
 let output='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{output+=String(chunk);});
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>resolve(code??1));});
 const safe=redactDatabaseSecrets(output,process.env);await writeFile(join(directory,`${name}.log`),safe);
 checks.push({name,command:['npm',...args],exitCode:code,durationMs:Date.now()-start,log:`${name}.log`});console.log(`${name}: ${code===0?'PASS':'FAIL'}`);
 await writeFile(join(directory,'results.json'),JSON.stringify({recordedAt:new Date().toISOString(),platform:process.platform,node:process.version,externalDatabaseUsed:false,databaseTestEngine:'PGlite PostgreSQL WASM over loopback TCP plus Prisma pg adapter',checks},null,2)+'\n');
 if(code!==0){console.error(safe);process.exitCode=1;break;}
}
console.log(`Reports: ${directory}`);
