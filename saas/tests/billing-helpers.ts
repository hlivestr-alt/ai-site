import {execFileSync} from "node:child_process";
import type {APIRequestContext} from "@playwright/test";
export function fundFixture(ws:string,amount="100000"){execFileSync(process.execPath,["--env-file=.env.local","tests/fund-fixture.mjs",ws,amount],{cwd:process.cwd(),env:process.env,stdio:"pipe",windowsHide:true});}
export async function paidPost(c:APIRequestContext,ws:string,operation:"AI_VIDEO"|"CLIPPER",data:Record<string,unknown>){const q=await c.post(`/api/workspaces/${ws}/billing/quotes`,{data:{...data,operation}});if(!q.ok())return q;const {quote}=await q.json();return c.post(`/api/workspaces/${ws}/${operation==="AI_VIDEO"?"ai-videos":"clipper"}`,{data:{...data,quoteId:quote.id,quoteHash:quote.quoteHash}});}
