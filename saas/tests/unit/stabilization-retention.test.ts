import {test} from 'node:test';
import assert from 'node:assert/strict';
import {stagingCleanupKeys} from '../../docker/staging-retention.mjs';
const workspace='11111111-1111-4111-8111-111111111111',id='22222222-2222-4222-8222-222222222222';
const source={kind:'source',id,workspace_id:workspace,status:'FAILED',upload_key:`pending/workspaces/${workspace}/sources/${id}/upload`,storage_key:`workspaces/${workspace}/sources/${id}/original`,finalized_at:null,verified_at:null};
test('retention scope selects only exact owned staging and unverified quarantine keys',()=>{
  assert.equal(stagingCleanupKeys(source).length,2);
  for(const change of [{status:'READY'},{status:'UPLOADED'},{status:'VERIFIED'},{status:'ARCHIVED'},{finalized_at:new Date()},{verified_at:new Date()},{upload_key:'workspaces/customer/original'},{storage_key:'workspaces/customer/history'}])assert.throws(()=>stagingCleanupKeys({...source,...change}));
});
