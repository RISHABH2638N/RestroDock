import { existsSync, readFileSync, writeFileSync } from 'node:fs';
for (const app of ['client','server']) {
  const target = new URL(`../${app}/.env`, import.meta.url);
  if (!existsSync(target)) writeFileSync(target,readFileSync(new URL(`../${app}/.env.example`, import.meta.url)),{mode:0o600,flag:'wx'});
  console.log(`${app}/.env ${existsSync(target) ? 'ready (existing values preserved)' : 'missing'}`);
}
