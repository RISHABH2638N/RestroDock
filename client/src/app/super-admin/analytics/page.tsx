import {pageMetadata} from '../../../lib/site-metadata';
export const metadata=pageMetadata('Platform analytics | RestroDock', 'Review restaurant and usage metrics for the platform.');
import {PlatformAnalytics} from '../../../features/access/platform-analytics';

export default function Page(){return <PlatformAnalytics/>;}
