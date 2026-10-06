import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { DbClient } from "./db";
import {correlationMetadata} from './operational-logging';

const scrypt = promisify(scryptCallback);
export class AppError extends Error {
  constructor(public status: number, message: string, public safeCode?:string,public retryAfter?:number) { super(message); }
}

export function normalizeEmail(value: unknown): string {
  if (typeof value !== "string") throw new AppError(400, "Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new AppError(400, "Enter a valid email address.");
  return email;
}

export function displayName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 100) throw new AppError(400, "Name must be 2–100 characters.");
  return value.trim();
}

export function workspaceName(value: unknown): string {
  if (typeof value !== "string" || value.trim().length < 2 || value.trim().length > 100) throw new AppError(400, "Workspace name must be 2–100 characters.");
  return value.trim();
}

export function validPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 128 || !/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) {
    throw new AppError(400, "Password must be 12–128 characters with a letter and a number.");
  }
  return value;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [scheme, salt, hash] = encoded.split(":");
  if (scheme !== "scrypt" || !salt || !hash || !/^[a-f0-9]{32}$/.test(salt) || !/^[a-f0-9]{128}$/.test(hash)) return false;
  const actual = await scrypt(password, Buffer.from(salt, "hex"), 64) as Buffer;
  return timingSafeEqual(actual, Buffer.from(hash, "hex"));
}

export function randomToken(): string { return randomBytes(32).toString("base64url"); }
export function hashToken(token: string): string { return createHash("sha256").update(token).digest("hex"); }
export function isUuid(value: string): boolean { return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value); }

export function role(value: unknown): "OWNER" | "ADMIN" | "EDITOR" | "VIEWER" {
  if (value !== "OWNER" && value !== "ADMIN" && value !== "EDITOR" && value !== "VIEWER") throw new AppError(400, "Invalid role.");
  return value;
}

export function safeNext(value: unknown): string {
  return typeof value === "string" && /^\/invite\?token=[A-Za-z0-9_-]{30,100}$/.test(value) ? value : "/";
}

export async function audit(db: DbClient, event: { billingAccountId?:string|null; workspaceId?: string | null; actorUserId?: string | null; type: string; targetType: string; targetId?: string | null; metadata?: Record<string, string | number | boolean | null> }) {
  await db.query("INSERT INTO audit_events(workspace_id,actor_user_id,event_type,target_type,target_id,safe_metadata,billing_account_id) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)",
    [event.workspaceId ?? null, event.actorUserId ?? null, event.type, event.targetType, event.targetId ?? null, JSON.stringify({...correlationMetadata(),...event.metadata}),event.billingAccountId??null]);
}

export async function rateLimit(db: DbClient, action: string, identity: string, maxAttempts = 8,windowSeconds=900): Promise<void> {
  const key = hashToken(`${action}:${identity}`);
  const row = await db.query<{ attempts: number; blocked: boolean }>(`
    INSERT INTO auth_rate_limits(key_hash,window_started_at,attempts,blocked_until)
    VALUES($1,now(),1,NULL)
    ON CONFLICT(key_hash) DO UPDATE SET
      window_started_at=CASE WHEN auth_rate_limits.window_started_at < now()-($3::integer*interval '1 second') THEN now() ELSE auth_rate_limits.window_started_at END,
      attempts=CASE WHEN auth_rate_limits.window_started_at < now()-($3::integer*interval '1 second') THEN 1 ELSE auth_rate_limits.attempts+1 END,
      blocked_until=CASE WHEN auth_rate_limits.window_started_at < now()-($3::integer*interval '1 second') THEN NULL WHEN auth_rate_limits.attempts+1 > $2 THEN auth_rate_limits.window_started_at+($3::integer*interval '1 second') ELSE auth_rate_limits.blocked_until END
    RETURNING attempts, blocked_until > now() AS blocked`, [key, maxAttempts,windowSeconds]);
  if (row.rows[0]?.blocked) throw new AppError(429, "Too many attempts. Try again later.",'RATE_LIMITED',windowSeconds);
}
