import { z } from 'zod';
import {databaseSettings} from './database/settings.js';
const schema = z.object({
  NODE_ENV:z.enum(['development','test','production']).default('development'),
  HOST:z.string().default('127.0.0.1'), PORT:z.coerce.number().int().min(1).max(65535).default(4000),
  CLIENT_ORIGIN:z.url().default('http://localhost:3000'),
  DEV_CLIENT_ORIGIN:z.string().optional(),
  DEMO_MODE:z.enum(['true','false']).default('false').transform(v => v === 'true'),
  CHECKOUT_PILOT_ENABLED:z.enum(['true','false']).default('false').transform(value=>value==='true'),
  GUEST_PII_KEY:z.string().regex(/^([a-f0-9]{64})?$/i).default(''),
  BREVO_API_KEY:z.string().trim().default(''),
  BREVO_SENDER_EMAIL:z.union([z.email(),z.literal('')]).default(''),
  DATABASE_URL:z.string().default(''),
  // Number of trusted reverse-proxy hops in front of this API (0 = none). Only raise this when an ingress you control
  // appends the real client address to X-Forwarded-For; otherwise clients could spoof their rate-limit identity.
  TRUST_PROXY_HOPS:z.coerce.number().int().min(0).max(3).default(0)
});
export function loadConfig(env:NodeJS.ProcessEnv = process.env) {
  const parsed=schema.safeParse(env);
  if(!parsed.success){
    const fields=parsed.error.issues.map(issue=>issue.path.join('.'));
    throw new Error('Invalid server configuration fields: '+[...new Set(fields)].join(', '));
  }
  const config=parsed.data;
  if(config.NODE_ENV==='production' && (env.DEBUG?.trim() || env.NODE_DEBUG?.trim() || /(?:^|\s)--inspect(?:-brk|-wait)?(?:=|\s|$)/.test([env.NODE_OPTIONS,...process.execArgv].join(' ')))){
    throw new Error('Disable debug logging and Node inspector flags before starting production.');
  }
  if(!['http:','https:'].includes(new URL(config.CLIENT_ORIGIN).protocol))throw new Error('CLIENT_ORIGIN must use HTTP(S)');
  if(config.NODE_ENV==='production'&&env.NODE_TLS_REJECT_UNAUTHORIZED==='0')throw new Error('Production requires TLS certificate verification');
  const origin = new URL(config.CLIENT_ORIGIN);
  if (origin.origin !== config.CLIENT_ORIGIN) throw new Error('CLIENT_ORIGIN must be an origin without path/trailing slash');
  if(config.DEV_CLIENT_ORIGIN){
    if(config.NODE_ENV!=='development')throw new Error('DEV_CLIENT_ORIGIN is only allowed in development');
    const extra=new URL(config.DEV_CLIENT_ORIGIN);
    if(!['http:','https:'].includes(extra.protocol)||extra.origin!==config.DEV_CLIENT_ORIGIN)throw new Error('DEV_CLIENT_ORIGIN must be an HTTP(S) origin without a trailing slash');
  }
  if (config.NODE_ENV === 'production' && config.CHECKOUT_PILOT_ENABLED) throw new Error('Checkout pilot is forbidden in production');
  if (config.NODE_ENV === 'production' && config.DEMO_MODE) throw new Error('DEMO_MODE is forbidden in production');
  if (config.NODE_ENV === 'production' && (!config.DATABASE_URL || origin.protocol !== 'https:')) throw new Error('Production requires DATABASE_URL and HTTPS CLIENT_ORIGIN');
  if (Boolean(config.BREVO_API_KEY)!==Boolean(config.BREVO_SENDER_EMAIL)) throw new Error('Configure both Brevo password recovery settings');
  databaseSettings(env);
  return config;
}
export type Config = ReturnType<typeof loadConfig>;

export function allowsClientOrigin(config:Config,origin:string|undefined){
  return origin===config.CLIENT_ORIGIN||(config.NODE_ENV==='development'&&!!origin&&origin===config.DEV_CLIENT_ORIGIN);
}
