import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Restaurant order review | RestroDock', 'Review orders and manage the restaurant’s ordering intake.');
import {OrderReviewPortal} from '../../../features/order-review/portal';
export default function Page(){return <OrderReviewPortal kind="restaurant"/>;}
