import {test} from 'node:test';
import assert from 'node:assert/strict';
import {customerWorkerStage,customerWorkerFailure,clipperCustomerMessages} from '../../src/lib/worker-messages';
const marker='ECONNREFUSED 127.0.0.1:9999 PostgreSQL RuntimeError Traceback WORKER_TOKEN synthetic-placeholder';
test('worker messages come exclusively from controlled stage/error catalogs',()=>{
  for(const stage of ['TRANSCRIBING','WORKER_TOKEN',marker])assert.ok(!JSON.stringify(customerWorkerStage(stage)).includes('WORKER_TOKEN'));
  assert.equal(customerWorkerFailure('SOURCE_DOWNLOAD_FAILED').retry,true);
  assert.equal(customerWorkerFailure('LOCAL_PROCESS_FAILED').retry,true);
  assert.equal(customerWorkerFailure('WORKER_INTERRUPTED').retry,true);
  assert.equal(customerWorkerFailure('SOURCE_INVALID').retry,false);
  assert.equal(customerWorkerFailure('WORKER_TOKEN').code,'CLIPPER_OPERATION_FAILED');
});
test('legacy persisted diagnostics are not returned in customer Clipper messages',()=>{
  const output=clipperCustomerMessages({status:'FAILED',progress_stage:marker,error_code:marker});
  for(const bad of ['ECONNREFUSED','127.0.0.1','PostgreSQL','RuntimeError','Traceback','WORKER_TOKEN'])assert.ok(!JSON.stringify(output).includes(bad));
});
