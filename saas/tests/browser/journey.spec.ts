import { test, expect } from "@playwright/test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function localLink(to:string,subject:string):Promise<string>{
  const folder=join(process.cwd(),"data","mailbox");
  for(let attempt=0;attempt<50;attempt++){
    const files=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();
    for(const file of files){const mail=JSON.parse(await readFile(join(folder,file),"utf8"));if(mail.to===to&&mail.subject.includes(subject))return mail.url;}
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`No development link for ${to}`);
}

test("customer registration to shared workspace, role controls and sign-out",async({page,browser})=>{
  const stamp=Date.now();
  const owner=`ui-owner-${stamp}@example.test`, teammate=`ui-editor-${stamp}@example.test`;
  await page.goto("/register");
  await expect(page.getByRole("heading",{name:"Create your account"})).toBeVisible();
  await page.getByLabel("Email address").fill(owner);
  await page.getByLabel("Your name").fill("UI Owner");
  await page.getByLabel("Password").fill("ValidPassword123!");
  await page.getByRole("button",{name:/Create account/}).click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await page.goto(await localLink(owner,"Verify"));
  await page.getByRole("button",{name:/Verify email/}).click();
  await expect(page.getByRole("heading",{name:/Welcome, UI Owner/})).toBeVisible();
  await page.getByLabel("Workspace name").fill(`UI Brand ${stamp}`);
  await page.getByRole("button",{name:/Create workspace/}).click();
  await expect(page.getByRole("heading",{name:/Welcome to UI Brand/})).toBeVisible();
  await expect(page.getByText("Team members")).toBeVisible();
  await page.screenshot({path:"test-results/phase1-home.png",fullPage:true});
  await page.getByRole("link",{name:/Settings/}).click();
  await expect(page.getByRole("heading",{name:"Team & roles"})).toBeVisible();
  await page.screenshot({path:"test-results/phase1-settings.png",fullPage:true});
  await page.getByLabel("Email address").fill(teammate);
  await page.getByRole("button",{name:/Send invitation/}).click();
  await expect(page.getByText(teammate).first()).toBeVisible();
  const aSession=await (await page.request.get("/api/auth/session")).json();
  const aWs=aSession.currentWorkspace.id as string;
  const aMember=(await (await page.request.get(`/api/workspaces/${aWs}/members`)).json()).members[0].id as string;

  const second=await browser.newContext();
  const peer=await second.newPage();
  try{
    await peer.goto(await localLink(teammate,"Invitation"));
    await expect(peer.getByRole("heading",{name:/Join UI Brand/})).toBeVisible();
    await peer.getByRole("link",{name:"Create account"}).click();
    await peer.getByLabel("Email address").fill(teammate);
    await peer.getByLabel("Your name").fill("UI Editor");
    await peer.getByLabel("Password").fill("ValidPassword123!");
    await peer.getByRole("button",{name:/Create account/}).click();
    await peer.goto(await localLink(teammate,"Verify"));
    await peer.getByRole("button",{name:/Verify email/}).click();
    await expect(peer.getByRole("heading",{name:/Join UI Brand/})).toBeVisible();
    await peer.getByRole("button",{name:/Join workspace/}).click();
    await expect(peer.getByRole("heading",{name:/Welcome to UI Brand/})).toBeVisible();
    await peer.getByRole("link",{name:/Settings/}).click();
    await expect(peer.getByRole("heading",{name:"Team & roles"})).toBeVisible();
    await expect(peer.getByRole("button",{name:/Send invitation/})).toHaveCount(0);
    await expect(peer.getByText("editor",{exact:false}).first()).toBeVisible();
  } finally {await second.close();}

  const brandB=`ui-brand-b-${stamp}@example.test`;
  const third=await browser.newContext();
  const bPage=await third.newPage();
  try {
    await bPage.goto("/register");
    await bPage.getByLabel("Email address").fill(brandB);
    await bPage.getByLabel("Your name").fill("UI Brand B");
    await bPage.getByLabel("Password").fill("ValidPassword123!");
    await bPage.getByRole("button",{name:/Create account/}).click();
    await bPage.goto(await localLink(brandB,"Verify"));
    await bPage.getByRole("button",{name:/Verify email/}).click();
    await bPage.getByLabel("Workspace name").fill(`Other Brand ${stamp}`);
    await bPage.getByRole("button",{name:/Create workspace/}).click();
    await expect(bPage.getByRole("heading",{name:/Welcome to Other Brand/})).toBeVisible();
    await bPage.goto(`/api/workspaces/${aWs}`);
    await expect(bPage.locator("body")).toContainText("Workspace not found");
    await bPage.goto(`/api/workspaces/${aWs}/members`);
    await expect(bPage.locator("body")).toContainText("Workspace not found");
    const crossPatch=await bPage.request.patch(`/api/workspaces/${aWs}/members/${aMember}`,{headers:{Origin:"http://127.0.0.1:3200"},data:{role:"VIEWER"}});
    expect([403,404]).toContain(crossPatch.status());
    await bPage.goto("/settings");
    await bPage.getByLabel("Email address").fill(owner);
    await bPage.getByRole("button",{name:/Send invitation/}).click();
    await expect(bPage.getByText(owner).first()).toBeVisible();
    await page.goto(await localLink(owner,"Invitation to Other Brand"));
    await page.getByRole("button",{name:/Join workspace/}).click();
    await expect(page.getByRole("heading",{name:/Welcome to Other Brand/})).toBeVisible();
    await page.getByRole("combobox",{name:"Switch workspace"}).selectOption(aWs);
    await expect(page.getByRole("heading",{name:/Welcome to UI Brand/})).toBeVisible();
  } finally {await third.close();}
  await page.getByRole("button",{name:"Sign out"}).click();
  await expect(page.getByRole("heading",{name:"Welcome back"})).toBeVisible();
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/login$/);
});
