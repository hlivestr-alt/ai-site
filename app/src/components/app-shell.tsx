"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { Icon, type IconName } from "./icon";
import { ThemeControl } from "./theme-control";
const items: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Home", icon: "home" }, { href: "/ai-videos", label: "AI Videos", icon: "video" },
  { href: "/clipper", label: "Clipper", icon: "scissors" }, { href: "/outreach", label: "Outreach", icon: "send" }, { href: "/settings", label: "Settings", icon: "settings" },
];
export function SignOutButton() {
  async function logout() {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (response.ok || response.status === 401) { window.location.replace("/login"); }
  }
  return <button className="button-outline logout-button" type="button" onClick={() => void logout()}><Icon name="logout" size={17} />Log Out</button>;
}
export function AppShell({ children, authEnabled }: { children: React.ReactNode; authEnabled: boolean }) {
  const pathname = usePathname();
  useEffect(() => {
    if (!authEnabled || pathname === "/login") return;
    const check = () => { void fetch("/api/auth/session", { cache: "no-store" }).then(response => { if (response.status === 401) { window.location.replace("/login"); } }).catch(() => undefined); };
    const timer = window.setInterval(check, 60_000); return () => window.clearInterval(timer);
  }, [pathname, authEnabled]);
  if (pathname === "/login") return <>{children}</>;
  return <div className="app-shell"><aside className="sidebar">
    <Link className="brand" href="/" aria-label="AI Site home"><span className="brand-mark"><Icon name="sparkles" size={24} /></span><span className="brand-name">AI Site</span></Link>
    <nav className="nav-list" aria-label="Main navigation">{items.map(item => { const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href); return <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`nav-item ${active ? "active" : ""}`} title={item.label}><Icon name={item.icon} size={22} /><span className="nav-text">{item.label}</span></Link>; })}</nav>
    {authEnabled && <div className="sidebar-bottom"><span className="status-dot" />Account<SignOutButton /></div>}
  </aside><div className="main"><header className="topbar"><div className="global-search" aria-disabled="true"><Icon name="search" size={18} /><span>Search videos, campaigns, and more…</span><kbd>Coming soon</kbd></div><div className="top-right"><ThemeControl />{authEnabled && <><span className="topbar-separator" /><Link className="operator-account" href="/settings"><div className="avatar"><Icon name="user" size={19} /></div><span><strong>Operator</strong></span></Link></>}</div></header><main className="content">{children}</main></div></div>;
}
