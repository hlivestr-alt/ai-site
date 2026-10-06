import {test} from 'node:test';
import assert from 'node:assert/strict';
import {referenceSlot,referenceSlots} from '../../src/lib/reference-slots';
import {uploadInput,purposes} from '../../src/lib/media-validation';
test('eight customer slots cover all legacy purposes without inventing another specialized role',()=>{
  assert.equal(referenceSlots.length,8);assert.equal(referenceSlots[7].label,'Additional Reference');
  for(const purpose of purposes)assert.ok(referenceSlots.some(s=>s.id===referenceSlot(purpose)));
  assert.equal(referenceSlot('LEFT_SIDE'),referenceSlot('RIGHT_SIDE'));
  assert.equal(referenceSlot('USAGE_IMAGE'),referenceSlot('USAGE_VIDEO'));
});
test('authenticated default upload derives provenance without recording a rights attestation',()=>{
  const input=uploadInput({purpose:'FRONT',mimeType:'image/png',byteSize:100,filename:'front.png'});
  assert.equal(input.sourceType,'CUSTOMER_UPLOAD');assert.equal(input.permissionConfirmed,false);
  assert.throws(()=>uploadInput({purpose:'FRONT',mimeType:'image/png',byteSize:100,filename:'front.png',sourceType:'LICENSED',permissionConfirmed:false}));
});
