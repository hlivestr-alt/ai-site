import {pool} from './db';
import {assertRuntimeConfiguration,boundedSetting} from './operational-config';
import {serviceMonitor,type ServiceName} from './service-state';
export type ServiceStage={name:string;maximum:number;run:(limit:number)=>Promise<number>;runBatch?:(limit:number,stopping:()=>boolean)=>Promise<number>};
export async function runService(service:ServiceName,stages:ServiceStage[],pollSetting:string){
  assertRuntimeConfiguration();
  const monitor=serviceMonitor(service),once=process.argv.includes('--once'),poll=boundedSetting(pollSetting,1000,200,30000);
  let stopping=false,wake:undefined|(()=>void);
  const stop=()=>{stopping=true;wake?.();};
  process.on('SIGINT',stop);process.on('SIGTERM',stop);
  const message=(m:unknown)=>{if(m&&typeof m==='object'&&'command' in m&&m.command==='stop')stop();};process.on('message',message);
  try{
    await monitor.beat('STARTING');monitor.log('STARTED');
    do{
      let failed=false;const counts:Record<string,number>={};
      for(const stage of stages){
        if(stopping)break;
        try{
          const maximum=boundedSetting(`BATCH_${stage.name.toUpperCase()}`,stage.maximum,1,100);let processed=0;
          // Check the stop flag between claims; each admitted claim completes its transaction.
          if(stage.runBatch)processed=await stage.runBatch(maximum,()=>stopping);
          else for(let index=0;index<maximum&&!stopping;index++){const n=await stage.run(1);processed+=n;if(!n)break;}
          counts[stage.name]=processed;monitor.success(stage.name,processed);
          await monitor.beat(failed?'ERROR':'RUNNING',failed?'SUBSERVICE_FAILED':null);
        }catch{failed=true;monitor.log('SUBSERVICE_FAILED',{stage:stage.name});await monitor.beat('ERROR','SUBSERVICE_FAILED').catch(()=>{});}
      }
      if(once)console.log(JSON.stringify({event:`${service}_tick`,...counts}));
      else if(Object.values(counts).some(Boolean))monitor.log('TICK',counts);
      if(failed&&once)process.exitCode=1;
      if(!once&&!stopping)await new Promise<void>(resolve=>{const timer=setTimeout(()=>{wake=undefined;resolve();},poll);wake=()=>{clearTimeout(timer);wake=undefined;resolve();};});
    }while(!once&&!stopping);
  }finally{await monitor.beat('STOPPED').catch(()=>{});monitor.log('STOPPED');process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('message',message);if(process.connected)process.disconnect();await pool().end();}
}
