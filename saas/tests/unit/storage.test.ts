import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { NextRequest } from "next/server";
import { S3ObjectStorage, storageReachable } from "../../src/lib/storage";
import { proxy } from "../../src/proxy";

const publicEndpoint = "https://storage-test.proyaofficial.com";
const fixture = {
  OBJECT_STORAGE_ENDPOINT: "http://127.0.0.1:9000",
  OBJECT_STORAGE_REGION: "us-east-1",
  OBJECT_STORAGE_BUCKET: "private-fixture",
  OBJECT_STORAGE_ACCESS_KEY: "fixture-only",
  OBJECT_STORAGE_SECRET_KEY: "fixture-only-secret",
};

test("without a public endpoint all browser signatures retain the internal endpoint", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, fixture);
    delete process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT;
    const storage = new S3ObjectStorage();
    for (const value of [
      await storage.issueUpload("pending/fixture", "image/png", 300),
      await storage.issueDownload("sealed/fixture", "fixture.png", 60),
      await storage.issuePart("pending/source", "fixture-upload", 1, 900),
    ]) {
      const url = new URL(value);
      assert.equal(url.origin, fixture.OBJECT_STORAGE_ENDPOINT);
      assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
      assert.ok(url.searchParams.has("X-Amz-Signature"));
    }
  } finally { process.env = saved; }
});

test("public PUT, GET and multipart URLs are signed directly against the external hostname", async () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, fixture, { OBJECT_STORAGE_PUBLIC_ENDPOINT: publicEndpoint });
    const storage = new S3ObjectStorage();
    const upload = new URL(await storage.issueUpload("pending/fixture", "image/png", 300));
    const download = new URL(await storage.issueDownload("sealed/fixture", "fixture.png", 60, true));
    const part = new URL(await storage.issuePart("pending/source", "fixture-upload", 2, 900));
    for (const url of [upload, download, part]) {
      assert.equal(url.origin, publicEndpoint);
      assert.equal(url.pathname.split("/")[1], fixture.OBJECT_STORAGE_BUCKET);
      assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
      assert.ok(url.searchParams.has("X-Amz-Signature"));
    }
    assert.equal(upload.searchParams.get("X-Amz-Expires"), "300");
    assert.equal(download.searchParams.get("X-Amz-Expires"), "60");
    assert.match(download.searchParams.get("response-content-disposition")!, /^attachment;/);
    assert.equal(part.searchParams.get("X-Amz-Expires"), "900");
    assert.equal(part.searchParams.get("uploadId"), "fixture-upload");
    assert.equal(part.searchParams.get("partNumber"), "2");
  } finally { process.env = saved; }
});

test("all backend storage operations use the internal transport with a public endpoint configured", async () => {
  const saved = { ...process.env };
  const requests: { method: string; host: string; path: string; copy: boolean }[] = [];
  const server = http.createServer((request, response) => {
    const url = new URL(request.url!, "http://localhost");
    const copy = !!request.headers["x-amz-copy-source"];
    requests.push({ method: request.method!, host: request.headers.host!, path: request.url!, copy });
    assert.match(request.headers.authorization!, /^AWS4-HMAC-SHA256 /);
    request.resume();
    request.on("end", () => {
      response.setHeader("ETag", '"fixture-etag"');
      if (request.method === "HEAD") { response.setHeader("Content-Length", "4"); response.end(); }
      else if (request.method === "GET" && url.searchParams.has("uploadId")) response.end('<ListPartsResult><IsTruncated>false</IsTruncated><Part><PartNumber>1</PartNumber><ETag>fixture-etag</ETag><Size>4</Size></Part></ListPartsResult>');
      else if (request.method === "GET") response.end("test");
      else if (request.method === "POST" && url.searchParams.has("uploads")) response.end("<InitiateMultipartUploadResult><UploadId>fixture-upload</UploadId></InitiateMultipartUploadResult>");
      else if (request.method === "POST") response.end("<CompleteMultipartUploadResult><ETag>fixture-etag</ETag></CompleteMultipartUploadResult>");
      else if (copy) {
        const root = url.searchParams.has("uploadId") ? "CopyPartResult" : "CopyObjectResult";
        response.end(`<${root}><ETag>fixture-etag</ETag></${root}>`);
      } else { response.statusCode = request.method === "DELETE" ? 204 : 200; response.end(); }
    });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const port = (server.address() as import("node:net").AddressInfo).port;
  const folder = await mkdtemp(join(tmpdir(), "saas-storage-test-"));
  try {
    Object.assign(process.env, fixture, { OBJECT_STORAGE_ENDPOINT: `http://127.0.0.1:${port}`, OBJECT_STORAGE_PUBLIC_ENDPOINT: publicEndpoint });
    const storage = new S3ObjectStorage();
    assert.equal((await storage.head("sealed/fixture"))!.byteSize, 4);
    const chunks = [];
    for await (const chunk of await storage.stream("sealed/fixture")) chunks.push(Buffer.from(chunk));
    assert.equal(Buffer.concat(chunks).toString(), "test");
    await storage.copy("pending/fixture", "sealed/fixture", '"fixture-etag"', "image/png");
    await storage.put("sealed/bytes", Buffer.from("test"), "image/png");
    const file = join(folder, "fixture.png");
    await writeFile(file, "test");
    await storage.putFile("sealed/file", file, 4, "image/png");
    await storage.delete("pending/fixture");
    const uploadId = await storage.createMultipart("pending/source", "video/mp4");
    assert.equal(uploadId, "fixture-upload");
    const parts = await storage.listParts("pending/source", uploadId);
    assert.equal(parts.length, 1);
    await storage.completeMultipart("pending/source", uploadId, parts);
    await storage.abortMultipart("pending/source", uploadId);
    await storage.copyLarge("pending/large", "sealed/large", { byteSize: 6 * 1024 ** 3, etag: '"fixture-etag"', contentType: "video/mp4" }, "video/mp4");
    await storageReachable();
    assert.ok(requests.length > 20);
    assert.ok(requests.every(request => request.host === `127.0.0.1:${port}`));
    assert.ok(requests.some(request => request.method === "HEAD" && request.path === "/private-fixture/"));
    assert.ok(requests.some(request => request.method === "GET" && request.path.startsWith("/private-fixture/sealed/fixture")));
    assert.ok(requests.some(request => request.copy && request.path.includes("partNumber=")));
    assert.ok(requests.some(request => request.copy && !request.path.includes("uploadId=")));
  } finally {
    process.env = saved;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    assert.equal(dirname(resolve(folder)), resolve(tmpdir()));
    assert.ok(basename(folder).startsWith("saas-storage-test-"));
    await rm(folder, { recursive: true, force: true });
  }
});

test("CSP permits public storage uploads, images and video while retaining its restrictions", () => {
  const saved = { ...process.env };
  try {
    Object.assign(process.env, fixture, { APP_ENV: "local", OBJECT_STORAGE_PUBLIC_ENDPOINT: publicEndpoint });
    const response = proxy(new NextRequest("https://ai-test.proyaofficial.com/products"));
    const csp = response.headers.get("Content-Security-Policy")!;
    for (const name of ["connect-src", "img-src", "media-src"]) {
      assert.ok(csp.split(";").find(directive => directive.trim().startsWith(name))!.includes(publicEndpoint));
    }
    assert.ok(csp.includes("object-src 'none'"));
    assert.ok(csp.includes("frame-ancestors 'none'"));
    assert.ok(!csp.includes("fixture-only-secret"));
  } finally { process.env = saved; }
});
