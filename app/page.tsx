import Link from "next/link";
import { ArrowRight, CalendarDays, Coins, EyeOff, LockKeyhole, Users } from "lucide-react";

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark"><Coins size={20} strokeWidth={2.6} /></span>
      ChipNVote
    </Link>
  );
}

export default function Home() {
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
          <h1>Stop saying “I&apos;m down.” <span>Put chips on it.</span></h1>
          <p className="hero-copy">
            ChipNVote lets a group decide what matters most. Start with 100 chips, get 10 more every day, and save them for the choices you care about most.
          </p>
          <div className="hero-actions">
            <Link href="/auth?mode=signup" className="button yellow">Create your group <ArrowRight size={18} /></Link>
            <a href="#how" className="button secondary">See how it works</a>
          </div>
          <div className="mini-rule" id="how">
            <span><Coins size={15} /> 100 to start · +10 daily</span>
            <span><EyeOff size={15} /> Votes stay blind until the deadline</span>
            <span><LockKeyhole size={15} /> Chips can&apos;t be bought</span>
          </div>
        </div>

        <div className="demo" aria-label="Example ChipNVote room">
          <div className="demo-note">Blind until<br />the deadline</div>
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
    </main>
  );
}
