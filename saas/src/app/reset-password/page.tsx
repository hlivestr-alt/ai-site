import { localMailAllowed } from "@/lib/mail";
import { AuthForm } from "@/components/auth-form";
export default async function ResetPassword({searchParams}:{searchParams:Promise<{token?:string}>}) { return <AuthForm mode="reset" token={(await searchParams).token} showMailbox={localMailAllowed()} />; }
