import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Billing queue | RestroDock', 'Review bill requests and close settled table sessions.');
import {TablesPortal} from '../../../features/tables/board';
export default function Page(){return <TablesPortal kind="staff" view="billing"/>;}
