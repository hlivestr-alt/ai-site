import {dispatchBatch,reconcileBatch} from '../src/lib/job-core';
import {providerBatch,reserveProviderBatch} from '../src/lib/provider-core';
import {contentPublicationBatch} from '../src/lib/content-publication';
import {contentPosterBatch} from '../src/lib/content-posters';
import {settlementBatch} from '../src/lib/billing-core';
import {paymentReconcileBatch} from '../src/lib/payments-core';
import {mailDeliveryBatch} from '../src/lib/mail-core';
import {runService} from '../src/lib/service-runner';
void runService('execution_dispatcher',[
  {name:'reconciled',maximum:25,run:reconcileBatch},{name:'dispatched',maximum:25,run:dispatchBatch},
  {name:'providerReserved',maximum:10,run:reserveProviderBatch},{name:'providerActions',maximum:20,run:providerBatch},
  {name:'tokensSettled',maximum:25,run:settlementBatch},{name:'paymentsReconciled',maximum:10,run:paymentReconcileBatch,runBatch:paymentReconcileBatch},
  {name:'contentPublished',maximum:10,run:contentPublicationBatch},{name:'postersCreated',maximum:2,run:contentPosterBatch},
  {name:'mailDelivered',maximum:5,run:mailDeliveryBatch},
],'DISPATCHER_POLL_MS').catch(()=>{console.error(JSON.stringify({service:'execution_dispatcher',event:'STARTUP_FAILED'}));process.exitCode=1;});
