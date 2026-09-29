import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getSession, SESSION_COOKIE } from "./auth";
import { currentWorkspace, listWorkspaces } from "./workspaces";

export async function pageSession() {
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSession(raw);
}

export async function requiredPageSession() {
  const session = await pageSession();
  if (!session) redirect("/login");
  return session;
}

export async function pageWorkspace() {
  const session = await requiredPageSession();
  const workspaces = await listWorkspaces(session.userId);
  const current = await currentWorkspace(session);
  if (!current) redirect("/onboarding");
  return { session, workspaces, current };
}

export function safeNext(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.startsWith("/") || value.startsWith("//") || value.includes("\\")) return undefined;
  return value;
}
