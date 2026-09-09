"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Check, Clock, Coins, Copy, Minus, Plus, RefreshCw, Settings2, Trash2, UserRound, Users } from "lucide-react";
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

type ScheduleSettings = {
  start_date: string;
  end_date: string;
  start_hour: number;
  end_hour: number;
  slot_minutes: 30 | 60;
  timezone: string;
};

type ScheduleData = {
  settings: ScheduleSettings | null;
  viewer_preferences: { slot_key: string; preference: 1 | 2 }[];
  summary: { slot_key: string; available: number; preferred: number }[];
  responded_count: number;
};

type Panel = "vote" | "schedule";

const EMPTY_SCHEDULE: ScheduleData = { settings: null, viewer_preferences: [], summary: [], responded_count: 0 };

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

function localDateKey(offset = 0) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeysBetween(start: string, end: string) {
  const [startYear, startMonth, startDay] = start.split("-").map(Number);
  const [endYear, endMonth, endDay] = end.split("-").map(Number);
  const cursor = new Date(startYear, startMonth - 1, startDay, 12);
  const last = new Date(endYear, endMonth - 1, endDay, 12);
  const values: string[] = [];
  while (cursor <= last && values.length < 14) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    values.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return values;
}

function formatDay(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function formatMinuteOfDay(totalMinutes: number) {
  const normalized = totalMinutes % (24 * 60);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, Math.floor(normalized / 60), normalized % 60));
}

function timeKey(totalMinutes: number) {
  return `${String(Math.floor(totalMinutes / 60)).padStart(2, "0")}:${String(totalMinutes % 60).padStart(2, "0")}`;
}

function formatSlotLabel(slotKey: string) {
  const [dateKey, time] = slotKey.split("|");
  const [hour, minute] = time.split(":").map(Number);
  return `${formatDay(dateKey)} at ${formatMinuteOfDay(hour * 60 + minute)}`;
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
  const [activePanel, setActivePanel] = useState<Panel>("vote");

  const [scheduleData, setScheduleData] = useState<ScheduleData>(EMPTY_SCHEDULE);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduleEditing, setScheduleEditing] = useState(false);
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [scheduleStart, setScheduleStart] = useState(localDateKey());
  const [scheduleEnd, setScheduleEnd] = useState(localDateKey(6));
  const [scheduleStartHour, setScheduleStartHour] = useState(9);
  const [scheduleEndHour, setScheduleEndHour] = useState(22);
  const [scheduleSlotMinutes, setScheduleSlotMinutes] = useState<30 | 60>(60);
  const [scheduleTimezone, setScheduleTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time");

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

  const loadSchedule = useCallback(async () => {
    if (!deviceToken || !decision?.viewer) return;
    setScheduleLoading(true);
    const { data, error: scheduleError } = await createClient().rpc("get_decision_schedule", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
    });
    setScheduleLoading(false);
    if (scheduleError) {
      setError(scheduleError.message);
      return;
    }
    const next = (data ?? EMPTY_SCHEDULE) as ScheduleData;
    setScheduleData(next);
    if (next.settings && !scheduleEditing) {
      setScheduleStart(next.settings.start_date);
      setScheduleEnd(next.settings.end_date);
      setScheduleStartHour(next.settings.start_hour);
      setScheduleEndHour(next.settings.end_hour);
      setScheduleSlotMinutes(next.settings.slot_minutes);
      setScheduleTimezone(next.settings.timezone);
    }
  }, [deviceToken, decision?.viewer, inviteCode, scheduleEditing]);

  useEffect(() => setDeviceToken(getDeviceToken()), []);
  useEffect(() => { void loadDecision(true); }, [loadDecision]);
  useEffect(() => {
    const timer = window.setInterval(() => void loadDecision(false), 10000);
    return () => window.clearInterval(timer);
  }, [loadDecision]);
  useEffect(() => {
    if (decision?.viewer) void loadSchedule();
  }, [decision?.viewer, loadSchedule]);
  useEffect(() => {
    if (activePanel !== "schedule" || !decision?.viewer) return;
    const timer = window.setInterval(() => void loadSchedule(), 20000);
    return () => window.clearInterval(timer);
  }, [activePanel, decision?.viewer, loadSchedule]);

  const chipsUsed = Object.values(drafts).reduce((total, chips) => total + chips, 0);
  const chipsRemaining = 100 - chipsUsed;
  const maxTotal = Math.max(1, ...(decision?.results_visible ? decision.choices.map((choice) => choice.total_chips) : [1]));

  const scheduleDates = useMemo(() => scheduleData.settings ? dateKeysBetween(scheduleData.settings.start_date, scheduleData.settings.end_date) : [], [scheduleData.settings]);
  const scheduleTimes = useMemo(() => {
    if (!scheduleData.settings) return [];
    const values: number[] = [];
    for (let minute = scheduleData.settings.start_hour * 60; minute < scheduleData.settings.end_hour * 60; minute += scheduleData.settings.slot_minutes) values.push(minute);
    return values;
  }, [scheduleData.settings]);
  const mySchedule = useMemo(() => Object.fromEntries(scheduleData.viewer_preferences.map((item) => [item.slot_key, item.preference])) as Record<string, 1 | 2>, [scheduleData.viewer_preferences]);
  const scheduleSummary = useMemo(() => Object.fromEntries(scheduleData.summary.map((item) => [item.slot_key, item])) as Record<string, { slot_key: string; available: number; preferred: number }>, [scheduleData.summary]);
  const bestSlots = useMemo(() => [...scheduleData.summary].filter((item) => item.available > 0).sort((a, b) => b.available - a.available || b.preferred - a.preferred || a.slot_key.localeCompare(b.slot_key)).slice(0, 3), [scheduleData.summary]);

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
    if (!deviceToken || decision?.voting_closed || !window.confirm(`Remove ${participant.display_name} from this event?`)) return;
    const { error: removeError } = await createClient().rpc("remove_decision_participant", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_participant_id: participant.id,
    });
    if (removeError) return setError(removeError.message);
    await loadDecision(false);
    await loadSchedule();
  }

  async function saveScheduleSetup(event: FormEvent) {
    event.preventDefault();
    if (!deviceToken || !decision?.viewer?.is_creator) return;
    setScheduleSaving(true);
    setError("");
    const { error: setupError } = await createClient().rpc("setup_decision_schedule", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_start_date: scheduleStart,
      p_end_date: scheduleEnd,
      p_start_hour: scheduleStartHour,
      p_end_hour: scheduleEndHour,
      p_slot_minutes: scheduleSlotMinutes,
      p_timezone: scheduleTimezone.trim() || "Local time",
    });
    setScheduleSaving(false);
    if (setupError) return setError(setupError.message);
    setScheduleEditing(false);
    await loadSchedule();
  }

  async function cycleAvailability(slotKey: string) {
    if (!deviceToken) return;
    const current = mySchedule[slotKey] ?? 0;
    const next = ((current + 1) % 3) as 0 | 1 | 2;
    const hadAny = scheduleData.viewer_preferences.length > 0;
    const nextViewerPreferences = scheduleData.viewer_preferences.filter((item) => item.slot_key !== slotKey);
    if (next > 0) nextViewerPreferences.push({ slot_key: slotKey, preference: next });
    const willHaveAny = nextViewerPreferences.length > 0;

    const oldSummary = scheduleSummary[slotKey] ?? { slot_key: slotKey, available: 0, preferred: 0 };
    let available = oldSummary.available;
    let preferred = oldSummary.preferred;
    if (current === 0 && next === 1) available += 1;
    if (current === 1 && next === 2) preferred += 1;
    if (current === 2 && next === 0) { available = Math.max(0, available - 1); preferred = Math.max(0, preferred - 1); }
    const nextSummary = scheduleData.summary.filter((item) => item.slot_key !== slotKey);
    if (available > 0) nextSummary.push({ slot_key: slotKey, available, preferred });

    setScheduleData((old) => ({
      ...old,
      viewer_preferences: nextViewerPreferences,
      summary: nextSummary,
      responded_count: Math.max(0, old.responded_count + (!hadAny && willHaveAny ? 1 : hadAny && !willHaveAny ? -1 : 0)),
    }));

    const { error: availabilityError } = await createClient().rpc("set_decision_schedule_availability", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_slot_key: slotKey,
      p_preference: next,
    });
    if (availabilityError) {
      setError(availabilityError.message);
      await loadSchedule();
    }
  }

  async function clearMyAvailability() {
    if (!deviceToken || !scheduleData.viewer_preferences.length) return;
    const { error: clearError } = await createClient().rpc("clear_decision_schedule_availability", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
    });
    if (clearError) return setError(clearError.message);
    await loadSchedule();
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
          {formatDeadline(decision.voting_deadline) && <p className="decision-date">Vote by {formatDeadline(decision.voting_deadline)}</p>}
          <div className="preview-choices">{decision.choices.map((choice) => <span key={choice.id}>{choice.title}</span>)}</div>
          <form onSubmit={join}>
            <label className="field">Your name<input className="input" autoFocus placeholder="Alex" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required disabled={decision.voting_closed} /></label>
            {error && <div className="error">{error}</div>}
            <button className="button yellow" disabled={joining || decision.voting_closed}>{decision.voting_closed ? "Voting ended" : joining ? "Joining…" : "Join & get 100 chips"}</button>
          </form>
          <p className="device-note">{decision.voting_closed ? "Voting has ended." : "No signup. Split your 100 chips between the options you want most."}</p>
        </div>
      </main>
    );
  }

  const viewer = decision.viewer;

  return (
    <main className="decision-page">
      <nav className="shell app-nav">
        <Link href="/" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
        <button className="button secondary" onClick={copyInvite}>{copied ? <Check size={16} /> : <Copy size={16} />}{copied ? "Link copied" : "Invite friends"}</button>
      </nav>

      <div className="shell decision-layout">
        <section className="decision-main">
          <header className="decision-head">
            <div className="eyebrow"><Users size={14} /> {decision.participant_count} {decision.participant_count === 1 ? "person" : "people"}</div>
            <h1>{decision.question}</h1>
          </header>

          <div className="event-tabs" role="tablist" aria-label="Event tools">
            <button type="button" className={activePanel === "vote" ? "event-tab active" : "event-tab"} onClick={() => setActivePanel("vote")}><Coins size={15} /> Vote</button>
            <button type="button" className={activePanel === "schedule" ? "event-tab active" : "event-tab"} onClick={() => setActivePanel("schedule")}><CalendarDays size={15} /> Find a time</button>
          </div>

          {error && <div className="error decision-error">{error}</div>}

          {activePanel === "vote" ? (
            <>
              {!decision.results_visible && (
                <div className="identity-card decision-error">
                  {viewer.has_voted ? <Check size={18} /> : <Coins size={18} />}
                  <div>
                    <small>{viewer.has_voted ? "Your vote is submitted" : `${decision.votes_submitted}/${decision.participant_count} votes submitted`}</small>
                    <strong>{viewer.has_voted ? "You can still change your chips until voting closes." : "Split up to 100 chips, then submit. Group results stay hidden until everyone votes or the deadline passes."}</strong>
                  </div>
                </div>
              )}

              {decision.results_visible && (
                <div className="identity-card decision-error">
                  <Check size={18} />
                  <div><small>Final results</small><strong>Voting is closed. The group totals are now revealed.</strong></div>
                </div>
              )}

              <div className="chip-budget-mobile">
                <span><b>{chipsRemaining}</b> chips left <small>{chipsUsed}/100 used</small></span>
                <ChipBudgetBlocks used={chipsUsed} />
              </div>

              <div className="decision-choices">
                {decision.choices.map((choice, index) => {
                  const mine = drafts[choice.id] ?? 0;

                  if (!decision.results_visible) {
                    return (
                      <article className="decision-choice" key={choice.id}>
                        <div className="choice-result-row">
                          <span className="choice-rank">{String.fromCharCode(65 + index)}</span>
                          <div className="choice-title"><h2>{choice.title}</h2><p>How much do you want this?</p></div>
                          <strong className="choice-total">{mine}<small>your chips</small></strong>
                        </div>
                        <div className="allocation-control">
                          <button type="button" aria-label={`Remove chips from ${choice.title}`} onClick={() => setChoiceChips(choice.id, mine - 5)} disabled={decision.voting_closed || mine === 0}><Minus size={17} /></button>
                          <input type="range" min="0" max="100" step="1" value={mine} onChange={(event) => setChoiceChips(choice.id, Number(event.target.value))} aria-label={`Your chips for ${choice.title}`} disabled={decision.voting_closed} />
                          <input className="chip-number-input" type="number" min="0" max="100" value={mine} onChange={(event) => setChoiceChips(choice.id, Number(event.target.value))} aria-label={`Exact chips for ${choice.title}`} disabled={decision.voting_closed} />
                          <button type="button" aria-label={`Add chips to ${choice.title}`} onClick={() => setChoiceChips(choice.id, mine + 5)} disabled={decision.voting_closed || chipsRemaining === 0}><Plus size={17} /></button>
                        </div>
                      </article>
                    );
                  }

                  return (
                    <article className={index === 0 && choice.total_chips > 0 ? "decision-choice leader" : "decision-choice"} key={choice.id}>
                      <div className="choice-result-row">
                        <span className="choice-rank">{index + 1}</span>
                        <div className="choice-title"><h2>{choice.title}</h2><p>{choice.supporters} {choice.supporters === 1 ? "supporter" : "supporters"}</p></div>
                        <strong className="choice-total">{choice.total_chips}<small>group chips</small></strong>
                      </div>
                      <div className="result-bar" aria-hidden="true" style={{ marginTop: 14 }}><span style={{ width: choice.total_chips ? `${Math.max(5, (choice.total_chips / maxTotal) * 100)}%` : "0%" }} /></div>
                      <div className="allocation-label"><span>Your vote</span><strong>{mine} chips</strong></div>
                    </article>
                  );
                })}
              </div>

              {!decision.voting_closed && (
                <div className="save-vote-bar">
                  <div>
                    <strong>{chipsRemaining} chips left</strong>
                    <span>{viewer.has_voted ? dirty ? "You changed your vote. Submit again to save it." : "Your vote is submitted." : chipsUsed ? "Submit when you are happy with your split." : "Move a slider or type a chip amount to start."}</span>
                  </div>
                  <button className="button yellow" onClick={saveVotes} disabled={!dirty || saving || chipsRemaining < 0}>{saving ? "Submitting…" : viewer.has_voted ? dirty ? "Update my vote" : "Vote submitted" : "Submit my vote"}</button>
                </div>
              )}

              {!decision.voting_closed && (decision.allow_guest_choices || viewer.is_creator) && (
                <form className="add-option-form" onSubmit={addChoice}>
                  <Plus size={20} />
                  <input placeholder="Add another option" value={newChoice} onChange={(event) => setNewChoice(event.target.value)} maxLength={120} required />
                  <button type="submit" disabled={addingChoice}>{addingChoice ? "Adding…" : "Add option"}</button>
                </form>
              )}
            </>
          ) : (
            <div className="schedule-panel">
              {scheduleLoading && !scheduleData.settings ? (
                <div className="schedule-card schedule-empty"><RefreshCw className="spin" size={20} /><strong>Loading availability…</strong></div>
              ) : !scheduleData.settings && !viewer.is_creator ? (
                <div className="schedule-card schedule-empty">
                  <CalendarDays size={24} />
                  <div><h2>Find a time</h2><p>The event creator hasn’t set up the availability grid yet.</p></div>
                </div>
              ) : !scheduleData.settings || scheduleEditing ? (
                <form className="schedule-card" onSubmit={saveScheduleSetup}>
                  <div className="schedule-card-head">
                    <div><div className="eyebrow">Availability setup</div><h2>When can everyone make it?</h2><p>Choose the days and hours people should mark, similar to When2Meet.</p></div>
                  </div>
                  <div className="schedule-setup-grid">
                    <label className="field">Start date<input className="input" type="date" value={scheduleStart} onChange={(event) => setScheduleStart(event.target.value)} required /></label>
                    <label className="field">End date<input className="input" type="date" value={scheduleEnd} min={scheduleStart} onChange={(event) => setScheduleEnd(event.target.value)} required /></label>
                    <label className="field">From<select className="input" value={scheduleStartHour} onChange={(event) => setScheduleStartHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{formatMinuteOfDay(hour * 60)}</option>)}</select></label>
                    <label className="field">To<select className="input" value={scheduleEndHour} onChange={(event) => setScheduleEndHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{formatMinuteOfDay(hour * 60)}</option>)}</select></label>
                    <label className="field">Time slots<select className="input" value={scheduleSlotMinutes} onChange={(event) => setScheduleSlotMinutes(Number(event.target.value) as 30 | 60)}><option value={60}>1 hour</option><option value={30}>30 minutes</option></select></label>
                    <label className="field">Timezone<input className="input" value={scheduleTimezone} onChange={(event) => setScheduleTimezone(event.target.value)} maxLength={80} required /></label>
                  </div>
                  <div className="schedule-actions">
                    {scheduleData.settings && <button type="button" className="button secondary" onClick={() => setScheduleEditing(false)}>Cancel</button>}
                    <button className="button yellow" disabled={scheduleSaving}>{scheduleSaving ? "Saving…" : scheduleData.settings ? "Save changes" : "Create availability grid"}</button>
                  </div>
                </form>
              ) : (
                <>
                  <div className="schedule-card schedule-overview-clean">
                    <div className="schedule-topline">
                      <div><div className="eyebrow"><Clock size={13} /> Find a time</div><h2>{scheduleData.responded_count}/{decision.participant_count} people responded</h2><p>{scheduleData.settings.timezone} · Click once for available, twice for preferred, a third time to clear.</p></div>
                      {viewer.is_creator && <button type="button" className="button secondary" onClick={() => setScheduleEditing(true)}><Settings2 size={14} /> Edit</button>}
                    </div>

                    {bestSlots.length > 0 && (
                      <div className="schedule-best">
                        {bestSlots.map((slot, index) => (
                          <div className={index === 0 ? "schedule-best-card top" : "schedule-best-card"} key={slot.slot_key}>
                            <span>{index === 0 ? "Best match" : `Option ${index + 1}`}</span>
                            <strong>{formatSlotLabel(slot.slot_key)}</strong>
                            <small>{slot.available}/{decision.participant_count} available{slot.preferred ? ` · ${slot.preferred} preferred` : ""}</small>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="schedule-legend-clean">
                    <span><i className="legend-group" /> Group availability</span>
                    <span><i className="legend-mine" /> Your available time</span>
                    <span><i className="legend-preferred-clean" /> Your preferred time</span>
                    <button type="button" onClick={clearMyAvailability} disabled={!scheduleData.viewer_preferences.length}>Clear my times</button>
                  </div>

                  <div className="decision-schedule-scroll">
                    <div className="decision-schedule-grid" style={{ gridTemplateColumns: `74px repeat(${scheduleDates.length}, 82px)` }}>
                      <div className="decision-schedule-corner">Time</div>
                      {scheduleDates.map((dateKey) => <div className="decision-schedule-day" key={dateKey}>{formatDay(dateKey)}</div>)}
                      {scheduleTimes.map((minute) => (
                        <div key={minute} style={{ display: "contents" }}>
                          <div className="decision-schedule-time">{formatMinuteOfDay(minute)}</div>
                          {scheduleDates.map((dateKey) => {
                            const slotKey = `${dateKey}|${timeKey(minute)}`;
                            const mine = mySchedule[slotKey] ?? 0;
                            const summary = scheduleSummary[slotKey] ?? { available: 0, preferred: 0 };
                            const groupRatio = decision.participant_count ? summary.available / decision.participant_count : 0;
                            return (
                              <button
                                type="button"
                                key={slotKey}
                                className={`decision-schedule-cell${mine === 1 ? " mine-available" : mine === 2 ? " mine-preferred" : ""}`}
                                style={!mine && summary.available ? { background: `rgba(39, 140, 105, ${Math.min(.42, .07 + groupRatio * .34)})` } : undefined}
                                onClick={() => void cycleAvailability(slotKey)}
                                title={`${formatSlotLabel(slotKey)} · ${summary.available} available · ${summary.preferred} preferred`}
                                aria-label={`${formatSlotLabel(slotKey)}. ${summary.available} available. Your status: ${mine === 2 ? "preferred" : mine === 1 ? "available" : "not selected"}.`}
                              >
                                {summary.available > 0 && <strong>{summary.available}</strong>}
                                {mine === 2 && <span>★</span>}
                              </button>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>

        <aside className="decision-sidebar">
          {activePanel === "vote" && !decision.results_visible && (
            <div className="event-wallet">
              <div className="eyebrow">Your chips</div>
              <div className="event-wallet-number">{chipsRemaining}</div>
              <p>left out of 100</p>
              <ChipBudgetBlocks used={chipsUsed} />
              <div className="budget-caption"><span>0</span><strong>{chipsUsed} used</strong><span>100</span></div>
              <small>Use more chips on the options you care about most.</small>
            </div>
          )}

          <div className="identity-card">
            <UserRound size={18} />
            <div><small>You are</small><strong>{viewer.display_name}</strong></div>
          </div>

          {viewer.is_creator && decision.participants && (
            <div className="participants-card">
              <div className="participants-title"><strong>Participants</strong><button type="button" onClick={() => { void loadDecision(false); void loadSchedule(); }} aria-label="Refresh participants"><RefreshCw size={15} /></button></div>
              {decision.participants.map((participant) => (
                <div className="participant-row" key={participant.id}>
                  <span>
                    <strong>{participant.display_name}</strong>
                    <small>{participant.has_voted ? "Voted" : "Waiting"}{participant.is_creator ? " · Creator" : ""}</small>
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
