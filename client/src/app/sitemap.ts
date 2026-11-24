import type {MetadataRoute} from 'next';
import {indexingEnabled,publicPaths,siteOrigin} from '../lib/site-metadata';

export default function sitemap(): MetadataRoute.Sitemap {
  return indexingEnabled ? publicPaths.map(path=>({url:siteOrigin+path})) : [];
}
