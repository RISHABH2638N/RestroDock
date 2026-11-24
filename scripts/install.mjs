
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import './setup.mjs';

if (Number(process.versions.node.split('.')[0]) !== 24) {
  throw new Error(
    'RestroDock requires Node.js 24. Install Node 24 LTS, then run npm ci again.'
  );
}

const npm = process.env.npm_execpath;

if (!npm) {
  throw new Error('Run npm ci from the project root.');
}

const isVercel = process.env.VERCEL === '1';

if (isVercel) {
  console.log(
    'Vercel deployment detected: skipping backend Prisma generation.'
  );
} else {
  const result = spawnSync(
    process.execPath,
    [npm, 'run', 'db:generate'],
    {
      cwd: fileURLToPath(new URL('../', import.meta.url)),
      stdio: 'inherit'
    }
  );

  if (result.error || result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

// Shared contracts are required by the frontend.
const contractsResult = spawnSync(
  process.execPath,
  [npm, 'run', 'build', '-w', '@restrodock/contracts'],
  {
    cwd: fileURLToPath(new URL('../', import.meta.url)),
    stdio: 'inherit'
  }
);

if (contractsResult.error || contractsResult.status !== 0) {
  process.exit(contractsResult.status ?? 1);
}
