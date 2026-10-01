import "server-only";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {deliverMail} from './mail-core';

const mailbox = join(process.cwd(), "data", "mailbox");

function localMailAllowed(): boolean {
  const base = process.env.APP_BASE_URL || "";
  return process.env.APP_ENV === "local" && process.env.MAIL_MODE === "development_file" && /^http:\/\/(127\.0\.0\.1|localhost):3200$/.test(base);
}

export async function deliverLocalMail(to: string, subject: string, url: string) {
  await deliverMail(to,subject,url);
}

export async function localMailbox() {
  if (!localMailAllowed()) return null;
  await mkdir(mailbox, { recursive: true });
  const names = (await readdir(mailbox)).filter(x => x.endsWith(".json")).sort().reverse().slice(0, 50);
  return Promise.all(names.map(async name => JSON.parse(await readFile(join(mailbox, name), "utf8")) as { to: string; subject: string; url: string; createdAt: string }));
}
