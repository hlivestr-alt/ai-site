import { test, expect, request, type APIRequestContext } from "@playwright/test";
import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {randomUUID} from 'node:crypto';

const base=(process.env.SAAS_TEST_BASE_URL||"http://127.0.0.1:3200");
const password="ValidPassword123!";
type Mail={to:string;subject:string;url:string};
async function mail(to:string,subject:string,excludeToken?:string):Promise<Mail> {
  const folder=join(process.cwd(),"data","mailbox");
  for(let attempt=0;attempt<40;attempt++) {
    const names=(await readdir(folder).catch(()=>[])).filter(x=>x.endsWith(".json")).sort().reverse();
    for(const name of names) { const item=JSON.parse(await readFile(join(folder,name),"utf8")) as Mail; if(item.to===to&&item.subject.includes(subject)&&(!excludeToken||new URL(item.url).searchParams.get('token')!==excludeToken))return item; }
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`No local mail for ${to}: ${subject}`);
}
async function context(){return request.newContext({baseURL:base,extraHTTPHeaders:{Origin:base}});}
async function post(client:APIRequestContext,path:string,data:Record<string,unknown>={}){return client.post(path,{data});}
async function register(client:APIRequestContext,email:string,name:string){
  expect((await post(client,"/api/auth/register",{email,displayName:name,password})).status()).toBe(201);
  const token=new URL((await mail(email,"Verify")).url).searchParams.get("token");
  expect(token).toBeTruthy();
  expect((await post(client,"/api/auth/verify",{token})).status()).toBe(200);
}
async function workspace(client:APIRequestContext,name:string){const r=await post(client,"/api/workspaces",{name});expect(r.status()).toBe(201);return (await r.json()).workspace.id as string;}

test("identity, workspaces, roles, invitations, isolation, recovery and audit",async()=>{
  const stamp=`${Date.now()}-${Math.round(Math.random()*1e6)}`;
  const aEmail=`brand-a-${stamp}@example.test`, bEmail=`brand-b-${stamp}@example.test`, editorEmail=`editor-${stamp}@example.test`, viewerEmail=`viewer-${stamp}@example.test`;
  const a=await context(),b=await context(),editor=await context(),viewer=await context();
  const db=new pg.Client({connectionString:process.env.TEST_DATABASE_URL});await db.connect();
  try {
    await register(a,aEmail,"Brand A Owner");
    expect((await post(a,"/api/auth/register",{email:aEmail,displayName:"Duplicate",password})).status()).toBe(201);
    const aWs=await workspace(a,"Brand A");
    expect(aWs).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    const aSession=await (await a.get("/api/auth/session")).json();
    expect(aSession.currentWorkspace.id).toBe(aWs);
    expect(aSession.currentWorkspace.role).toBe("OWNER");
    const initialWorkspace=await a.get(`/api/workspaces/${aWs}`);
    expect(initialWorkspace.status(),await initialWorkspace.text()).toBe(200);
    const initialMembers=await a.get(`/api/workspaces/${aWs}/members`);
    expect(initialMembers.status(),await initialMembers.text()).toBe(200);

    await register(b,bEmail,"Brand B Owner");
    const bWs=await workspace(b,"Brand B");
    const bMembers=await (await b.get(`/api/workspaces/${bWs}/members`)).json();
    const bMemberId=bMembers.members[0].id as string;

    const inviteResponse=await post(a,`/api/workspaces/${aWs}/invitations`,{email:editorEmail,role:"EDITOR"});
    expect(inviteResponse.status()).toBe(201);
    const inviteId=(await inviteResponse.json()).invitation.id as string;
    const token=new URL((await mail(editorEmail,"Invitation")).url).searchParams.get("token")!;
    expect((await post(a,`/api/workspaces/${aWs}/invitations`,{email:editorEmail,role:"VIEWER"})).status()).toBe(409);
    await register(editor,editorEmail,"Brand A Editor");
    const accepted=await post(editor,`/api/invitations/${token}/accept`,{role:"OWNER",workspaceId:bWs});
    expect(accepted.status()).toBe(200);
    expect((await post(editor,`/api/invitations/${token}/accept`)).status()).toBe(200);
    expect((await editor.get(`/api/workspaces/${aWs}`)).status()).toBe(200);
    expect((await (await editor.get(`/api/workspaces/${aWs}`)).json()).workspace.role).toBe("EDITOR");
    expect((await post(editor,`/api/workspaces/${aWs}/invitations`,{email:viewerEmail,role:"VIEWER"})).status()).toBe(403);
    const editorMember=(await (await a.get(`/api/workspaces/${aWs}/members`)).json()).members.find((m:{email:string})=>m.email===editorEmail);
    expect((await editor.patch(`/api/workspaces/${aWs}/members/${editorMember.id}`,{data:{role:"OWNER"}})).status()).toBe(403);
    expect((await a.patch(`/api/workspaces/${aWs}/members/${editorMember.id}`,{data:{role:"VIEWER"}})).status()).toBe(200);
    expect((await post(editor,`/api/workspaces/${aWs}/invitations`,{email:viewerEmail,role:"VIEWER"})).status()).toBe(403);

    const viewerInvite=await post(a,`/api/workspaces/${aWs}/invitations`,{email:viewerEmail,role:"VIEWER"});expect(viewerInvite.status()).toBe(201);
    const viewerToken=new URL((await mail(viewerEmail,"Invitation")).url).searchParams.get("token")!;
    expect((await post(b,`/api/invitations/${viewerToken}/accept`)).status()).toBe(403);
    await register(viewer,viewerEmail,"Brand A Viewer");
    expect((await post(viewer,`/api/invitations/${viewerToken}/accept`)).status()).toBe(200);
    expect((await viewer.patch(`/api/workspaces/${aWs}`,{data:{name:"Illegal"}})).status()).toBe(403);
    expect((await viewer.get(`/api/workspaces/${aWs}/audit`)).status()).toBe(403);
    expect((await post(b,`/api/invitations/${token}/accept`)).status()).toBe(403);

    // Replacing either the parent workspace ID or nested object ID must never reveal or change Brand B.
    for(const response of [
      await a.get(`/api/workspaces/${bWs}`),await a.get(`/api/workspaces/${bWs}/members`),await a.get(`/api/workspaces/${bWs}/invitations`),await a.get(`/api/workspaces/${bWs}/audit`),
      await a.patch(`/api/workspaces/${bWs}`,{data:{name:"Compromised"}}),
      await post(a,`/api/workspaces/${bWs}/select`),
      await post(a,`/api/workspaces/${bWs}/invitations`,{email:"intruder@example.test",role:"ADMIN"}),
      await a.patch(`/api/workspaces/${aWs}/members/${bMemberId}`,{data:{role:"VIEWER"}}),
      await a.delete(`/api/workspaces/${aWs}/members/${bMemberId}`),
      await a.get(`/api/workspaces/${aWs}/invitations/${randomUUID()}`),
      await a.get(`/api/workspaces/${bWs}/invitations/${inviteId}`),
      await a.delete(`/api/workspaces/${bWs}/invitations/${inviteId}`),
    ]) expect([403,404]).toContain(response.status());
    expect((await (await b.get(`/api/workspaces/${bWs}`)).json()).workspace.name).toBe("Brand B");
    expect((await (await a.get(`/api/workspaces/${aWs}/members`)).json()).members.length).toBe(3);
    expect((await (await b.get(`/api/workspaces/${bWs}/members`)).json()).members.length).toBe(1);
    const viewerMember=(await (await a.get(`/api/workspaces/${aWs}/members`)).json()).members.find((m:{email:string})=>m.email===viewerEmail);
    await db.query("UPDATE workspace_members SET status='REMOVED' WHERE id=$1",[viewerMember.id]);
    expect((await viewer.get(`/api/workspaces/${aWs}`)).status()).toBe(404);
    expect((await post(viewer,`/api/workspaces/${aWs}/select`)).status()).toBe(404);

    // Add a legitimate second membership, then switch the active workspace.
    const crossInvite=await post(b,`/api/workspaces/${bWs}/invitations`,{email:aEmail,role:"VIEWER"});expect(crossInvite.status()).toBe(201);
    const crossToken=new URL((await mail(aEmail,"Invitation to Brand B")).url).searchParams.get("token")!;
    expect((await post(a,`/api/invitations/${crossToken}/accept`)).status()).toBe(200);
    expect((await post(a,`/api/workspaces/${aWs}/select`)).status()).toBe(200);
    expect((await (await a.get("/api/auth/session")).json()).currentWorkspace.id).toBe(aWs);
    expect((await post(a,`/api/workspaces/${bWs}/select`)).status()).toBe(200);
    expect((await (await a.get("/api/auth/session")).json()).currentWorkspace.id).toBe(bWs);
    expect((await a.patch(`/api/workspaces/${bWs}`,{data:{name:"Still Brand B"}})).status()).toBe(403);

    // Owner protection and Admin restrictions.
    const aOwnerId=(await (await a.get(`/api/workspaces/${aWs}/members`)).json()).members.find((m:{email:string})=>m.email===aEmail).id;
    expect((await a.delete(`/api/workspaces/${aWs}/members/${aOwnerId}`)).status()).toBe(409);
    expect((await a.patch(`/api/workspaces/${aWs}/members/${aOwnerId}`,{data:{role:"ADMIN"}})).status()).toBe(409);
    expect((await a.patch(`/api/workspaces/${aWs}/members/${editorMember.id}`,{data:{role:"ADMIN"}})).status()).toBe(200);
    expect((await editor.patch(`/api/workspaces/${aWs}/members/${editorMember.id}`,{data:{role:"OWNER"}})).status()).toBe(403);
    expect((await editor.delete(`/api/workspaces/${aWs}/members/${aOwnerId}`)).status()).toBe(403);
    expect((await post(editor,`/api/workspaces/${aWs}/invitations`,{email:`new-${stamp}@example.test`,role:"OWNER"})).status()).toBe(403);
    const adminInvite=await post(editor,`/api/workspaces/${aWs}/invitations`,{email:`admin-viewer-${stamp}@example.test`,role:"VIEWER"});
    expect(adminInvite.status()).toBe(201);
    expect((await editor.delete(`/api/workspaces/${aWs}/invitations/${(await adminInvite.json()).invitation.id}`)).status()).toBe(200);

    // Expired invitation and recovery token, single use, session revocation.
    const expiredEmail=`expired-${stamp}@example.test`;
    expect((await post(a,`/api/workspaces/${aWs}/invitations`,{email:expiredEmail,role:"VIEWER"})).status()).toBe(201);
    const expiredToken=new URL((await mail(expiredEmail,"Invitation")).url).searchParams.get("token")!;
    await db.query("UPDATE workspace_invitations SET expires_at=now()-interval '1 minute' WHERE email=$1",[expiredEmail]);
    expect((await b.get(`/api/invitations/${expiredToken}`)).status()).toBe(404);
    const expiredUser=await context();
    try {await register(expiredUser,expiredEmail,"Expired Invitee");expect((await post(expiredUser,`/api/invitations/${expiredToken}/accept`)).status()).toBe(410);} finally {await expiredUser.dispose();}
    expect((await post(a,"/api/auth/forgot-password",{email:aEmail})).status()).toBe(200);
    const resetToken=new URL((await mail(aEmail,"Reset")).url).searchParams.get("token")!;
    await db.query("UPDATE auth_tokens SET expires_at=now()-interval '1 minute' WHERE user_id=(SELECT id FROM users WHERE email=$1) AND kind='RESET_PASSWORD'",[aEmail]);
    expect((await post(a,"/api/auth/reset-password",{token:resetToken,password:"NewValidPassword456!"})).status()).toBe(400);
    expect((await post(a,"/api/auth/forgot-password",{email:aEmail})).status()).toBe(200);
    const resetToken2=new URL((await mail(aEmail,"Reset",resetToken)).url).searchParams.get("token")!;
    expect((await post(a,"/api/auth/reset-password",{token:resetToken2,password:"NewValidPassword456!"})).status()).toBe(200);
    expect((await post(a,"/api/auth/reset-password",{token:resetToken2,password:"NewValidPassword456!"})).status()).toBe(400);
    expect((await a.get("/api/auth/session")).status()).toBe(401);
    expect((await post(a,"/api/auth/login",{email:aEmail,password})).status()).toBe(401);
    expect((await post(a,"/api/auth/login",{email:aEmail,password:"NewValidPassword456!"})).status()).toBe(200);
    const liveSession=await (await a.get("/api/auth/session")).json();
    await db.query("UPDATE sessions SET expires_at=now()-interval '1 minute' WHERE user_id=$1 AND revoked_at IS NULL",[liveSession.user.id]);
    expect((await a.get("/api/auth/session")).status()).toBe(401);
    expect((await post(a,"/api/auth/login",{email:aEmail,password:"NewValidPassword456!"})).status()).toBe(200);
    expect((await post(a,"/api/auth/logout")).status()).toBe(200);
    expect((await a.get("/api/auth/session")).status()).toBe(401);

    const audit=await db.query("SELECT event_type,safe_metadata FROM audit_events WHERE actor_user_id=(SELECT id FROM users WHERE email=$1)",[aEmail]);
    for(const event of ["USER_REGISTERED","EMAIL_VERIFIED","USER_LOGIN","USER_LOGOUT","WORKSPACE_CREATED","INVITATION_CREATED","MEMBER_ROLE_CHANGED","PASSWORD_RESET"]) expect(audit.rows.some(row=>row.event_type===event)).toBeTruthy();
    const serialized=JSON.stringify(audit.rows);
    expect(serialized).not.toContain(password);
    expect(serialized).not.toContain(resetToken2);
    expect(serialized).not.toContain(token);
  } finally {await Promise.all([a.dispose(),b.dispose(),editor.dispose(),viewer.dispose()]);await db.end();}
});
