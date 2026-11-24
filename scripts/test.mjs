import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const folder = new URL(process.argv[2] === 'db' ? '../server/test/db/' : process.argv[2] === 'integration' ? '../server/test/integration/' : '../server/test/unit/', import.meta.url);
const files = (await readdir(folder)).filter(f => f.endsWith('.test.ts')).sort().map(f => fileURLToPath(new URL(f, folder)));
const result = spawnSync(process.execPath, ['--import','tsx','--test',`--test-concurrency=${process.argv[2]==='integration'?1:2}`,...files], { stdio: 'inherit', env: { ...process.env, NODE_ENV:'test' } });
process.exit(result.status ?? 1);
