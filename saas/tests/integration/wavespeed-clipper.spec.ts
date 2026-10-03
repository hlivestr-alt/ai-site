import { test, expect, request } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { owner, source, submit, base, lease, type Claim } from "../clipper-helpers";
import { contentEnv } from "../content-helpers";

test("WaveSpeed Clipper freezes its model and requires a matching configured private worker", async () => {
  const a = await owner(`wavespeed-clipper-${Date.now()}@example.test`);
  const provisioned = JSON.parse(execFileSync(process.execPath, ["--env-file=.env.local", "scripts/worker-admin.mjs", "create", `wavespeed-health-${Date.now()}`, "CLIPPER_V1", "1"], { env: contentEnv(), encoding: "utf8", windowsHide: true }));
  const worker = await request.newContext({ baseURL: base, extraHTTPHeaders: { Authorization: `Bearer ${provisioned.credential}` } });
  try {
    const s = await source(a.c, a.workspaceId), template = await submit(a.c, a.workspaceId, s.id, `wavespeed-clipper-template-${Date.now()}`);
    expect(template.status()).toBe(201); const templateId = (await template.json()).job.id;
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${templateId}/cancel`)).status()).toBe(200);
    const result = JSON.parse(execFileSync(process.execPath, ["--env-file=.env.local", "--import", "tsx", "tests/invoke-wavespeed-clipper.ts", a.workspaceId, templateId], { env: contentEnv(), encoding: "utf8", windowsHide: true }));
    const health = { transcriberAvailable: true, ffmpegAvailable: true, gpuAvailable: true, freeDiskBytes: 50 * 1024 ** 3 };
    for (const clipperHealth of [health, { ...health, analyzerConfigured: true, analyzerProvider: "openai", analyzerModel: "configured-direct-model" }, { ...health, analyzerConfigured: false, analyzerProvider: "wavespeed", analyzerModel: result.model }, { ...health, analyzerConfigured: true, analyzerProvider: "wavespeed", analyzerModel: "openai/gpt-5.6-sol" }]) {
      const heartbeat = await worker.post("/api/worker/heartbeat", { data: { agentVersion: "wavespeed-contract-test", pipelineVersion: "clipper-v1", availableSlots: 1, activeLeaseIds: [], clipperHealth } });
      expect(heartbeat.status(), await heartbeat.text()).toBe(200);
      expect((await (await worker.post("/api/worker/claim", { data: {} })).json()).claim).toBeNull();
    }
    expect((await worker.post("/api/worker/heartbeat", { data: { agentVersion: "wavespeed-contract-test", pipelineVersion: "clipper-v1", availableSlots: 1, activeLeaseIds: [], clipperHealth: { ...health, analyzerConfigured: true, analyzerProvider: "wavespeed", analyzerModel: result.model } } })).status()).toBe(200);
    const claim = (await (await worker.post("/api/worker/claim", { data: {} })).json()).claim as Claim;
    expect(claim.jobId).toBe(result.id); expect(claim.inputSnapshot.analyzerProvider).toBe("wavespeed"); expect(claim.inputSnapshot.analyzerModel).toBe(result.model);
    expect(JSON.stringify(claim)).not.toContain("API_KEY"); expect(JSON.stringify(claim)).not.toContain("storageKey");
    expect((await worker.post(`/api/worker/jobs/${claim.jobId}/fail`, { data: { ...lease(claim), errorCode: "CONTROLLED_CONTRACT_TEST", retriable: false, message: "Controlled routing test complete" } })).status()).toBe(200);
  } finally { await worker.dispose(); await a.c.dispose(); }
});
