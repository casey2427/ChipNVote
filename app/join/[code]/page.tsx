"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { Coins, LoaderCircle, UserRound } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinRoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const inviteCode = useMemo(() => decodeURIComponent(code).trim().toUpperCase(), [code]);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [checking, setChecking] = useState(true);
  const [joining, setJoining] = useState(false);

  async function joinCurrentUser() {
    const supabase = createClient();
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
        await joinCurrentUser();
        return;
      }

      setChecking(false);
    }

    void checkSession();
    return () => { cancelled = true; };
  }, [inviteCode]);

  async function joinAsGuest(event: FormEvent) {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) return;

    setError("");
    setJoining(true);
    const supabase = createClient();
    const { error: authError } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: displayName } },
    });

    if (authError) {
      setError(authError.message);
      setJoining(false);
      return;
    }

    await joinCurrentUser();
  }

  const next = `/join/${encodeURIComponent(inviteCode)}`;
  const loginHref = `/auth?next=${encodeURIComponent(next)}`;
  const signupHref = `/auth?mode=signup&next=${encodeURIComponent(next)}`;

  return (
    <main className="auth-wrap">
      <div className="auth-card">
        <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>

        {checking || joining ? (
          <div style={{ textAlign: "center" }}>
            <LoaderCircle size={34} className="spin" style={{ margin: "28px auto 12px" }} />
            <h1>Joining the room…</h1>
            <p>Opening the group and getting your chips ready.</p>
          </div>
        ) : (
          <>
            <h1>Join the group</h1>
            <p>No account needed. Enter your name and start voting.</p>

            <form onSubmit={joinAsGuest}>
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
              <button className="button" style={{ width: "100%", marginTop: 18 }} disabled={joining}>
                <UserRound size={17} /> Join as guest
              </button>
            </form>

            <p style={{ fontSize: 12, color: "var(--muted)", margin: "14px 0 0", lineHeight: 1.5 }}>
              Guests start with 100 chips and keep earning chips on this browser. You can save your account later without losing them.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 20 }}>
              <Link className="button secondary" href={loginHref} style={{ justifyContent: "center" }}>Sign in</Link>
              <Link className="button secondary" href={signupHref} style={{ justifyContent: "center" }}>Create account</Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
