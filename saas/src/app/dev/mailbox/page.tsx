import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { localMailbox } from "@/lib/mail";

export default async function DevelopmentMailbox() {
  const host=(await headers()).get("host") || "";
  if (process.env.APP_ENV !== "local" || !/^127\.0\.0\.1:3200$/.test(host)) notFound();
  const messages=await localMailbox();
  if (!messages) notFound();
  return <main className="simple-page"><Link className="wordmark" href="/">Content Workspace <span>Preview</span></Link><section className="simple-card mailbox-card"><p className="eyebrow">LOCAL DEVELOPMENT ONLY</p><h1>Test mailbox</h1><p>Verification, recovery and invitation links created on this machine appear here. Refresh for new messages.</p>{messages.length?messages.map((message,index)=><div className="mail-item" key={`${message.createdAt}-${index}`}><small>{new Date(message.createdAt).toLocaleString()}</small><strong>{message.subject}</strong><span>{message.to}</span><a href={message.url}>Open link →</a></div>):<p className="muted">No messages yet.</p>}</section></main>;
}
