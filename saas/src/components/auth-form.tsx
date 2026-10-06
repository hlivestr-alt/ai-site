"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { api } from "./api";

type Mode = "login" | "register" | "forgot" | "reset" | "verify" | "resend";
export function AuthForm({mode,token,next,showMailbox}:{mode:Mode;token?:string;next?:string;showMailbox:boolean}) {
  const [email,setEmail]=useState("");
  const [name,setName]=useState("");
  const [password,setPassword]=useState("");
  const [message,setMessage]=useState("");
  const [error,setError]=useState("");
  const [busy,setBusy]=useState(false);
  const labels:Record<Mode,string>={login:"Welcome back",register:"Create your account",forgot:"Reset your password",reset:"Choose a new password",verify:"Verify your account",resend:"Resend verification email"};

  async function submit(event:FormEvent) {
    event.preventDefault();setBusy(true);setError("");setMessage("");
    try {
      if (mode === "login") {
        await api("/api/auth/login","POST",{email,password});
        window.location.assign(next || "/");
      } else if (mode === "register") {
        const result=await api<{message:string}>("/api/auth/register","POST",{email,displayName:name,password,next});
        setMessage(result.message);setPassword("");
      } else if (mode === "forgot") {
        const result=await api<{message:string}>("/api/auth/forgot-password","POST",{email});
        setMessage(result.message);
      } else if (mode === "resend") {
        const result=await api<{message:string}>("/api/auth/resend-verification","POST",{email});setMessage(result.message);
      } else if (mode === "reset") {
        const result=await api<{message:string}>("/api/auth/reset-password","POST",{token,password});
        setMessage(result.message);setPassword("");
      } else {
        await api("/api/auth/verify","POST",{token});
        window.location.assign(next || "/");
      }
    } catch (cause) { setError(cause instanceof Error?cause.message:"Request failed."); }
    finally {setBusy(false);}
  }

  return <main className="auth-page"><section className="auth-intro"><Link className="wordmark" href="/">Content Workspace <span>Preview</span></Link><div><p className="eyebrow">CUSTOMER WORKSPACE</p><h1>One place for your team to create content.</h1><p>Bring your products, references, and team together in your workspace.</p></div><p className="auth-foot">Products · Videos · Teamwork</p></section><section className="auth-panel"><div className="auth-card"><p className="eyebrow">GET STARTED</p><h2>{labels[mode]}</h2><p className="muted">{mode==="register"||mode==="resend"?"Check your email to verify your account.":mode==="verify"?"Confirm this email to activate your account.":mode==="forgot"?"Enter your account email to receive a password reset link.":mode==="reset"?"This link works once and expires after 30 minutes.":"Sign in to your customer workspace."}</p><form onSubmit={submit}>
    {(mode==="register"||mode==="login"||mode==="forgot"||mode==="resend")&&<label>Email address<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="you@company.com" /></label>}
    {mode==="register"&&<label>Your name<input required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" /></label>}
    {(mode==="register"||mode==="login"||mode==="reset")&&<label>Password<input type="password" required minLength={mode==="login"?1:12} autoComplete={mode==="login"?"current-password":"new-password"} value={password} onChange={e=>setPassword(e.target.value)} placeholder={mode==="login"?"Your password":"At least 12 characters, a letter and number"} /></label>}
    {error&&<p className="notice error" role="alert">{error}</p>}{message&&<p className="notice success" role="status">{message}</p>}
    <button className="button primary full" disabled={busy || ((mode==="reset"||mode==="verify")&&!token)}>{busy?"Working…":mode==="login"?"Sign in":mode==="register"?"Create account":mode==="forgot"?"Request reset link":mode==="reset"?"Set new password":mode==="resend"?"Resend verification":"Verify email"}<span aria-hidden>→</span></button>
  </form><div className="auth-links">{mode!=="login"&&<a href={`/login${next?`?next=${encodeURIComponent(next)}`:""}`}>Sign in</a>}{mode!=="register"&&<a href={`/register${next?`?next=${encodeURIComponent(next)}`:""}`}>Create account</a>}{mode==="login"&&<a href="/forgot-password">Forgot password?</a>}{mode!=="resend"&&<Link href="/resend-verification">Resend verification email</Link>}{showMailbox&&<a href="/dev/mailbox">Open local mailbox ↗</a>}</div></div></section></main>;
}
