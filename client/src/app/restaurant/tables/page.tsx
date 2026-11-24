import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Restaurant tables and QRs | RestroDock', 'Set up restaurant tables, print QR cards and manage sessions.');
import {TablesPortal} from '../../../features/tables/board';
export default function Page(){return <TablesPortal kind="restaurant"/>;}
