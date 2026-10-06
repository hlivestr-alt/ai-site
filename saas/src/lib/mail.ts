import "server-only";
import { mkdir, readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {deliverMail} from './mail-core';
import {nonProductionTestAllowed} from './operational-config';

const mailbox = join(process.cwd(), "data", "mailbox");

export function localMailAllowed(): boolean {
  return nonProductionTestAllowed() && (process.env.MAIL_PROVIDER||process.env.MAIL_MODE) === "development_file";
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
