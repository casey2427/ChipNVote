"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Check, Coins, Copy, Plus, Sparkles, Users, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Group = { id: string; name: string; invite_code: string };
type GroupEvent = { id: string; title: string; event_date: string | null; created_at: string };
type Wallet = { available_chips: number; daily_chips: number; bank_cap: number; last_accrual_date: string };
type Score = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  regular_points: number;
  super_votes: number;
  supporters: number;
  super_value: number;
  total_score: number;
};
type ScheduleSettings = {
  group_id: string;
  created_by: string;
  start_date: string;
  end_date: string;
  start_hour: number;
  end_hour: number;
  slot_minutes: 30 | 60;
  timezone: string;
};
type Availability = { user_id: string; slot_key: string; preference: 1 | 2 };
type RoomTab = "vote" | "schedule";

function localDateKey(offset = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offset);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateKeysBetween(start: string, end: string) {
  const output: string[] = [];
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  const cursor = new Date(sy, sm - 1, sd, 12);
  const last = new Date(ey, em - 1, ed, 12);
  while (cursor <= last && output.length < 14) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    output.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return output;
}

function formatDay(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function formatEventDate(dateKey: string | null) {
  if (!dateKey) return "Date TBD";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function formatMinuteOfDay(totalMinutes: number) {
  const date = new Date(2000, 0, 1, Math.floor(totalMinutes / 60), totalMinutes % 60);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
}

function timeKey(totalMinutes: number) {
  const hour = String(Math.floor(totalMinutes / 60)).padStart(2, "0");
  const minute = String(totalMinutes % 60).padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatSlotLabel(slotKey: string) {
  const [date, time] = slotKey.split("|");
  const [hour, minute] = time.split(":").map(Number);
  return `${formatDay(date)} at ${formatMinuteOfDay(hour * 60 + minute)}`;
}

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [group, setGroup] = useState<Group | null>(null);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [superPlan, setSuperPlan] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [currentUserId, setCurrentUserId] = useState("");
  const [currentRole, setCurrentRole] = useState("member");
  const [roomTab, setRoomTab] = useState<RoomTab>("vote");
  const [scheduleSettings, setScheduleSettings] = useState<ScheduleSettings | null>(null);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [showScheduleSetup, setShowScheduleSetup] = useState(false);
  const [scheduleStart, setScheduleStart] = useState(localDateKey());
  const [scheduleEnd, setScheduleEnd] = useState(localDateKey(6));
  const [scheduleStartHour, setScheduleStartHour] = useState(9);
  const [scheduleEndHour, setScheduleEndHour] = useState(22);
  const [scheduleSlotMinutes, setScheduleSlotMinutes] = useState<30 | 60>(60);
  const [scheduleTimezone, setScheduleTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time");
  const [scheduleSaving, setScheduleSaving] = useState(false);
  const [showEventModal, setShowEventModal] = useState(false);
  const [showPlanModal, setShowPlanModal] = useState(false);
  const [activeEventId, setActiveEventId] = useState<string | null>(null);
  const [eventTitle, setEventTitle] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [location, setLocation] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadRoom = useCallback(async () => {
    setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/auth");
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const [groupResult, eventsResult, scoresResult, votesResult, walletResult, superResult, membersResult, membershipResult, scheduleResult, availabilityResult] = await Promise.all([
      supabase.from("groups").select("id,name,invite_code").eq("id", id).single(),
      supabase.from("events").select("id,title,event_date,created_at").eq("group_id", id).order("created_at", { ascending: true }),
      supabase.from("plan_scores").select("*").eq("group_id", id).order("total_score", { ascending: false }),
      supabase.rpc("get_my_vote_allocations", { p_group_id: id }),
      supabase.rpc("get_my_chip_wallet", { p_group_id: id }).single(),
      supabase.from("super_votes").select("plan_id").eq("group_id", id).eq("user_id", auth.user.id).eq("month_key", month).maybeSingle(),
      supabase.from("group_members").select("user_id", { count: "exact", head: true }).eq("group_id", id),
      supabase.from("group_members").select("role").eq("group_id", id).eq("user_id", auth.user.id).single(),
      supabase.from("group_schedule_settings").select("group_id,created_by,start_date,end_date,start_hour,end_hour,slot_minutes,timezone").eq("group_id", id).maybeSingle(),
      supabase.from("schedule_availability").select("user_id,slot_key,preference").eq("group_id", id),
    ]);
    if (groupResult.error) {
      setError("You do not have access to this room.");
      setLoading(false);
      return;
    }
    setCurrentUserId(auth.user.id);
    setCurrentRole(membershipResult.data?.role ?? "member");
    setGroup(groupResult.data as Group);
    const sortedEvents = ((eventsResult.data ?? []) as GroupEvent[]).sort((a, b) => {
      if (a.event_date && b.event_date) return a.event_date.localeCompare(b.event_date) || a.created_at.localeCompare(b.created_at);
      if (a.event_date) return -1;
      if (b.event_date) return 1;
      return a.created_at.localeCompare(b.created_at);
    });
    setEvents(sortedEvents);
    setScores((scoresResult.data ?? []) as Score[]);
    const next = Object.fromEntries(((votesResult.data ?? []) as { plan_id: string; chips: number }[]).map((vote) => [vote.plan_id, vote.chips]));
    setAllocations(next);
    setDrafts(next);
    setWallet((walletResult.data ?? null) as Wallet | null);
    setSuperPlan(superResult.data?.plan_id ?? null);
    setMemberCount(membersResult.count ?? 0);
    const loadedSchedule = (scheduleResult.data ?? null) as ScheduleSettings | null;
    setScheduleSettings(loadedSchedule);
    setAvailability((availabilityResult.data ?? []) as Availability[]);
    if (loadedSchedule) {
      setScheduleStart(loadedSchedule.start_date);
      setScheduleEnd(loadedSchedule.end_date);
      setScheduleStartHour(loadedSchedule.start_hour);
      setScheduleEndHour(loadedSchedule.end_hour);
      setScheduleSlotMinutes(loadedSchedule.slot_minutes);
      setScheduleTimezone(loadedSchedule.timezone);
    }
    if (eventsResult.error) setError(`Event error: ${eventsResult.error.message}`);
    else if (scoresResult.error) setError(scoresResult.error.message);
    else if (votesResult.error) setError(votesResult.error.message);
    else if (walletResult.error) setError(`Chip bank error: ${walletResult.error.message}`);
    else if (scheduleResult.error) setError(`Scheduling error: ${scheduleResult.error.message}`);
    else if (availabilityResult.error) setError(`Scheduling error: ${availabilityResult.error.message}`);
    setLoading(false);
  }, [id, router]);

  useEffect(() => { void loadRoom(); }, [loadRoom]);

  const spent = useMemo(() => Object.values(allocations).reduce((sum, value) => sum + value, 0), [allocations]);
  const remaining = wallet?.available_chips ?? 0;
  const bankCap = wallet?.bank_cap ?? 500;
  const dailyChips = wallet?.daily_chips ?? 10;
  const remainingPercent = Math.max(0, Math.min(100, (remaining / bankCap) * 100));
  const isOwner = currentRole === "owner";

  const scheduleDates = useMemo(
    () => scheduleSettings ? dateKeysBetween(scheduleSettings.start_date, scheduleSettings.end_date) : [],
    [scheduleSettings],
  );
  const scheduleTimes = useMemo(() => {
    if (!scheduleSettings) return [];
    const values: number[] = [];
    for (let minute = scheduleSettings.start_hour * 60; minute < scheduleSettings.end_hour * 60; minute += scheduleSettings.slot_minutes) values.push(minute);
    return values;
  }, [scheduleSettings]);
  const validSlotKeys = useMemo(() => new Set(scheduleDates.flatMap((date) => scheduleTimes.map((minute) => `${date}|${timeKey(minute)}`))), [scheduleDates, scheduleTimes]);
  const visibleAvailability = useMemo(() => availability.filter((row) => validSlotKeys.has(row.slot_key)), [availability, validSlotKeys]);
  const myPreferences = useMemo(() => Object.fromEntries(visibleAvailability.filter((row) => row.user_id === currentUserId).map((row) => [row.slot_key, row.preference])), [visibleAvailability, currentUserId]);
  const scheduleSummary = useMemo(() => {
    const map = new Map<string, { available: number; preferred: number }>();
    for (const row of visibleAvailability) {
      const current = map.get(row.slot_key) ?? { available: 0, preferred: 0 };
      current.available += 1;
      if (row.preference === 2) current.preferred += 1;
      map.set(row.slot_key, current);
    }
    return map;
  }, [visibleAvailability]);
  const respondedCount = useMemo(() => new Set(visibleAvailability.map((row) => row.user_id)).size, [visibleAvailability]);
  const bestSlots = useMemo(() => Array.from(validSlotKeys)
    .map((key) => ({ key, ...(scheduleSummary.get(key) ?? { available: 0, preferred: 0 }) }))
    .filter((slot) => slot.available > 0)
    .sort((a, b) => b.available - a.available || b.preferred - a.preferred || a.key.localeCompare(b.key))
    .slice(0, 3), [validSlotKeys, scheduleSummary]);

  function openPlanModal(eventId: string) {
    setActiveEventId(eventId);
    setTitle("");
    setDetails("");
    setLocation("");
    setShowPlanModal(true);
  }

  async function saveVote(planId: string) {
    const chips = drafts[planId] ?? 0;
    const { error: rpcError } = await supabase.rpc("set_plan_vote", { p_plan_id: planId, p_chips: chips });
    if (rpcError) return setError(rpcError.message);
    await loadRoom();
  }

  async function toggleSuper(planId: string) {
    const { error: rpcError } = await supabase.rpc("toggle_super_vote", { p_plan_id: planId });
    if (rpcError) return setError(rpcError.message);
    await loadRoom();
  }

  async function addEvent(event: FormEvent) {
    event.preventDefault();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error: insertError } = await supabase.from("events").insert({
      group_id: id,
      created_by: auth.user.id,
      title: eventTitle.trim(),
      event_date: eventDate || null,
    });
    if (insertError) return setError(insertError.message);
    setEventTitle("");
    setEventDate("");
    setShowEventModal(false);
    await loadRoom();
  }

  async function addPlan(event: FormEvent) {
    event.preventDefault();
    if (!activeEventId) return;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error: insertError } = await supabase.from("plans").insert({
      group_id: id,
      event_id: activeEventId,
      created_by: auth.user.id,
      title,
      description: details || null,
      location: location || null,
      planned_for: null,
    });
    if (insertError) return setError(insertError.message);
    setTitle("");
    setDetails("");
    setLocation("");
    setActiveEventId(null);
    setShowPlanModal(false);
    await loadRoom();
  }

  async function copyInvite() {
    if (!group) return;
    const inviteUrl = `${window.location.origin}/join/${group.invite_code}`;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  async function saveSchedule(event: FormEvent) {
    event.preventDefault();
    if (!currentUserId) return;
    setError("");
    setScheduleSaving(true);
    const { data, error: scheduleError } = await supabase.from("group_schedule_settings").upsert({
      group_id: id,
      created_by: currentUserId,
      start_date: scheduleStart,
      end_date: scheduleEnd,
      start_hour: scheduleStartHour,
      end_hour: scheduleEndHour,
      slot_minutes: scheduleSlotMinutes,
      timezone: scheduleTimezone || "Local time",
      updated_at: new Date().toISOString(),
    }, { onConflict: "group_id" }).select("group_id,created_by,start_date,end_date,start_hour,end_hour,slot_minutes,timezone").single();
    setScheduleSaving(false);
    if (scheduleError) return setError(scheduleError.message);
    setScheduleSettings(data as ScheduleSettings);
    setShowScheduleSetup(false);
  }

  async function setSlotPreference(slotKey: string) {
    if (!currentUserId) return;
    const current = (myPreferences[slotKey] ?? 0) as 0 | 1 | 2;
    const next = current === 0 ? 1 : current === 1 ? 2 : 0;
    setError("");
    setAvailability((rows) => {
      const without = rows.filter((row) => !(row.user_id === currentUserId && row.slot_key === slotKey));
      return next === 0 ? without : [...without, { user_id: currentUserId, slot_key: slotKey, preference: next }];
    });

    const result = next === 0
      ? await supabase.from("schedule_availability").delete().eq("group_id", id).eq("user_id", currentUserId).eq("slot_key", slotKey)
      : await supabase.from("schedule_availability").upsert({ group_id: id, user_id: currentUserId, slot_key: slotKey, preference: next, updated_at: new Date().toISOString() }, { onConflict: "group_id,user_id,slot_key" });

    if (result.error) {
      setError(result.error.message);
      await loadRoom();
    }
  }

  async function fillDay(dateKey: string) {
    if (!currentUserId || !scheduleSettings) return;
    const keys = scheduleTimes.map((minute) => `${dateKey}|${timeKey(minute)}`);
    const rows = keys.map((slotKey) => ({ group_id: id, user_id: currentUserId, slot_key: slotKey, preference: 1, updated_at: new Date().toISOString() }));
    const { error: fillError } = await supabase.from("schedule_availability").upsert(rows, { onConflict: "group_id,user_id,slot_key" });
    if (fillError) return setError(fillError.message);
    setAvailability((old) => [
      ...old.filter((row) => !(row.user_id === currentUserId && keys.includes(row.slot_key))),
      ...keys.map((slotKey) => ({ user_id: currentUserId, slot_key: slotKey, preference: 1 as const })),
    ]);
  }

  async function clearMyTimes() {
    if (!currentUserId) return;
    const { error: clearError } = await supabase.from("schedule_availability").delete().eq("group_id", id).eq("user_id", currentUserId);
    if (clearError) return setError(clearError.message);
    setAvailability((rows) => rows.filter((row) => row.user_id !== currentUserId));
  }

  if (loading) return <main className="loading">Opening the room…</main>;
  if (!group) return <main className="loading"><div><p>{error}</p><Link className="button" href="/dashboard">Back to groups</Link></div></main>;

  return (
    <main className="app-page">
      <nav className="shell app-nav">
        <Link href="/dashboard" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
        <button className="button secondary" onClick={copyInvite}>{copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Invite copied" : group.invite_code}</button>
      </nav>
      <div className="shell room-layout">
        <aside>
          <Link href="/dashboard" style={{ display: "inline-flex", gap: 7, alignItems: "center", color: "var(--muted)", fontSize: 13, fontWeight: 800, marginBottom: 16 }}><ArrowLeft size={15} /> All groups</Link>
          <div className="wallet">
            <div className="eyebrow" style={{ color: "rgba(255,255,255,.48)" }}>Your chip bank</div>
            <div className="wallet-number">{remaining}</div>
            <small>chips available</small>
            <div className="meter"><span style={{ width: `${remainingPercent}%` }} /></div>
            <small>+{dailyChips} every day · unused chips roll over · {bankCap} max</small>
            <div style={{ marginTop: 8 }}><small>{spent} chips currently committed</small></div>
            <div className="super-box">
              <div className="star">★</div>
              <div><strong>Super Vote</strong><br /><small>{superPlan ? "Used this month · tap another activity to move it" : `Worth ${memberCount * 20} points`}</small></div>
            </div>
          </div>
        </aside>

        <section>
          <div className="room-head">
            <div>
              <div className="eyebrow"><span className="dot" style={{ display: "inline-block", marginRight: 7 }} />{memberCount} members · +{dailyChips} chips/day · {bankCap} max bank</div>
              <h1 className="room-title">{group.name}</h1>
            </div>
            {roomTab === "vote" ? (
              <button className="button yellow" onClick={() => setShowEventModal(true)}><Plus size={18} /> New event</button>
            ) : isOwner ? (
              <button className={scheduleSettings ? "button secondary" : "button yellow"} onClick={() => setShowScheduleSetup(true)}><CalendarDays size={17} /> {scheduleSettings ? "Edit schedule" : "Set up schedule"}</button>
            ) : null}
          </div>

          <div className="room-tabs" role="tablist" aria-label="Room tools">
            <button className={roomTab === "vote" ? "room-tab active" : "room-tab"} onClick={() => setRoomTab("vote")} role="tab" aria-selected={roomTab === "vote"}>Events & voting</button>
            <button className={roomTab === "schedule" ? "room-tab active" : "room-tab"} onClick={() => setRoomTab("schedule")} role="tab" aria-selected={roomTab === "schedule"}><CalendarDays size={16} /> Find a time</button>
          </div>

          {error && <div className="error" style={{ marginBottom: 15 }}>{error}</div>}

          {roomTab === "vote" ? (
            events.length === 0 ? (
              <div className="empty"><Sparkles size={32} /><h2>No events yet</h2><p>Create a date, trip, occasion, or Date TBD event, then add the activities everyone wants to do.</p><button className="button yellow" style={{ marginTop: 14 }} onClick={() => setShowEventModal(true)}><Plus size={17} /> Create first event</button></div>
            ) : (
              <div className="event-list">
                {events.map((groupEvent) => {
                  const eventPlans = scores.filter((plan) => plan.event_id === groupEvent.id);
                  return (
                    <article className="event-card" key={groupEvent.id}>
                      <div className="event-card-head">
                        <div>
                          <div className={groupEvent.event_date ? "event-date-pill" : "event-date-pill tbd"}><CalendarDays size={14} /> {formatEventDate(groupEvent.event_date)}</div>
                          <h2>{groupEvent.title}</h2>
                        </div>
                        <button className="button secondary" onClick={() => openPlanModal(groupEvent.id)}><Plus size={16} /> Add activity</button>
                      </div>

                      {eventPlans.length === 0 ? (
                        <div className="event-empty">No activities yet. Add the first option for this event.</div>
                      ) : eventPlans.map((plan, index) => {
                        const current = allocations[plan.id] ?? 0;
                        const draft = drafts[plan.id] ?? current;
                        const max = current + remaining;
                        const activeSuper = superPlan === plan.id;
                        return (
                          <article className="proposal event-proposal" key={plan.id}>
                            <div className="proposal-top">
                              <div className={index === 0 ? "rank first" : "rank"}>{index + 1}</div>
                              <div>
                                <h2>{plan.title}</h2>
                                <p>{[plan.location, plan.description].filter(Boolean).join(" · ") || "Details coming soon"}</p>
                                <p><Users size={13} style={{ verticalAlign: "middle" }} /> {plan.supporters} supporters &nbsp; <Coins size={13} style={{ verticalAlign: "middle" }} /> {plan.regular_points} chips &nbsp; ★ {plan.super_votes}</p>
                              </div>
                              <div className="total"><small>Total score</small>{plan.total_score}</div>
                            </div>
                            <div className="vote-control">
                              <div className="range-wrap">
                                <span>Your stake</span>
                                <input className="range" aria-label={`Chips for ${plan.title}`} type="range" min="0" max={max} step="5" value={draft} onChange={(e) => setDrafts((old) => ({ ...old, [plan.id]: Number(e.target.value) }))} />
                                <span className="count-box">{draft}</span>
                              </div>
                              <button className="button" disabled={draft === current} onClick={() => saveVote(plan.id)}>Save</button>
                              <button className={activeSuper ? "super-button active" : "super-button"} onClick={() => toggleSuper(plan.id)}>{activeSuper ? `★ +${plan.super_value}` : superPlan ? "☆ Move Super Vote" : "☆ Super Vote"}</button>
                            </div>
                          </article>
                        );
                      })}
                    </article>
                  );
                })}
              </div>
            )
          ) : (
            <div className="schedule-section">
              {(!scheduleSettings || showScheduleSetup) && isOwner ? (
                <form className="schedule-setup" onSubmit={saveSchedule}>
                  <div>
                    <div className="eyebrow">Availability window</div>
                    <h2>{scheduleSettings ? "Edit when people can choose" : "Open the calendar"}</h2>
                    <p>Choose up to 14 days and the hours your group should compare.</p>
                  </div>
                  <div className="schedule-setup-grid">
                    <label className="field">First day<input className="input" type="date" value={scheduleStart} onChange={(e) => setScheduleStart(e.target.value)} required /></label>
                    <label className="field">Last day<input className="input" type="date" min={scheduleStart} value={scheduleEnd} onChange={(e) => setScheduleEnd(e.target.value)} required /></label>
                    <label className="field">From<select className="input" value={scheduleStartHour} onChange={(e) => setScheduleStartHour(Number(e.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option value={hour} key={hour}>{formatMinuteOfDay(hour * 60)}</option>)}</select></label>
                    <label className="field">Until<select className="input" value={scheduleEndHour} onChange={(e) => setScheduleEndHour(Number(e.target.value))}>{Array.from({ length: 24 }, (_, index) => index + 1).filter((hour) => hour > scheduleStartHour).map((hour) => <option value={hour} key={hour}>{hour === 24 ? "12:00 AM" : formatMinuteOfDay(hour * 60)}</option>)}</select></label>
                    <label className="field">Time blocks<select className="input" value={scheduleSlotMinutes} onChange={(e) => setScheduleSlotMinutes(Number(e.target.value) as 30 | 60)}><option value={60}>1 hour</option><option value={30}>30 minutes</option></select></label>
                    <label className="field">Time zone<input className="input" value={scheduleTimezone} onChange={(e) => setScheduleTimezone(e.target.value)} maxLength={80} required /></label>
                  </div>
                  <div className="modal-actions">
                    {scheduleSettings && <button type="button" className="button secondary" onClick={() => setShowScheduleSetup(false)}>Cancel</button>}
                    <button className="button" disabled={scheduleSaving || scheduleEndHour <= scheduleStartHour}>{scheduleSaving ? "Saving…" : "Open availability"}</button>
                  </div>
                </form>
              ) : !scheduleSettings ? (
                <div className="empty"><CalendarDays size={32} /><h2>Scheduling is not open yet</h2><p>The group owner can choose a few days and hours, then everyone can mark when they are free.</p></div>
              ) : (
                <>
                  <div className="schedule-overview">
                    <div>
                      <div className="eyebrow">Find a time</div>
                      <h2>{respondedCount}/{memberCount} members responded</h2>
                      <p>Tap once for <strong>Available</strong>, twice for <strong>Preferred</strong>, and a third time to clear it. Times are shown in {scheduleSettings.timezone}.</p>
                    </div>
                    <button className="button secondary" onClick={clearMyTimes}>Clear my times</button>
                  </div>

                  {bestSlots.length > 0 && (
                    <div className="best-times">
                      {bestSlots.map((slot, index) => (
                        <div className={index === 0 ? "best-time top" : "best-time"} key={slot.key}>
                          <span>{index === 0 ? "Best match" : `#${index + 1}`}</span>
                          <strong>{formatSlotLabel(slot.key)}</strong>
                          <small>{slot.available}/{memberCount} available{slot.preferred ? ` · ${slot.preferred} prefer it` : ""}</small>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="schedule-legend"><span><i className="legend-available" /> Available</span><span><i className="legend-preferred" /> Your preferred time</span><span>Darker = more people free</span></div>

                  <div className="schedule-scroll">
                    <div className="schedule-grid" style={{ gridTemplateColumns: `76px repeat(${scheduleDates.length}, minmax(112px, 1fr))` }}>
                      <div className="schedule-corner">Time</div>
                      {scheduleDates.map((date) => (
                        <div className="schedule-day" key={date}>
                          <strong>{formatDay(date)}</strong>
                          <button onClick={() => fillDay(date)} type="button">Free all day</button>
                        </div>
                      ))}
                      {scheduleTimes.flatMap((minute) => [
                        <div className="schedule-time" key={`time-${minute}`}>{formatMinuteOfDay(minute)}</div>,
                        ...scheduleDates.map((date) => {
                          const key = `${date}|${timeKey(minute)}`;
                          const summary = scheduleSummary.get(key) ?? { available: 0, preferred: 0 };
                          const mine = myPreferences[key] ?? 0;
                          const strength = memberCount ? summary.available / memberCount : 0;
                          const background = summary.available ? `rgba(39, 140, 105, ${0.08 + strength * 0.58})` : "rgba(255,255,255,.72)";
                          return (
                            <button
                              type="button"
                              className={`schedule-cell${mine === 1 ? " mine" : ""}${mine === 2 ? " preferred" : ""}`}
                              style={{ background }}
                              key={key}
                              onClick={() => setSlotPreference(key)}
                              aria-label={`${formatSlotLabel(key)}. ${summary.available} of ${memberCount} available. ${mine === 2 ? "You prefer this time" : mine === 1 ? "You are available" : "You have not selected this time"}.`}
                            >
                              {summary.available > 0 && <strong>{summary.available}</strong>}
                              {mine === 2 && <span>★</span>}
                            </button>
                          );
                        }),
                      ])}
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </section>
      </div>

      {showEventModal && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowEventModal(false)}>
          <form className="modal" onSubmit={addEvent}>
            <button type="button" onClick={() => setShowEventModal(false)} style={{ float: "right", border: 0, background: "transparent", cursor: "pointer" }} aria-label="Close"><X /></button>
            <h2>Create an event</h2>
            <p style={{ color: "var(--muted)" }}>Give related activities one place to compete, like Halloween, a birthday, or a trip.</p>
            <label className="field">Event name<input className="input" placeholder="Halloween trip" value={eventTitle} onChange={(e) => setEventTitle(e.target.value)} maxLength={120} required /></label>
            <label className="field">Date <span style={{ color: "var(--muted)", fontWeight: 500 }}>(optional)</span><input className="input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></label>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowEventModal(false)}>Cancel</button><button className="button">Create event</button></div>
          </form>
        </div>
      )}

      {showPlanModal && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowPlanModal(false)}>
          <form className="modal" onSubmit={addPlan}>
            <button type="button" onClick={() => setShowPlanModal(false)} style={{ float: "right", border: 0, background: "transparent", cursor: "pointer" }} aria-label="Close"><X /></button>
            <h2>Add an activity</h2>
            <p style={{ color: "var(--muted)" }}>Add an option people can put chips behind inside this event.</p>
            <label className="field">Activity name<input className="input" placeholder="Halloween Horror Nights" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
            <label className="field">Place <span style={{ color: "var(--muted)", fontWeight: 500 }}>(optional)</span><input className="input" placeholder="Universal Studios" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
            <label className="field">Extra details<textarea className="input" rows={3} placeholder="Go after dinner" value={details} onChange={(e) => setDetails(e.target.value)} /></label>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowPlanModal(false)}>Cancel</button><button className="button">Add activity</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
