import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {NextRequest} from 'next/server';
import {proxy} from '../../src/proxy';

for(const path of ['/verify','/reset-password'])test(`${path}: recipient link renders without forwarding its secret`,()=>{
  const token=randomBytes(32).toString('base64url'),url=new URL(path,'https://ai-test.proyaofficial.com');
  url.searchParams.set('token',token);url.searchParams.set('next','/');
  const response=proxy(new NextRequest(url));
  const rewrite=new URL(response.headers.get('x-middleware-rewrite')!);
  assert.equal(rewrite.searchParams.has('token'),false);
  assert.equal(rewrite.pathname,path);
  assert.equal(rewrite.searchParams.get('next'),'/');
  assert.equal([...response.headers].some(([key,value])=>key!=='x-middleware-override-headers'&&value.includes(token)),false);
  assert.equal(response.headers.get('Content-Security-Policy')!.includes("object-src 'none'"),true);
  assert.equal(response.headers.get('X-Frame-Options'),'DENY');
});

test('auth API requests retain their body and do not use the page rewrite',()=>{
  const response=proxy(new NextRequest('https://ai-test.proyaofficial.com/api/auth/verify',{method:'POST',body:JSON.stringify({token:'request-body-secret'})}));
  assert.equal(response.headers.has('x-middleware-rewrite'),false);
});

for(const path of ['/verify','/reset-password'])test(`${path}: forwarded HTTPS renders through the HTTP loopback origin`,()=>{
  const token=randomBytes(32).toString('base64url'),url=new URL(path,'https://127.0.0.1:3200');
  url.searchParams.set('token',token);
  const response=proxy(new NextRequest(url,{headers:{'x-forwarded-proto':'https'}}));
  const rewrite=new URL(response.headers.get('x-middleware-rewrite')!);
  assert.equal(rewrite.origin,'http://localhost:3200');
  assert.equal(rewrite.searchParams.has('token'),false);
});
