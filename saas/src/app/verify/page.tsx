import { AuthForm } from "@/components/auth-form";
import { safeNext } from "@/lib/page";
export default async function Verify({searchParams}:{searchParams:Promise<{token?:string;next?:string}>}) { const params=await searchParams; return <AuthForm mode="verify" token={params.token} next={safeNext(params.next)} showMailbox={process.env.APP_ENV === "local"} />; }
