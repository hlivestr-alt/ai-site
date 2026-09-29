import { test } from "node:test";
import assert from "node:assert/strict";
import { signatureMatches, uploadInput } from "../../src/lib/media-validation";

test("upload intent validates purpose, size, rights and media type",()=>{
  const good={purpose:"FRONT",mimeType:"image/png",byteSize:1024,filename:"C:\\uploads\\front.png",permissionConfirmed:true};
  const parsed=uploadInput(good);
  assert.equal(parsed.originalFilename,"front.png");
  assert.equal(parsed.type,"IMAGE");
  for(const bad of [{...good,byteSize:0},{...good,byteSize:21*1024*1024},{...good,mimeType:"application/x-msdownload"},{...good,permissionConfirmed:false},{...good,purpose:"USAGE_VIDEO"}])assert.throws(()=>uploadInput(bad));
});

test("signature checks reject extension and MIME spoofing",()=>{
  const png=Uint8Array.from([137,80,78,71,13,10,26,10]);
  assert.equal(signatureMatches("image/png",png),true);
  assert.equal(signatureMatches("image/jpeg",png),false);
  assert.equal(signatureMatches("video/mp4",new TextEncoder().encode("xxxxftypisom")),true);
  assert.equal(signatureMatches("video/mp4",new TextEncoder().encode("xxxxftypqt  ")),false);
});
