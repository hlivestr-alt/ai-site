import type { Metadata } from "next";
import { connection } from "next/server";
import { authEnabled } from "@/lib/auth/config";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI Site",
  description: "Internal workspace for AI Site creative operations",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  await connection();
  return <html lang="en" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: `(function(){try{var t=localStorage.getItem('ai_site_theme');document.documentElement.dataset.theme=t==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})()` }} /></head><body><AppShell authEnabled={authEnabled()}>{children}</AppShell></body></html>;
}
