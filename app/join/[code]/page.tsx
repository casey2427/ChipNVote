"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Coins, LoaderCircle, ShieldCheck } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const PENDING_NAME_KEY = "chipnvote:pending-join-name";

type OAuthProvider = "google" | "apple";

export default function JoinRoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const inviteCode = useMemo(() => decodeURIComponent(code).trim().toUpperCase(), [code]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [joining, setJoining] = useState(false);
  const [oauthProvider, setOauthProvider] = useState<OAuthProvider | null>(null);

  async function joinCurrentUser(userId: string) {
    const supabase = createClient();
    const pendingName = window.sessionStorage.getItem(PENDING_NAME_KEY)?.trim();

    if (pendingName) {
      await supabase.auth.updateUser({ data: { display_name: pendingName } });
      await supabase.from("profiles").update({ display_name: pendingName }).eq("id", userId);
      window.sessionStorage.removeItem(PENDING_NAME_KEY);
    }

    const { data, error: joinError } = await supabase.rpc("join_group", {
      p_invite_code: inviteCode,
    });

    if (joinError) {
      setError(joinError.message);
      setJoining(false);
      setChecking(false);
      return;
    }

    router.replace(`/room/${data}`);
  }

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (cancelled) return;

      if (auth.user) {
        setJoining(true);
        await joinCurrentUser(auth.user.id);
        return;
      }

      setChecking(false);
    }

    void checkSession();
    return () => { cancelled = true; };
  }, [inviteCode]);

  async function continueWith(provider: OAuthProvider) {
    const displayName = name.trim();
    if (!displayName) {
      setError("Enter your name first.");
      return;
    }

    setError("");
    setOauthProvider(provider);
    window.sessionStorage.setItem(PENDING_NAME_KEY, displayName);

    const supabase = createClient();
    const next = `/join/${encodeURIComponent(inviteCode)}`;
    const callback = new URL("/auth/callback", window.location.origin);
    callback.searchParams.set("next", next);

    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo: callback.toString() },
    });

    if (authError) {
      window.sessionStorage.removeItem(PENDING_NAME_KEY);
      setError(authError.message);
      setOauthProvider(null);
    }
  }

  const next = `/join/${encodeURIComponent(inviteCode)}`;
  const loginHref = `/auth?next=${encodeURIComponent(next)}`;
  const signupHref = `/auth?mode=signup&next=${encodeURIComponent(next)}&name=${encodeURIComponent(name.trim())}`;

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>

        {checking || joining ? (
          <div style={{ textAlign: "center" }}>
            <LoaderCircle size={34} className="spin" style={{ margin: "28px auto 12px" }} />
            <h1>Joining the group…</h1>
            <p>Getting your room and chip balance ready.</p>
          </div>
        ) : (
          <>
            <h1>Join the group</h1>
            <p>Enter your name, then sign in so your chip balance stays tied to one identity.</p>

            <label className="field">
              Your name
              <input
                className="input"
                placeholder="Alex"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={50}
                autoComplete="name"
                required
              />
            </label>

            {error && <div className="error">{error}</div>}

            <button
              type="button"
              className="button"
              style={{ width: "100%", marginTop: 18 }}
              onClick={() => continueWith("google")}
              disabled={oauthProvider !== null}
            >
              <ShieldCheck size={17} /> {oauthProvider === "google" ? "Opening Google…" : "Continue with Google"}
            </button>

            <button
              type="button"
              className="button secondary"
              style={{ width: "100%", marginTop: 8 }}
              onClick={() => continueWith("apple")}
              disabled={oauthProvider !== null}
            >
              {oauthProvider === "apple" ? "Opening Apple…" : "Continue with Apple"}
            </button>

            <p style={{ fontSize: 12, color: "var(--muted)", margin: "14px 0 0", lineHeight: 1.5 }}>
              New members start with 100 chips and get 10 more every day. Unused chips roll over.
            </p>

            <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "22px 0 14px", color: "var(--muted)", fontSize: 11, fontWeight: 800 }}>
              <span style={{ height: 1, background: "rgba(23,24,20,.12)", flex: 1 }} />OR<span style={{ height: 1, background: "rgba(23,24,20,.12)", flex: 1 }} />
            </div>

            <Link className="button secondary" href={signupHref} style={{ width: "100%", justifyContent: "center" }}>Use email instead</Link>
            <p style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 14 }}>
              Already have an account? <Link href={loginHref} style={{ fontWeight: 850 }}>Sign in</Link>
            </p>
          </>
        )}
      </div>
    </main>
  );
}
