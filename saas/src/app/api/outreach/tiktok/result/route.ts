export const dynamic='force-dynamic';
export async function GET(request:Request) {
  const value=new URL(request.url).searchParams.get('result'),success=value==='native-success';
  const text=success?'Native account authorization completed. Return to your private Outreach settings to review the authorized shops.':'Account authorization could not be completed. Return to your settings and start a new connection.';
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Account connection</title></head><body><main><h1>'+ (success?'Account connected':'Connection needs attention')+'</h1><p>'+text+'</p></main></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",'X-Content-Type-Options':'nosniff'}});
}
