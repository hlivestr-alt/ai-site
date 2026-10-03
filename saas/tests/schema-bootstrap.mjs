import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import pg from "pg";

process.loadEnvFile(".env.local");
const source=process.env.TEST_DATABASE_URL;
if(!source)throw new Error("TEST_DATABASE_URL is required");
const admin=new URL(source);admin.pathname="/postgres";
const name=`phase3_bootstrap_${randomBytes(5).toString("hex")}`;
const target=new URL(source);target.pathname=`/${name}`;
const client=new pg.Client({connectionString:admin.toString()});
await client.connect();
let created=false;
try{
  await client.query(`CREATE DATABASE ${name}`);created=true;
  const env={...process.env,DATABASE_URL:target.toString()};
  const up=execFileSync(process.execPath,["scripts/migrate.mjs","up"],{cwd:process.cwd(),env,encoding:"utf8"});
  const status=execFileSync(process.execPath,["scripts/migrate.mjs","status"],{cwd:process.cwd(),env,encoding:"utf8"});
  if(!["0001_identity_workspaces.sql","0002_products_assets.sql","0003_jobs_workers.sql","0004_ai_video_provider.sql","0005_clipper.sql","0006_content_review.sql","0007_billing_tokens.sql","0008_workflows.sql","0009_paid_beta_hardening.sql","0010_wavespeed_providers.sql"].every(file=>status.includes(`applied ${file}`)))throw new Error("Clean bootstrap did not apply every migration");
  console.log(up.trim());console.log("Clean bootstrap passed");
}finally{
  if(created)await client.query(`DROP DATABASE ${name} WITH (FORCE)`);
  await client.end();
}
