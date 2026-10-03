import base from "./playwright.config";
import { defineConfig } from "@playwright/test";

const publicEndpoint = "https://storage-test.proyaofficial.com";
process.env.OBJECT_STORAGE_PUBLIC_ENDPOINT = publicEndpoint;
process.env.OBJECT_STORAGE_ALLOWED_ORIGINS = "http://127.0.0.1:3200,https://ai-test.proyaofficial.com";
const server = Array.isArray(base.webServer) ? base.webServer[0] : base.webServer!;

// This exercises the public canonical Host on the existing port, without needing public DNS.
// Configure/recreate object-gateway with these same remote-test endpoints/origins first.
export default defineConfig({
  ...base, testIgnore: [], testMatch: ["**/integration/remote-storage.spec.ts"], timeout: 180_000,
  webServer: { ...server, env: { ...server.env, OBJECT_STORAGE_PUBLIC_ENDPOINT: publicEndpoint } },
});
