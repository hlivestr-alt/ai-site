import {test,expect,chromium,type Request} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {fixture,close,evidence,pending,base,nativeWeb,marker} from './router-support';
for(const channel of ['chrome','msedge'] as const)for(const viewport of [{width:1440,height:1000},{width:390,height:844}]){
 test(`F1 ${channel} ${viewport.width}: SaaS and native OAuth complete on clean result pages`,async()=>{
  test.setTimeout(240000);const f=await fixture(),browser=await chromium.launch({channel});
  const secrets:string[]=[],consoleLeaks:string[]=[],networkLeaks:string[]=[],pageFailures:string[]=[],steps:string[]=[];
  const context=await browser.newContext({baseURL:base,viewport,storageState:await f.c.storageState()}),page=await context.newPage();let observedState='',mode='saas',failure=false;
  context.on('page',p=>p.on('pageerror',()=>pageFailures.push('PAGE_EXCEPTION')));
  page.on('pageerror',()=>pageFailures.push('PAGE_EXCEPTION'));
  page.on('console',m=>{if(secrets.some(v=>m.text().includes(v)))consoleLeaks.push('CALLBACK_VALUE');});
  const responses:Promise<void>[]=[];
  page.on('response',r=>{responses.push((async()=>{try{const u=new URL(r.url());if(u.pathname==='/api/outreach/tiktok/callback')return;const text=await r.text();if(secrets.some(v=>text.includes(v)))networkLeaks.push('CALLBACK_VALUE_IN_RESPONSE');}catch{}})());});
  page.on('request',r=>{try{const u=new URL(r.url());if(u.pathname==='/api/outreach/tiktok/callback'||u.origin==='https://services.tiktokshop.com')return;if(secrets.some(v=>r.url().includes(v)))networkLeaks.push('CALLBACK_VALUE_IN_UNRELATED_URL');if(r.headers().referer&&secrets.some(v=>r.headers().referer.includes(v)))networkLeaks.push('CALLBACK_REFERRER');}catch{}});
  await context.route('**/*',async route=>{const origin=new URL(route.request().url()).origin;if([base,nativeWeb,process.env.F1_NATIVE_API_URL!].includes(origin))await route.continue();else {networkLeaks.push('UNEXPECTED_EXTERNAL_REQUEST_BLOCKED');await route.abort();}});
  await context.route('https://services.tiktokshop.com/open/authorize**',async route=>{
   const u=new URL(route.request().url());observedState=u.searchParams.get('state')||'';
   if(u.searchParams.get('service_id')!=='fixture_service'){await route.abort();throw new Error('UNEXPECTED_PROVIDER_APP_BLOCKED');}
   const code=(mode==='native'&&failure?'fail_':'')+marker();secrets.push(code);
   const destination=base+'/api/outreach/tiktok/callback?'+new URLSearchParams({state:observedState,code});
   await route.fulfill({status:302,headers:{Location:destination,'Referrer-Policy':'no-referrer','Cache-Control':'no-store'}});
  });
  // Playwright routes intercept the first URL in a redirect chain. Fetch the
  // local start response without following its provider redirect, preserve its
  // real browser-binding cookie, and supply only the controlled provider reply.
  await context.route(base+'/api/outreach/tiktok/native/start',async route=>{
   const response=await route.fetch({maxRedirects:0}),headers=response.headers(),target=new URL(headers.location||base);
   if(response.status()!==303||target.origin!=='https://services.tiktokshop.com'||target.searchParams.get('service_id')!=='fixture_service')throw new Error('NATIVE_FIXTURE_START_FAILED');
   observedState=target.searchParams.get('state')||'';const code=(failure?'fail_':'')+marker();secrets.push(code);
   await route.fulfill({response,status:303,headers:{...headers,location:base+'/api/outreach/tiktok/callback?'+new URLSearchParams({state:observedState,code})}});
  });
  async function clean(expected:string){
   try {await page.waitForURL(url=>url.pathname===expected&&(url.searchParams.has('connection')||url.searchParams.has('result'))&&!url.searchParams.has('code')&&!url.searchParams.has('state'),{timeout:20000});}catch{await writeFile('.next-tests/phase-f1/browser-stage.json',JSON.stringify({stage:steps.at(-1)||'START',lastPath:new URL(page.url()).pathname,mode,providerStateObserved:!!observedState}));throw new Error('FIXTURE_CLEAN_RESULT_NOT_REACHED');}
   const text=await page.content();expect(secrets.some(v=>text.includes(v))).toBe(false);expect(secrets.some(v=>page.url().includes(v))).toBe(false);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  }
  try{
   await pending(f);await page.goto('/outreach/channels');await page.getByRole('button',{name:'Connect account',exact:true}).last().click();await clean('/outreach/channels');expect(new URL(page.url()).searchParams.get('connection')).toBe('updated');steps.push('saas-ui-connect-success');
   await page.screenshot({path:`docs/phase-f1-evidence/router-${channel}-${viewport.width}-saas.png`,fullPage:true});
   const usedState=observedState;
   try{await page.goto(base+'/api/outreach/tiktok/callback?'+new URLSearchParams({state:usedState,code:marker()}));}catch{throw new Error('FIXTURE_REPLAY_NAVIGATION_FAILED');}
   await clean('/api/outreach/tiktok/result');await expect(page.getByRole('heading',{name:'Connection needs attention'})).toBeVisible();steps.push('replay-clean-failure');
   await pending(f,'REVOKED');await page.goto('/outreach/channels');await page.getByRole('button',{name:'Connect account',exact:true}).last().click();await clean('/outreach/channels');expect(new URL(page.url()).searchParams.get('connection')).toBe('needs-attention');steps.push('saas-provider-failure');
   mode='native';await page.goto(nativeWeb+'/settings');
   let desktopInitiations=0;const watchDesktop=(r:Request)=>{if(r.method()==='POST'&&new URL(r.url()).pathname.endsWith('/integrations/tiktok/authorize'))desktopInitiations++;};page.on('request',watchDesktop);
   await page.evaluate(()=>{Reflect.set(window,'outreachDesktop',{platform:'fixture',onMaximizedChange:()=>()=>{},isMaximized:async()=>false});});
   await page.getByRole('button',{name:/Authorize|Connect TikTok/}).first().click();await expect(page.getByRole('status').filter({hasText:'Complete authorization in that same browser.'})).toBeVisible();expect(desktopInitiations).toBe(0);expect(new URL(page.url()).pathname).toBe('/settings');
   page.off('request',watchDesktop);await page.evaluate(()=>{Reflect.deleteProperty(window,'outreachDesktop');});steps.push('desktop-starts-in-standard-browser-before-state');
   await page.getByRole('button',{name:/Authorize|Connect TikTok/}).first().click();await clean('/api/outreach/tiktok/result');expect(new URL(page.url()).searchParams.get('result')).toBe('native-success');await expect(page.getByRole('heading',{name:'Account connected'})).toBeVisible();steps.push('native-ui-private-completion');
   await page.screenshot({path:`docs/phase-f1-evidence/router-${channel}-${viewport.width}-native.png`,fullPage:true});
   failure=true;await page.goto(nativeWeb+'/settings');await page.getByRole('button',{name:/Authorize|Connect TikTok/}).first().click();await clean('/api/outreach/tiktok/result');expect(new URL(page.url()).searchParams.get('result')).toBe('native-failure');steps.push('native-completion-failure');
   await Promise.allSettled(responses);expect(consoleLeaks.length).toBe(0);expect(networkLeaks.length).toBe(0);expect(pageFailures.length).toBe(0);
   await evidence(`router-browser-${channel}-${viewport.width}`,{status:'PASS',channel,browserVersion:browser.version(),viewport,steps,consoleLeaks:0,networkLeaks:0,cleanResults:true,realProviderOperations:0,realSends:0});
  }catch{throw new Error('ROUTER_BROWSER_ACCEPTANCE_FAILED_AFTER_'+(steps.at(-1)||'START'));}
  finally{await context.close();await browser.close();await close(f);}
 });
}
