import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";
export function PageHeader({ title, description, icon, action }: { title: string; description: string; icon?: IconName; action?: ReactNode }) {
  return <div className="page-head"><div className="page-heading">{icon && <span className="page-icon"><Icon name={icon} size={28} /></span>}<div><h1 className="page-title">{title}</h1><p className="page-description">{description}</p></div></div>{action && <div className="header-actions">{action}</div>}</div>;
}
export function StatusBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "success" | "warning" | "danger" | "info" }) {
  return <span className={`status-badge ${tone}`}><i />{children}</span>;
}
export function EmptyState({ title, detail, icon = "layers" }: { title: string; detail?: string; icon?: IconName }) {
  return <div className="empty-state"><span><Icon name={icon} size={28} /></span><strong>{title}</strong>{detail && <p>{detail}</p>}</div>;
}
export function MetricCard({ label, value, detail, icon, tone = "orange" }: { label: string; value: ReactNode; detail: string; icon: IconName; tone?: string }) {
  return <article className={`card metric-card ${tone}`}><span className="metric-icon"><Icon name={icon} size={25} /></span><div><p>{label}</p><strong>{value}</strong><small>{detail}</small></div></article>;
}
