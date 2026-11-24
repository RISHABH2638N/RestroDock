import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Platform administration | RestroDock', 'Manage restaurant tenants and platform access.');
import {PlatformPortal} from '../../features/access/platform';
export default function Page(){return <PlatformPortal/>;}
