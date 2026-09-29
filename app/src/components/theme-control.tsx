"use client";
import { useSyncExternalStore } from "react";
import { Icon } from "./icon";
export const THEME_KEY = "ai_site_theme";
const subscribe = (callback: () => void) => {
  window.addEventListener("ai-site-theme", callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener("ai-site-theme", callback); window.removeEventListener("storage", callback); };
};
export function ThemeControl({ expanded = false }: { expanded?: boolean }) {
  const theme = useSyncExternalStore(subscribe, () => document.documentElement.dataset.theme ?? "light", () => "light");
  function change(next: string) {
    document.documentElement.setAttribute("data-theme", next);
    try { localStorage.setItem(THEME_KEY, next); } catch { /* theme works without storage */ }
    window.dispatchEvent(new Event("ai-site-theme"));
  }
  if (expanded) return <div className="theme-options" role="group" aria-label="Color theme">{["light", "dark"].map(item => <button key={item} className={`button-outline ${theme === item ? "selected" : ""}`} aria-pressed={theme === item} onClick={() => change(item)}><Icon name={item === "light" ? "sun" : "moon"} />{item === "light" ? "Light" : "Dark"}</button>)}</div>;
  return <button className="icon-button" type="button" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => change(theme === "dark" ? "light" : "dark")}><Icon name={theme === "dark" ? "sun" : "moon"} /></button>;
}
