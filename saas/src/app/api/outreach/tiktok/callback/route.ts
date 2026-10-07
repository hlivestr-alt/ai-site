import {NextResponse} from 'next/server';
import {requestSession} from '@/lib/http';
import {authorizationCallback} from '@/lib/outreach-provider';

// State carries ownership; neither Workspace nor channel comes from query input.
export async function GET(request:Request){let result='needs-attention';try{const url=new URL(request.url),session=await requestSession(request);if(url.searchParams.has('error'))throw new Error('Authorization rejected');await authorizationCallback(session,url.searchParams.get('state')||'',url.searchParams.get('code')||'');result='updated';}catch{/* Never log callback URL, code, raw provider body or Error. */}const destination=new URL('/outreach/channels',process.env.APP_BASE_URL);destination.searchParams.set('connection',result);return NextResponse.redirect(destination,{status:303,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
