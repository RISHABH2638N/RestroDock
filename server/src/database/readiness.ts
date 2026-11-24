import {readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Database} from '../db.js';
export interface MigrationEntry {name:string;checksum:string}
export async function migrationManifest():Promise<readonly MigrationEntry[]> {
 const root=new URL('../../prisma/migrations/',import.meta.url);
 const folders=(await readdir(root,{withFileTypes:true})).filter(e=>e.isDirectory()).map(e=>e.name).sort();
 return Promise.all(folders.map(async name=>({name,checksum:createHash('sha256').update(await readFile(new URL(`${name}/migration.sql`,root))).digest('hex')})));
}
let manifest:Promise<readonly MigrationEntry[]>|undefined;
export async function checkDatabaseSchema(db:Database):Promise<'current'|'pending'> {
 await db.$queryRaw`SELECT 1`;
 const [table]=await db.$queryRaw<{present:boolean}[]>`SELECT to_regclass('public._prisma_migrations') IS NOT NULL AS present`;
 if(!table?.present)return 'pending';
 const rows=await db.$queryRaw<{migration_name:string;checksum:string;finished_at:Date|null;rolled_back_at:Date|null}[]>`SELECT migration_name, checksum, finished_at, rolled_back_at FROM public._prisma_migrations`;
 const expected=await (manifest??=migrationManifest());
 const applied=rows.filter(r=>r.finished_at&&!r.rolled_back_at);
 if(rows.some(r=>!r.finished_at&&!r.rolled_back_at)||applied.length!==expected.length)return 'pending';
 return expected.every(m=>applied.some(a=>a.migration_name===m.name&&a.checksum===m.checksum))?'current':'pending';
}
