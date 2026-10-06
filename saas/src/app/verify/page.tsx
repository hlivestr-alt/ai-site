import { localMailAllowed } from "@/lib/mail";
import { AuthForm } from "@/components/auth-form";
import { safeNext } from "@/lib/page";
export default async function Verify({searchParams}:{searchParams:Promise<{next?:string}>}) { const params=await searchParams; return <AuthForm mode="verify" next={safeNext(params.next)} showMailbox={localMailAllowed()} />; }
