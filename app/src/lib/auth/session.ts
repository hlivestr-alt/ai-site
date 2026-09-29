import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

export const SESSION_COOKIE = "ai_site_session";
export const SESSION_SECONDS = 8 * 60 * 60;
const USER = "operator";
const sessionRoot = resolve(process.cwd(), "data", "auth-sessions");

function secret() {
  const value = process.env.AI_SITE_SESSION_SECRET;
  return value && value.length >= 32 ? value : null;
}

export function authConfigured() {
  return Boolean(secret() && process.env.AI_SITE_PASSWORD_HASH?.startsWith("scrypt:"));
}

export function verifyPassword(password: string) {
  const parts = process.env.AI_SITE_PASSWORD_HASH?.split(":") ?? [];
  if (parts.length !== 3 || parts[0] !== "scrypt" || !/^[a-f0-9]{32}$/.test(parts[1]) || !/^[a-f0-9]{128}$/.test(parts[2])) return false;
  try {
    const expected = Buffer.from(parts[2], "hex");
    const actual = scryptSync(password, Buffer.from(parts[1], "hex"), expected.length);
    return timingSafeEqual(actual, expected);
  } catch { return false; }
}

function sessionPath(token: string, key: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return join(sessionRoot, createHmac("sha256", key).update(token).digest("hex") + ".json");
}

export async function createSession(now = Date.now()) {
  const key = secret();
  if (!key) throw new Error("Authentication is not configured");
  const token = randomBytes(32).toString("base64url");
  const path = sessionPath(token, key);
  if (!path) throw new Error("Could not create session");
  await mkdir(sessionRoot, { recursive: true });
  await writeFile(path, JSON.stringify({ sub: USER, exp: now + SESSION_SECONDS * 1000 }), { flag: "wx", mode: 0o600 });
  return token;
}

export async function readSession(value: string | undefined, now = Date.now()) {
  const key = secret();
  const path = key && value ? sessionPath(value, key) : null;
  if (!path) return null;
  try {
    const data: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!data || typeof data !== "object") return null;
    const session = data as { sub?: unknown; exp?: unknown };
    if (session.sub !== USER || typeof session.exp !== "number") return null;
    if (session.exp <= now) { await unlink(path).catch(() => undefined); return null; }
    return { user: USER };
  } catch { return null; }
}

export async function destroySession(value: string | undefined) {
  const key = secret();
  const path = key && value ? sessionPath(value, key) : null;
  if (path) await unlink(path).catch(() => undefined);
}

export function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const url = new URL(request.url);
  const host = request.headers.get("host") || url.host;
  return Boolean(origin && origin === `${url.protocol}//${host}`);
}
