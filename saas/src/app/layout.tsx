import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Content Workspace | Customer preview",
  description: "Customer identity, workspace and team access preview.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
