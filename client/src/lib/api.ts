import { healthSchema, readinessSchema, demoWorkspaceSchema } from '@restrodock/contracts';
const base = (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/$/,'');
async function read(path:string, allowUnavailable=false):Promise<unknown> {
  const response=await fetch(`${base}${path}`,{cache:'no-store',signal:AbortSignal.timeout(6000),credentials:'omit'});
  if (!response.ok && !(allowUnavailable && response.status === 503)) throw new Error('The API could not complete this request. Check that the server is running.');
  return response.json();
}
export const getHealth = async () => healthSchema.parse(await read('/api/health'));
export const getReadiness = async () => readinessSchema.parse(await read('/api/ready',true));
export const getDemo = async () => demoWorkspaceSchema.parse(await read('/api/v1/demo/workspace'));
