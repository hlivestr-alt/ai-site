const DEFAULT_H3_BASE_URL = "http://127.0.0.1:8787";

/** Phase 2 only permits a loopback runner. This prevents the status proxy becoming an SSRF surface. */
export function h3BaseUrl(value = process.env.H3_BASE_URL): string {
  const url = new URL(value?.trim() || DEFAULT_H3_BASE_URL);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(host) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("H3_BASE_URL must be a plain HTTP loopback origin.");
  }
  return url.origin;
}
