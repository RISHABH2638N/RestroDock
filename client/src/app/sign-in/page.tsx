import {pageMetadata} from '../../lib/site-metadata';
export const metadata=pageMetadata('Sign in | RestroDock', 'Choose the RestroDock sign-in portal for owners, staff or platform administrators.');
import {SignIn} from '../../features/access/auth';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}){const query=await searchParams;const portal=query.portal==='platform'?'platform':query.portal==='restaurant'?'restaurant':'staff';return <SignIn key={portal} portal={portal}/>;}
