import assert from "node:assert/strict";
import { test } from "node:test";
import { mapPreviewRecipients, nativeAction, outreachApiUrl, validateDraft, validateVersion } from "./write";

const draft = { messageTemplate: "Hello {{creator_display_name}}", targetCount: 10, cooldownDays: 30, rankingMetric: "FOLLOWERS", filters: { minFollowers: 1000 } };

test("native URL cannot point to remote hosts, credentials, or arbitrary paths", () => {
  for (const url of ["https://127.0.0.1:4000", "http://evil.invalid", "http://127.0.0.1:4000/path", "http://user:password@localhost:4000"]) assert.throws(() => outreachApiUrl(url));
  assert.equal(outreachApiUrl("http://127.0.0.1:4000"), "http://127.0.0.1:4000");
});

test("draft and freeze validators accept native fields and reject unsupported values", () => {
  assert.equal(validateDraft(draft).targetCount, 10);
  assert.equal("productName" in validateDraft({ ...draft, productName: "ignored", campaignName: "ignored" }), false);
  assert.throws(() => validateDraft({ ...draft, filters: { inventedFilter: true } }));
  assert.throws(() => validateDraft({ ...draft, targetCount: 501 }));
  assert.equal(validateVersion({ version: 2 }), 2);
  assert.throws(() => validateVersion({ version: "2" }));
});

test("recipient preview mapping exposes selected and exclusion state only", () => {
  const result = mapPreviewRecipients([{ selected: true, eligibility: "ELIGIBLE", skipReason: null, creator: { nickname: "Creator", creatorOpenId: "private" }, snapshot: { followerCount: 1234, rawPayload: { secret: true } } }]);
  assert.equal(result[0].displayName, "Creator");
  assert.equal(result[0].followerCount, 1234);
  assert.equal(JSON.stringify(result).includes("private"), false);
});

test("native action allowlist excludes Send; failure is explicit and no sender is called", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return new Response("{}", { status: 503 }); }) as typeof fetch;
  await assert.rejects(() => nativeAction("/api/v1/outreach/campaigns/id/send", {}, fetcher));
  assert.equal(calls, 0);
  await assert.rejects(() => nativeAction("/api/v1/outreach/campaigns", draft, fetcher), /rejected/);
  assert.equal(calls, 1);
});

test("malformed native action response omits raw payload", async () => {
  await assert.rejects(() => nativeAction("/api/v1/outreach/campaigns", draft, (async () => new Response('private-token={"broken":')) as typeof fetch), /^Error: Outreach response was invalid$/);
});
