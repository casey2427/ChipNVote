"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Coins, EyeOff, LockKeyhole, Users, X } from "lucide-react";
import { useEffect, useState } from "react";

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark"><Coins size={20} strokeWidth={2.6} /></span>
      ChipNVote
    </Link>
  );
}

export default function Home() {
  const [showHow, setShowHow] = useState(false);

  useEffect(() => {
    if (!showHow) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowHow(false);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [showHow]);

  return (
    <main>
      <nav className="shell nav">
        <Brand />
        <div style={{ display: "flex", gap: 10 }}>
          <Link href="/auth" className="button secondary">Log in</Link>
          <Link href="/auth?mode=signup" className="button">Start a group <ArrowRight size={17} /></Link>
        </div>
      </nav>

      <section className="shell hero">
        <div>
          <div className="eyebrow">Group decisions, with actual stakes</div>
          <h1>Stop guessing what the <span>group wants.</span></h1>
          <p className="hero-copy">
            ChipNVote lets a group decide what matters most. Start with 100 chips, get 10 more every day, and save them for the choices you care about most.
          </p>
          <div className="hero-actions">
            <Link href="/auth?mode=signup" className="button yellow">Create your group <ArrowRight size={18} /></Link>
            <button type="button" className="button secondary" onClick={() => setShowHow(true)}>See how it works</button>
          </div>
          <div className="mini-rule">
            <span><Coins size={15} /> 100 to start · +10 daily</span>
            <span><EyeOff size={15} /> Votes stay blind until the deadline</span>
            <span><LockKeyhole size={15} /> Chips can&apos;t be bought</span>
          </div>
        </div>

        <div className="demo" aria-label="Example ChipNVote room">
          <div className="demo-top">
            <div>
              <div className="eyebrow">Weekend crew · Halloween trip</div>
              <strong>What should we do?</strong>
            </div>
            <div className="balance"><strong>160</strong><br /><small>chips left</small></div>
          </div>

          <div className="plan leader">
            <div className="plan-row">
              <div className="plan-icon">🎢</div>
              <div className="plan-copy"><h3>Halloween Horror Nights</h3><p>Your vote · results hidden</p></div>
              <div className="score">80</div>
            </div>
            <div className="chips">{Array.from({ length: 8 }).map((_, i) => <span className="chip" key={i} />)}</div>
          </div>

          <div className="plan">
            <div className="plan-row">
              <div className="plan-icon" style={{ background: "#ffe8db" }}>🥩</div>
              <div className="plan-copy"><h3>Korean BBQ</h3><p>Your vote · results hidden</p></div>
              <div className="score">20</div>
            </div>
            <div className="chips">{Array.from({ length: 2 }).map((_, i) => <span className="chip" key={i} />)}</div>
          </div>

          <div className="plan">
            <div className="plan-row">
              <div className="plan-icon" style={{ background: "#ddf4e9" }}>🧩</div>
              <div className="plan-copy"><h3>Escape room</h3><p>No chips placed yet</p></div>
              <div className="score">0</div>
            </div>
          </div>

          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 8, color: "var(--muted)", fontSize: 12, fontWeight: 750 }}>
            <CalendarDays size={15} /> Find a time is built into every group. After the reveal, you can see who backed each choice and by how much.
          </div>
        </div>
      </section>

      {showHow && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="how-chipnvote-works"
          onMouseDown={() => setShowHow(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 1000,
            background: "rgba(23, 24, 20, .56)",
            backdropFilter: "blur(7px)",
            display: "grid",
            placeItems: "center",
            padding: 20,
          }}
        >
          <div
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              width: "min(720px, 100%)",
              maxHeight: "min(760px, calc(100vh - 40px))",
              overflowY: "auto",
              background: "var(--card)",
              border: "2px solid var(--ink)",
              borderRadius: 30,
              boxShadow: "12px 12px 0 var(--ink)",
              padding: "clamp(24px, 5vw, 38px)",
              position: "relative",
            }}
          >
            <button
              type="button"
              aria-label="Close"
              onClick={() => setShowHow(false)}
              style={{
                position: "absolute",
                right: 18,
                top: 18,
                width: 40,
                height: 40,
                borderRadius: 999,
                border: "1px solid var(--line)",
                background: "white",
                display: "grid",
                placeItems: "center",
                cursor: "pointer",
                color: "var(--ink)",
              }}
            >
              <X size={19} />
            </button>

            <div className="eyebrow">How ChipNVote works</div>
            <h2 id="how-chipnvote-works" style={{ fontSize: "clamp(38px, 7vw, 58px)", lineHeight: .98, letterSpacing: "-.06em", margin: "10px 48px 14px 0" }}>
              Show how much you actually care.
            </h2>
            <p style={{ color: "var(--muted)", fontSize: 16, lineHeight: 1.6, margin: "0 0 26px" }}>
              Instead of everyone giving every idea one equal vote, you decide how many of your limited chips each choice is worth to you.
            </p>

            <div style={{ display: "grid", gap: 12 }}>
              {[
                {
                  number: "1",
                  title: "Join a group",
                  text: "Your group creates an event, like Friday night, a vacation, or what to do after class. Everyone can add ideas.",
                },
                {
                  number: "2",
                  title: "Put chips on the ideas you want",
                  text: "You start with 100 chips and get 10 more every day. Put a few chips on something you like, or save up and go big on something you really care about.",
                },
                {
                  number: "3",
                  title: "Voting stays blind",
                  text: "Until the deadline, you cannot see how many chips other people used. That keeps the current leader from influencing everyone else.",
                },
                {
                  number: "4",
                  title: "Reveal the result",
                  text: "When voting closes, the totals appear. You can see which choice won, who backed each option, and how many chips they put behind it.",
                },
              ].map((step) => (
                <div
                  key={step.number}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "44px minmax(0, 1fr)",
                    gap: 14,
                    alignItems: "start",
                    padding: 16,
                    background: step.number === "3" ? "#eee9ff" : "white",
                    border: "1px solid var(--line)",
                    borderRadius: 18,
                  }}
                >
                  <div style={{ width: 38, height: 38, borderRadius: 12, background: step.number === "3" ? "var(--purple)" : "var(--yellow)", color: step.number === "3" ? "white" : "var(--ink)", display: "grid", placeItems: "center", fontWeight: 950 }}>
                    {step.number}
                  </div>
                  <div>
                    <strong style={{ display: "block", fontSize: 16, marginBottom: 4 }}>{step.title}</strong>
                    <span style={{ color: "var(--muted)", lineHeight: 1.5, fontSize: 13 }}>{step.text}</span>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 18, padding: "15px 16px", borderRadius: 17, background: "#f6f1e7", display: "flex", gap: 10, alignItems: "flex-start" }}>
              <CalendarDays size={19} style={{ flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, lineHeight: 1.5 }}><strong>Need to choose when, too?</strong> Each group also has Find a Time so everyone can mark when they&apos;re free.</span>
            </div>

            <Link href="/auth?mode=signup" className="button yellow" style={{ width: "100%", marginTop: 22 }}>
              Create your group <ArrowRight size={18} />
            </Link>
          </div>
        </div>
      )}
    </main>
  );
}
