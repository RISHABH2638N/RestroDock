import {indexingEnabled,publicPaths} from './src/lib/site-metadata';
import type { NextConfig } from 'next';
const production=process.env.NODE_ENV==='production';
// Next embeds referenced NEXT_PUBLIC_* values in browser assets.
for (const [name, value] of Object.entries(process.env)) {
  if (value && name.startsWith('NEXT_PUBLIC_') && /SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL|DIRECT_URL|ACCESS_TOKEN|PII_KEY/i.test(name)) {
    throw new Error(`Remove server credential ${name} from the public environment.`);
  }
}
const contentSecurityPolicy=[
 "default-src 'self'",
 "script-src 'self' 'unsafe-inline'",
 "script-src-attr 'none'",
 "style-src 'self' 'unsafe-inline'",
 "img-src 'self' data: blob:",
 "connect-src 'self'",
 "object-src 'none'",
 "frame-ancestors 'none'",
 "base-uri 'none'",
 "form-action 'self'",
].join('; ');
const nextConfig:NextConfig={ poweredByHeader:false, reactStrictMode:true, devIndicators:false,
  // Only the managed development preview uses this hostname. No wildcard or API-Origin change.
  allowedDevOrigins: process.env.NODE_ENV==='development'?['terminal.local']:[],
  async rewrites(){
    if(process.env.NODE_ENV!=='development')return [];
    const api=URL.parse(process.env.API_PROXY_URL||'http://127.0.0.1:4000');
    if(!api||!['http:','https:'].includes(api.protocol)||api.username||api.password||api.pathname!=='/'||api.search||api.hash)return [];
    return [{source:'/restrodock-live',destination:api.origin+'/socket.io/'}];
  },
  async headers() { return [{source:'/:path*',headers:[{key:'X-Content-Type-Options',value:'nosniff'},{key:'Referrer-Policy',value:'no-referrer'},{key:'X-Frame-Options',value:'DENY'},{key:'Cross-Origin-Opener-Policy',value:'same-origin'},{key:'Cross-Origin-Resource-Policy',value:'same-origin'},{key:'X-Permitted-Cross-Domain-Policies',value:'none'},{key:'X-DNS-Prefetch-Control',value:'off'},{key:'X-Robots-Tag',value:'noindex, nofollow'},
    {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=(), payment=()'},
    ...(production?[
      {key:'Content-Security-Policy',value:contentSecurityPolicy},
      {key:'Strict-Transport-Security',value:'max-age=31536000'},
    ]:[])]}, ...(indexingEnabled ? publicPaths.map(source=>({source,headers:[{key:'X-Robots-Tag',value:'index, follow'}]})) : [])]; }
};
export default nextConfig;
