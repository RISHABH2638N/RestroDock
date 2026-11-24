import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Development workspace | RestroDock', 'Inspect the local RestroDock development workspace.');
import {notFound} from 'next/navigation';
import DevelopmentWorkspace from '../../features/access/development-workspace';
export const dynamic='force-dynamic';
export default function Page(){if(process.env.NODE_ENV==='production')notFound();return <DevelopmentWorkspace/>;}
