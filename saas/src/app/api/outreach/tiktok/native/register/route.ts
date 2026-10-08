import {registerNative} from '@/lib/outreach-oauth-router';
export const dynamic='force-dynamic';
export async function POST(request:Request) {
  try {
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error();
    const chunks:Uint8Array[]=[];let total=0;const reader=request.body?.getReader();if(!reader)throw new Error();
    try {for(;;){const part=await reader.read();if(part.done)break;total+=part.value.byteLength;if(total>12000){await reader.cancel();throw new Error();}chunks.push(part.value);}}finally{reader.releaseLock();}
    await registerNative(JSON.parse(Buffer.concat(chunks).toString('utf8')),request.headers);
    return new Response(null,{status:204,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});
  } catch {return Response.json({error:'Account authorization is unavailable.'},{status:403,headers:{'Cache-Control':'no-store','Referrer-Policy':'no-referrer'}});}
}
