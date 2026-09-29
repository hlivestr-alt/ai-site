import { defineConfig } from "@playwright/test";
import { scryptSync } from "node:crypto";
const salt="00112233445566778899aabbccddeeff";
const password="ui-validation-password-only";
export default defineConfig({
  testDir:"./tests/ui", fullyParallel:false, workers:1, timeout:45000,
  use:{baseURL:"http://127.0.0.1:3101",headless:true,launchOptions:{channel:"msedge"}},
  reporter:[["list"]], outputDir:"./test-results/auth-enabled",
  webServer:{command:"node node_modules/next/dist/bin/next start -p 3101 -H 127.0.0.1",url:"http://127.0.0.1:3101/login",reuseExistingServer:false,timeout:45000,
    env:{AUTH_ENABLED:"true",OUTREACH_QUEUE_ENABLED:"false",AI_SITE_PASSWORD_HASH:`scrypt:${salt}:${scryptSync(password,Buffer.from(salt,"hex"),64).toString("hex")}`,AI_SITE_SESSION_SECRET:"isolated-browser-validation-secret-at-least-32-characters",H3_BRIDGE_URL:"http://127.0.0.1:18788",OUTREACH_DATABASE_URL:"",CLIPPER_API_URL:"http://127.0.0.1:18765"}},
});
