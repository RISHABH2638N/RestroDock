import type {Metadata} from 'next';

export const siteOrigin = 'https://restrodock.com';
export const publicPaths = ['/', '/register', '/privacy', '/terms'] as const;
export const indexingEnabled = process.env.RESTRODOCK_PUBLIC_INDEXING === 'true' &&
  process.env.NODE_ENV === 'production' &&
  (!process.env.VERCEL_ENV || process.env.VERCEL_ENV === 'production');

export function pageMetadata(title: string, description: string, path?: typeof publicPaths[number]): Metadata {
  const metadata: Metadata = {
    title,
    description,
    robots: path && indexingEnabled ? {index:true,follow:true} : {index:false,follow:false},
  };
  if (!path) return metadata;
  const image = {url:'/brand/restrodock-share.png', width:1200, height:630, alt:'RestroDock QR ordering and kitchen operations'};
  return {
    ...metadata,
    alternates:{canonical:path},
    openGraph:{type:'website',siteName:'RestroDock',url:path,title,description,images:[image]},
    twitter:{card:'summary_large_image',title,description,images:[image]},
  };
}
