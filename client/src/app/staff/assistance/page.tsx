import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Guest assistance | RestroDock', 'Handle requests for help from guests at your branch.');
import {TablesPortal} from '../../../features/tables/board';
export default function Page(){return <TablesPortal kind="staff" view="assistance"/>;}
