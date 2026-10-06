export const storageBrowserMethods = ["GET", "HEAD", "PUT"];
export const storageBrowserHeaders = ["content-type", "authorization", "range", "if-match", "if-none-match", "x-amz-content-sha256", "x-amz-date", "x-amz-security-token", "x-amz-user-agent", "x-amz-checksum-crc32", "x-amz-checksum-crc32c", "x-amz-checksum-crc64nvme", "x-amz-checksum-sha1", "x-amz-checksum-sha256", "x-amz-sdk-checksum-algorithm"];
export const storageExposedHeaders = ["ETag", "Content-Length", "Content-Range", "Accept-Ranges"];

/** @param {Record<string, string | undefined>} env */
export function allowedStorageOrigins(env = process.env) {
  const origins = (env.OBJECT_STORAGE_ALLOWED_ORIGINS || "http://127.0.0.1:3200")
    .split(",").map(value => value.trim()).filter(Boolean);
  if (!origins.length) throw new Error("At least one exact storage browser origin is required");
  for (const origin of origins) {
    const url = new URL(origin);
    if (origin.includes("*") || !["http:", "https:"].includes(url.protocol) || url.origin !== origin || url.username || url.password) {
      throw new Error("OBJECT_STORAGE_ALLOWED_ORIGINS requires exact HTTP(S) origins; wildcards are forbidden");
    }
  }
  return [...new Set(origins)];
}

/** @param {Record<string, string | undefined>} env */
export function assertStorageCredentials(env = process.env) {
  const access = env.OBJECT_STORAGE_ACCESS_KEY;
  const secret = env.OBJECT_STORAGE_SECRET_KEY;
  if (!access || !secret) throw new Error("Object storage signing credentials are required");
  if (access === secret) throw new Error("Object storage access identifier and signing secret must be distinct");
}

/** @param {Record<string, string | undefined>} env */
export function storageGatewayConfig(env = process.env) {
  if (!["local", "test"].includes(env.APP_ENV || "local")) throw new Error("Local S3 gateway is local/test-only");
  assertStorageCredentials(env);
  const port = env.SAAS_TEST_STORAGE_PORT || "9000";
  if (env.SAAS_TEST_STORAGE_PORT && (env.APP_ENV !== "test" || !/^\d+$/.test(port) || Number(port) < 1024 || Number(port) > 65535)) throw new Error("Alternate gateway ports require explicit test mode");
  const internal = new URL(env.OBJECT_STORAGE_ENDPOINT || "http://127.0.0.1:9000");
  if (internal.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(internal.hostname) || internal.port !== port || internal.username || internal.password || internal.pathname !== "/" || internal.search || internal.hash) {
    throw new Error("Local S3 gateway requires its configured loopback endpoint");
  }
  const internalHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const allowedHosts = new Set(internalHosts);
  if (env.OBJECT_STORAGE_PUBLIC_ENDPOINT) {
    const external = new URL(env.OBJECT_STORAGE_PUBLIC_ENDPOINT);
    if (external.host.includes("*") || external.protocol !== "https:" || external.username || external.password || external.pathname !== "/" || external.search || external.hash) {
      throw new Error("Remote-test public storage endpoint must be an HTTPS origin");
    }
    allowedHosts.add(external.host);
  }
  return {
    targetHost: env.TARGET_HOST || "object-storage",
    targetPort: Number(env.TARGET_PORT || 4566),
    accessKey: env.OBJECT_STORAGE_ACCESS_KEY,
    secretKey: env.OBJECT_STORAGE_SECRET_KEY,
    region: env.OBJECT_STORAGE_REGION || "us-east-1",
    internalHosts,
    allowedHosts,
    allowedOrigins: new Set(allowedStorageOrigins(env)),
  };
}
