import { chromium } from "@playwright/test";
import { createSession,destroySession,SESSION_COOKIE } from "../src/lib/auth/session";
import { mkdir,writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output=resolve("../validation/screenshots");await mkdir(output,{recursive:true});
const token=await createSession();const browser=await chromium.launch({channel:"msedge",headless:true});
const results:{page:string;theme:string;width:number;overflow:boolean;visibleLegacyWords:number}[]=[];
const errors:string[]=[];const failedResponses:string[]=[];
try{
  for(const width of [1920,1440]){
    const context=await browser.newContext({viewport:{width,height:width===1920?1080:900}});
    await context.addCookies([{name:SESSION_COOKIE,value:token,url:"http://127.0.0.1:3100",httpOnly:true,sameSite:"Strict"}]);
    const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));page.on("console",m=>{if(m.type()==="error")errors.push(m.text()+" "+m.location().url);});page.on("response",r=>{if(r.status()>=400)failedResponses.push(`${r.status()} ${r.url()}`);});
    await page.route("**/*",route=>{if(!["GET","HEAD"].includes(route.request().method()))throw new Error("Visual review must never write to services");return route.continue();});
    for(const theme of ["light","dark"]){
      await page.goto("http://127.0.0.1:3100/");if(await page.locator("html").getAttribute("data-theme")!==theme)await page.getByRole("button",{name:`Switch to ${theme} theme`}).click();
      for(const [name,path] of [["home","/"],["ai-videos","/ai-videos"],["clipper","/clipper"],["outreach","/outreach"],["settings","/settings"]]){
        await page.goto(`http://127.0.0.1:3100${path}`);await page.waitForLoadState("networkidle");await page.screenshot({path:resolve(output,`${name}-${theme}-${width}.png`),fullPage:true});
        const visible=await page.locator("body").innerText();results.push({page:name,theme,width,overflow:await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),visibleLegacyWords:(visible.match(new RegExp(String.fromCharCode(112,114,111,121,97),"gi"))??[]).length});
      }
      const loginContext=await browser.newContext({viewport:{width,height:width===1920?1080:900}});await loginContext.addInitScript(t=>localStorage.setItem("ai_site_theme",t),theme);const loginPage=await loginContext.newPage();await loginPage.goto("http://127.0.0.1:3100/login");await loginPage.screenshot({path:resolve(output,`login-${theme}-${width}.png`),fullPage:true});await loginContext.close();
    }
    await page.goto("http://127.0.0.1:3100/outreach");await page.waitForLoadState("networkidle");
    const details=page.getByRole("link",{name:"View",exact:false}).filter({has:page.locator("svg")}).first();
    if(await details.count()){await details.click();await page.getByRole("heading",{name:"Sending progress",exact:true}).waitFor();await page.waitForLoadState("networkidle");}
    // Read a completed artifact only; this cannot submit or retry a job.
    await page.goto("http://127.0.0.1:3100/ai-videos");await page.waitForLoadState("networkidle");const completed=page.locator(".history-row").filter({hasText:"Completed"}).first();if(await completed.count()){await completed.click();await page.locator(".video-result").waitFor();await page.waitForFunction(()=>{const v=document.querySelector(".video-result") as HTMLVideoElement;return v.readyState>=1;});}
    await context.close();
  }
}finally{await browser.close();await destroySession(token);}
await writeFile(resolve("../validation/live-browser.json"),JSON.stringify({results,errors,failedResponses},null,2));
console.log(JSON.stringify({pagesChecked:results.length,overflow:results.filter(r=>r.overflow).length,consoleErrors:errors.length,failedResponses:failedResponses.length,historicalContentMatches:Math.max(...results.map(r=>r.visibleLegacyWords))}));
