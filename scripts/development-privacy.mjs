import {readFileSync,appendFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {parse} from 'dotenv';
// Development only: a blank inherited override means unset. Never replace an existing file key.
export function ensureDevelopmentPrivacyKey(path,environment=process.env){
 const saved=parse(readFileSync(path));const current=environment.GUEST_PII_KEY||saved.GUEST_PII_KEY;
 if(current){if(!/^[a-f0-9]{64}$/i.test(current))throw new Error('GUEST_PII_KEY must contain exactly 64 hexadecimal characters. Existing values were preserved.');return current;}
 const key=randomBytes(32).toString('hex');appendFileSync(path,'\n# Generated development guest privacy key; preserve across restarts.\nGUEST_PII_KEY='+key+'\n');return key;
}
