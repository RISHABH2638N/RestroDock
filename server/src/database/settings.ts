export type Environment = 'development'|'test'|'production';
export class DatabaseConfigurationError extends Error {}
const localHosts=new Set(['localhost','127.0.0.1','[::1]']);
export function validateDatabaseUrl(value:string,field:'DATABASE_URL'|'DIRECT_URL',environment:Environment):string {
 if(!value)return '';
 let parsed:URL;
 try{parsed=new URL(value);}catch{throw new DatabaseConfigurationError(`${field} must be a valid PostgreSQL connection URL.`);}
 if(!['postgresql:','postgres:'].includes(parsed.protocol)||!parsed.hostname||parsed.pathname.length<2||parsed.hash)throw new DatabaseConfigurationError(`${field} must include a PostgreSQL host and database name, without a fragment.`);
 if(parsed.searchParams.getAll('sslmode').length>1)throw new DatabaseConfigurationError(`${field} contains conflicting TLS settings.`);
 if(parsed.searchParams.has('schema')&&parsed.searchParams.get('schema')!=='public')throw new DatabaseConfigurationError('RestroDock uses the public PostgreSQL schema. Use a dedicated Neon branch/database for isolation.');
 if(field==='DIRECT_URL'&&parsed.hostname.includes('-pooler.'))throw new DatabaseConfigurationError('DIRECT_URL must use the non-pooler endpoint. Copy it with Neon Connection pooling disabled.');
 if(parsed.searchParams.get('sslmode')==='no-verify')throw new DatabaseConfigurationError('Certificate verification must not be disabled. Use sslmode=verify-full for Neon.');
 if(environment==='production'&&!localHosts.has(parsed.hostname)&&parsed.searchParams.get('sslmode')!=='verify-full')throw new DatabaseConfigurationError(`${field} requires sslmode=verify-full in production.`);
 if(!localHosts.has(parsed.hostname)&&parsed.searchParams.get('sslmode')==='disable')throw new DatabaseConfigurationError('Unencrypted remote database connections are not allowed.');
 return value;
}
export function databaseSettings(env:NodeJS.ProcessEnv,requireDirect=false) {
 const mode=env.NODE_ENV??'development';
 if(!['development','test','production'].includes(mode))throw new DatabaseConfigurationError('NODE_ENV must be development, test or production.');
 const environment=mode as Environment;
 const runtime=validateDatabaseUrl(env.DATABASE_URL??'','DATABASE_URL',environment);
 const direct=validateDatabaseUrl(env.DIRECT_URL??'','DIRECT_URL',environment);
 if(requireDirect&&!direct)throw new DatabaseConfigurationError('DIRECT_URL is required. Put the direct non-pooler URL in server/.env; use DATABASE_URL for the pooled URL.');
 if(!runtime&&env.DATABASE_URL_POOLED)throw new DatabaseConfigurationError('RestroDock uses DATABASE_URL, not DATABASE_URL_POOLED. Copy the pooled URL into DATABASE_URL.');
 if(runtime&&direct){
  const a=new URL(runtime),b=new URL(direct);
  if(a.hostname.endsWith('.neon.tech')&&b.hostname.endsWith('.neon.tech')&&(a.hostname.replace('-pooler.','.')!==b.hostname||a.pathname!==b.pathname))throw new DatabaseConfigurationError('DATABASE_URL and DIRECT_URL must target the same Neon endpoint and database.');
 }
 return {runtime,direct,environment};
}
/** Redact before forwarding driver/CLI diagnostics. Never print connection URLs or passwords. */
export function redactDatabaseSecrets(text:string,env:NodeJS.ProcessEnv):string {
 let safe=text;
 for(const key of ['DATABASE_URL','DIRECT_URL','DATABASE_URL_POOLED','DATABASE_URL_UNPOOLED','NEON_REALTIME_SECRET','PGPASSWORD','BOOTSTRAP_ADMIN_PASSWORD','BREVO_API_KEY','GUEST_PII_KEY']){
  const value=env[key];if(!value)continue;
  safe=safe.split(value).join('[redacted]');
  try{const password=new URL(value).password;if(password){safe=safe.split(password).join('[redacted]');safe=safe.split(decodeURIComponent(password)).join('[redacted]');}}catch{/* Non-URL secret already redacted. */}
 }
 return safe.replace(/postgres(?:ql)?:\/\/[^\s'"<>]+/gi,'[redacted-database-url]');
}
