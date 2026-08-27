"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { FormEvent, Suspense, useState } from "react";
import { Coins } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

function AuthForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [signup, setSignup] = useState(searchParams.get("mode") === "signup");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (!isSupabaseConfigured) {
      setError("Supabase environment variables have not been added yet.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    if (signup) {
      const { error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: `${window.location.origin}/auth/callback`,
        },
      });
      if (authError) setError(authError.message);
      else setMessage("Account created. Check your email if confirmation is enabled, then log in.");
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) setError(authError.message);
      else router.push("/dashboard");
    }
    setLoading(false);
  }

  return (
    <div className="auth-card">
      <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
      <h1>{signup ? "Create your account" : "Welcome back"}</h1>
      <p>{signup ? "Start a room and find out what your friends actually want to do." : "Your chips and group plans are waiting."}</p>
      <form onSubmit={submit}>
        {signup && <label className="field">Your name<input className="input" value={name} onChange={(e) => setName(e.target.value)} required /></label>}
        <label className="field">Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">Password<input className="input" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="button" style={{ width: "100%", marginTop: 20 }} disabled={loading}>{loading ? "One second…" : signup ? "Create account" : "Log in"}</button>
      </form>
      <button onClick={() => { setSignup(!signup); setError(""); setMessage(""); }} style={{ border: 0, background: "transparent", width: "100%", marginTop: 17, cursor: "pointer", color: "var(--muted)" }}>
        {signup ? "Already have an account? Log in" : "New here? Create an account"}
      </button>
    </div>
  );
}

export default function AuthPage() {
  return <main className="auth-wrap"><Suspense fallback={<div>Loading…</div>}><AuthForm /></Suspense></main>;
}
