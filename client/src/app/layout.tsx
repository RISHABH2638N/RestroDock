import {siteOrigin} from '../lib/site-metadata';
import type { Metadata } from 'next';
import { Providers } from './providers';
import { Shell } from '../components/shell';
import '@fontsource-variable/figtree/wght.css';
import './globals.css';
import './access.css';
import './restaurant.css';
import './platform-analytics.css';
import './landing.css';
import './workspaces.css';
import './registration.css';
import './tables.css';
import './order-review.css';
import { previewEnabled } from '../features/ux-preview/model';
import './ux-preview.css';
export const metadata:Metadata={metadataBase:new URL(siteOrigin),title:'RestroDock | Built for service',description:'Your menu, your team and the service ahead. RestroDock restaurant operations.',robots:{index:false,follow:false}};
export default function RootLayout({children}:{children:React.ReactNode}) {
  return <html lang="en"><body><Providers><Shell uxPreviewEnabled={previewEnabled(process.env.NODE_ENV,process.env.ENABLE_UX_PREVIEW)}>{children}</Shell></Providers></body></html>;
}
