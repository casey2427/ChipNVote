import Link from "next/link";
import { ArrowRight, Coins, LockKeyhole, Sparkles, Users } from "lucide-react";

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
          <Link href="/auth?mode=signup" className="button">Start a room <ArrowRight size={17} /></Link>
        </div>
      </nav>

      <section className="shell hero">
        <div>
          <div className="eyebrow">Group decisions, with actual stakes</div>
          <h1>Everyone says they&apos;re down. <span>Prove it.</span></h1>
          <p className="hero-copy">
            Every friend gets the same 100 monthly chips. Spread them across ideas or go all-in on one. The plans people truly care about rise to the top.
          </p>
          <div className="hero-actions">
            <Link href="/auth?mode=signup" className="button yellow">Create your group <ArrowRight size={18} /></Link>
            <a href="#how" className="button secondary">See how it works</a>
          </div>
          <div className="mini-rule" id="how">
            <span><Users size={15} /> Equal chips for everyone</span>
            <span><LockKeyhole size={15} /> No buying influence</span>
            <span><Sparkles size={15} /> One Super Vote monthly</span>
          </div>
        </div>

        <div className="demo" aria-label="Example ChipNVote room">
          <div className="demo-note">1 Super<br />Vote left</div>
          <div className="demo-top">
            <div><div className="eyebrow">Weekend crew</div><strong>What should we do?</strong></div>
            <div className="balance"><strong>70</strong><br /><small>chips left</small></div>
          </div>
          <div className="plan leader">
            <div className="plan-row">
              <div className="plan-icon">🏰</div>
              <div className="plan-copy"><h3>Disneyland day</h3><p>6 supporters · 2 Super Votes</p></div>
              <div className="score">920</div>
            </div>
            <div className="chips">
              {Array.from({ length: 8 }).map((_, i) => <span className={i > 5 ? "chip purple" : "chip"} key={i}>{i > 5 ? "★" : ""}</span>)}
            </div>
          </div>
          <div className="plan">
            <div className="plan-row">
              <div className="plan-icon" style={{ background: "#ffe8db" }}>🥩</div>
              <div className="plan-copy"><h3>Korean BBQ</h3><p>8 supporters · 0 Super Votes</p></div>
              <div className="score">550</div>
            </div>
            <div className="chips">{Array.from({ length: 5 }).map((_, i) => <span className="chip" key={i} />)}</div>
          </div>
          <div className="plan">
            <div className="plan-row">
              <div className="plan-icon" style={{ background: "#ddf4e9" }}>🌲</div>
              <div className="plan-copy"><h3>Cabin weekend</h3><p>4 supporters · 1 Super Vote</p></div>
              <div className="score">470</div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
