import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Application status | RestroDock', 'Check a restaurant registration using your private tracking link.');
import {RegistrationTracking} from '../../../features/registration/public';
export default function Page(){return <RegistrationTracking/>;}
