import { execFileSync } from "node:child_process";

export default function setup() {
  if (!process.env.TEST_DATABASE_URL) throw new Error("No isolated test database configured");
  execFileSync(process.execPath,["scripts/migrate.mjs","up"],{
    cwd:process.cwd(),
    env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL},
    stdio:"inherit",
  });
  execFileSync(process.execPath,["--import","tsx","scripts/billing-seed-test.ts"],{cwd:process.cwd(),env:{...process.env,DATABASE_URL:process.env.TEST_DATABASE_URL,APP_ENV:"local",ENABLE_TEST_BILLING:"1"},stdio:"inherit"});
  execFileSync(process.execPath,["scripts/storage-init.mjs"],{
    cwd:process.cwd(),env:process.env,stdio:"inherit",
  });
}
