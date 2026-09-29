import pg from "pg";
import { randomBytes, scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

if (process.env.APP_ENV !== "local" || !process.env.DATABASE_URL) throw new Error("Development seed requires APP_ENV=local and DATABASE_URL");
const scrypt = promisify(scryptCallback);
const password = process.env.SAAS_TEST_SEED_PASSWORD || randomBytes(18).toString("base64url");
const salt = randomBytes(16);
const hash = `scrypt:${salt.toString("hex")}:${(await scrypt(password,salt,64)).toString("hex")}`;
const client = new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try {
  await client.query("BEGIN");
  const users = {};
  for (const [key,email,name] of [["a","brand-a-owner@seed.local","Brand A Owner"],["editor","brand-a-editor@seed.local","Brand A Editor"],["b","brand-b-owner@seed.local","Brand B Owner"]]) {
    const result=await client.query("INSERT INTO users(email,display_name,password_hash,status,email_verified_at) VALUES($1,$2,$3,'ACTIVE',now()) ON CONFLICT(email) DO UPDATE SET display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,status='ACTIVE',email_verified_at=now() RETURNING id",[email,name,hash]);
    users[key]=result.rows[0].id;
  }
  for (const [slug,name,owner] of [["seed-brand-a","Brand A","a"],["seed-brand-b","Brand B","b"]]) {
    const workspace=await client.query("INSERT INTO workspaces(name,slug,created_by) VALUES($1,$2,$3) ON CONFLICT(slug) DO UPDATE SET name=EXCLUDED.name RETURNING id",[name,slug,users[owner]]);
    const id=workspace.rows[0].id;
    await client.query("INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'OWNER','ACTIVE') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='OWNER',status='ACTIVE'",[id,users[owner]]);
    if (slug==="seed-brand-a") await client.query("INSERT INTO workspace_members(workspace_id,user_id,role,status) VALUES($1,$2,'EDITOR','ACTIVE') ON CONFLICT(workspace_id,user_id) DO UPDATE SET role='EDITOR',status='ACTIVE'",[id,users.editor]);
  }
  await client.query("COMMIT");
  console.log("Seeded isolated Brand A and Brand B test workspaces. Seed account password:",password);
} catch(error) { await client.query("ROLLBACK"); throw error; }
finally { await client.end(); }
