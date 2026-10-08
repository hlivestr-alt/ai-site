import {NextResponse} from 'next/server';
import {bindNativeBrowser} from '@/lib/outreach-oauth-router';
import {ROUTER_COOKIE} from '@/lib/outreach-oauth-core';
import {providerFixtureEnabled} from '@/lib/outreach-provider';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))throw new Error();
    const reader=request.body?.getReader();if(!reader)throw new Error();const chunks:Uint8Array[]=[];let size=0;
    try{for(;;){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>512){await reader.cancel();throw new Error();}chunks.push(p.value);}}finally{reader.releaseLock();}
    const input=new URLSearchParams(Buffer.concat(chunks).toString('utf8'));if([...input.keys()].sort().join(',')!=='state,ticket')throw new Error();
    const state=input.get('state')||'',ticket=input.get('ticket')||'',browser=await bindNativeBrowser(request,state,ticket);
    const url=new URL('https://services.tiktokshop.com/open/authorize');url.searchParams.set('service_id',providerFixtureEnabled()?'fixture_service':process.env.OUTREACH_TIKTOK_SERVICE_ID!);url.searchParams.set('state',state);
    const result=NextResponse.redirect(url,{status:303,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
    result.cookies.set(ROUTER_COOKIE,browser,{httpOnly:true,sameSite:'lax',secure:process.env.APP_BASE_URL?.startsWith('https://')||false,path:'/api/outreach/tiktok',maxAge:600});return result;
  }catch{return NextResponse.redirect(new URL('/api/outreach/tiktok/result?result=needs-attention',process.env.APP_BASE_URL),{status:303,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
}
