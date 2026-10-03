import { test, expect, request, type APIRequestContext } from "@playwright/test";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import pg from "pg";
import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

const base=(process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200"),password="ValidPassword123!";
async function client(){return request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});}
async function post(c:APIRequestContext,path:string,data:Record<string,unknown>={}){return c.post(path,{data});}
async function mail(to:string,subject:string){
  const folder=join(process.cwd(),"data","mailbox");
  for(let i=0;i<40;i++){
    const files=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();
    for(const f of files){const item=JSON.parse(await readFile(join(folder,f),"utf8"));if(item.to===to&&item.subject.includes(subject))return item.url as string;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`Missing test mail for ${to}`);
}
async function register(c:APIRequestContext,email:string,name:string){expect((await post(c,"/api/auth/register",{email,displayName:name,password})).status()).toBe(201);const token=new URL(await mail(email,"Verify")).searchParams.get("token");expect((await post(c,"/api/auth/verify",{token})).status()).toBe(200);}
async function workspace(c:APIRequestContext,name:string){const r=await post(c,"/api/workspaces",{name});expect(r.status()).toBe(201);return (await r.json()).workspace.id as string;}
async function product(c:APIRequestContext,ws:string,name:string,sku:string){const r=await post(c,`/api/workspaces/${ws}/products`,{brand:"Test Brand",name,category:"Care",sku,description:"Original",keySellingPoints:["Clear benefit"],targetAudience:"Adults"});expect(r.status(),await r.text()).toBe(201);return (await r.json()).product.id as string;}
const rules={keepLogo:true,keepPackagingText:true,keepProductShape:true,keepCapPump:true,keepProductColorMaterial:true,keepApplicationMethod:true,customInstructions:"Keep printed facts accurate."};
async function upload(c:APIRequestContext,ws:string,pid:string,png:Buffer,purpose="FRONT",replaceAssetId?:string,expectedBytes=png.length){
  const basePath=`/api/workspaces/${ws}/products/${pid}/assets`;
  const path=replaceAssetId?`${basePath}/${replaceAssetId}/upload-intents`:`${basePath}/upload-intents`;
  const r=await post(c,path,{purpose,mimeType:"image/png",byteSize:expectedBytes,filename:"fixture.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Test fixture"});
  expect(r.status(),await r.text()).toBe(201);const intent=(await r.json()).intent as {assetId:string;versionId:string;uploadUrl:string;requiredHeaders:Record<string,string>};
  const sent=await fetch(intent.uploadUrl,{method:"PUT",headers:intent.requiredHeaders,body:new Uint8Array(png)});
  expect(sent.status,await sent.text()).toBe(200);
  return intent;
}
async function finalize(c:APIRequestContext,ws:string,pid:string,intent:{assetId:string;versionId:string}){return post(c,`/api/workspaces/${ws}/products/${pid}/assets/${intent.assetId}/versions/${intent.versionId}/finalize`);}

test("workspace-owned product versions and private media stay isolated",async()=>{
  const tag=`${Date.now()}-${Math.round(Math.random()*1e5)}`;
  const aEmail=`p2-a-${tag}@example.test`,bEmail=`p2-b-${tag}@example.test`,viewerEmail=`p2-view-${tag}@example.test`,editorEmail=`p2-edit-${tag}@example.test`;
  const a=await client(),b=await client(),viewer=await client(),editor=await client();
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  const s3=new S3Client({endpoint:process.env.OBJECT_STORAGE_ENDPOINT,region:process.env.OBJECT_STORAGE_REGION,credentials:{accessKeyId:process.env.OBJECT_STORAGE_ACCESS_KEY!,secretAccessKey:process.env.OBJECT_STORAGE_SECRET_KEY!},forcePathStyle:true});
  const png=await sharp({create:{width:80,height:80,channels:3,background:"#ed6748"}}).png().toBuffer();
  try{
    await register(a,aEmail,"Product Owner A");const wa=await workspace(a,"Product Brand A");
    await register(b,bEmail,"Product Owner B");const wb=await workspace(b,"Product Brand B");
    const pa=await product(a,wa,"A Cream","SHARED-001");
    expect((await a.get(`/api/workspaces/${wa}/products?status=CURRENT`)).status()).toBe(200);
    expect((await (await a.get(`/api/workspaces/${wa}/products?status=CURRENT`)).json()).total).toBe(1);
    expect((await post(a,`/api/workspaces/${wa}/products/${pa}/activate`)).status()).toBe(409);
    for(const input of [
      {purpose:"FRONT",mimeType:"application/zip",byteSize:10,filename:"evil.zip",permissionConfirmed:true},
      {purpose:"FRONT",mimeType:"image/png",byteSize:0,filename:"empty.png",permissionConfirmed:true},
      {purpose:"FRONT",mimeType:"image/png",byteSize:21*1024*1024,filename:"huge.png",permissionConfirmed:true},
    ])expect([400,413,415]).toContain((await post(a,`/api/workspaces/${wa}/products/${pa}/assets/upload-intents`,input)).status());
    const mismatched=await upload(a,wa,pa,png,"OTHER",undefined,png.length+1);
    expect((await finalize(a,wa,pa,mismatched)).status()).toBe(422);
    const intentA=await upload(a,wa,pa,png);
    const done=await finalize(a,wa,pa,intentA);expect(done.status(),await done.text()).toBe(200);
    expect((await done.json()).asset.sha256).toBe(createHash("sha256").update(png).digest("hex"));
    expect((await finalize(a,wa,pa,intentA)).status()).toBe(200);
    expect((await post(a,`/api/workspaces/${wa}/products/${pa}/activate`)).status()).toBe(200);
    const readyA=await (await a.get(`/api/workspaces/${wa}/products/${pa}`)).json();
    expect(readyA.product.status).toBe("ACTIVE");expect(readyA.assets.filter((x:{status:string})=>x.status==="READY")).toHaveLength(1);
    expect((await (await a.get(`/api/workspaces/${wa}/products?search=Cream`)).json()).total).toBe(1);
    expect((await (await a.get(`/api/workspaces/${wa}/products?search=NeverMatch`)).json()).total).toBe(0);
    const dl=await a.get(`/api/workspaces/${wa}/products/${pa}/assets/${intentA.assetId}/download`);expect(dl.status()).toBe(200);
    const signed=(await dl.json()).url as string;expect((await fetch(signed)).status).toBe(200);
    const unsigned=new URL(signed);unsigned.search="";expect((await fetch(unsigned)).status).not.toBe(200);
    const forged=new URL(signed);forged.searchParams.set("X-Amz-Signature","0".repeat(64));expect((await fetch(forged)).status).not.toBe(200);
    expect((await fetch(unsigned,{headers:{Authorization:"AWS4-HMAC-SHA256 Credential=fake, SignedHeaders=host, Signature=fake"}})).status).not.toBe(200);
    const ttl=await a.get(`/api/workspaces/${wa}/products/${pa}/assets/${intentA.assetId}/download?testTtl=1`);const expiring=(await ttl.json()).url as string;
    await new Promise(resolve=>setTimeout(resolve,2200));expect((await fetch(expiring)).status).not.toBe(200);
    const thumb=await a.get(`/api/workspaces/${wa}/products/${pa}/assets/${intentA.assetId}/download?variant=thumbnail`);expect(thumb.status()).toBe(200);

    const pb=await product(b,wb,"B Cream","SHARED-001");const intentB=await upload(b,wb,pb,png);expect((await finalize(b,wb,pb,intentB)).status()).toBe(200);expect((await post(b,`/api/workspaces/${wb}/products/${pb}/activate`)).status()).toBe(200);
    const duplicate=await product(a,wa,"Duplicate active SKU","SHARED-001");
    const duplicateIntent=await upload(a,wa,duplicate,png);expect((await finalize(a,wa,duplicate,duplicateIntent)).status()).toBe(200);
    expect((await post(a,`/api/workspaces/${wa}/products/${duplicate}/activate`)).status()).toBe(409);
    const aList=await (await a.get(`/api/workspaces/${wa}/products?status=ACTIVE`)).json();expect(aList.total).toBe(1);expect(aList.products[0].id).toBe(pa);
    const bList=await (await b.get(`/api/workspaces/${wb}/products?status=ACTIVE`)).json();expect(bList.total).toBe(1);expect(bList.products[0].id).toBe(pb);
    expect((await (await a.get(`/api/workspaces/${wa}/products?search=B%20Cream`)).json()).total).toBe(0);
    expect((await (await b.get(`/api/workspaces/${wb}/products?search=A%20Cream`)).json()).total).toBe(0);
    expect((await (await a.get(`/api/workspaces/${wa}/products/${pa}/assets`)).json()).assets.filter((x:{status:string})=>x.status==="READY")).toHaveLength(1);
    expect((await (await b.get(`/api/workspaces/${wb}/products/${pb}/assets`)).json()).total).toBe(1);
    const bAssetId=intentB.assetId;
    const denied=[
      await a.get(`/api/workspaces/${wb}/products/${pb}`),
      await a.get(`/api/workspaces/${wa}/products/${pb}`),
      await a.patch(`/api/workspaces/${wa}/products/${pb}`,{data:{brand:"Bad",name:"Hijack",category:"Care",sku:"HIJACK",description:"",keySellingPoints:[],targetAudience:""}}),
      await a.delete(`/api/workspaces/${wa}/products/${pb}`),
      await a.patch(`/api/workspaces/${wa}/products/${pb}/rules`,{data:rules}),
      await a.get(`/api/workspaces/${wa}/products/${pb}/assets`),
      await a.get(`/api/workspaces/${wb}/products/${pb}/assets`),
      await a.get(`/api/workspaces/${wa}/products/${pb}/assets/${bAssetId}`),
      await a.get(`/api/workspaces/${wa}/products/${pa}/assets/${bAssetId}`),
      await a.delete(`/api/workspaces/${wa}/products/${pa}/assets/${bAssetId}`),
      await a.delete(`/api/workspaces/${wb}/products/${pb}/assets/${bAssetId}`),
      await a.get(`/api/workspaces/${wb}/products/${pb}/assets/${bAssetId}/download`),
      await a.get(`/api/workspaces/${wa}/products/${pa}/assets/${bAssetId}/download`),
      await post(a,`/api/workspaces/${wa}/products/${pb}/assets/upload-intents`,{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"x.png",permissionConfirmed:true}),
      await post(a,`/api/workspaces/${wa}/products/${pa}/assets/${bAssetId}/upload-intents`,{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"x.png",permissionConfirmed:true}),
    ];
    for(const response of denied)expect([403,404]).toContain(response.status());

    const updated=await a.patch(`/api/workspaces/${wa}/products/${pa}`,{data:{brand:"Test Brand",name:"A Cream",category:"Care",sku:"SHARED-001",description:"Updated description",keySellingPoints:["Clear benefit"],targetAudience:"Adults"}});expect(updated.status()).toBe(200);
    expect((await a.patch(`/api/workspaces/${wa}/products/${pa}/rules`,{data:{...rules,keepLogo:false}})).status()).toBe(200);
    const replacement=await upload(a,wa,pa,png,"FRONT",intentA.assetId);expect((await finalize(a,wa,pa,replacement)).status()).toBe(200);
    const versions=await (await a.get(`/api/workspaces/${wa}/products/${pa}/assets/${intentA.assetId}/versions`)).json();expect(versions.versions.map((v:{version_number:number})=>v.version_number)).toEqual([2,1]);
    const detail=await (await a.get(`/api/workspaces/${wa}/products/${pa}`)).json();
    expect(detail.version.version_number).toBe(2);expect(detail.version.description).toBe("Updated description");expect(detail.versionHistory).toHaveLength(2);
    expect(detail.rules.version_number).toBe(2);expect(detail.rules.keep_logo).toBe(false);expect(detail.ruleHistory).toHaveLength(2);
    expect(detail.assets.filter((x:{status:string})=>x.status==="READY")).toHaveLength(1);
    await expect(db.query("UPDATE product_versions SET name='Mutated' WHERE id=$1",[detail.versionHistory[1].id])).rejects.toThrow();
    await expect(db.query("UPDATE product_accuracy_rule_versions SET keep_logo=false WHERE id=$1",[detail.ruleHistory[1].id])).rejects.toThrow();

    const invite=await post(a,`/api/workspaces/${wa}/invitations`,{email:viewerEmail,role:"VIEWER"});expect(invite.status()).toBe(201);
    const viewerToken=new URL(await mail(viewerEmail,"Invitation")).searchParams.get("token")!;
    await register(viewer,viewerEmail,"Product Viewer");expect((await post(viewer,`/api/invitations/${viewerToken}/accept`)).status()).toBe(200);
    expect((await viewer.get(`/api/workspaces/${wa}/products/${pa}`)).status()).toBe(200);
    expect((await viewer.patch(`/api/workspaces/${wa}/products/${pa}`,{data:{}})).status()).toBe(403);
    expect((await post(viewer,`/api/workspaces/${wa}/products/${pa}/assets/upload-intents`,{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"x.png",permissionConfirmed:true})).status()).toBe(403);
    const editInvite=await post(a,`/api/workspaces/${wa}/invitations`,{email:editorEmail,role:"EDITOR"});expect(editInvite.status()).toBe(201);
    const editorToken=new URL(await mail(editorEmail,"Invitation")).searchParams.get("token")!;
    await register(editor,editorEmail,"Product Editor");expect((await post(editor,`/api/invitations/${editorToken}/accept`)).status()).toBe(200);
    expect((await editor.patch(`/api/workspaces/${wa}/products/${pa}`,{data:{brand:"Test Brand",name:"A Cream",category:"Care",sku:"SHARED-001",description:"Editor update",keySellingPoints:["Clear benefit"],targetAudience:"Adults"}})).status()).toBe(200);

    const another=await product(a,wa,"Archived Item","ARCHIVE-1");expect((await a.delete(`/api/workspaces/${wa}/products/${another}`)).status()).toBe(200);
    expect((await (await a.get(`/api/workspaces/${wa}/products?status=CURRENT`)).json()).total).toBe(2);
    expect((await (await a.get(`/api/workspaces/${wa}/products?status=ARCHIVED`)).json()).total).toBe(1);
    const storageKey=(await db.query<{storage_key:string}>("SELECT storage_key FROM asset_versions WHERE id=$1",[intentB.versionId])).rows[0].storage_key;
    await s3.send(new DeleteObjectCommand({Bucket:process.env.TEST_OBJECT_STORAGE_BUCKET,Key:storageKey}));
    expect((await b.get(`/api/workspaces/${wb}/products/${pb}/assets/${bAssetId}/download`)).status()).toBe(503);
    expect((await (await b.get(`/api/workspaces/${wb}/products/${pb}/assets/${bAssetId}`)).json()).asset.status).toBe("FAILED");
    const audited=await db.query<{event_type:string;safe_metadata:unknown}>("SELECT event_type,safe_metadata FROM audit_events WHERE workspace_id=$1",[wa]);
    for(const event of ["PRODUCT_CREATED","PRODUCT_UPDATED","PRODUCT_ACTIVATED","PRODUCT_RULES_UPDATED","PRODUCT_ASSET_CREATED","PRODUCT_ARCHIVED"])expect(audited.rows.some(row=>row.event_type===event)).toBeTruthy();
    const auditText=JSON.stringify(audited.rows);expect(auditText).not.toContain("X-Amz-Signature");expect(auditText).not.toContain(process.env.OBJECT_STORAGE_SECRET_KEY!);
  }finally{await Promise.all([a.dispose(),b.dispose(),viewer.dispose(),editor.dispose()]);await db.end();s3.destroy();}
});
