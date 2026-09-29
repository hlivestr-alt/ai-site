import { test,expect,type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const password="ui-validation-password-only";
const id="11111111-1111-4111-8111-111111111111";
const now="2026-09-26T02:00:00.000Z";
const campaign={id,name:"Autumn creator campaign",state:"FROZEN",version:2,targetCount:10,createdAt:now,preview:{evaluated:12,eligible:10,selected:10},frozen:10,queued:0,sending:0,sent:0,failed:0,restricted:0,deliveryUnknown:0,cancelled:0,remaining:10};
async function login(page:Page){await page.goto("/login");await expect(page.locator(".brand-name")).toHaveText("AI Site");await page.getByLabel("Password",{exact:true}).fill(password);await page.getByRole("button",{name:"Sign in",exact:true}).click();await expect(page).toHaveURL("/");await expect(page.getByRole("heading",{name:"AI Videos",level:2})).toBeVisible();}
async function mockServices(page:Page,offline=false){
  await page.route("**/api/ai-video/bridge/status",route=>route.fulfill({json:{state:offline?"offline":"connected",readyToGenerate:!offline,comfy:offline?"offline":"idle",creative:"idle",generation:"available",validation:"ready",capabilities:{durations:[4,8,15],resolutions:["480x864","576x1024","768x1344"],aspectRatios:["9:16"]}}}));
  await page.route("**/api/ai-video/jobs",route=>{expect(route.request().method()).toBe("GET");return route.fulfill({status:offline?503:200,json:{jobs:offline?[]:[{id,state:"COMPLETED",prompt:"A portrait product scene with soft natural lighting",createdAt:now,updatedAt:now,durationSeconds:8,aspectRatio:"9:16",referenceCount:1,output:{filename:"video.mp4"}}]}});});
  await page.route("**/api/ai-video/jobs/*/artifact",route=>route.fulfill({contentType:"video/mp4",body:readFileSync("../h3-bridge/test-fixtures/fixture.mp4")}));
  await page.route("**/api/clipper/overview",route=>route.fulfill({json:{state:offline?"disconnected":"connected",sources:offline?[]:[{name:"Source video.mp4",size:12345678}],jobs:offline?[]:[{id:"clip-1",name:"Source video",status:"processing",step:"Selecting moments",progress:65,clips:3}],results:offline?[]:[{id:"result-1",source:"Source video",product:"Product scene",score:92,status:"completed"}]}}));
  await page.route("**/api/outreach/overview",route=>route.fulfill({json:{state:offline?"disconnected":"connected",campaigns:offline?[]:[campaign]}}));
  await page.route("**/api/outreach/status",route=>route.fulfill({json:{state:offline?"offline":"connected",sender:"unavailable",worker:"idle",message:"Platform queueing remains disabled."}}));
}
for(const width of [1920,1440])for(const theme of ["light","dark"]){
  test(`${width}px ${theme}: navigation, layout, and theme persistence`,async({page})=>{
    await page.setViewportSize({width,height:width===1920?1080:900});await login(page);await mockServices(page);
    if(theme==="dark")await page.getByRole("button",{name:"Switch to dark theme"}).click();
    const errors:string[]=[];page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text()+" "+m.location().url);});
    for(const [name,path] of [["Home","/"],["AI Videos","/ai-videos"],["Clipper","/clipper"],["Outreach","/outreach"],["Settings","/settings"]]){
      await page.getByRole("navigation").getByRole("link",{name,exact:true}).click();await expect(page).toHaveURL(path);await expect(page.locator(`nav a[aria-current="page"]`)).toHaveText(name);
      await expect(page.locator(".brand-name")).toHaveText("AI Site");
      await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
      await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`../validation/screenshots/test-${name.toLowerCase().replaceAll(" ","-")}-${theme}-${width}.png`,fullPage:true});
    }
    await page.reload();await expect(page.locator("html")).toHaveAttribute("data-theme",theme);
    await expect(page.locator("body")).not.toContainText("A little imagination.");
    await page.getByRole("button",{name:"Log Out",exact:true}).last().click();await expect(page).toHaveURL("/login");await expect(page.locator("html")).toHaveAttribute("data-theme",theme);await expect(page.getByLabel("Account")).toHaveValue("Operator");await page.screenshot({path:`../validation/screenshots/test-login-${theme}-${width}.png`,fullPage:true});
    expect(errors).toEqual([]);
  });
}
test("reference upload, validation, removal, and history filters without submission",async({page})=>{
  await login(page);await mockServices(page);await page.goto("/ai-videos");await expect(page.getByText("Ready",{exact:true}).first()).toBeVisible();
  await expect(page.getByRole("button",{name:"Generate Video",exact:true})).toBeDisabled();await page.getByLabel("Prompt",{exact:true}).fill("A quiet product scene with natural light");
  await page.getByLabel("Reference Images (1–2)").setInputFiles({name:"reference.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7L8AAAAASUVORK5CYII=","base64")});
  await expect(page.getByAltText("Reference 1")).toBeVisible();await expect(page.getByRole("button",{name:"Generate Video",exact:true})).toBeEnabled();await page.getByRole("button",{name:"Remove",exact:true}).click();await expect(page.getByRole("button",{name:"Generate Video",exact:true})).toBeDisabled();
  await page.getByLabel("Reference Images (1–2)").setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("not an image")});await expect(page.getByRole("alert").filter({hasText:"PNG, JPEG, or WebP"})).toBeVisible();await page.getByRole("tab",{name:"Failed",exact:true}).click();await expect(page.getByText("No failed generations",{exact:true})).toBeVisible();
});
test("video controls, real progress display, and cleaned campaign form",async({page})=>{
  await login(page);await mockServices(page);
  await page.goto("/ai-videos");
  await expect(page.getByLabel("Duration")).toHaveValue("8");
  await expect(page.getByLabel("Resolution")).toHaveValue("576x1024");
  await expect(page.getByLabel("Duration").locator("option")).toHaveText(["4 sec","8 sec","15 sec"]);
  await expect(page.getByLabel("Resolution").locator("option")).toHaveText(["480 × 864","576 × 1024","768 × 1344"]);
  await expect(page.locator("main")).not.toContainText("Give your ideas");
  await page.route(`**/api/ai-video/jobs/${id}`,route=>route.fulfill({json:{id,state:"RUNNING",progress:42,prompt:"A portrait product scene with soft natural lighting",createdAt:now,updatedAt:now,durationSeconds:8,resolution:"576x1024",aspectRatio:"9:16",referenceCount:1}}));
  await page.route("**/api/ai-video/jobs",route=>route.fulfill({json:{jobs:[{id,state:"RUNNING",progress:42,prompt:"A portrait product scene with soft natural lighting",createdAt:now,updatedAt:now,durationSeconds:8,resolution:"576x1024",aspectRatio:"9:16",referenceCount:1}]}}));
  await page.reload();await page.locator(".history-row").first().click();
  await expect(page.getByRole("heading",{name:"Generating video · 42%"})).toBeVisible();
  await expect(page.getByRole("progressbar",{name:"Video generation progress"})).toHaveAttribute("value","42");
  await page.goto("/outreach/new");
  await expect(page.getByLabel("Message body")).toContainText("Halo kak {{creator_display_name}}");
  await expect(page.getByLabel("Message body")).toBeEditable();
  await expect(page.getByLabel("Product name")).toHaveCount(0);
  await expect(page.getByLabel("Campaign name")).toHaveCount(0);
  await page.goto(`/outreach/${id}`);await expect(page.getByRole("heading",{name:"Sending progress"})).toBeVisible();
});
test("one click advances a mocked campaign through native stages and opens details",async({page})=>{
  await login(page);await mockServices(page);
  let calls=0;
  await page.route("**/api/outreach/send-campaign",route=>{
    const body=route.request().postDataJSON();
    if(calls===0){
      expect(body.input).not.toHaveProperty("productName");
      expect(body.input).not.toHaveProperty("campaignName");
      expect(body.input.messageTemplate).toBe("Hello {{creator_display_name}}");
    }
    calls++;
    const stages=["selecting","freezing","queueing","sending"];
    return route.fulfill({json:{stage:stages[Math.min(calls-1,3)],campaignId:id,frozen:calls>=3?1:undefined}});
  });
  await page.goto("/outreach/new");
  await expect(page.getByLabel("Message body")).toContainText("Halo kak {{creator_display_name}}");
  await page.getByLabel("Message body").fill("Hello {{creator_display_name}}");
  await expect(page.getByRole("button",{name:"Send Campaign",exact:true})).toBeEnabled();
  for(const label of ["Preview recipients","Freeze recipients","Confirm & Queue","Product name","Campaign name"])await expect(page.getByText(label,{exact:true})).toHaveCount(0);
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await page.getByRole("button",{name:"Send Campaign",exact:true}).click();
  await expect(page).toHaveURL(`/outreach/${id}`);
  await expect(page.getByRole("heading",{name:"Sending progress"})).toBeVisible();
  expect(calls).toBe(4);
});
test("missing native message blocks campaign creation",async({page})=>{
  await login(page);await mockServices(page);
  await page.route("**/api/outreach/template",route=>route.fulfill({status:503,json:{error:"Unable to load outreach message template."}}));
  await page.goto("/outreach/new");
  await expect(page.getByRole("alert").filter({hasText:"Unable to load outreach message template."})).toBeVisible();
  await expect(page.getByRole("button",{name:"Send Campaign"})).toBeDisabled();
});
test("offline and loading states are intentional",async({page})=>{
  await login(page);await mockServices(page,true);await page.goto("/ai-videos");await expect(page.getByText("Generation history unavailable",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Generate Video",exact:true})).toBeDisabled();await page.goto("/clipper");await expect(page.getByText("Clipper is offline",{exact:true})).toBeVisible();await page.goto("/outreach");await expect(page.getByText("Campaign data unavailable",{exact:true})).toBeVisible();
  await page.route("**/api/clipper/overview",async route=>{await new Promise(resolve=>setTimeout(resolve,600));await route.fulfill({json:{state:"connected",sources:[],jobs:[],results:[]}});});await page.goto("/clipper");await expect(page.getByText("Checking sources…",{exact:true})).toBeVisible();await expect(page.getByText("No source videos yet",{exact:true})).toBeVisible();
});
test("refresh resumes the same operation key without a new form submission",async({page})=>{
  await login(page);await mockServices(page);
  const key="22222222-2222-4222-8222-222222222222";
  let calls=0;
  await page.route("**/api/outreach/send-campaign",route=>{calls++;expect(route.request().postDataJSON()).toEqual({key});return route.fulfill({json:{stage:"failed",campaignId:id,error:"Native sender is unavailable."}});});
  await page.goto(`/outreach/new?operation=${key}`);
  await expect(page.getByRole("alert").filter({hasText:"Native sender is unavailable."})).toBeVisible();
  await page.reload();
  await expect(page.getByRole("alert").filter({hasText:"Native sender is unavailable."})).toBeVisible();
  expect(calls).toBe(2);
});
test("real protected APIs reject unauthenticated and foreign-origin writes; logout revokes session",async({request})=>{
  for(const path of ["/api/auth/session","/api/ai-video/jobs","/api/clipper/overview","/api/outreach/overview"]){expect((await request.get(path)).status()).toBe(401);}
  expect((await request.get("/settings",{maxRedirects:0})).status()).toBe(307);
  expect((await request.post("/api/auth/login",{headers:{Origin:"http://127.0.0.1:3101"},data:{password}})).status()).toBe(200);
  expect((await request.get("/api/auth/session")).status()).toBe(200);
  for(const path of ["/api/ai-video/jobs","/api/outreach/draft","/api/outreach/send-campaign",`/api/outreach/campaigns/${id}/confirm`])expect((await request.post(path,{headers:{Origin:"http://foreign.invalid"},data:{}})).status()).toBe(403);
  expect((await request.post("/api/auth/logout",{headers:{Origin:"http://127.0.0.1:3101"}})).status()).toBe(200);expect((await request.get("/api/auth/session")).status()).toBe(401);
});


test("campaign pagination and name filtering use the loaded records",async({page})=>{
  await login(page);await mockServices(page);
  await page.route("**/api/outreach/overview",route=>route.fulfill({json:{state:"connected",campaigns:Array.from({length:14},(_,i)=>({...campaign,id:`11111111-1111-4111-8111-${String(i+1).padStart(12,"0")}`,name:`Campaign ${String(i+1).padStart(2,"0")}`}))}}));
  await page.goto("/outreach");await expect(page.getByText("1–6 of 14 campaigns")).toBeVisible();await page.getByRole("button",{name:"Next",exact:true}).click();await expect(page.getByText("7–12 of 14 campaigns")).toBeVisible();await page.getByLabel("Search campaign name").fill("Campaign 14");await expect(page.getByText("1–1 of 1 campaigns")).toBeVisible();await expect(page.getByRole("cell",{name:"Campaign 14 Frozen recipient list"})).toBeVisible();
});
