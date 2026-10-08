import {NextResponse} from 'next/server';
import {routeCallback} from '@/lib/outreach-oauth-router';

export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const result=await routeCallback(request);
  const destination=new URL(result.startsWith('saas-')?'/outreach/channels':'/api/outreach/tiktok/result',process.env.APP_BASE_URL);
  destination.searchParams.set(result.startsWith('saas-')?'connection':'result',result==='saas-success'?'updated':result==='native-success'?'native-success':result==='native-failure'?'native-failure':'needs-attention');
  return NextResponse.redirect(destination,{status:303,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
}
