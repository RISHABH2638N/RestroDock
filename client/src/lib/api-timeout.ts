// Management writes may need to wait for a database transaction and reload the saved state.
const managementWrite = /^\/api\/v1\/(?:restaurant\/(?:tables|manage|order-review)|staff\/(?:tables|order-review))(?:\/|$)/;

export function isManagementWrite(method:string,path:string){
 return ['POST','PUT','PATCH','DELETE'].includes(method) && managementWrite.test(path.split('?')[0] ?? '');
}

export const managementProxyTimeoutMs=60_000;
export const managementClientTimeoutMs=70_000;
