import { connection } from "next/server";
import { authEnabled } from "@/lib/auth/config";
import { queueEnabled } from "@/lib/integrations/outreach/queue";
import { SystemStatus } from "@/components/system-status";
import { ThemeControl } from "@/components/theme-control";
import { SignOutButton } from "@/components/app-shell";
import { Icon } from "@/components/icon";
import { PageHeader, StatusBadge } from "@/components/ui";
export default async function SettingsPage() {
  await connection();
  const enabled = authEnabled();
  return <><PageHeader title="Settings" description={enabled ? "Manage your account, system status, and workspace preferences." : "System status and preferences."} />
    <section className="card panel"><div className="section-top"><h2><Icon name="activity" />System Status</h2><span className="field-note">Live service checks · refreshes automatically</span></div><SystemStatus /><p className="field-note">Outreach Sending — {queueEnabled() ? "Enabled" : "Disabled"}</p></section>
    {enabled && <div className="settings-grid"><section className="card setting-card"><h2 className="settings-title"><Icon name="user" />Account</h2><p>Your operator account and current session.</p><div className="account-info"><div className="avatar"><Icon name="user" size={29} /></div><div><strong>Operator</strong><p>AI Site</p></div></div><div className="divider" /><div className="connection-head"><div><span className="field-label">Current login</span><StatusBadge tone="success">Authenticated session</StatusBadge></div><SignOutButton /></div></section>
    <section className="card setting-card"><h2 className="settings-title"><Icon name="shield" />Security</h2><p>Protections built into your operator workspace.</p><div style={{marginTop:18}}>{["Operator login required","Server-side session protection","Same-origin write protection"].map(label=><div className="security-row" key={label}><Icon name="check" size={18} /><span>{label}</span><span>Active</span></div>)}</div><p className="field-note">Account access is managed by your platform administrator.</p></section></div>}
    <div className="settings-grid"><section className="card setting-card"><h2 className="settings-title"><Icon name="sun" />Appearance</h2><p>Choose the theme that works best for you. Your preference is saved on this browser.</p><ThemeControl expanded /></section><section className="card setting-card"><h2 className="settings-title"><Icon name="layers" />Operations</h2><p>AI Site connects your creative tools in one workspace. Editing and publishing clips stay in Clipper. Campaign sending follows the existing server policy.</p><div className="divider" /><p>Start and manage services through the local operations scripts. Contact your administrator for logs or configuration changes.</p></section></div>
  </>;
}
