import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Reset password | RestroDock', 'Choose a new password using your private RestroDock reset link.');
import {PasswordRecovery} from '../../features/access/password-recovery';

export default function Page(){return <PasswordRecovery/>;}
