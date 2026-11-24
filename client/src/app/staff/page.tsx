import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Staff workspace | RestroDock', 'Find the workspaces available to your assigned branch role.');
import {StaffStart} from '../../features/access/staff-start';

export default function Page(){return <StaffStart/>;}
