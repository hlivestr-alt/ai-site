import type {Page} from '@playwright/test';
import {observe} from '../stabilization/browser-checks';
export async function providerBrowserAudit(page:Page){
  const original=await observe(page),keys=Object.values(JSON.parse(process.env.OUTREACH_CREDENTIAL_KEYS||'{}')) as string[],reads:Promise<void>[]=[],leaks:string[]=[];
  const scan=(value:string)=>{if(keys.some(key=>key&&value.includes(key)))leaks.push('OUTREACH_ENCRYPTION_KEY');if(/fixture_(?:access|refresh)_[a-f0-9-]{36}_\d+|fixture_(?:second_)?cipher_[a-f0-9-]{36}/i.test(value))leaks.push('PROVIDER_CREDENTIAL');};
  page.on('console',m=>scan(m.text()));page.on('response',r=>{if(r.url().startsWith(process.env.SAAS_TEST_BASE_URL!)&&/json|html|javascript/.test(r.headers()['content-type']||''))reads.push(r.text().then(scan).catch(()=>{}));});
  return {...original,providerLeaks:leaks,finish:async()=>{await original.finish();await Promise.allSettled(reads);}};
}
