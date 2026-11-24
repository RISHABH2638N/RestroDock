import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Kitchen tickets | RestroDock', 'See approved tickets and update preparation status.');
import {KitchenPortal} from '../../../features/kitchen/portal';
export default function Page(){return <KitchenPortal/>;}
