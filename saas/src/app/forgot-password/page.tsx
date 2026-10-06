import { localMailAllowed } from "@/lib/mail";
import { AuthForm } from "@/components/auth-form";
export default function ForgotPassword() { return <AuthForm mode="forgot" showMailbox={localMailAllowed()} />; }
