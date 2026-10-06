import { test, expect } from "@playwright/test";
import http from "node:http";
import { paddedVideoFirstPart } from "../media-fixtures";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import { GetBucketCorsCommand, GetPublicAccessBlockCommand } from "@aws-sdk/client-s3";
import { storageClient } from "../../src/lib/storage";
import { owner } from "../clipper-helpers";

const publicEndpoint = "https://storage-test.proyaofficial.com";
const remoteOrigin = "https://ai-test.proyaofficial.com";

// cloudflared's network hop is simulated; the URL, path, query and signed Host stay intact.
function tunnelRequest(value: string, method = "GET", body?: Buffer, extraHeaders: Record<string, string> = {}) {
  const url = new URL(value);
  expect(url.origin).toBe(publicEndpoint);
  return new Promise<{ status: number; body: Buffer; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const request = http.request({ hostname: "127.0.0.1", port: 9000, method, path: url.pathname + url.search,
      headers: { Host: url.host, Origin: remoteOrigin, ...(body ? { "Content-Length": String(body.length) } : {}), ...extraHeaders } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve({ status: response.statusCode!, body: Buffer.concat(chunks), headers: response.headers }));
    });
    request.on("error", reject); request.end(body);
  });
}

test("public Product image/video and source URLs work through the private SigV4 gateway", async () => {
  const preflight = await tunnelRequest(publicEndpoint + "/private-fixture/pending/fixture", "OPTIONS", undefined, { "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "content-type" });
  expect(preflight.status, "Configure object-gateway with the documented public endpoint and remote origin before this test").toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(remoteOrigin);
  const s3 = storageClient();
  try {
    const Bucket = process.env.TEST_OBJECT_STORAGE_BUCKET!;
    const privacy = await s3.send(new GetPublicAccessBlockCommand({ Bucket }));
    expect(privacy.PublicAccessBlockConfiguration).toEqual({ BlockPublicAcls: true, IgnorePublicAcls: true, BlockPublicPolicy: true, RestrictPublicBuckets: true });
    const cors = await s3.send(new GetBucketCorsCommand({ Bucket }));
    expect(cors.CORSRules![0].AllowedOrigins).toEqual(["http://127.0.0.1:3200", remoteOrigin]);
    expect(cors.CORSRules![0].AllowedHeaders).not.toContain("*");
    expect(cors.CORSRules![0].ExposeHeaders).toContain("ETag");
  } finally { s3.destroy(); }
  const a = await owner(`remote-storage-a-${randomUUID()}@example.test`, false);
  const b = await owner(`remote-storage-b-${randomUUID()}@example.test`, false);
  try {
    const product = await a.c.post(`/api/workspaces/${a.workspaceId}/products`, { data: { brand: "Remote fixture", name: "Remote Product", category: "Care", description: "Remote storage acceptance", keySellingPoints: [], targetAudience: "Adults" } });
    expect(product.status()).toBe(201);
    const productId = (await product.json()).product.id as string;
    const root = `/api/workspaces/${a.workspaceId}/products/${productId}/assets`;
    const image = await sharp({ create: { width: 80, height: 80, channels: 3, background: "#ed6748" } }).png().toBuffer();
    const video = await readFile("tests/fixtures/clipper-output.mp4");
    for (const [bytes, mimeType, purpose, filename] of [[image, "image/png", "FRONT", "fixture.png"], [video, "video/mp4", "PRODUCT_VIDEO", "fixture.mp4"]] as const) {
      const data = { purpose, mimeType, byteSize: bytes.length, filename, sha256: createHash("sha256").update(bytes).digest("hex"), sourceType: "CUSTOMER_OWNED", permissionConfirmed: true };
      const response = await a.c.post(root + "/upload-intents", { data }); expect(response.status()).toBe(201);
      const intent = (await response.json()).intent;
      expect(new URL(intent.uploadUrl).hostname).toBe("storage-test.proyaofficial.com");
      const upload = await tunnelRequest(intent.uploadUrl, "PUT", bytes, intent.requiredHeaders); expect(upload.status).toBe(200);
      expect(upload.headers["access-control-allow-origin"]).toBe(remoteOrigin);
      expect(upload.headers.etag).toBeTruthy();
      // Finalization performs Head/Get/Copy/Put over loopback, even though signing is public.
      expect((await a.c.post(`${root}/${intent.assetId}/versions/${intent.versionId}/finalize`)).status()).toBe(200);
      const download = await a.c.get(`${root}/${intent.assetId}/download`); expect(download.status()).toBe(200);
      const url = (await download.json()).url as string;
      expect(new URL(url).hostname).toBe("storage-test.proyaofficial.com");
      const media = await tunnelRequest(url); expect(media.status).toBe(200); expect(media.body).toEqual(bytes);
      const range = await tunnelRequest(url, "GET", undefined, { Range: "bytes=0-11" }); expect(range.status).toBe(206); expect(range.body).toEqual(bytes.subarray(0, 12));
      expect((await tunnelRequest(url.split("?")[0])).status).toBe(403);
      const forged = new URL(url); forged.searchParams.set("X-Amz-Signature", "0".repeat(64)); expect((await tunnelRequest(forged.toString())).status).toBe(403);
      const expiredResponse = await a.c.get(`${root}/${intent.assetId}/download?testTtl=1`); expect(expiredResponse.status()).toBe(200);
      const expiring = (await expiredResponse.json()).url as string;
      await new Promise(resolve => setTimeout(resolve, 2200)); expect((await tunnelRequest(expiring)).status).toBe(403);
      for (const denied of [await b.c.get(`${root}/${intent.assetId}/download`), await b.c.post(root + "/upload-intents", { data }), await b.c.get(`/api/workspaces/${b.workspaceId}/products/${productId}/assets/${intent.assetId}/download`)]) {
        expect([403, 404]).toContain(denied.status()); expect(await denied.text()).not.toContain("X-Amz-Signature");
      }
    }
    const sourceRoot = `/api/workspaces/${a.workspaceId}/sources`;
    const response = await a.c.post(sourceRoot, { data: { filename: "source.mp4", mimeType: "video/mp4", byteSize: video.length } }); expect(response.status()).toBe(201);
    const source = await response.json(); expect(source.mode).toBe("simple");
    expect((await tunnelRequest(source.uploadUrl, "PUT", video, source.requiredHeaders)).status).toBe(200);
    expect((await a.c.post(`${sourceRoot}/${source.source.id}/finalize`)).status()).toBe(200);
    const download = await a.c.get(`${sourceRoot}/${source.source.id}/download`); expect(download.status()).toBe(200);
    expect((await tunnelRequest((await download.json()).url)).body).toEqual(video);
    expect((await b.c.get(`${sourceRoot}/${source.source.id}/download`)).status()).toBe(404);
    expect((await tunnelRequest(publicEndpoint + "/", "GET")).status).toBe(403);
    const deniedCors = await tunnelRequest(publicEndpoint + "/", "OPTIONS", undefined, { Origin: "https://unrelated.example.test", "Access-Control-Request-Method": "PUT" });
    expect(deniedCors.status).toBe(403); expect(deniedCors.headers["access-control-allow-origin"]).toBeUndefined();
  } finally { await a.c.dispose(); await b.c.dispose(); }
});

test("public multipart parts upload, resume and seal through internal multipart controls", async () => {
  const a = await owner(`remote-storage-multipart-${randomUUID()}@example.test`, false);
  const b = await owner(`remote-storage-multipart-foreign-${randomUUID()}@example.test`, false);
  try {
    const size = 64 * 1024 ** 2 + 5 * 1024 ** 2;
    const root = `/api/workspaces/${a.workspaceId}/sources`;
    const response = await a.c.post(root, { data: { filename: "multipart.mp4", mimeType: "video/mp4", byteSize: size } }); expect(response.status()).toBe(201);
    const source = await response.json(); expect(source.mode).toBe("multipart");
    const path = `${root}/${source.source.id}`;
    const first = await paddedVideoFirstPart(size, source.partSize);
    for (const [partNumber, bytes] of [[1, first], [2, Buffer.alloc(5 * 1024 ** 2)]] as const) {
      const response = await a.c.post(path + "/parts", { data: { partNumber } }); expect(response.status()).toBe(200);
      const url = (await response.json()).url as string; expect(new URL(url).hostname).toBe("storage-test.proyaofficial.com");
      const part = await tunnelRequest(url, "PUT", bytes); expect(part.status).toBe(200); expect(part.headers.etag).toBeTruthy();
      expect(part.headers["access-control-expose-headers"]).toContain("ETag");
      expect((await b.c.post(path + "/parts", { data: { partNumber } })).status()).toBe(404);
      if (partNumber === 1) {
        expect((await a.c.post(path + "/finalize")).status()).toBe(409);
        const resumed = await a.c.get(path + "/upload"); expect(resumed.status()).toBe(200);
        expect((await resumed.json()).parts.map((p: { partNumber: number }) => p.partNumber)).toEqual([1]);
      }
    }
    expect((await a.c.post(path + "/finalize")).status()).toBe(200);
    expect((await a.c.post(path + "/finalize")).status()).toBe(200);
    const download = await a.c.get(path + "/download"); expect(download.status()).toBe(200);
    const url = (await download.json()).url as string;
    const prefix = await tunnelRequest(url, "GET", undefined, { Range: "bytes=0-11" }); expect(prefix.status).toBe(206); expect(prefix.body).toEqual(first.subarray(0, 12));
  } finally { await a.c.dispose(); await b.c.dispose(); }
});
