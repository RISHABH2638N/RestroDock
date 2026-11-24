import type {MetadataRoute} from 'next';
import {indexingEnabled,siteOrigin} from '../lib/site-metadata';

export default function robots(): MetadataRoute.Robots {
  if (!indexingEnabled) return {rules:{userAgent:'*',disallow:'/'}};
  return {rules:{userAgent:'*',allow:'/',disallow:'/api/'},sitemap:siteOrigin+'/sitemap.xml'};
}
