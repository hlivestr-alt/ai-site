import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The native application owns this value. Read its exported constant instead of copying it.
export async function nativeMessageTemplate(file = process.env.OUTREACH_NATIVE_DOMAIN_FILE || join("C:", "Data", "TikTok Outreach", "packages", "domain", "src", "index.ts")) {
  const source = await readFile(file, "utf8");
  const match = /export const DEFAULT_OUTREACH_MESSAGE_TEMPLATE\s*=\s*`([^`]*)`;/.exec(source);
  if (!match || !match[1].trim() || match[1].length > 2000 || match[1].includes("${")) throw new Error("Unable to load outreach message template.");
  return match[1];
}
