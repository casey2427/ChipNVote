"use client";

import Link from "next/link";
import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, CalendarDays, Coins, History, Link2, Plus, Settings2, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDeviceToken, getRememberedDisplayName, rememberDisplayName } from "@/lib/device";
import { getRecentEvents, rememberRecentEvent, type RecentEvent, type RecentEventKind } from "@/lib/recent-events";
import "./home-clean.css";

function Brand() {
  return (
    <Link href="/" className="brand">
      <span className="brand-mark"><Coins size={20} strokeWidth={2.6} /></span>
      ChipNVote
    </Link>
  );
}

export default function Home() {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const [eventDate, setEventDate] = useState("");
  const [votingDeadline, setVotingDeadline] = useState("");
  const [allowGuestChoices, setAllowGuestChoices] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);
  const [createMode, setCreateMode] = useState<RecentEventKind>("vote");
  const [recentEvents, setRecentEvents] = useState<RecentEvent[]>([]);

  useEffect(() => {
    setName(getRememberedDisplayName());
    setRecentEvents(getRecentEvents());
  }, []);

  function updateChoice(index: number, value: string) {
    setChoices((current) => current.map((choice, choiceIndex) => choiceIndex === index ? value : choice));
  }

  function chooseMode(mode: RecentEventKind) {
    setCreateMode(mode);
    setError("");
    window.requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    setError("");

    const displayName = name.trim();
    const cleanQuestion = question.trim();
    const cleanChoices = choices.map((choice) => choice.trim()).filter(Boolean);

    if (createMode === "vote" && cleanChoices.length < 2) {
      setError("Add at least two choices.");
      return;
    }

    setCreating(true);
    const supabase = createClient();
    const result = createMode === "time"
      ? await supabase.rpc("create_decision_schedule_event", {
          p_question: cleanQuestion,
          p_display_name: displayName,
          p_device_token: getDeviceToken(),
        })
      : await supabase.rpc("create_decision_event", {
          p_question: cleanQuestion,
          p_choices: cleanChoices,
          p_display_name: displayName,
          p_device_token: getDeviceToken(),
          p_event_date: eventDate || null,
          p_allow_guest_choices: allowGuestChoices,
          p_voting_deadline: votingDeadline ? new Date(votingDeadline).toISOString() : null,
        });
    setCreating(false);

    if (result.error) {
      setError(result.error.message);
      return;
    }

    const inviteCode = result.data?.invite_code as string | undefined;
    if (!inviteCode) {
      setError("The event was created, but ChipNVote could not open it.");
      return;
    }

    rememberDisplayName(displayName);
    const path = `/e/${inviteCode}`;
    rememberRecentEvent({
      inviteCode,
      question: cleanQuestion,
      kind: createMode,
      path,
    });
    setRecentEvents(getRecentEvents());
    router.push(path);
  }

  function openInvite(event: FormEvent) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (code) router.push(`/e/${encodeURIComponent(code)}`);
  }

  return (
    <main>
      <nav className="shell nav">
        <Brand />
        <form className="code-form" onSubmit={openInvite}>
          <input aria-label="Event code" placeholder="Event code" value={joinCode} onChange={(event) => setJoinCode(event.target.value)} maxLength={12} />
          <button type="submit">Join</button>
        </form>
      </nav>

      <section className="shell simple-hero">
        <div className="simple-intro">
          <div className="eyebrow">One event · 100 chips each · no signup</div>
          <h1>Vote on what you <span>want.</span></h1>
          <p>Make an event, share the link, and let everyone split 100 chips across the choices. More chips means they want it more.</p>

          <div className="home-mode-actions">
            <button type="button" className="button yellow" onClick={() => chooseMode("vote")}><Coins size={17} /> Start a new vote</button>
            <button type="button" className="button secondary" onClick={() => chooseMode("time")}><CalendarDays size={17} /> Find a time</button>
          </div>

          {recentEvents.length > 0 && (
            <div className="recent-events">
              <div className="recent-events-head"><History size={16} /><strong>Continue where you left off</strong></div>
              <div className="recent-event-list">
                {recentEvents.slice(0, 3).map((recent) => (
                  <Link className="recent-event" href={recent.path} key={recent.inviteCode}>
                    <span>
                      <small>{recent.kind === "time" ? "Find a time" : "Vote"}</small>
                      <strong>{recent.question}</strong>
                    </span>
                    <ArrowRight size={16} />
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="allocation-example" aria-label="Example chip allocation">
            {[["Din Tai Fung", 60], ["KBBQ", 30], ["Sushi", 10]].map(([label, amount], index) => (
              <div className="example-row" key={String(label)}>
                <span className="example-rank">{index + 1}</span>
                <strong>{label}</strong>
                <div className="example-bar"><i style={{ width: `${amount}%` }} /></div>
                <b>{amount}</b>
              </div>
            ))}
            <div className="example-total"><Coins size={16} /> 100 chips spent</div>
          </div>
        </div>

        <form ref={formRef} className="create-event-card" onSubmit={createEvent}>
          <div className="create-mode-switch" role="tablist" aria-label="Create event type">
            <button type="button" className={createMode === "vote" ? "active" : ""} onClick={() => setCreateMode("vote")}><Coins size={15} /> Vote</button>
            <button type="button" className={createMode === "time" ? "active" : ""} onClick={() => setCreateMode("time")}><CalendarDays size={15} /> Find a time</button>
          </div>

          <div>
            <div className="eyebrow">{createMode === "time" ? "Create a time poll" : "Create a vote"}</div>
            <h2>{createMode === "time" ? "When can everyone make it?" : "What are you deciding?"}</h2>
          </div>

          <label className="field">Your display name<input className="input" placeholder="Alex" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required /></label>
          <label className="field">
            {createMode === "time" ? "What are you scheduling?" : "Question"}
            <input className="input" placeholder={createMode === "time" ? "When should we get dinner?" : "Where should we eat Friday?"} value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={160} required />
          </label>

          {createMode === "vote" ? (
            <>
              <fieldset className="choice-fields">
                <legend>Choices</legend>
                {choices.map((choice, index) => (
                  <div className="choice-input-row" key={index}>
                    <input className="input" aria-label={`Choice ${index + 1}`} placeholder={index === 0 ? "Din Tai Fung" : index === 1 ? "KBBQ" : "Another choice"} value={choice} onChange={(event) => updateChoice(index, event.target.value)} maxLength={120} required={index < 2} />
                    {choices.length > 2 && <button type="button" aria-label={`Remove choice ${index + 1}`} onClick={() => setChoices((current) => current.filter((_, choiceIndex) => choiceIndex !== index))}><Trash2 size={17} /></button>}
                  </div>
                ))}
                {choices.length < 10 && <button type="button" className="add-choice-link" onClick={() => setChoices((current) => [...current, ""])}><Plus size={16} /> Add choice</button>}
              </fieldset>

              <details className="advanced-settings">
                <summary><Settings2 size={15} /> Advanced settings</summary>
                <div className="advanced-settings-body">
                  <label className="field">Event date <span className="optional">(optional)</span><input className="input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
                  <label className="field">Voting deadline <span className="optional">(optional)</span><input className="input" type="datetime-local" value={votingDeadline} onChange={(event) => setVotingDeadline(event.target.value)} /><small className="optional">Results reveal when the group leader chooses or this deadline passes.</small></label>
                  <label className="check-row"><input type="checkbox" checked={allowGuestChoices} onChange={(event) => setAllowGuestChoices(event.target.checked)} /><span><strong>Let friends add choices</strong><small>Anyone who joins can suggest another option.</small></span></label>
                </div>
              </details>
            </>
          ) : (
            <div className="time-create-note">
              <CalendarDays size={20} />
              <div><strong>Set the availability grid next</strong><span>After creating it, choose the date range and hours, then share the link with everyone.</span></div>
            </div>
          )}

          {error && <div className="error">{error}</div>}
          <button className="button yellow create-button" disabled={creating}>
            {creating ? "Creating…" : createMode === "time" ? <>Create time poll <ArrowRight size={18} /></> : <>Create & share <ArrowRight size={18} /></>}
          </button>
          <p className="no-account-note"><Link2 size={14} /> No account, email, or password required.</p>
        </form>
      </section>
    </main>
  );
}
