import { test, expect } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { owner } from "../clipper-helpers";
import { product, videoJob, contentEnv } from "../content-helpers";

test("WaveSpeed durable execution: one ambiguous submit, bounded GET recovery, verified private MP4 ingest and immutable Content", async () => {
  test.setTimeout(180000);
  const a = await owner(`wavespeed-${Date.now()}@example.test`);
  try {
    const p = await product(a.c, a.workspaceId), templateId = await videoJob(a.c, a.workspaceId, p.id);
    expect((await a.c.post(`/api/workspaces/${a.workspaceId}/jobs/${templateId}/cancel`)).status()).toBe(200);
    for (const [mode, status] of [["success", "SUCCEEDED"], ["unknown", "RECONCILING"], ["failed", "FAILED"], ["invalid-host", "FAILED"], ["invalid-mp4", "FAILED"], ["poll-rate-limit", "SUCCEEDED"], ["reference-unavailable", "FAILED"]]) {
      const result = JSON.parse(execFileSync(process.execPath, ["--env-file=.env.local", "--import", "tsx", "tests/invoke-wavespeed.ts", a.workspaceId, templateId, mode], { env: { ...contentEnv(), WAVESPEED_REFERENCE_FETCH_VERIFIED: "0" }, encoding: "utf8", windowsHide: true, timeout: 45000 }));
      expect(result.job.status, mode).toBe(status);
      expect(result.submissions, mode).toBe(mode === "reference-unavailable" ? 0 : 1);
      expect(result.execution.submit_count).toBe(1);
      expect(result.job.input_snapshot.executionProvider).toBe("WAVESPEED");
      if (status === "SUCCEEDED") {
        expect(result.artifacts).toHaveLength(1); expect(result.artifacts[0].status).toBe("READY"); expect(result.artifacts[0].sha256).toBe(result.expectedSha256);
        expect(result.artifacts[0].storage_key).toContain(`/jobs/${result.id}/outputs/`); expect(result.contentIds).toHaveLength(1);
        const downloaded = await a.c.get(`/api/workspaces/${a.workspaceId}/ai-videos/${result.id}/artifacts/${result.artifacts[0].id}/download`);
        expect(downloaded.status()).toBe(200); expect((await downloaded.json()).url).not.toContain("wavespeed");
        const detail = await a.c.get(`/api/workspaces/${a.workspaceId}/content/${result.contentIds[0]}`); expect(detail.status()).toBe(200); expect(await detail.text()).not.toContain("cloudfront.net");
      }
      if (mode === "unknown") { expect(result.polls).toBe(0); expect(result.execution.state).toBe("SUBMISSION_UNKNOWN"); expect(result.artifacts).toHaveLength(0); }
      if (mode === "invalid-host") { expect(result.downloads).toBe(0); expect(result.job.error_code).toBe("OUTPUT_INVALID"); }
      if (mode === "invalid-mp4") { expect(result.artifacts).toHaveLength(0); expect(result.job.error_code).toBe("OUTPUT_INVALID"); }
      if (mode === "poll-rate-limit") expect(result.polls).toBeGreaterThan(2);
    }
  } finally { await a.c.dispose(); }
});
