import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL is required");
const mode = process.argv[2] || "status";
if (!["up", "status"].includes(mode)) throw new Error("Usage: migrate.mjs up|status");
const pool = new pg.Pool({ connectionString: url, max: 1 });
const migrationDir = fileURLToPath(new URL("../migrations/", import.meta.url));
const files = (await readdir(migrationDir)).filter(x => /^\d{4}_[a-z0-9_]+\.sql$/.test(x)).sort();
const client = await pool.connect();
try {
  await client.query("SELECT pg_advisory_lock(731052133)");
  await client.query("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, sha256 text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())");
  const applied = new Map((await client.query("SELECT name, sha256 FROM schema_migrations ORDER BY name")).rows.map(x => [x.name, x.sha256]));
  for (const name of files) {
    const sql = await readFile(join(migrationDir, name), "utf8");
    const hash = createHash("sha256").update(sql).digest("hex");
    if (applied.has(name) && applied.get(name) !== hash) throw new Error(`Applied migration changed: ${name}`);
    if (mode === "status") { process.stdout.write(`${applied.has(name) ? "applied" : "pending"} ${name}\n`); continue; }
    if (applied.has(name)) continue;
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)", [name, hash]);
      await client.query("COMMIT");
      process.stdout.write(`applied ${name}\n`);
    } catch (error) { await client.query("ROLLBACK"); throw error; }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(731052133)").catch(() => undefined);
  client.release();
  await pool.end();
}
