import {randomUUID} from 'node:crypto';
import {query} from './db';
import {operationalLog} from './operational-logging';
import {boundedSetting} from './operational-config';
export type ServiceName='execution_dispatcher'|'workflow_dispatcher';
export function serviceMonitor(service:ServiceName){
  const instanceId=randomUUID();let subservices:Record<string,{lastSuccessAt:string;processed:number}>={};
  return {
    async beat(status:'STARTING'|'RUNNING'|'ERROR'|'STOPPED',errorCode:string|null=null){await query(`INSERT INTO service_heartbeats(service,instance_id,status,error_code,subservices,last_success_at,stopped_at) VALUES($1,$2,$3,$4,$5::jsonb,CASE WHEN $3='RUNNING' THEN now() END,CASE WHEN $3='STOPPED' THEN now() END)
      ON CONFLICT(service,instance_id) DO UPDATE SET status=$3,error_code=$4,subservices=$5::jsonb,last_tick_at=now(),last_success_at=CASE WHEN $3='RUNNING' THEN now() ELSE service_heartbeats.last_success_at END,stopped_at=CASE WHEN $3='STOPPED' THEN now() END`,[service,instanceId,status,errorCode,JSON.stringify(subservices)]);},
    success(name:string,processed:number){subservices={...subservices,[name]:{lastSuccessAt:new Date().toISOString(),processed}};},
    log(event:string,data:Record<string,string|number|boolean|null>={}){operationalLog(service,event,{instanceId,...data});},
  };
}
export async function serviceFreshness(){const stale=boundedSetting('SERVICE_STALE_SECONDS',180,10,3600),rows=(await query<{service:ServiceName;status:string;last_tick_at:Date;last_success_at:Date|null;subservices:Record<string,unknown>}>("SELECT DISTINCT ON(service) service,status,last_tick_at,last_success_at,subservices FROM service_heartbeats ORDER BY service,(status='RUNNING' AND last_tick_at>now()-make_interval(secs=>$1)) DESC,last_tick_at DESC",[stale])).rows;return ['execution_dispatcher','workflow_dispatcher'].map(service=>{const r=rows.find(r=>r.service===service);return {service,status:!r?'UNKNOWN':r.status==='STOPPED'?'OFFLINE':Date.now()-r.last_tick_at.getTime()>stale*1000?'STALE':r.status==='ERROR'?'ERROR':!r.last_success_at?'STALE':'HEALTHY',lastTickAt:r?.last_tick_at||null,lastSuccessAt:r?.last_success_at||null,subservices:r?.subservices||{}};});}
