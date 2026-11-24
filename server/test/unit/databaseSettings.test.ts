import {test} from 'node:test';
import assert from 'node:assert/strict';
import {databaseSettings,redactDatabaseSecrets,validateDatabaseUrl} from '../../src/database/settings.js';
const pooled='postgresql://runtime:placeholder@ep-sample-pooler.region.aws.neon.tech/dev?sslmode=verify-full';
const direct='postgresql://owner:placeholder@ep-sample.region.aws.neon.tech/dev?sslmode=verify-full';
test('database settings allow blank development bootstrap without claiming connectivity',()=>{assert.equal(databaseSettings({}).runtime,'');});
test('database operations require explicit direct URL',()=>{assert.throws(()=>databaseSettings({DATABASE_URL:pooled},true),/DIRECT_URL is required/);});
test('Neon pooled migration URL rejected',()=>{assert.throws(()=>databaseSettings({DIRECT_URL:pooled},true),/non-pooler/);});
test('database environment pairs must use matching Neon endpoint/database',()=>{assert.equal(databaseSettings({DATABASE_URL:pooled,DIRECT_URL:direct},true).direct,direct);assert.throws(()=>databaseSettings({DATABASE_URL:pooled,DIRECT_URL:direct.replace('/dev?','/other?')}),/same Neon/);});
test('runtime/migration usernames may differ for least-privilege deployment',()=>{assert.doesNotThrow(()=>databaseSettings({DATABASE_URL:pooled,DIRECT_URL:direct}));});
test('production remote database requires explicit hostname-verified TLS',()=>{assert.throws(()=>databaseSettings({NODE_ENV:'production',DATABASE_URL:pooled.replace('verify-full','require')}),/verify-full/);assert.doesNotThrow(()=>databaseSettings({NODE_ENV:'production',DATABASE_URL:pooled,DIRECT_URL:direct}));});
test('invalid URL messages never include supplied credentials',()=>{for(const value of ['mongodb://sample:fake-password@host/db','postgresql://sample:fake-password@/db','postgresql://host'])assert.throws(()=>validateDatabaseUrl(value,'DATABASE_URL','test'),error=>error instanceof Error&&!error.message.includes('fake-password'));});
test('unverified certificates and remote plaintext refused; isolated loopback tests permitted',()=>{assert.throws(()=>validateDatabaseUrl(direct.replace('verify-full','no-verify'),'DIRECT_URL','development'));assert.throws(()=>validateDatabaseUrl(direct.replace('verify-full','disable'),'DIRECT_URL','development'));assert.doesNotThrow(()=>validateDatabaseUrl('postgresql://postgres:test@127.0.0.1:5678/test?sslmode=disable','DIRECT_URL','test'));});
test('Neon dashboard alias gets actionable canonical-name guidance',()=>{assert.throws(()=>databaseSettings({DATABASE_URL_POOLED:pooled}),/DATABASE_URL, not DATABASE_URL_POOLED/);});
test('CLI redaction covers full URL, encoded/decoded passwords and unrelated PostgreSQL URI',()=>{const url='postgresql://user:demo%40password@host/db';const text=`${url} demo%40password demo@password postgresql://other:other-secret@host/other`;const safe=redactDatabaseSecrets(text,{DIRECT_URL:url});assert.ok(!safe.includes('demo'));assert.ok(!safe.includes('other-secret'));assert.ok(safe.includes('[redacted'));});

test('unsupported schema namespace fails before connecting',()=>{assert.throws(()=>validateDatabaseUrl(direct+'&schema=other','DIRECT_URL','test'),/public PostgreSQL schema/);});

test('database configuration rejects ambiguous SSL modes',()=>{
 assert.throws(()=>databaseSettings({NODE_ENV:'production',DATABASE_URL:pooled+'&sslmode=disable'}),/conflicting TLS/);
});
test('database diagnostics redact email and guest encryption credentials',()=>{
 const env={BREVO_API_KEY:'synthetic-mail-credential',GUEST_PII_KEY:'synthetic-guest-credential'};
 assert.equal(redactDatabaseSecrets(Object.values(env).join(' '),env),'[redacted] [redacted]');
});
