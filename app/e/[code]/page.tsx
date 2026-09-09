"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Check, Coins, Copy, Minus, Plus, RefreshCw, Trash2, UserRound, Users } from "lucide-react";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDeviceToken } from "@/lib/device";

type Choice = { id: string; title: string; total_chips: number; supporters: number };
type Participant = { id: string; display_name: string; is_creator: boolean; chips_spent: number; has_voted: boolean };
type Decision = {
  id: string;
  question: string;
  invite_code: string;
  event_date: string | null;
  voting_deadline: string | null;
  allow_guest_choices: boolean;
  participant_count: number;
  votes_submitted: number;
  results_visible: boolean;
  voting_closed: boolean;
  viewer: null | { id: string; display_name: string; is_creator: boolean; chips_spent: number; chips_remaining: number; has_voted: boolean };
  viewer_allocations: { choice_id: string; chips: number }[];
  choices: Choice[];
  participants: Participant[] | null;
};

function formatDate(value: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "long", day: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function formatDeadline(value: string | null) {
  if (!value) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function ChipBudgetBlocks({ used }: { used: number }) {
  return (
    <div className="budget-blocks" aria-label={`${used} of 100 chips allocated`}>
      {Array.from({ length: 10 }, (_, index) => {
        const fill = Math.max(0, Math.min(100, (used - index * 10) * 10));
        return <span key={index} style={{ background: `linear-gradient(90deg, var(--yellow) ${fill}%, rgba(255,255,255,.14) ${fill}%)` }} />;
      })}
    </div>
  );
}

export default function DecisionPage() {
  const { code } = useParams<{ code: string }>();
  const inviteCode = useMemo(() => decodeURIComponent(code).trim().toUpperCase(), [code]);
  const [deviceToken, setDeviceToken] = useState("");
  const [decision, setDecision] = useState<Decision | null>(null);
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [name, setName] = useState("");
  const [newChoice, setNewChoice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [joining, setJoining] = useState(false);
  const [saving, setSaving] = useState(false);
  const [addingChoice, setAddingChoice] = useState(false);
  const [copied, setCopied] = useState(false);
  const [dirty, setDirty] = useState(false);

  const loadDecision = useCallback(async (syncDrafts = false) => {
    if (!deviceToken) return;
    const { data, error: loadError } = await createClient().rpc("get_decision_event", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
    });
    if (loadError) {
      setError(loadError.message);
      setLoading(false);
      return;
    }
    const nextDecision = data as Decision;
    setDecision(nextDecision);
    if (syncDrafts) {
      setDrafts(Object.fromEntries(nextDecision.viewer_allocations.map((allocation) => [allocation.choice_id, allocation.chips])));
    }
    setLoading(false);
  }, [deviceToken, inviteCode]);

  useEffect(() => setDeviceToken(getDeviceToken()), []);
  useEffect(() => { void loadDecision(true); }, [loadDecision]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadDecision(false), 10000);
    return () => window.clearInterval(timer);
  }, [loadDecision]);

  const chipsUsed = Object.values(drafts).reduce((total, chips) => total + chips, 0);
  const chipsRemaining = 100 - chipsUsed;
  const maxTotal = Math.max(1, ...(decision?.results_visible ? decision.choices.map((choice) => choice.total_chips) : [1]));

  function setChoiceChips(choiceId: string, requested: number) {
    if (decision?.voting_closed) return;
    const current = drafts[choiceId] ?? 0;
    const value = Math.max(0, Math.min(100, Math.round(requested), current + chipsRemaining));
    setDrafts((old) => ({ ...old, [choiceId]: value }));
    setDirty(true);
  }

  async function join(event: FormEvent) {
    event.preventDefault();
    if (!deviceToken || decision?.voting_closed) return;
    setJoining(true);
    setError("");
    const { error: joinError } = await createClient().rpc("join_decision_event", {
      p_invite_code: inviteCode,
      p_display_name: name.trim(),
      p_device_token: deviceToken,
    });
    setJoining(false);
    if (joinError) return setError(joinError.message);
    await loadDecision(true);
  }

  async function saveVotes() {
    if (!deviceToken || chipsRemaining < 0 || decision?.voting_closed) return;
    setSaving(true);
    setError("");
    const allocations = Object.entries(drafts).map(([choice_id, chips]) => ({ choice_id, chips }));
    const { error: saveError } = await createClient().rpc("save_decision_allocations", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_allocations: allocations,
    });
    setSaving(false);
    if (saveError) return setError(saveError.message);
    setDirty(false);
    await loadDecision(true);
  }

  async function addChoice(event: FormEvent) {
    event.preventDefault();
    if (!deviceToken || !newChoice.trim() || decision?.voting_closed) return;
    setAddingChoice(true);
    setError("");
    const { error: choiceError } = await createClient().rpc("add_decision_choice", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_title: newChoice.trim(),
    });
    setAddingChoice(false);
    if (choiceError) return setError(choiceError.message);
    setNewChoice("");
    await loadDecision(false);
  }

  async function removeParticipant(participant: Participant) {
    if (!deviceToken || decision?.voting_closed || !window.confirm(`Remove ${participant.display_name} and their chips from this event?`)) return;
    const { error: removeError } = await createClient().rpc("remove_decision_participant", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_participant_id: participant.id,
    });
    if (removeError) return setError(removeError.message);
    await loadDecision(false);
  }

  async function copyInvite() {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (loading) return <main className="decision-loading"><Coins className="spin" /> Opening event…</main>;
  if (!decision) return <main className="decision-loading"><div><p>{error || "Event not found."}</p><Link className="button" href="/">Create an event</Link></div></main>;

  if (!decision.viewer) {
    return (
      <main className="join-decision-wrap">
        <div className="join-decision-card">
          <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
          <div className="event-preview-pill">{decision.participant_count} {decision.participant_count === 1 ? "person" : "people"} joined</div>
          <h1>{decision.question}</h1>
          {formatDate(decision.event_date) && <p className="decision-date">{formatDate(decision.event_date)}</p>}
          {formatDeadline(decision.voting_deadline) && <p className="decision-date">Voting deadline: {formatDeadline(decision.voting_deadline)}</p>}
          <div className="preview-choices">{decision.choices.map((choice) => <span key={choice.id}>{choice.title}</span>)}</div>
          <form onSubmit={join}>
            <label className="field">What should we call you?<input className="input" autoFocus placeholder="Alex" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required disabled={decision.voting_closed} /></label>
            {error && <div className="error">{error}</div>}
            <button className="button yellow" disabled={joining || decision.voting_closed}>{decision.voting_closed ? "Voting ended" : joining ? "Joining…" : "Join with 100 chips"}</button>
          </form>
          <p className="device-note">{decision.voting_closed ? "Voting is closed and group results have been revealed to participants." : "No account needed. This browser remembers your vote."}</p>
        </div>
      </main>
    );
  }

  const viewer = decision.viewer;

  return (
    <main className="decision-page">
      <nav className="shell app-nav">
        <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
        <button className="button secondary" onClick={copyInvite}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Link copied" : "Share event"}</button>
      </nav>

      <div className="shell decision-layout">
        <section className="decision-main">
          <header className="decision-head">
            <div className="eyebrow"><Users size={14} /> {decision.participant_count} {decision.participant_count === 1 ? "person" : "people"}</div>
            <h1>{decision.question}</h1>
            {formatDate(decision.event_date) && <p>{formatDate(decision.event_date)}</p>}
            {formatDeadline(decision.voting_deadline) && <p>Voting deadline: {formatDeadline(decision.voting_deadline)}</p>}
          </header>

          <div className="identity-card decision-error">
            {decision.results_visible ? <Check size={18} /> : <Users size={18} />}
            <div>
              <small>{decision.results_visible ? "Results revealed" : "Blind voting"}</small>
              <strong>{decision.results_visible ? "Group totals are now visible and voting is locked." : `Group totals are hidden · ${decision.votes_submitted}/${decision.participant_count} voted`}</strong>
            </div>
          </div>

          {error && <div className="error decision-error">{error}</div>}

          <div className="chip-budget-mobile">
            <span><b>{chipsRemaining}</b> chips left <small>{chipsUsed}/100 allocated</small></span>
            <ChipBudgetBlocks used={chipsUsed} />
          </div>

          <div className="decision-choices">
            {decision.choices.map((choice, index) => {
              const mine = drafts[choice.id] ?? 0;
              return (
                <article className={decision.results_visible && index === 0 && choice.total_chips > 0 ? "decision-choice leader" : "decision-choice"} key={choice.id}>
                  <div className="choice-result-row">
                    <span className="choice-rank">{index + 1}</span>
                    <div className="choice-title">
                      <h2>{choice.title}</h2>
                      <p>{decision.results_visible ? `${choice.supporters} ${choice.supporters === 1 ? "supporter" : "supporters"}` : viewer.has_voted ? "Your vote is saved" : "Group results hidden"}</p>
                    </div>
                    <strong className="choice-total">{decision.results_visible ? choice.total_chips : "—"}<small>{decision.results_visible ? "chips" : "hidden"}</small></strong>
                  </div>
                  <div className="result-bar-label"><span>Group total</span><strong>{decision.results_visible ? `${choice.total_chips} chips` : "Hidden"}</strong></div>
                  <div className="result-bar" aria-hidden="true"><span style={{ width: decision.results_visible && choice.total_chips ? `${Math.max(5, (choice.total_chips / maxTotal) * 100)}%` : "0%" }} /></div>
                  <div className="allocation-label"><span>Your chips</span><strong>{mine}</strong></div>
                  <div className="allocation-control">
                    <button type="button" aria-label={`Remove chips from ${choice.title}`} onClick={() => setChoiceChips(choice.id, mine - 5)} disabled={decision.voting_closed || mine === 0}><Minus size={17} /></button>
                    <input type="range" min="0" max="100" step="1" value={mine} onChange={(event) => setChoiceChips(choice.id, Number(event.target.value))} aria-label={`Your chips for ${choice.title}`} disabled={decision.voting_closed} />
                    <input className="chip-number-input" type="number" min="0" max="100" value={mine} onChange={(event) => setChoiceChips(choice.id, Number(event.target.value))} aria-label={`Exact chips for ${choice.title}`} disabled={decision.voting_closed} />
                    <button type="button" aria-label={`Add chips to ${choice.title}`} onClick={() => setChoiceChips(choice.id, mine + 5)} disabled={decision.voting_closed || chipsRemaining === 0}><Plus size={17} /></button>
                  </div>
                </article>
              );
            })}
          </div>

          <div className="save-vote-bar">
            <div>
              <strong>{decision.voting_closed ? "Voting has ended" : `${chipsUsed}/100 allocated`}</strong>
              <span>{decision.voting_closed ? "Your saved allocation is locked because the group results are visible." : chipsRemaining ? `You still have ${chipsRemaining} chips to spend.` : "All 100 chips are allocated."}</span>
            </div>
            <button className="button yellow" onClick={saveVotes} disabled={decision.voting_closed || !dirty || saving || chipsRemaining < 0}>{decision.voting_closed ? "Vote locked" : saving ? "Saving…" : "Save my chips"}</button>
          </div>

          {!decision.voting_closed && (decision.allow_guest_choices || viewer.is_creator) && (
            <form className="add-option-form" onSubmit={addChoice}>
              <Plus size={20} />
              <input placeholder="Suggest another choice" value={newChoice} onChange={(event) => setNewChoice(event.target.value)} maxLength={120} required />
              <button type="submit" disabled={addingChoice}>{addingChoice ? "Adding…" : "Add"}</button>
            </form>
          )}
        </section>

        <aside className="decision-sidebar">
          <div className="event-wallet">
            <div className="eyebrow">Your event chips</div>
            <div className="event-wallet-number">{chipsRemaining}</div>
            <p>of 100 left</p>
            <ChipBudgetBlocks used={chipsUsed} />
            <div className="budget-caption"><span>0</span><strong>{chipsUsed} allocated</strong><span>100</span></div>
            <small>{decision.voting_closed ? "Voting is locked. Your saved chips can no longer be changed." : "These chips only belong to this event. There is nothing to save for later."}</small>
          </div>

          <div className="identity-card">
            <UserRound size={18} />
            <div><small>Voting as</small><strong>{viewer.display_name}</strong></div>
          </div>

          {viewer.is_creator && decision.participants && (
            <div className="participants-card">
              <div className="participants-title"><strong>Participants</strong><button type="button" onClick={() => loadDecision(false)} aria-label="Refresh participants"><RefreshCw size={15} /></button></div>
              {decision.participants.map((participant) => (
                <div className="participant-row" key={participant.id}>
                  <span>
                    <strong>{participant.display_name}</strong>
                    <small>{participant.is_creator ? `Creator · ${participant.has_voted ? "voted" : "waiting"}` : participant.has_voted ? decision.results_visible ? `${participant.chips_spent}/100 spent · voted` : "Voted" : "Waiting to vote"}</small>
                  </span>
                  {!participant.is_creator && !decision.voting_closed && <button type="button" onClick={() => removeParticipant(participant)} aria-label={`Remove ${participant.display_name}`}><Trash2 size={15} /></button>}
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>
    </main>
  );
}
