import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import './setup.mjs';
if(Number(process.versions.node.split('.')[0])!==24)throw new Error('RestroDock requires Node.js 24. Install Node 24 LTS, then run npm ci again.');
const npm=process.env.npm_execpath;
if(!npm)throw new Error('Run npm ci from the project root.');
for(const args of [['run','db:generate'],['run','build','-w','@restrodock/contracts']]){
 const result=spawnSync(process.execPath,[npm,...args],{cwd:fileURLToPath(new URL('../',import.meta.url)),stdio:'inherit'});
 if(result.error||result.status!==0)process.exit(result.status??1);
}
