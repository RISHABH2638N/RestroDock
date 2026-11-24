import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
const folder=new URL('../client/test/',import.meta.url);
const files=(await readdir(folder)).filter(f=>/\.test\.tsx?$/.test(f)).sort().map(f=>fileURLToPath(new URL(f,folder)));
const result=spawnSync(process.execPath,['--import','tsx','--test','--test-concurrency=2',...files],{stdio:'inherit',env:{...process.env,NODE_ENV:'test',TSX_TSCONFIG_PATH:fileURLToPath(new URL('../client/tsconfig.json',import.meta.url))}});
process.exit(result.status??1);
