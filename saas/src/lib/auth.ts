import "server-only";
import { query, transaction, type DbClient } from "./db";
import { AppError, audit, displayName, hashPassword, hashToken, normalizeEmail, randomToken, rateLimit, safeNext, validPassword, verifyPassword } from "./core";
import { enqueueMail } from "./mail-core";

export type Session = { id: string; userId: string; email: string; displayName: string; activeWorkspaceId: string | null; expiresAt: Date };
export const SESSION_COOKIE = "saas_session";

export async function createSession(db: DbClient, userId: string): Promise<{ raw: string; id: string }> {
  const raw = randomToken();
  const first = await db.query<{ workspace_id: string }>("SELECT workspace_id FROM workspace_members WHERE user_id=$1 AND status='ACTIVE' ORDER BY created_at LIMIT 1", [userId]);
  const inserted = await db.query<{ id: string }>("INSERT INTO sessions(user_id,token_hash,active_workspace_id,expires_at) VALUES($1,$2,$3,now()+interval '14 days') RETURNING id", [userId, hashToken(raw), first.rows[0]?.workspace_id ?? null]);
  return { raw, id: inserted.rows[0].id };
}

export async function getSession(raw: string | undefined): Promise<Session | null> {
  if (!raw || raw.length > 120) return null;
  const result = await query<{ id: string; user_id: string; email: string; display_name: string; active_workspace_id: string | null; expires_at: Date }>(`
    SELECT s.id,s.user_id,u.email,u.display_name,s.active_workspace_id,s.expires_at
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=$1 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='ACTIVE'`, [hashToken(raw)]);
  const row = result.rows[0];
  return row ? { id: row.id, userId: row.user_id, email: row.email, displayName: row.display_name, activeWorkspaceId: row.active_workspace_id, expiresAt: row.expires_at } : null;
}

async function queueAuthLink(db:DbClient,userId:string,email:string,kind:"VERIFY_EMAIL"|"RESET_PASSWORD",next?:unknown) {
  const raw=randomToken();
  await db.query("UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND kind=$2 AND used_at IS NULL",[userId,kind]);
  const token=(await db.query<{id:string}>("INSERT INTO auth_tokens(user_id,kind,token_hash,expires_at) VALUES($1,$2,$3,now()+CASE WHEN $2='VERIFY_EMAIL' THEN interval '24 hours' ELSE interval '30 minutes' END) RETURNING id",[userId,kind,hashToken(raw)])).rows[0];
  const link=new URL(kind==='VERIFY_EMAIL'?'/verify':'/reset-password',process.env.APP_BASE_URL);
  link.searchParams.set('token',raw);
  if(kind==='VERIFY_EMAIL')link.searchParams.set('next',safeNext(next));
  return enqueueMail(db,email,kind==='VERIFY_EMAIL'?'Verify your account':'Reset your password',link.toString(),token.id);
}

export async function register(input: { email: unknown; displayName: unknown; password: unknown; next?:unknown }): Promise<{ deliveryId:string|null }> {
  const email = normalizeEmail(input.email), name = displayName(input.displayName), password = validPassword(input.password);
  await rateLimit({ query }, "register", email, 5);
  const passwordHash = await hashPassword(password);
  return transaction(async db => {
    const inserted = await db.query<{ id: string }>("INSERT INTO users(email,display_name,password_hash,status) VALUES($1,$2,$3,'PENDING_VERIFICATION') ON CONFLICT(email) DO NOTHING RETURNING id", [email, name, passwordHash]);
    const user=(await db.query<{id:string;status:string}>("SELECT id,status FROM users WHERE email=$1 FOR UPDATE",[email])).rows[0];
    if(user.status!=='PENDING_VERIFICATION')return {deliveryId:null};
    // Retrying never changes the original account password or profile.
    const deliveryId=await queueAuthLink(db,user.id,email,'VERIFY_EMAIL',input.next);
    await audit(db, { actorUserId: user.id, type: inserted.rows.length?"USER_REGISTERED":"EMAIL_VERIFICATION_REQUESTED", targetType: "user", targetId: user.id });
    return {deliveryId};
  });
}

export async function verifyEmailToken(raw: string): Promise<{ raw: string }> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(raw)) throw new AppError(400, "Verification link is invalid or expired.");
  return transaction(async db => {
    const owner=(await db.query<{user_id:string}>("SELECT user_id FROM auth_tokens WHERE token_hash=$1 AND kind='VERIFY_EMAIL'",[hashToken(raw)])).rows[0];
    if(!owner)throw new AppError(400,"Verification link is invalid or expired.");
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner.user_id]);
    const found = await db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>("SELECT id,user_id,expires_at,used_at FROM auth_tokens WHERE token_hash=$1 AND kind='VERIFY_EMAIL' FOR UPDATE", [hashToken(raw)]);
    const token = found.rows[0];
    if (!token || token.used_at || token.expires_at <= new Date()) throw new AppError(400, "Verification link is invalid or expired.");
    await db.query("UPDATE auth_tokens SET used_at=now() WHERE id=$1", [token.id]);
    await db.query("UPDATE users SET status='ACTIVE',email_verified_at=now(),updated_at=now() WHERE id=$1", [token.user_id]);
    await audit(db, { actorUserId: token.user_id, type: "EMAIL_VERIFIED", targetType: "user", targetId: token.user_id });
    return createSession(db, token.user_id);
  });
}

export async function login(input: { email: unknown; password: unknown }): Promise<{ raw: string }> {
  const email = normalizeEmail(input.email);
  if (typeof input.password !== "string") throw new AppError(401, "Invalid email or password.");
  await rateLimit({ query }, "login", email, 10);
  const result = await query<{ id: string; password_hash: string; status: string }>("SELECT id,password_hash,status FROM users WHERE email=$1", [email]);
  const user = result.rows[0];
  if (!user || !(await verifyPassword(input.password, user.password_hash))) throw new AppError(401, "Invalid email or password.");
  if (user.status !== "ACTIVE") throw new AppError(403, "Verify your account before signing in.");
  return transaction(async db => {
    const session = await createSession(db, user.id);
    await audit(db, { actorUserId: user.id, type: "USER_LOGIN", targetType: "user", targetId: user.id });
    return session;
  });
}

export async function logout(session: Session): Promise<void> {
  await transaction(async db => {
    await db.query("UPDATE sessions SET revoked_at=now() WHERE id=$1 AND revoked_at IS NULL", [session.id]);
    await audit(db, { actorUserId: session.userId, type: "USER_LOGOUT", targetType: "user", targetId: session.userId });
  });
}

export async function requestVerification(emailInput:unknown){
  const email=normalizeEmail(emailInput);await rateLimit({query},'resend-verification',email,4);
  return transaction(async db=>{
    const u=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND status='PENDING_VERIFICATION' FOR UPDATE",[email])).rows[0];if(!u)return null;
    const deliveryId=await queueAuthLink(db,u.id,email,'VERIFY_EMAIL');
    await audit(db,{actorUserId:u.id,type:'EMAIL_VERIFICATION_REQUESTED',targetType:'user',targetId:u.id});return deliveryId;
  });
}
export async function requestPasswordReset(emailInput: unknown): Promise<string | null> {
  const email = normalizeEmail(emailInput);
  await rateLimit({ query }, "reset-request", email, 4);
  return transaction(async db => {
    const user=(await db.query<{id:string}>("SELECT id FROM users WHERE email=$1 AND status='ACTIVE' FOR UPDATE",[email])).rows[0];if(!user)return null;
    const deliveryId=await queueAuthLink(db,user.id,email,'RESET_PASSWORD');
    await audit(db, { actorUserId: user.id, type: "PASSWORD_RECOVERY_REQUESTED", targetType: "user", targetId: user.id });
    return deliveryId;
  });
}

export async function resetPassword(raw: string, passwordInput: unknown): Promise<void> {
  if (!/^[A-Za-z0-9_-]{30,100}$/.test(raw)) throw new AppError(400, "Reset link is invalid or expired.");
  const passwordHash = await hashPassword(validPassword(passwordInput));
  await transaction(async db => {
    const owner=(await db.query<{user_id:string}>("SELECT user_id FROM auth_tokens WHERE token_hash=$1 AND kind='RESET_PASSWORD'",[hashToken(raw)])).rows[0];
    if(!owner)throw new AppError(400,"Reset link is invalid or expired.");
    await db.query('SELECT id FROM users WHERE id=$1 FOR UPDATE',[owner.user_id]);
    const found = await db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>("SELECT id,user_id,expires_at,used_at FROM auth_tokens WHERE token_hash=$1 AND kind='RESET_PASSWORD' FOR UPDATE", [hashToken(raw)]);
    const token = found.rows[0];
    if (!token || token.used_at || token.expires_at <= new Date()) throw new AppError(400, "Reset link is invalid or expired.");
    await db.query("UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2", [passwordHash, token.user_id]);
    await db.query("UPDATE auth_tokens SET used_at=now() WHERE user_id=$1 AND kind='RESET_PASSWORD' AND used_at IS NULL", [token.user_id]);
    await db.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [token.user_id]);
    await audit(db, { actorUserId: token.user_id, type: "PASSWORD_RESET", targetType: "user", targetId: token.user_id });
  });
}
