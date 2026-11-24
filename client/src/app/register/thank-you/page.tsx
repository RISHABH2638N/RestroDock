import {pageMetadata} from '../../../lib/site-metadata';
import {RegistrationThankYou} from '../../../features/registration/public';

export const metadata=pageMetadata('Registration confirmation | RestroDock','Review your submission and access your private restaurant application tracking link.');
export default function Page(){return <RegistrationThankYou/>;}
