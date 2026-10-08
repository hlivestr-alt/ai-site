import {pool,query} from '../../src/lib/db';
import type {Session} from '../../src/lib/auth';
import {authorizationCallback} from '../../src/lib/outreach-provider';
import {digest,recordMac,type RouterRecord} from '../../src/lib/outreach-oauth-core';
import pg from 'pg';
async function main(){let input='';for await(const b of process.stdin)input+=b;const v=JSON.parse(input);
 if(!process.env.DATABASE_URL?.includes('/phase_e_')||process.env.DATABASE_URL!==process.env.TEST_DATABASE_URL)throw new Error('OWNED_ROUTER_FIXTURE_REQUIRED');
 let result:unknown={rejected:true};
 try{
  if(v.action==='saas-callback'){
   const r=(await query('SELECT s.id,s.user_id,u.email,u.display_name,s.expires_at,s.active_workspace_id FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.email=$1 AND s.revoked_at IS NULL AND s.expires_at>now() ORDER BY s.created_at DESC LIMIT 1',[v.email])).rows[0];
   if(!r)throw new Error();const session:Session={id:r.id,userId:r.user_id,email:r.email,displayName:r.display_name,expiresAt:r.expires_at,activeWorkspaceId:v.activeWorkspaceId||r.active_workspace_id};
   await authorizationCallback(session,v.state,v.code);result={rejected:false};
  }else if(v.action==='marker-state'){
   const old=digest(v.state),next=digest(v.nextState);
   const r=(await query<RouterRecord>('SELECT * FROM outreach_oauth_router_states WHERE state_hash=$1',[old])).rows[0];
   r.state_hash=next;r.integrity_mac=recordMac(r,process.env.OUTREACH_OAUTH_ROUTER_KEY!);
   if(r.flow_kind==='NATIVE'){
    const n=new pg.Client({connectionString:process.env.F1_NATIVE_DATABASE_URL});try{await n.connect();await n.query('UPDATE "TikTokAuthorizationState" SET "stateHash"=$1 WHERE "stateHash"=$2',[next,old]);}finally{await n.end();}
    await query('UPDATE outreach_oauth_router_states SET state_hash=$1,integrity_mac=$2 WHERE state_hash=$3',[next,r.integrity_mac,old]);
   }else{
    const {transaction}=await import('../../src/lib/db');await transaction(async d=>{
     const columns=(await d.query('SELECT * FROM outreach_oauth_router_states WHERE state_hash=$1',[old])).rows[0];
     await d.query('DELETE FROM outreach_oauth_router_states WHERE state_hash=$1',[old]);await d.query('UPDATE outreach_oauth_states SET state_hash=$1 WHERE state_hash=$2',[next,old]);await d.query('UPDATE outreach_channels SET authorization_state_hash=$1 WHERE id=$2',[next,r.channel_id]);
     Object.assign(columns,{state_hash:next,saas_state_hash:next,integrity_mac:r.integrity_mac});
     const names=Object.keys(columns);await d.query('INSERT INTO outreach_oauth_router_states('+names.join(',')+') VALUES('+names.map((_,i)=>'$'+(i+1)).join(',')+')',names.map(k=>columns[k]));
    });
   }result={rewritten:true};
  }else if(v.action==='expire'){
   const r=(await query<RouterRecord>('SELECT * FROM outreach_oauth_router_states WHERE state_hash=$1',[digest(v.state)])).rows[0];r.created_at=new Date(Date.now()-120000);r.expires_at=new Date(Date.now()-60000);r.integrity_mac=recordMac(r,process.env.OUTREACH_OAUTH_ROUTER_KEY!);await query('UPDATE outreach_oauth_router_states SET created_at=$1,expires_at=$2,integrity_mac=$3 WHERE state_hash=$4',[r.created_at,r.expires_at,r.integrity_mac,r.state_hash]);result={expired:true};
  }
 }catch{result={rejected:true};}finally{await pool().end();}
 console.log(JSON.stringify(result));
}
void main().catch(()=>{console.log(JSON.stringify({rejected:true}));process.exitCode=1;});
