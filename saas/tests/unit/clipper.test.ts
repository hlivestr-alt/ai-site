import {test} from "node:test";
import assert from "node:assert/strict";
import {clipperRequest,clipperRequestHash,validatedClips,maxClipperSourceBytes} from "../../src/lib/clipper-core";
import {safeWorkerInput,type ClipperInput} from "../../src/lib/job-core";
const id="11111111-1111-4111-8111-111111111111";
const request={sourceAssetId:id,language:"auto",goal:"Useful ideas",targetClipCount:2,minClipSeconds:10,maxClipSeconds:30,captions:true,idempotencyKey:"clipper-key-1"};
test("Clipper bounds, normalized idempotency and discriminated worker input",()=>{
  const parsed=clipperRequest(request);assert.equal(clipperRequestHash(parsed),clipperRequestHash(clipperRequest({...request,idempotencyKey:"clipper-key-2"})));
  for(const change of [{targetClipCount:11},{minClipSeconds:9},{maxClipSeconds:91},{minClipSeconds:31},{sourceAssetId:"bad"},{language:"invalid"},{captions:"yes"}])assert.throws(()=>clipperRequest({...request,...change}));
  const input:ClipperInput={schemaVersion:1,kind:"CLIPPER",analyzerProvider:"openai",source:{origin:"SOURCE_ASSET",sourceAssetId:id,byteSize:100,mimeType:"video/mp4",storageIdentity:id,storageKey:"private-key",filename:"fixture.mp4"},language:"en",goal:"Ideas",targetClipCount:2,minClipSeconds:10,maxClipSeconds:30,aspectRatio:"9:16",captions:true,analyzerPolicyVersion:"v1",renderPolicyVersion:"v1"};
  const safe=safeWorkerInput(input);assert.equal(safe.kind,"CLIPPER");assert.ok(!JSON.stringify(safe).includes("private-key"));assert.equal(maxClipperSourceBytes(),10*1024**3);
});
test("Clipper manifest rejects invalid, duplicate and oversized fields",()=>{
  const clip={artifactId:id,start:0,end:10,duration:10,score:90,hook:"Idea",reason:"Reason",tags:["useful"],width:720,height:1280,sha256:"a".repeat(64)};
  assert.equal(validatedClips([clip],request,40).length,1);
  for(const change of [{start:-1},{end:100},{score:101},{reason:"x".repeat(501)},{width:1920},{localPath:"private"}])assert.throws(()=>validatedClips([{...clip,...change}],request,40));
  assert.throws(()=>validatedClips([clip,{...clip,artifactId:"22222222-2222-4222-8222-222222222222"}],request,40));
});
