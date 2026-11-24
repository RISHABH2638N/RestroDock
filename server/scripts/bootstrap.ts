import 'dotenv/config';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {createDatabase} from '../src/db.js';
import {databaseSettings,DatabaseConfigurationError} from '../src/database/settings.js';
import {bootstrapAdmin} from '../src/modules/auth/bootstrap.js';
import {bootstrapFailureMessage} from '../src/modules/auth/bootstrap-errors.js';
export async function runBootstrap(env:NodeJS.ProcessEnv=process.env):Promise<number> {
 let db:ReturnType<typeof createDatabase>=null;
 let exitCode=0;
 try{
  const settings=databaseSettings(env);
  if(!settings.runtime)throw new DatabaseConfigurationError('DATABASE_URL is required for first-admin provisioning.');
  // Hosted cold starts get a bounded, longer connection budget; normal API connections are unchanged.
  db=createDatabase(settings.runtime,{connectionTimeoutMillis:10000})!;
  const result=await bootstrapAdmin(db,env);
  console.log(`First administrator: ${result}`);
  if(result==='not_configured')console.log('Configure BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD in server/.env, then restart to create the first administrator.');
 }catch(error){console.error(bootstrapFailureMessage(error));exitCode=1;}
 finally{
  try{await db?.$disconnect();}catch{if(exitCode===0){console.error('First-admin connection cleanup failed [DATABASE_DISCONNECT]. Check connectivity before continuing.');exitCode=1;}}
 }
 return exitCode;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)process.exitCode=await runBootstrap();
