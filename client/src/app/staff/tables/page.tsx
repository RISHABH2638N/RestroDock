import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Staff table management | RestroDock', 'Manage guest sessions and service at your assigned tables.');
import {TablesPortal} from '../../../features/tables/board';
export default function Page(){return <TablesPortal kind="staff"/>;}
