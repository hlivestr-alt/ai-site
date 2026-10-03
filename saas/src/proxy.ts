import {NextResponse,type NextRequest} from "next/server";
export function proxy(request:NextRequest){
  const requestId=/^[a-f0-9-]{36}$/i.test(request.headers.get('x-request-id')||'')?request.headers.get('x-request-id')!:crypto.randomUUID();
  const nonce=Buffer.from(crypto.randomUUID()).toString('base64'),headers=new Headers(request.headers);headers.set('x-request-id',requestId);headers.set('x-nonce',nonce);
  const origins=new Set<string>();for(const raw of [process.env.OBJECT_STORAGE_ENDPOINT,process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT,process.env.OBJECT_STORAGE_PUBLIC_ORIGIN]){try{if(raw)origins.add(new URL(raw).origin);}catch{}}
  const trusted=[...origins].join(' '),production=process.env.APP_ENV==='production';
  const csp=`default-src 'self'; script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${production?'':" 'unsafe-eval'"}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${trusted}; media-src 'self' blob: ${trusted}; connect-src 'self' ${trusted}${production?'':" ws: wss:"}; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'${production?'; upgrade-insecure-requests':''}`;
  headers.set('Content-Security-Policy',csp);const response=NextResponse.next({request:{headers}});response.headers.set('x-request-id',requestId);response.headers.set('Content-Security-Policy',csp);
  response.headers.set('X-Frame-Options','DENY');response.headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
  if(production&&process.env.APP_BASE_URL?.startsWith('https:'))response.headers.set('Strict-Transport-Security','max-age=31536000');
  return response;
}
export const config={matcher:['/((?!_next/static|_next/image|favicon.ico).*)']};
