import { AuthForm } from "@/components/auth-form";
import { localMailAllowed } from "@/lib/mail";
export default function ResendVerification(){return <AuthForm mode="resend" showMailbox={localMailAllowed()} />;}
