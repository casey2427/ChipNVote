"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Coins, LoaderCircle } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export default function JoinRoomPage() {
  const { code } = useParams<{ code: string }>();
  const router = useRouter();
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function join() {
      const inviteCode = decodeURIComponent(code).trim().toUpperCase();
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!auth.user) {
        const next = `/join/${encodeURIComponent(inviteCode)}`;
        router.replace(`/auth?mode=signup&next=${encodeURIComponent(next)}`);
        return;
      }

      const { data, error: joinError } = await supabase.rpc("join_group", {
        p_invite_code: inviteCode,
      });

      if (cancelled) return;

      if (joinError) {
        setError(joinError.message);
        return;
      }

      router.replace(`/room/${data}`);
    }

    void join();
    return () => { cancelled = true; };
  }, [code, router]);

  return (
    <main className="auth-wrap">
      <div className="auth-card" style={{ textAlign: "center" }}>
        <Link href="/" className="brand" style={{ justifyContent: "center" }}>
          <span className="brand-mark"><Coins size={20} /></span>ChipNVote
        </Link>
        {error ? (
          <>
            <h1>Invite not found</h1>
            <p>{error}</p>
            <Link className="button" href="/dashboard">Go to your groups</Link>
          </>
        ) : (
          <>
            <LoaderCircle size={34} className="spin" style={{ margin: "28px auto 12px" }} />
            <h1>Joining the room…</h1>
            <p>We’re adding you to the group and opening its vote.</p>
          </>
        )}
      </div>
    </main>
  );
}
