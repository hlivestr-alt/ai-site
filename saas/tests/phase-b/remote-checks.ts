// Owned REMOTE-TEST Product/workspace fixtures only. No inference or payments.
import {chromium,request,expect} from '@playwright/test';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {parseEnv} from 'node:util';
import {randomBytes} from 'node:crypto';
import pg from 'pg';
import sharp from 'sharp';
import {hashPassword} from '../../src/lib/core';
import {observe} from '../stabilization/browser-checks';

async function main(){
  Object.assign(process.env,parseEnv(await readFile('.env.local','utf8')));
  if(process.env.APP_BASE_URL!=='https://ai-test.proyaofficial.com'||process.env.APP_ENV!=='local')throw new Error('REMOTE-TEST configuration required');
  const base=process.env.APP_BASE_URL,runId=`${Date.now()}-${randomBytes(3).toString('hex')}`;
  const email=`phase-b-remote-${runId}@example.test`,password=`PhaseB!${randomBytes(24).toString('base64url')}`;
  const database=new pg.Client({connectionString:process.env.DATABASE_URL});await database.connect();
  const c=await request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});
  const workspaces:string[]=[],products:{workspaceId:string;id:string}[]=[],runs:Record<string,unknown>[]=[];
  let userId='';const result:Record<string,unknown>={runId,realRemoteSignup:'EXTERNAL CONFIG REQUIRED',verificationEmailDelivered:false,realVideo:0,realLLM:0,outreach:0,payments:0,ownedQaOnly:true};
  try{
    // Explicit preverified QA fixture: this does not test or claim SMTP delivery.
    userId=(await database.query("INSERT INTO users(email,display_name,password_hash,status,email_verified_at) VALUES($1,'Phase B remote QA',$2,'ACTIVE',now()) RETURNING id",[email,await hashPassword(password)])).rows[0].id;
    expect((await c.post('/api/auth/login',{data:{email,password}})).status()).toBe(200);
    const image=await sharp({create:{width:640,height:640,channels:3,background:'#ed806b'}}).png().toBuffer();
    for(const channel of ['chrome','msedge'] as const){
      const browser=await chromium.launch({channel,headless:true}),context=await browser.newContext({baseURL:base,viewport:{width:1440,height:1000}}),page=await context.newPage();
      const audit=await observe(page,base),row:Record<string,unknown>={channel,version:browser.version()};
      try{
        for(const path of ['/register','/forgot-password','/reset-password','/resend-verification']){
          const response=await page.goto(path);expect(response?.status()).toBe(200);
          expect(/local (development|test) mailbox/i.test(await page.locator('body').innerText())).toBe(false);
          expect(await page.locator('a[href="/dev/mailbox"]').count()).toBe(0);
          expect((await response!.allHeaders())['content-security-policy']).toContain("object-src 'none'");
          expect(await page.locator('script[src*="email-decode"],.__cf_email__').count()).toBe(0);
        }
        row.publicAuthCopy=true;row.emailObfuscationAbsent=true;
        await context.addCookies((await c.storageState()).cookies);await page.goto('/');
        // Create both brands through the customer controls.
        for(const label of ['A','B']){
          if(await page.locator('.workspace-pick').count())await page.getByRole('button',{name:'Create workspace',exact:true}).click();
          await page.getByLabel('Workspace name').fill(`Phase B QA ${channel} ${label} ${runId}`);
          if(await page.locator('.workspace-create').count())await page.locator('.workspace-create').getByRole('button',{name:'Create workspace',exact:true}).click();else await page.getByRole('button',{name:/Create workspace/}).click();
          await expect(page.getByLabel('Switch workspace')).toBeEnabled();
          await expect(page.locator('select[aria-label="Switch workspace"] option:checked')).toHaveText(`Phase B QA ${channel} ${label} ${runId}`);
          workspaces.push((await (await page.request.get('/api/auth/session')).json()).currentWorkspace.id);
        }
        const a=workspaces.at(-2)!,b=workspaces.at(-1)!;
        for(const id of [a,b,a,b]){await page.getByLabel('Switch workspace').selectOption(id);await expect(page.getByLabel('Switch workspace')).toBeEnabled();await expect(page.getByLabel('Switch workspace')).toHaveValue(id);expect((await (await page.request.get('/api/auth/session')).json()).currentWorkspace.id).toBe(id);}
        row.repeatedSwitches=4;
        await page.goto('/products/new');await page.getByLabel('Brand',{exact:true}).fill('Owned QA');await page.getByLabel('Product name',{exact:true}).fill(`Phase B ${channel} reference`);await page.getByLabel('Category',{exact:true}).fill('QA');await page.getByRole('button',{name:/Continue to assets/}).click();await expect(page.locator('.reference-card')).toHaveCount(8);
        const productId=new URL(page.url()).pathname.split('/')[2];products.push({workspaceId:b,id:productId});
        const front=page.locator('[data-slot="FRONT"]'),back=page.locator('[data-slot="BACK"]');
        async function upload(label:string,name:string){const card=page.locator(`[data-slot="${label.toUpperCase()}"]`);await page.getByLabel(`${label} file`,{exact:true}).setInputFiles({name,mimeType:'image/png',buffer:image});const finalized=page.waitForResponse(r=>new URL(r.url()).pathname.endsWith('/finalize')&&r.request().method()==='POST');await card.getByRole('button',{name:name==='front-v2.png'?'Replace':'Upload',exact:true}).click();expect((await finalized).status()).toBe(200);await expect(card.locator('.reference-status')).toHaveText('Ready');}
        await upload('Front','front.png');await expect(front.getByText('COVER',{exact:true})).toBeVisible();await upload('Back','back.png');await back.getByRole('button',{name:'Set as cover'}).click();await expect(back.getByText('COVER',{exact:true})).toBeVisible();
        await front.getByRole('button',{name:'Set as cover'}).click();await expect(front.getByText('COVER',{exact:true})).toBeVisible();await upload('Front','front-v2.png');await expect(front.getByText('Version 2',{exact:true})).toBeVisible();await expect(front.getByText('COVER',{exact:true})).toBeVisible();
        await page.getByRole('button',{name:/Continue to accuracy/}).click();await page.getByRole('button',{name:/Save product/}).click();await expect(page.getByText('ACTIVE',{exact:true})).toBeVisible();
        await page.goto('/products');const cover=page.getByRole('img',{name:`Phase B ${channel} reference cover`,exact:true});await expect(cover).toBeVisible();await expect.poll(()=>cover.evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        await page.goto(`/products/${productId}`);page.once('dialog',dialog=>void dialog.accept());await page.getByRole('button',{name:'Archive',exact:true}).click();await expect(page).toHaveURL(/\/products$/);await page.getByLabel('Status').selectOption('ARCHIVED');await page.getByRole('button',{name:'Search',exact:true}).click();await page.getByRole('link',{name:new RegExp(`Phase B ${channel} reference`)}).click();await page.getByRole('button',{name:'Restore product',exact:true}).click();await expect(page.getByText('ACTIVE',{exact:true})).toBeVisible();
        await page.getByLabel('Switch workspace').selectOption(a);await expect(page.getByLabel('Switch workspace')).toBeEnabled();expect((await page.request.get(`/api/workspaces/${b}/products/${productId}`)).status()).toBe(404);row.isolation=true;
        await page.getByLabel('Switch workspace').selectOption(b);await expect(page.getByLabel('Switch workspace')).toBeEnabled();
        row.responsive=[];
        for(const viewport of [{width:390,height:844},{width:768,height:1024},{width:1440,height:1000}]){await page.setViewportSize(viewport);await page.goto(`/products/${productId}/edit?step=assets`);await expect(page.locator('.reference-card')).toHaveCount(8);await expect(front.getByText('COVER',{exact:true})).toBeVisible();await expect.poll(()=>front.locator('img').evaluate(el=>(el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:`docs/stabilization-phase-b-evidence/remote-${channel}-${viewport.width}.png`,fullPage:true});(row.responsive as unknown[]).push({...viewport,overflow:false});}
        const wallet=(await database.query('SELECT available_tokens,reserved_tokens FROM billing_account_wallets WHERE billing_account_id=(SELECT billing_account_id FROM workspaces WHERE id=$1)',[b])).rows[0];expect(wallet).toEqual({available_tokens:'0',reserved_tokens:'0'});
        await audit.finish();expect(audit.crashes).toEqual([]);expect(audit.consoleErrors).toEqual([]);expect(audit.leaks).toEqual([]);
        row.product={slots:8,frontDefaultCover:true,manualCover:true,coverReplacementV2:true,catalogImageLoaded:true,archiveRestore:true};row.zeroWallet=true;row.pageErrors=audit.crashes;row.consoleErrors=audit.consoleErrors;row.secretLeaks=audit.leaks;row.status='PASS';
      }catch{row.status='FAIL';process.exitCode=1;}
      finally{runs.push(row);await context.close();await browser.close();}
    }
    expect((await database.query('SELECT count(*)::integer AS count FROM jobs WHERE workspace_id=ANY($1::uuid[])',[workspaces])).rows[0].count).toBe(0);
  }finally{
    for(const p of products)await database.query("UPDATE products SET status='ARCHIVED',archived_at=now(),updated_at=now() WHERE workspace_id=$1 AND id=$2",[p.workspaceId,p.id]);
    if(workspaces.length)await database.query("UPDATE workspaces SET status='ARCHIVED',updated_at=now() WHERE id=ANY($1::uuid[])",[workspaces]);
    if(userId){await database.query('UPDATE sessions SET revoked_at=now() WHERE user_id=$1',[userId]);await database.query("UPDATE users SET status='DISABLED',updated_at=now() WHERE id=$1",[userId]);}
    result.browserRuns=runs;result.cleanup={ownedAccountDisabled:!!userId,ownedWorkspacesArchived:workspaces.length,ownedProductsArchived:products.length,mediaHistoryRetained:true};
    await mkdir('docs/stabilization-phase-b-evidence',{recursive:true});await writeFile('docs/stabilization-phase-b-evidence/remote-checks.json',JSON.stringify(result,null,2));console.log(JSON.stringify({browserRuns:runs.map(r=>({channel:r.channel,status:r.status})),realRemoteSignup:result.realRemoteSignup,paid:{realVideo:0,realLLM:0,outreach:0,payments:0},cleanup:result.cleanup}));
    await c.dispose();await database.end();
  }
}
main().catch(()=>{console.error('REMOTE_PHASE_B_CHECK_FAILED');process.exitCode=1;});
