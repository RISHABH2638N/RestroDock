import type {TableBoard} from '@restrodock/contracts';

type Table=TableBoard['items'][number];
export const serviceOrders=(table:Table)=>(table.session?.orders??[]).filter(order=>!['REJECTED','CANCELLED'].includes(order.status));
export function tableStatus(table:Table){
 if(table.archived)return 'Archived';
 if(!table.session)return 'Available';
 const orders=serviceOrders(table);
 if(table.session.singleGuest&&orders.length&&orders.every(order=>order.status==='SERVED'))return 'Ready for payment';
 if(orders.some(order=>order.status==='READY'))return 'Ready to serve';
 if(orders.some(order=>order.status==='AWAITING_REVIEW'))return 'Needs review';
 if(orders.some(order=>['PLACED','ACCEPTED','PREPARING'].includes(order.status)))return 'In kitchen';
 return table.session.billRequestedAt?'Bill requested':'Occupied';
}
