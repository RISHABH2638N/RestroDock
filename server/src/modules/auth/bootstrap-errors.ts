import {DatabaseConfigurationError} from '../../database/settings.js';
export const bootstrapMessages={
 BOOTSTRAP_EMAIL_REQUIRED:'Set BOOTSTRAP_ADMIN_EMAIL in server/.env as well as BOOTSTRAP_ADMIN_PASSWORD.',
 BOOTSTRAP_EMAIL_INVALID:'BOOTSTRAP_ADMIN_EMAIL must be a valid email address (at most 254 characters).',
 BOOTSTRAP_PASSWORD_REQUIRED:'Set BOOTSTRAP_ADMIN_PASSWORD in server/.env as well as BOOTSTRAP_ADMIN_EMAIL.',
 BOOTSTRAP_PASSWORD_LENGTH:'BOOTSTRAP_ADMIN_PASSWORD must contain 15–128 characters. Quote the whole value in .env, especially when it contains #.',
 BOOTSTRAP_PLATFORM_EXISTS:'A platform administrator already exists without a bootstrap marker. Provisioning was refused; use its existing sign-in or an audited recovery process.',
 BOOTSTRAP_ACCOUNT_EXISTS:'That bootstrap email already belongs to a user. No account was changed. For a fresh platform use a separate private operator email.',
} as const;
export type BootstrapErrorCode=keyof typeof bootstrapMessages;
export class BootstrapError extends Error {
 constructor(public readonly code:BootstrapErrorCode){super(bootstrapMessages[code]);}
}
/** Only fixed messages and allowlisted codes may reach terminal output; never stringify a driver error. */
export function bootstrapFailureMessage(error:unknown):string {
 const prefix='First-admin setup failed';
 if(error instanceof BootstrapError)return `${prefix} [${error.code}]: ${bootstrapMessages[error.code]}`;
 if(error instanceof DatabaseConfigurationError)return `${prefix} [DATABASE_CONFIGURATION]: ${error.message}`;
 const codes=new Set<string>();
 function collect(value:unknown,depth=0){
  if(!value||typeof value!=='object'||depth>5)return;
  const record=value as Record<string,unknown>;
  for(const key of ['code','sqlState','originalCode'])if(typeof record[key]==='string')codes.add(record[key] as string);
  for(const key of ['cause','meta','driverAdapterError','originalCause'])collect(record[key],depth+1);
 }
 collect(error);
 if(codes.has('28P01')||codes.has('P1000'))return `${prefix} [DATABASE_AUTHENTICATION]: DATABASE_URL could not authenticate. Check its current database username/password; migration success through DIRECT_URL does not verify DATABASE_URL.`;
 if(codes.has('42501')||codes.has('P1010'))return `${prefix} [DATABASE_PERMISSION]: The DATABASE_URL role lacks required database/table permissions. Check the application role grants; no privileges were automatically changed.`;
 if(codes.has('P2021')||codes.has('P2022')||codes.has('42P01')||codes.has('42703'))return `${prefix} [DATABASE_SCHEMA]: The application connection is missing required tables/columns. Confirm DATABASE_URL and DIRECT_URL use the same database and that all three migrations are applied.`;
 if(codes.has('P2028'))return `${prefix} [BOOTSTRAP_TRANSACTION]: The provisioning transaction failed or exceeded its time budget. Check database latency/connectivity, then retry npm run dev. No password reset is performed.`;
 if(['CERT_HAS_EXPIRED','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN','UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].some(code=>codes.has(code)))return `${prefix} [DATABASE_TLS]: Database certificate verification failed. Check the endpoint, system clock, CA/proxy configuration and sslmode=verify-full. Do not disable certificate verification.`;
 if(['P1001','P1002','P1017','P2024','ECONNREFUSED','ECONNRESET','ETIMEDOUT','ENOTFOUND','EAI_AGAIN'].some(code=>codes.has(code)))return `${prefix} [DATABASE_CONNECTION]: DATABASE_URL could not establish/retain its connection. Check the runtime endpoint, network and Neon availability; DIRECT_URL migration success alone is insufficient.`;
 if(codes.has('ERR_CRYPTO_INVALID_SCRYPT_PARAMS')||codes.has('ERR_MEMORY_ALLOCATION_FAILED'))return `${prefix} [PASSWORD_HASHING]: Password hashing could not allocate its required resources. Use Node.js 24 and sufficient free memory; do not weaken the password hashing parameters.`;
 if(codes.has('P2002'))return `${prefix} [BOOTSTRAP_CONFLICT]: A provisioning record conflicted with an existing account. No existing account was reset. Retry once; inspect administrator ownership if it persists.`;
 return `${prefix} [BOOTSTRAP_UNKNOWN]: The failure could not be classified safely. Share this code and the preceding non-secret log lines; never share .env contents or credentials. Raw driver details remain suppressed.`;
}
