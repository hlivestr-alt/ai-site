import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { requiredPageSession } from "@/lib/page";
import { listWorkspaces } from "@/lib/workspaces";

export default async function Onboarding() {
  const session = await requiredPageSession();
  if ((await listWorkspaces(session.userId)).length) redirect("/");
  return <OnboardingForm displayName={session.displayName} />;
}
