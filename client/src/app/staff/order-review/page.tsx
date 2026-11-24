import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Staff order review | RestroDock', 'Verify first orders at the table and review flagged orders with the assigned role.');
import {OrderReviewPortal} from '../../../features/order-review/portal';
export default function Page(){return <OrderReviewPortal kind="staff"/>;}
