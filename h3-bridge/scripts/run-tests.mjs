import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const result = spawnSync(process.execPath, [resolve("node_modules/tsx/dist/cli.mjs"), "--test", "src/bridge.test.ts"], {
  cwd: process.cwd(),
  env: { ...process.env, BRIDGE_DATA_DIR: resolve("test-data") },
  stdio: "inherit",
});
process.exit(result.status ?? 1);
