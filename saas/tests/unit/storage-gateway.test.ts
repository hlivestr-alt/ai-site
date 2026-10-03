import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client, UploadPartCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createStorageGateway } from "../../docker/s3-gateway.mjs";
import { allowedStorageOrigins, storageGatewayConfig } from "../../docker/storage-gateway-config.mjs";

const publicEndpoint = "https://storage-test.proyaofficial.com";
const remoteOrigin = "https://ai-test.proyaofficial.com";
const localOrigin = "http://127.0.0.1:3200";
const fixture = {
  APP_ENV: "test", OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_PUBLIC_ENDPOINT: publicEndpoint,
  OBJECT_STORAGE_ALLOWED_ORIGINS: `${localOrigin},${remoteOrigin}`,
  OBJECT_STORAGE_REGION: "us-east-1",
  OBJECT_STORAGE_ACCESS_KEY: "fixture-only", OBJECT_STORAGE_SECRET_KEY: "fixture-only-secret",
};
const client = (endpoint: string) => new S3Client({ endpoint, region: fixture.OBJECT_STORAGE_REGION, forcePathStyle: true,
  credentials: { accessKeyId: fixture.OBJECT_STORAGE_ACCESS_KEY, secretAccessKey: fixture.OBJECT_STORAGE_SECRET_KEY } });

test("gateway configuration defaults to local CORS and rejects wildcards and production use", () => {
  assert.deepEqual(allowedStorageOrigins({}), [localOrigin]);
  assert.deepEqual(allowedStorageOrigins(fixture), [localOrigin, remoteOrigin]);
  for (const value of ["*", "https://*.example.test", "null", `${remoteOrigin}/path`, `${remoteOrigin}/`, "file://localhost"]) {
    assert.throws(() => allowedStorageOrigins({ OBJECT_STORAGE_ALLOWED_ORIGINS: value }));
  }
  for (const mode of ["staging", "production"]) assert.throws(() => storageGatewayConfig({ ...fixture, APP_ENV: mode }));
  for (const value of ["http://public.example.test", `${publicEndpoint}/path`, `${publicEndpoint}?x=1`, "https://user:password@public.example.test"]) {
    assert.throws(() => storageGatewayConfig({ ...fixture, OBJECT_STORAGE_PUBLIC_ENDPOINT: value }));
  }
  assert.ok(!storageGatewayConfig({ ...fixture, OBJECT_STORAGE_PUBLIC_ENDPOINT: "" }).allowedHosts.has(new URL(publicEndpoint).host));
});

test("gateway preserves external canonical Host, verifies SigV4 and enforces exact CORS", async t => {
  const upstreamRequests: { host: string; path: string }[] = [];
  const upstream = http.createServer((request, response) => {
    upstreamRequests.push({ host: request.headers.host!, path: request.url! });
    request.resume();
    request.on("end", () => {
      response.setHeader("ETag", '"fixture-etag"');
      response.setHeader("Access-Control-Allow-Origin", "*");
      response.setHeader("Access-Control-Allow-Credentials", "true");
      response.setHeader("Vary", "Accept-Encoding");
      response.end("test");
    });
  });
  upstream.listen(0, "127.0.0.1"); await once(upstream, "listening");
  const gateway = createStorageGateway({ ...fixture, TARGET_HOST: "127.0.0.1", TARGET_PORT: String((upstream.address() as import("node:net").AddressInfo).port) });
  gateway.listen(0, "127.0.0.1"); await once(gateway, "listening");
  const gatewayPort = (gateway.address() as import("node:net").AddressInfo).port;
  const external = client(publicEndpoint), internal = client(fixture.OBJECT_STORAGE_ENDPOINT), foreign = client("https://unrelated.example.test");
  t.after(async () => {
    for (const s3 of [external, internal, foreign]) s3.destroy();
    for (const server of [gateway, upstream]) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  });
  function send(value: string, method = "GET", headers: Record<string, string> = {}, body?: string) {
    const url = new URL(value);
    return new Promise<{ status: number; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
      // Simulate cloudflared delivering the unchanged external Host over local HTTP.
      const request = http.request({ hostname: "127.0.0.1", port: gatewayPort, method, path: url.pathname + url.search, headers: { Host: url.host, ...headers } }, response => {
        response.resume(); response.on("end", () => resolve({ status: response.statusCode!, headers: response.headers }));
      });
      request.on("error", reject); request.end(body);
    });
  }
  const get = await getSignedUrl(external, new GetObjectCommand({ Bucket: "private-fixture", Key: "sealed/fixture" }), { expiresIn: 60 });

  await t.test("public signed GET, PUT, HEAD and multipart PUT pass with their original Host", async () => {
    const put = await getSignedUrl(external, new PutObjectCommand({ Bucket: "private-fixture", Key: "pending/fixture", ContentType: "image/png" }), { expiresIn: 300 });
    const head = await getSignedUrl(external, new HeadObjectCommand({ Bucket: "private-fixture", Key: "sealed/fixture" }), { expiresIn: 60 });
    const part = await getSignedUrl(external, new UploadPartCommand({ Bucket: "private-fixture", Key: "pending/source", UploadId: "fixture-upload", PartNumber: 2 }), { expiresIn: 900 });
    for (const [value, method] of [[get, "GET"], [put, "PUT"], [head, "HEAD"], [part, "PUT"]]) {
      const result = await send(value, method, { Origin: remoteOrigin }, method === "PUT" ? "test" : undefined);
      assert.equal(result.status, 200);
      assert.equal(result.headers["access-control-allow-origin"], remoteOrigin);
      assert.match(result.headers["access-control-expose-headers"]!, /ETag/);
      assert.equal(result.headers["access-control-allow-credentials"], undefined);
      assert.equal(result.headers["cache-control"], "private, no-store");
      assert.match(result.headers.vary!, /Origin/);
    }
    assert.ok(upstreamRequests.every(request => request.host === new URL(publicEndpoint).host));
    assert.ok(upstreamRequests.some(request => request.path.includes("uploadId=fixture-upload")));
  });
  await t.test("single-PC signed URLs and header-authenticated S3 operations still pass", async () => {
    const local = await getSignedUrl(internal, new GetObjectCommand({ Bucket: "private-fixture", Key: "sealed/fixture" }), { expiresIn: 60 });
    assert.equal((await send(local, "GET", { Origin: localOrigin })).status, 200);
    const capture = client(fixture.OBJECT_STORAGE_ENDPOINT);
    // Deliver a real SDK header signature through the same simulated tunnel transport.
    capture.config.requestHandler = { handle: async request => {
      const result = await send(fixture.OBJECT_STORAGE_ENDPOINT + request.path, request.method, request.headers);
      assert.equal(result.status, 200);
      return { response: { statusCode: 200, headers: {}, body: Buffer.alloc(0) } };
    }, destroy() {} };
    try { await capture.send(new HeadObjectCommand({ Bucket: "private-fixture", Key: "sealed/fixture" })); } finally { capture.destroy(); }
  });
  await t.test("unsigned object reads and bucket listing are rejected", async () => {
    for (const path of ["/private-fixture/sealed/fixture", "/private-fixture?list-type=2", "/", "/health"]) assert.equal((await send(publicEndpoint + path)).status, 403);
  });
  await t.test("forged, tampered and expired signatures are rejected before upstream access", async () => {
    const before = upstreamRequests.length;
    const forged = new URL(get); forged.searchParams.set("X-Amz-Signature", "0".repeat(64));
    assert.equal((await send(forged.toString())).status, 403);
    const tampered = new URL(get); tampered.pathname += "-foreign";
    assert.equal((await send(tampered.toString())).status, 403);
    assert.equal((await send(get, "PUT")).status, 403);
    const expired = await getSignedUrl(external, new GetObjectCommand({ Bucket: "private-fixture", Key: "sealed/fixture" }), { expiresIn: 60, signingDate: new Date(Date.now() - 120_000) });
    assert.equal((await send(expired)).status, 403);
    assert.equal(upstreamRequests.length, before);
  });
  await t.test("changing signed Host or spoofing forwarded headers cannot bypass verification", async () => {
    const before = upstreamRequests.length;
    assert.equal((await send(get, "GET", { Host: "127.0.0.1:9000", "X-Forwarded-Host": new URL(publicEndpoint).host, "X-Forwarded-Proto": "https" })).status, 403);
    const unknown = await getSignedUrl(foreign, new GetObjectCommand({ Bucket: "private-fixture", Key: "sealed/fixture" }), { expiresIn: 60 });
    assert.equal((await send(unknown)).status, 403);
    assert.equal((await send(unknown, "GET", { Host: new URL(publicEndpoint).host, "X-Forwarded-Host": new URL(unknown).host })).status, 403);
    assert.equal(upstreamRequests.length, before);
    assert.equal((await send(get, "GET", { "X-Forwarded-Host": "unrelated.example.test", "X-Forwarded-Proto": "http" })).status, 200);
  });
  await t.test("configured local and remote origins permit PUT, GET and HEAD preflight", async () => {
    for (const origin of [localOrigin, remoteOrigin]) for (const method of ["PUT", "GET", "HEAD"]) {
      const result = await send(publicEndpoint + "/private-fixture/pending/source?partNumber=1&uploadId=fixture-upload", "OPTIONS", { Origin: origin, "Access-Control-Request-Method": method, "Access-Control-Request-Headers": "content-type, range, x-amz-checksum-crc32" });
      assert.equal(result.status, 204); assert.equal(result.headers["access-control-allow-origin"], origin);
    }
  });
  await t.test("unrelated origins and unapproved preflight methods or headers are denied", async () => {
    for (const method of ["OPTIONS", "GET", "PUT"]) {
      const result = await send(get, method, { Origin: "https://unrelated.example.test", "Access-Control-Request-Method": "PUT" });
      assert.equal(result.status, 403); assert.equal(result.headers["access-control-allow-origin"], undefined);
    }
    assert.equal((await send(get, "OPTIONS", { Origin: remoteOrigin, "Access-Control-Request-Method": "DELETE" })).status, 403);
    assert.equal((await send(get, "OPTIONS", { Origin: remoteOrigin, "Access-Control-Request-Method": "PUT", "Access-Control-Request-Headers": "x-unapproved" })).status, 403);
  });
});
