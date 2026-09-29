import { AuthForm } from "@/components/auth-form";
export default function ForgotPassword() { return <AuthForm mode="forgot" showMailbox={process.env.APP_ENV === "local"} />; }
