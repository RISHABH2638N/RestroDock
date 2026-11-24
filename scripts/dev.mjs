import {ensureDevelopmentPrivacyKey} from './development-privacy.mjs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const serverEnvironment={...process.env,GUEST_PII_KEY:ensureDevelopmentPrivacyKey(new URL('../server/.env',import.meta.url),process.env)};
const server=spawn(process.execPath,['--import','tsx','--watch','src/index.ts'],{cwd:fileURLToPath(new URL('../server',import.meta.url)),stdio:'inherit',env:serverEnvironment});
const client=spawn(process.execPath,[fileURLToPath(new URL('./client-dev.mjs',import.meta.url)),...process.argv.slice(2)],{stdio:'inherit'});
let stopping=false;
function stop(signal='SIGTERM'){if(stopping)return;stopping=true;server.kill(signal);client.kill(signal);}
for(const child of [server,client]){child.on('error',()=>{process.exitCode=1;stop();});child.on('exit',code=>{if(!stopping){process.exitCode=code??1;stop();}});}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>stop(signal));
