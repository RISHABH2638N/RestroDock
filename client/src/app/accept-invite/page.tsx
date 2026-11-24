import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Accept invitation | RestroDock', 'Set up your RestroDock access with a private staff invitation.');
import {InvitationAcceptance} from '../../features/access/auth';
export default function Page(){return <InvitationAcceptance/>;}
