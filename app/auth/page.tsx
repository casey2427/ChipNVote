"use client";

import Link from "next/link";
import { useSearchParams, useRouter } from "next/navigation";
import { FormEvent, Suspense, useMemo, useState } from "react";
import { Coins, ShieldCheck } from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const PENDING_NAME_KEY = "chipnvote:pending-join-name";

type OAuthProvider = "google" | "apple";

function safeNextPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/dashboard";
  return value;
}

function AuthForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);
  const [signup, setSignup] = useState(searchParams.get("mode") === "signup");
  const [name, setName] = useState(searchParams.get("name") ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(
    searchParams.get("error") === "confirmation"
      ? "That sign-in link could not be completed. Try again."
      : "",
  );
  const [loading, setLoading] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<OAuthProvider | null>(null);

  function rememberJoinName() {
    if (nextPath.startsWith("/join/") && name.trim()) {
      window.sessionStorage.setItem(PENDING_NAME_KEY, name.trim());
    }
  }

  async function continueWith(provider: OAuthProvider) {
    setError("");
    setMessage("");
    if (!isSupabaseConfigured) {
      setError("Supabase environment variables have not been added yet.");
      return;
    }

    rememberJoinName();
    setOauthProvider(provider);
    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    if (nextPath !== "/dashboard") callback.searchParams.set("next", nextPath);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });

    if (authError) {
      setError(authError.message);
      setOauthProvider(null);
    }
  }

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
      const callback = new URL("/auth/callback", window.location.origin);
      if (nextPath !== "/dashboard") callback.searchParams.set("next", nextPath);

      const { data, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { display_name: name },
          emailRedirectTo: callback.toString(),
        },
      });

      if (authError) {
        setError(authError.message);
      } else if (data.session) {
        router.push(nextPath);
      } else {
        setMessage(
          nextPath.startsWith("/join/")
            ? "Account created. Confirm your email and you’ll return to this invite."
            : "Account created. Check your email to confirm your account.",
        );
      }
    } else {
      const { error: authError } = await supabase.auth.signInWithPassword({ email, password });
      if (authError) setError(authError.message);
      else router.push(nextPath);
    }

    setLoading(false);
  }

  return (
    <div className="auth-card">
      <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
      <h1>{signup ? "Create your account" : "Welcome back"}</h1>
      <p>{signup ? "Create one identity for your groups and chip balance." : "Your chips and group plans are waiting."}</p>
      {nextPath.startsWith("/join/") && <div className="success" style={{ marginBottom: 16 }}>Sign in once, then you’ll go straight into the group.</div>}

      {signup && (
        <label className="field">
          Your name
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
      )}

      <button
        type="button"
        className="button"
        style={{ width: "100%", marginTop: 8 }}
        onClick={() => continueWith("google")}
        disabled={oauthProvider !== null || loading}
      >
        <ShieldCheck size={17} /> {oauthProvider === "google" ? "Opening Google…" : "Continue with Google"}
      </button>

      <button
        type="button"
        className="button secondary"
        style={{ width: "100%", marginTop: 8 }}
        onClick={() => continueWith("apple")}
        disabled={oauthProvider !== null || loading}
      >
        {oauthProvider === "apple" ? "Opening Apple…" : "Continue with Apple"}
      </button>

      <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 4px", color: "var(--muted)", fontSize: 11, fontWeight: 800 }}>
        <span style={{ height: 1, background: "rgba(23,24,20,.12)", flex: 1 }} />OR<span style={{ height: 1, background: "rgba(23,24,20,.12)", flex: 1 }} />
      </div>

      <form onSubmit={submit}>
        <label className="field">Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="field">Password<input className="input" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        {error && <div className="error">{error}</div>}
        {message && <div className="success">{message}</div>}
        <button className="button secondary" style={{ width: "100%", marginTop: 20 }} disabled={loading || oauthProvider !== null}>{loading ? "One second…" : signup ? "Create with email" : "Sign in with email"}</button>
      </form>
      <button onClick={() => { setSignup(!signup); setError(""); setMessage(""); }} style={{ border: 0, background: "transparent", width: "100%", marginTop: 17, cursor: "pointer", color: "var(--muted)" }}>
        {signup ? "Already have an account? Sign in" : "New here? Create an account"}
      </button>
    </div>
  );
}

export default function AuthPage() {
  return <main className="auth-wrap"><Suspense fallback={<div>Loading…</div>}><AuthForm /></Suspense></main>;
}
