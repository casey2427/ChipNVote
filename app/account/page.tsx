"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { Check, Coins, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type CurrentUser = {
  email?: string | null;
  is_anonymous?: boolean;
  user_metadata?: Record<string, unknown>;
};

export default function AccountPage() {
  const router = useRouter();
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  async function refreshUser() {
    const supabase = createClient();
    const { data } = await supabase.auth.getUser();
    if (!data.user) {
      router.replace("/auth");
      return;
    }
    setUser(data.user as CurrentUser);
    setLoading(false);
  }

  useEffect(() => { void refreshUser(); }, []);

  async function linkGoogle() {
    setError("");
    setMessage("");
    setSaving(true);
    const supabase = createClient();
    const { data, error: linkError } = await supabase.auth.linkIdentity({ provider: "google" });
    if (linkError) {
      setError(linkError.message);
      setSaving(false);
      return;
    }
    if (data?.url) window.location.assign(data.url);
  }

  async function saveWithEmail(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);

    const supabase = createClient();
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", "/account");

    const { error: updateError } = await supabase.auth.updateUser(
      {
        email: email.trim(),
        data: { ...(user?.user_metadata ?? {}), guest_upgrade_pending: true },
      },
      { emailRedirectTo: callback.toString() },
    );

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }

    setMessage("Check your email to verify it. Your chips stay attached to this guest account while you do.");
  }

  async function setAccountPassword(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    setSaving(true);
    const supabase = createClient();
    const { error: passwordError } = await supabase.auth.updateUser({
      password,
      data: { ...(user?.user_metadata ?? {}), guest_upgrade_pending: false },
    });
    setSaving(false);

    if (passwordError) {
      setError(passwordError.message);
      return;
    }

    setPassword("");
    setMessage("Account saved. Your groups and chips are now attached to this account.");
    await refreshUser();
  }

  if (loading) return <main className="loading">Opening account…</main>;
  if (!user) return null;

  const isGuest = Boolean(user.is_anonymous);
  const needsPassword = !isGuest && Boolean(user.user_metadata?.guest_upgrade_pending);

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Link href="/dashboard" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>

        {isGuest ? (
          <>
            <h1>Keep your chips</h1>
            <p>You’re playing as a guest. Save this exact account so your current groups, votes, and chip balance follow you to other devices.</p>

            <button className="button" style={{ width: "100%", marginTop: 8 }} onClick={linkGoogle} disabled={saving}>
              <ShieldCheck size={17} /> Continue with Google
            </button>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0", color: "var(--muted)", fontSize: 11, fontWeight: 800 }}>
              <span style={{ height: 1, background: "rgba(23,24,20,.12)", flex: 1 }} />OR<span style={{ height: 1, background: "rgba(23,24,20,.12)", flex: 1 }} />
            </div>

            <form onSubmit={saveWithEmail}>
              <label className="field">Email<input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" required /></label>
              <button className="button secondary" style={{ width: "100%", marginTop: 14 }} disabled={saving}>Save with email</button>
            </form>

            <p style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, marginTop: 14 }}>
              Nothing resets when you save the account. You keep the same chip balance and voting history.
            </p>
          </>
        ) : needsPassword ? (
          <>
            <h1>Finish saving your account</h1>
            <p>Your email is verified. Create a password so you can come back from any device.</p>
            <form onSubmit={setAccountPassword}>
              <label className="field">Password<input className="input" type="password" minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
              <button className="button" style={{ width: "100%", marginTop: 18 }} disabled={saving}>{saving ? "Saving…" : "Save account"}</button>
            </form>
          </>
        ) : (
          <div style={{ textAlign: "center" }}>
            <div style={{ width: 54, height: 54, borderRadius: 18, background: "rgba(39,140,105,.12)", display: "grid", placeItems: "center", margin: "8px auto 16px" }}><Check size={26} /></div>
            <h1>Your chips are saved</h1>
            <p>Your account can keep your groups, votes, and chip balance across devices.</p>
            <Link className="button" href="/dashboard" style={{ width: "100%", justifyContent: "center", marginTop: 18 }}>Back to your groups</Link>
          </div>
        )}

        {error && <div className="error" style={{ marginTop: 16 }}>{error}</div>}
        {message && <div className="success" style={{ marginTop: 16 }}>{message}</div>}
      </div>
    </main>
  );
}
