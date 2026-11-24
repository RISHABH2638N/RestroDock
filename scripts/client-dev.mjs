import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const raw=process.argv.slice(2),args=[];
for(let i=0;i<raw.length;i++){
 if(raw[i]==='--strictPort')continue;
 args.push(raw[i]==='--host'?'--hostname':raw[i]);
}
const child=spawn(process.execPath,[fileURLToPath(new URL('../node_modules/next/dist/bin/next',import.meta.url)),'dev','--webpack',...args],{cwd:fileURLToPath(new URL('../client',import.meta.url)),stdio:'inherit'});
child.on('error',()=>{console.error('Next.js could not start. Run npm ci from the project root.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
