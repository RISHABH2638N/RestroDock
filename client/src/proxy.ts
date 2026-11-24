import {NextResponse,type NextRequest} from 'next/server';

// Deny development diagnostics before any streamed layout can commit a 200 response.
// This is a production route boundary, not staff authentication or an API proxy.
export function proxy(_request:NextRequest){
 if(process.env.NODE_ENV==='production')return new NextResponse('Not found',{status:404,headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
 return NextResponse.next();
}
export const config={matcher:['/workspace/:path*']};
