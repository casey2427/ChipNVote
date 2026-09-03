"use client";

import Link from "next/link";
import { Coins } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function GuestAccountPrompt() {
  const pathname = usePathname();
  const [isGuest, setIsGuest] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    async function refresh() {
      const { data } = await supabase.auth.getUser();
      setIsGuest(Boolean((data.user as { is_anonymous?: boolean } | null)?.is_anonymous));
    }

    void refresh();
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      setIsGuest(Boolean((session?.user as { is_anonymous?: boolean } | undefined)?.is_anonymous));
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  if (!isGuest || pathname === "/account" || pathname.startsWith("/auth") || pathname.startsWith("/join/")) return null;

  return (
    <div
      style={{
        position: "fixed",
        left: "50%",
        bottom: 18,
        transform: "translateX(-50%)",
        zIndex: 100,
        width: "min(560px, calc(100% - 28px))",
        background: "var(--ink)",
        color: "white",
        borderRadius: 18,
        padding: "14px 15px",
        boxShadow: "0 18px 50px rgba(0,0,0,.22)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 14,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <strong style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}><Coins size={15} /> Playing as guest</strong>
        <span style={{ display: "block", marginTop: 3, color: "rgba(255,255,255,.65)", fontSize: 11, lineHeight: 1.4 }}>
          Save your account to keep your groups and chips across devices.
        </span>
      </div>
      <Link className="button yellow" href="/account" style={{ flexShrink: 0, whiteSpace: "nowrap" }}>Save my chips</Link>
    </div>
  );
}
