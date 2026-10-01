import {fundFixture} from "../billing-helpers";
import { test, expect } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";

async function mail(to:string){for(let i=0;i<50;i++){const dir=join(process.cwd(),"data","mailbox"),files=(await readdir(dir).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const name of files){const item=JSON.parse(await readFile(join(dir,name),"utf8"));if(item.to===to&&item.subject.includes("Verify"))return item.url as string;}await new Promise(r=>setTimeout(r,100));}throw new Error("Verification mail missing");}
function dispatcher():ChildProcess{return spawn(process.execPath,["--env-file=.env.local","--import","tsx","scripts/dispatcher.ts"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,OBJECT_STORAGE_BUCKET:process.env.TEST_OBJECT_STORAGE_BUCKET,APP_ENV:"local",VIDEO_PROVIDER:"fake",ENABLE_FAKE_VIDEO_PROVIDER:"1",DISPATCHER_POLL_MS:"200"},stdio:["ignore","pipe","pipe"],windowsHide:true});}

test("customer creates a video, closes the page, and returns to a private result",async({page,browser})=>{
  test.setTimeout(150_000);
  const tag=Date.now(),email=`p4-browser-${tag}@example.test`;
  await page.goto("/register");await page.getByLabel("Email address").fill(email);await page.getByLabel("Your name").fill("Video Browser Owner");await page.getByLabel("Password").fill("ValidPassword123!");await page.getByRole("button",{name:/Create account/}).click();
  await page.goto(await mail(email));await page.getByRole("button",{name:/Verify email/}).click();await page.getByLabel("Workspace name").fill(`Video Browser ${tag}`);await page.getByRole("button",{name:/Create workspace/}).click();
  const ws=(await (await page.request.get("/api/auth/session")).json()).currentWorkspace.id as string;
  fundFixture(ws);
  const created=await page.request.post(`/api/workspaces/${ws}/products`,{headers:{Origin:"http://127.0.0.1:3200"},data:{brand:"Video Brand",name:"Hero Product",category:"Care",sku:`VIDEO-UI-${tag}`,description:"Simple Product",keySellingPoints:["A clear benefit"],targetAudience:"Adults"}});expect(created.status(),await created.text()).toBe(201);const productId=(await created.json()).product.id as string;
  const png=await sharp({create:{width:640,height:640,channels:3,background:"#edcab2"}}).png().toBuffer();
  const intentResponse=await page.request.post(`/api/workspaces/${ws}/products/${productId}/assets/upload-intents`,{headers:{Origin:"http://127.0.0.1:3200"},data:{purpose:"FRONT",mimeType:"image/png",byteSize:png.length,filename:"hero.png",sha256:createHash("sha256").update(png).digest("hex"),sourceType:"CUSTOMER_OWNED",permissionConfirmed:true,permissionNote:"Test image"}});expect(intentResponse.status(),await intentResponse.text()).toBe(201);
  const intent=(await intentResponse.json()).intent as {assetId:string;versionId:string;uploadUrl:string;requiredHeaders:Record<string,string>};expect((await fetch(intent.uploadUrl,{method:"PUT",headers:intent.requiredHeaders,body:new Uint8Array(png)})).status).toBe(200);
  expect((await page.request.post(`/api/workspaces/${ws}/products/${productId}/assets/${intent.assetId}/versions/${intent.versionId}/finalize`,{headers:{Origin:"http://127.0.0.1:3200"},data:{}})).status()).toBe(200);
  expect((await page.request.post(`/api/workspaces/${ws}/products/${productId}/activate`,{headers:{Origin:"http://127.0.0.1:3200"},data:{}})).status()).toBe(200);
  await page.getByRole("link",{name:/AI Videos/}).click();await expect(page.getByRole("heading",{name:"Create Video"})).toBeVisible();
  await page.getByLabel("Saved Product").selectOption(productId);await page.getByLabel("Video prompt").fill("Show the saved Product in a bright studio with a slow, gentle orbit camera movement.");await page.getByLabel("Duration").selectOption("5");await page.getByLabel("Aspect ratio").selectOption("1:1");
  await expect(page.getByText("Local simulation: this creates a test video")).toBeVisible();await page.getByRole("button",{name:"Generate video"}).click();await expect(page).toHaveURL(/\/ai-videos\/[0-9a-f-]+$/);
  const url=page.url(),state=await page.context().storageState();await page.close();
  const dispatch=dispatcher(),logs:string[]=[];dispatch.stdout?.on("data",x=>logs.push(String(x)));dispatch.stderr?.on("data",x=>logs.push(String(x)));
  try{
    const reopened=await browser.newContext({storageState:state}),view=await reopened.newPage();
    try{await view.goto(url);await expect(view.getByRole("heading",{name:"Preview and download"})).toBeVisible({timeout:90000});await expect(view.locator("video.video-preview")).toBeVisible();await expect(view.getByRole("link",{name:"Download MP4"})).toHaveAttribute("href",/^http/);await view.goto("/ai-videos");await expect(view.locator(".video-history-row strong").filter({hasText:"Hero Product"})).toBeVisible();await expect(view.getByText("SUCCEEDED")).toBeVisible();}
    catch(error){throw new Error(`${error instanceof Error?error.message:error}\nDispatcher: ${logs.join("").slice(-3000)}`);}
    finally{await reopened.close();}
  }finally{dispatch.kill();}
});
