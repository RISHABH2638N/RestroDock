import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Table ordering | RestroDock', 'Browse the restaurant menu and manage your table order.');
import './dining.css';
import {GuestEntry} from '../../features/tables/guest';
export default function Page(){return <GuestEntry/>;}
