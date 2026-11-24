import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {ensureDevelopmentPrivacyKey} from './development-privacy.mjs';
import {parse} from 'dotenv';
import './setup.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run npm run dev using npm.');
// Match dotenv precedence: process environment wins over server/.env.
const env={...parse(readFileSync(new URL('../server/.env',import.meta.url))),...process.env};
if((env.NODE_ENV??'development')!=='development')throw new Error('npm run dev only supports NODE_ENV=development. Use explicit production migration/start commands for deployment.');
env.GUEST_PII_KEY=ensureDevelopmentPrivacyKey(new URL('../server/.env',import.meta.url),process.env);
function run(args,cwd=root){const result=spawnSync(process.execPath,args,{cwd,env,stdio:'inherit'});if(result.error||result.status!==0)process.exit(result.status??1);}
run([npm,'run','build','-w','@restrodock/contracts']);
run([npm,'run','db:generate']);
if(env.DATABASE_URL||env.DIRECT_URL||env.DATABASE_URL_POOLED){
 run([npm,'run','db:deploy']);
 run(['--import','tsx','scripts/bootstrap.ts'],fileURLToPath(new URL('../server',import.meta.url)));
}else console.log('Database is blank: starting the development shell. Configure server/.env and restart to enable sign-in.');
