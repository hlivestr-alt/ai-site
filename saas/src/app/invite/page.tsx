import { InviteAccept } from "@/components/invite-accept";
import Link from "next/link";
import { pageSession } from "@/lib/page";
import { invitationPreview } from "@/lib/workspaces";

export default async function Invite({searchParams}:{searchParams:Promise<{token?:string}>}) {
  const token=(await searchParams).token || "";
  const session=await pageSession();
  const invite=await invitationPreview(token).catch(()=>null);
  const next=`/invite?token=${encodeURIComponent(token)}`;
  return <main className="simple-page"><Link className="wordmark" href="/">Content Workspace <span>Preview</span></Link><section className="simple-card"><p className="eyebrow">TEAM INVITATION</p>{invite?<><h1>Join {invite.workspaceName}</h1><p>You have been invited as a <strong>{invite.role.toLowerCase()}</strong>. This invitation expires {new Date(invite.expiresAt).toLocaleDateString()}.</p>{session?<><p className="helper">Signed in as {session.email}. Only the invited email can accept.</p><InviteAccept token={token} /></>:<div className="action-row"><Link className="button primary" href={`/register?next=${encodeURIComponent(next)}`}>Create account</Link><Link className="button secondary" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></div>}</>:<><h1>Invitation unavailable</h1><p>This link is invalid, expired or has already been used.</p><Link className="button secondary" href="/">Go home</Link></>}</section></main>;
}
