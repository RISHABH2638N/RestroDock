import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Restaurant overview | RestroDock', 'View the operational summary for your assigned restaurant.');
import {RestaurantOverview} from '../../features/restaurant/overview';
export default function Page(){return <RestaurantOverview/>;}
