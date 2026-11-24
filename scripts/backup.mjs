import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {chmod, mkdir, rename, rm} from 'node:fs/promises';
import {resolve} from 'node:path';

const destination = process.argv[2];
if (!destination || !process.env.PGHOST || !process.env.PGDATABASE || !process.env.PGUSER) {
  console.error('Usage: node scripts/backup.mjs <private-directory> with PGHOST, PGDATABASE and PGUSER set.');
  process.exit(1);
}
const dir = resolve(destination);
const archive = resolve(dir, 'restrodock-' + new Date().toISOString().replaceAll(':', '-') + '-' + randomUUID() + '.dump');
const partial = archive + '.partial';
process.umask(0o077);
try {
  await mkdir(dir, {recursive:true,mode:0o700});
  await new Promise((resolveDump,reject) => {
    const child = spawn('pg_dump', ['--no-password','--format=custom','--file',partial], {stdio:'ignore'});
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveDump() : reject(new Error('pg_dump failed')));
  });
  await chmod(partial,0o600);
  await rename(partial,archive);
  console.log(JSON.stringify({event:'backup_completed',archive}));
} catch {
  await rm(partial,{force:true}).catch(()=>{});
  console.error(JSON.stringify({event:'backup_failed'}));
  process.exitCode=1;
}
