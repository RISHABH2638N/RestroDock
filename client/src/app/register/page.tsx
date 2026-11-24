import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Register your restaurant | RestroDock', 'Apply for a RestroDock restaurant workspace and track your setup request.', '/register');
import {RegistrationFlow} from '../../features/registration/public';
export default function Page(){return <RegistrationFlow/>;}
