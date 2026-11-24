import 'dotenv/config';
import { createServer } from 'node:http';
import pino from 'pino';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import {checkDatabaseSchema} from './database/readiness.js';
import { createApp } from './app.js';
import { createRealtime } from './realtime.js';
import {purgeStaleAuthRecords} from './database/maintenance.js';
const config = loadConfig();
const logger = pino({redact:{paths:['password','token','pin','mobile','passwordHash','csrfToken','guestSecret','qrToken','DATABASE_URL','DIRECT_URL','BREVO_API_KEY','GUEST_PII_KEY','BOOTSTRAP_ADMIN_PASSWORD','*.password','*.token','*.passwordHash','*.mobile','*.pin','req.headers.cookie','req.headers.authorization','req.headers["x-csrf-token"]'],censor:'[redacted]'}});
// An unset NODE_ENV silently selects development behaviour (non-Secure cookies, development origins). Make that visible.
if(!process.env.NODE_ENV)logger.warn('NODE_ENV is not set; the API is running in development mode. Set NODE_ENV=production for deployments.');
const db = createDatabase(config.DATABASE_URL);
const server = createServer(createApp(config,async () => { if (!db) throw new Error('No database'); return checkDatabaseSchema(db); },db,(branch,announcement,tableId)=>notify(branch,announcement,tableId),logger));
const {io,notify}=createRealtime(server,config,db);
server.listen(config.PORT,config.HOST,() => logger.info({port:config.PORT,host:config.HOST,clientOrigin:config.CLIENT_ORIGIN,devClientOrigin:config.DEV_CLIENT_ORIGIN,databaseConfigured:!!db,demoEnabled:config.DEMO_MODE},'RestroDock API started'));
server.on('error',() => { logger.error('API could not listen; check HOST and PORT'); process.exitCode=1; });
let stopping=false;
async function stop() {
  if (stopping) return; stopping=true;
  const timeout=setTimeout(() => process.exit(1),10000); timeout.unref();
  await new Promise<void>(resolve => io.close(() => resolve()));
  await db?.$disconnect(); clearTimeout(timeout); logger.info('RestroDock API stopped');
}
process.on('SIGTERM',() => void stop()); process.on('SIGINT',() => void stop());
if(db){
 const purge=()=>void purgeStaleAuthRecords(db).then(removed=>{if(removed.sessions||removed.throttles)logger.info(removed,'Purged stale authentication records');},()=>logger.warn('Stale authentication record purge failed'));
 setTimeout(purge,60_000).unref();
 setInterval(purge,6*60*60*1000).unref();
}
