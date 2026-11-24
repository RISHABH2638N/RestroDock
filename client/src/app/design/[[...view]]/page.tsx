import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Design preview | RestroDock', 'Review internal RestroDock interface examples.');
import { notFound } from 'next/navigation';
import { Studio } from '../../../features/ux-preview/studio';
import { previewEnabled,resolveView } from '../../../features/ux-preview/model';
export const dynamic='force-dynamic';
export default async function DesignPage({params}:{params:Promise<{view?:string[]}>}) {
 if(!previewEnabled(process.env.NODE_ENV,process.env.ENABLE_UX_PREVIEW))notFound();
 const view=resolveView((await params).view);
 if(!view)notFound();
 return <Studio view={view}/>;
}
