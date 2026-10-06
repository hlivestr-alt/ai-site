import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { probeVideo } from "../../src/lib/media-probe";
import { AppError } from "../../src/lib/core";

const reader = (bytes: Buffer) => ({ readRange: async (_key: string, start: number, end: number, etag: string | undefined) => {
  assert.equal(etag, '"immutable-fixture"');
  return (async function* () { for (let i=start;i<=end;i+=65536) yield bytes.subarray(i,Math.min(i+65536,end+1)); })();
} });
test("real bounded probing rejects the acceptance ftyp-only MP4", async () => {
  const bytes=Buffer.alloc(20);bytes.writeUInt32BE(20);bytes.write("ftypisom",4);
  await assert.rejects(probeVideo(reader(bytes),"fixture",{byteSize:bytes.length,etag:'"immutable-fixture"',contentType:"video/mp4"}), e=>e instanceof AppError && e.status===422 && !e.message.includes("ffprobe"));
});
test("storage outages remain retryable and expose only the fixed validation message", async () => {
  const unavailable={readRange:async()=>{throw new Error('ECONNREFUSED private-worker:9999 synthetic diagnostic');}};
  await assert.rejects(probeVideo(unavailable,'fixture',{byteSize:100,etag:'"immutable-fixture"',contentType:'video/mp4'}),e=>e instanceof AppError&&e.status===503&&e.message==='Media validation is temporarily unavailable.');
});
test("real video frames and audio are validated without changing a valid MP4", async () => {
  const bytes=await readFile("tests/fixtures/clipper-speech.mp4");
  const media=await probeVideo(reader(bytes),"fixture",{byteSize:bytes.length,etag:'"immutable-fixture"',contentType:"video/mp4"},true);
  assert.equal(media.hasAudio,true);assert.ok(media.durationSeconds>0);assert.ok(media.width>0&&media.height>0);
});
