import {workflowBatch} from '../src/lib/workflow-core';
import {runService} from '../src/lib/service-runner';
void runService('workflow_dispatcher',[{name:'reconciled',maximum:25,run:workflowBatch}],'WORKFLOW_POLL_MS').catch(()=>{console.error(JSON.stringify({service:'workflow_dispatcher',event:'STARTUP_FAILED'}));process.exitCode=1;});
