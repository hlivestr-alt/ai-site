import "server-only";
import { mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const mailbox = join(process.cwd(), "data", "mailbox");

function localMailAllowed(): boolean {
  const base = process.env.APP_BASE_URL || "";
  return process.env.APP_ENV === "local" && process.env.MAIL_MODE === "development_file" && /^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base);
}

export async function deliverLocalMail(to: string, subject: string, url: string) {
  if (!localMailAllowed()) throw new Error("No mail transport is configured");
  await mkdir(mailbox, { recursive: true });
  await writeFile(join(mailbox, `${Date.now()}-${randomUUID()}.json`), JSON.stringify({ to, subject, url, createdAt: new Date().toISOString() }), { encoding: "utf8", flag: "wx", mode: 0o600 });
}

export async function localMailbox() {
  if (!localMailAllowed()) return null;
  await mkdir(mailbox, { recursive: true });
  const names = (await readdir(mailbox)).filter(x => x.endsWith(".json")).sort().reverse().slice(0, 50);
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(mailbox, name), "utf8")) as { to: string; subject: string; url: string; createdAt: string }));
}
