import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { owner } from "../clipper-helpers";
import { product, videoJob, contentEnv } from "../content-helpers";

for (const mode of ["success", "transient"]) test(`WaveSpeed existing-output recovery: ${mode}, original identity, private MP4 and idempotent Content`, async () => {
  test.setTimeout(120000);
  const a = await owner(`wavespeed-recovery-${mode}-${Date.now()}@example.test`);
  try {
    const p = await product(a.c, a.workspaceId), templateId = await videoJob(a.c, a.workspaceId, p.id);
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${templateId}/cancel`)).status()).toBe(200);
    const result = JSON.parse(execFileSync(process.execPath, ["--env-file=.env.local", "--import", "tsx", "tests/invoke-wavespeed-recovery.ts", a.workspaceId, templateId, mode], { env: contentEnv(), encoding: "utf8", windowsHide: true, timeout: 60000 }));
    expect(result.after.jobStatus).toBe("SUCCEEDED"); expect(result.after.state).toBe("SUCCEEDED"); expect(result.after.attemptStatus).toBe("SUCCEEDED");
    expect(result.posts).toBe(0); expect(result.after.submitCount).toBe(1); expect(result.after.predictionId).toBe(result.before.predictionId);
    expect(result.artifacts).toHaveLength(1); expect(result.artifacts[0].status).toBe("READY"); expect(result.privateStorageVerified).toBe(true); expect(result.contentIds).toHaveLength(1);
    const downloaded = await a.c.get(`/api/workspaces/${a.workspaceId}/ai-videos/${result.id}/artifacts/${result.artifacts[0].id}/download`);
    expect(downloaded.status()).toBe(200); expect((await downloaded.json()).url).not.toContain("cloudfront.net");
    const detail = await a.c.get(`/api/workspaces/${a.workspaceId}/content/${result.contentIds[0]}`); expect(detail.status()).toBe(200); expect(await detail.text()).not.toContain("Signature=");
    if (mode === "transient") { expect(result.after.ingestCount).toBe(7); expect(result.events).toHaveLength(2); }
  } finally { await a.c.dispose(); }
});
