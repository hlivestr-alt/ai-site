import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

async function localLink(to:string,subject:string){const folder=join(process.cwd(),"data","mailbox");for(let attempt=0;attempt<50;attempt++){const files=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();for(const file of files){const item=JSON.parse(await readFile(join(folder,file),"utf8"));if(item.to===to&&item.subject.includes(subject))return item.url as string;}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error(`Missing local link: ${to}`);}
async function signUp(page:import("@playwright/test").Page,email:string,name:string){await page.goto("/register");await page.getByLabel("Email address").fill(email);await page.getByLabel("Your name").fill(name);await page.getByLabel("Password").fill("ValidPassword123!");await page.getByRole("button",{name:/Create account/}).click();await page.goto(await localLink(email,"Verify"));await page.getByRole("button",{name:/Verify email/}).click();}

test("real product wizard, private references, versions and tenant-limited viewing",async({page,browser})=>{
  test.setTimeout(180_000);
  const tag=Date.now();const owner=`p2-ui-a-${tag}@example.test`,bEmail=`p2-ui-b-${tag}@example.test`,viewerEmail=`p2-ui-view-${tag}@example.test`;
  const image=await sharp({create:{width:96,height:96,channels:3,background:"#ec6849"}}).png().toBuffer();
  await signUp(page,owner,"Product UI Owner");
  await page.getByLabel("Workspace name").fill(`P2 UI Brand ${tag}`);await page.getByRole("button",{name:/Create workspace/}).click();
  await page.getByRole("link",{name:/Add product/}).click();
  await page.getByLabel("Brand").fill("Customer Brand");await page.getByLabel("Product name").fill("Reference Cream");await page.getByLabel("Category").fill("Skincare");await page.getByLabel(/SKU/).fill("UI-REF-01");
  await page.getByLabel("Short description").fill("First description");await page.getByLabel(/Key selling points/).fill("Hydrating feel\nSimple routine");await page.getByLabel("Target audience").fill("Adults");
  await page.getByRole("button",{name:/Continue to assets/}).click();
  await expect(page.getByRole("heading",{name:"Product assets"})).toBeVisible();
  const productId=new URL(page.url()).pathname.split("/")[2];
  const ws=(await (await page.request.get("/api/auth/session")).json()).currentWorkspace.id as string;
  for(const purpose of ["FRONT","BACK","CAP_PUMP","USAGE_IMAGE"]){
    await page.getByLabel("Reference purpose").selectOption(purpose);
    await page.getByLabel("File").setInputFiles({name:`${purpose.toLowerCase()}.png`,mimeType:"image/png",buffer:image});
    await page.getByLabel(/I confirm I have permission/).check();
    await page.getByRole("button",{name:"Upload reference"}).click();
    await expect(page.getByRole("status")).toContainText("uploaded and verified");
  }
  await expect(page.locator(".asset-card")).toHaveCount(4);
  await page.getByRole("button",{name:/Continue to rules/}).click();
  await page.getByLabel("Keep logo").uncheck();
  await page.getByLabel("Additional instructions").fill("Keep the label legible.");
  await page.getByRole("button",{name:/Save product/}).click();
  await expect(page.getByRole("heading",{name:"Reference Cream"})).toBeVisible();
  await expect(page.getByText("ACTIVE",{exact:true})).toBeVisible();
  await expect(page.locator(".asset-card")).toHaveCount(4);
  await page.goto("/");await expect(page.locator(".stat-card").nth(0).locator("strong")).toHaveText("1");await expect(page.locator(".stat-card").nth(1).locator("strong")).toHaveText("4");
  await page.goto("/products");await expect(page.getByRole("heading",{name:"Reference Cream"})).toBeVisible();
  await page.getByRole("link",{name:/Reference Cream/}).click();await expect(page).toHaveURL(new RegExp(`/products/${productId}$`));await page.reload();
  await expect(page.getByText("First description")).toBeVisible();
  await page.getByRole("link",{name:"Edit product"}).click();
  await page.getByLabel("Short description").fill("Edited description");await page.getByRole("button",{name:/Continue to assets/}).click();
  await page.getByRole("button",{name:/Continue to rules/}).click();await page.getByRole("button",{name:/Save changes/}).click();
  await expect(page.getByText("Edited description")).toBeVisible();await expect(page.getByText("Version 2").first()).toBeVisible();
  await page.getByRole("link",{name:"Manage assets"}).click();
  const detail=await (await page.request.get(`/api/workspaces/${ws}/products/${productId}`)).json();
  const front=detail.assets.find((x:{purpose:string})=>x.purpose==="FRONT");
  await page.getByLabel(/Replace existing asset/).selectOption(front.id);
  await page.getByLabel("File").setInputFiles({name:"new-front.png",mimeType:"image/png",buffer:image});
  await page.getByLabel(/I confirm I have permission/).check();
  await page.getByRole("button",{name:"Upload reference"}).click();
  await expect(page.getByRole("status")).toContainText("uploaded and verified");
  await page.getByRole("link",{name:"Product detail"}).click();
  await expect(page).toHaveURL(new RegExp(`/products/${productId}$`));
  await expect(page.locator(".asset-card strong").filter({hasText:"new-front.png"})).toBeVisible();
  await page.getByRole("link",{name:"Manage rules"}).click();
  await page.getByLabel("Keep packaging text").uncheck();await page.getByRole("button",{name:/Save changes/}).click();
  await expect(page.getByRole("heading",{name:/Current rules · v3/})).toBeVisible();
  await page.screenshot({path:"test-results/phase2-product-detail.png",fullPage:true});

  await page.goto("/products/new");await page.getByLabel("Brand").fill("Customer Brand");await page.getByLabel("Product name").fill("Archive Me");await page.getByLabel("Category").fill("Care");
  await page.getByRole("button",{name:"Save draft"}).click();await expect(page.getByRole("heading",{name:"Archive Me"})).toBeVisible();
  page.once("dialog",dialog=>void dialog.accept());await page.getByRole("button",{name:"Archive"}).click();
  await expect(page).toHaveURL(/\/products$/);
  await expect(page.getByRole("heading",{name:"Archive Me"})).toHaveCount(0);

  const bContext=await browser.newContext();const b=await bContext.newPage();
  try{await signUp(b,bEmail,"Product Brand B");await b.getByLabel("Workspace name").fill(`Other P2 ${tag}`);await b.getByRole("button",{name:/Create workspace/}).click();
    await expect(b.locator(".stat-card").nth(0).locator("strong")).toHaveText("0");await expect(b.locator(".stat-card").nth(1).locator("strong")).toHaveText("0");
    const bSession=await (await b.request.get("/api/auth/session")).json();expect(bSession.user.email).toBe(bEmail);
    await b.goto(`/products/${productId}`);await expect(b.getByRole("heading",{name:"Reference Cream"})).toHaveCount(0);
    const deniedApi=await b.request.get(`/api/workspaces/${ws}/products/${productId}`);expect([403,404]).toContain(deniedApi.status());
    const deniedMedia=await b.request.get(`/api/workspaces/${ws}/products/${productId}/assets/${front.id}/download`);expect([403,404]).toContain(deniedMedia.status());
  }finally{await bContext.close();}

  const invite=await page.request.post(`/api/workspaces/${ws}/invitations`,{headers:{Origin:(process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200")},data:{email:viewerEmail,role:"VIEWER"}});expect(invite.status()).toBe(201);
  const viewContext=await browser.newContext();const viewer=await viewContext.newPage();
  try{await viewer.goto(await localLink(viewerEmail,"Invitation"));await viewer.getByRole("link",{name:"Create account"}).click();await viewer.getByLabel("Email address").fill(viewerEmail);await viewer.getByLabel("Your name").fill("Product Viewer");await viewer.getByLabel("Password").fill("ValidPassword123!");await viewer.getByRole("button",{name:/Create account/}).click();await viewer.goto(await localLink(viewerEmail,"Verify"));await viewer.getByRole("button",{name:/Verify email/}).click();await expect(viewer.getByRole("heading",{name:/Join P2 UI Brand/})).toBeVisible();await viewer.getByRole("button",{name:/Join workspace/}).click();await expect(viewer.getByRole("heading",{name:/Welcome to P2 UI Brand/})).toBeVisible();
    await viewer.goto(`/products/${productId}`);await expect(viewer.getByRole("heading",{name:"Reference Cream"})).toBeVisible();await expect(viewer.getByRole("link",{name:"Edit product"})).toHaveCount(0);
    const patch=await viewer.request.patch(`/api/workspaces/${ws}/products/${productId}`,{headers:{Origin:(process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200")},data:{}});expect(patch.status()).toBe(403);
  }finally{await viewContext.close();}
});
