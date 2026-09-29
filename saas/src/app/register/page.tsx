import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { pageSession, safeNext } from "@/lib/page";

export default async function Register({searchParams}:{searchParams:Promise<{next?:string}>}) {
  const next = safeNext((await searchParams).next);
  if (await pageSession()) redirect(next || "/");
  return <AuthForm mode="register" next={next} showMailbox={process.env.APP_ENV === "local"} />;
}
