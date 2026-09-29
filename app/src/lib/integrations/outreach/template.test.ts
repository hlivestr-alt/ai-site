import assert from "node:assert/strict";
import { test } from "node:test";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeMessageTemplate } from "./template";

test("loads the editable native default without a copied Platform template", async () => {
  const message = await nativeMessageTemplate();
  assert.match(message, /Halo kak \{\{creator_display_name\}\}/);
  assert.ok(message.length > 100);
});

test("missing or malformed native template fails closed", async () => {
  await assert.rejects(() => nativeMessageTemplate(join(tmpdir(), "missing-outreach-template.ts")));
  const folder = await mkdtemp(join(tmpdir(), "outreach-template-"));
  try {
    const file = join(folder, "index.ts");
    await writeFile(file, "export const DEFAULT_OUTREACH_MESSAGE_TEMPLATE = ``;");
    await assert.rejects(() => nativeMessageTemplate(file), /Unable to load/);
  } finally { await rm(folder, { recursive: true, force: true }); }
});
