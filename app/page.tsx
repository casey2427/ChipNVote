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
          <h1>Stop guessing what the <span>group wants.</span></h1>
          <p className="hero-copy">
            ChipNVote lets a group decide what matters most. Start with 100 chips, get 10 more every day, and save them for the choices you care about most.
          </p>
          <div className="hero-actions">
            <Link href="/auth?mode=signup" className="button yellow">Create your group <ArrowRight size={18} /></Link>
            <a href="#how" className="button secondary">See how it works</a>
          </div>
          <div className="mini-rule">
            <span><Coins size={15} /> 100 to start · +10 daily</span>
            <span><EyeOff size={15} /> Votes stay blind until the deadline</span>
            <span><LockKeyhole size={15} /> Chips can&apos;t be bought</span>
          </div>
        </div>

        <div className="demo" aria-label="Example ChipNVote room">
          <a className="demo-note" href="#blind-voting" aria-label="Learn about blind voting">Blind until<br />the deadline</a>
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

      <section id="how" className="shell" style={{ padding: "28px 0 110px", scrollMarginTop: 24 }}>
        <div style={{ maxWidth: 720, marginBottom: 28 }}>
          <div className="eyebrow">How it works</div>
          <h2 style={{ fontSize: "clamp(38px, 5vw, 58px)", letterSpacing: "-.06em", margin: "10px 0 12px" }}>A clearer way to make group decisions.</h2>
          <p className="hero-copy" style={{ margin: 0 }}>Instead of giving every idea the same yes-or-no vote, ChipNVote lets people show how strongly they actually care.</p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
          <div className="plan" style={{ margin: 0, padding: 22 }}>
            <Coins size={24} />
            <h3 style={{ margin: "14px 0 7px" }}>Spend where you care</h3>
            <p style={{ margin: 0 }}>Start with 100 chips and get 10 more each day. Save them or put more behind the choices that matter most to you.</p>
          </div>

          <div id="blind-voting" className="plan" style={{ margin: 0, padding: 22, scrollMarginTop: 24 }}>
            <EyeOff size={24} />
            <h3 style={{ margin: "14px 0 7px" }}>Vote blind</h3>
            <p style={{ margin: 0 }}>Other people&apos;s chip totals stay hidden until the voting deadline, so you make your choice without being pulled by the current leader.</p>
          </div>

          <div className="plan" style={{ margin: 0, padding: 22 }}>
            <Users size={24} />
            <h3 style={{ margin: "14px 0 7px" }}>Reveal what the group wants</h3>
            <p style={{ margin: 0 }}>When voting ends, the results appear along with the chip breakdown showing who backed each option and by how much.</p>
          </div>
        </div>
      </section>
    </main>
  );
}
