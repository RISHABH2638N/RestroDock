import {pageMetadata} from '../../../lib/site-metadata';
import {notFound} from 'next/navigation';
import {TenantPortal} from '../../../features/access/tenant';
import {restaurantSections} from '../../../features/restaurant/sections';

const sections = restaurantSections.filter(section => section.key !== 'tables' && section.key !== 'order-review');
export async function generateMetadata({params}:{params:Promise<{section:string}>}) {
  const {section:slug}=await params;
  const section=sections.find(entry=>entry.key===slug);
  if (!section) notFound();
  return pageMetadata(section.label+' | Restaurant Admin | RestroDock', section.description);
}

export const dynamicParams = false;

export function generateStaticParams(){
  return sections.map(section => ({section:section.key}));
}

export default async function Page({params}:{params:Promise<{section:string}>}){
  const {section:slug} = await params;
  const section = sections.find(entry => entry.key === slug);
  if(!section)notFound();
  return <TenantPortal kind="restaurant" section={section.key}/>;
}
