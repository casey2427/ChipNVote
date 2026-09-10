"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, Clock, RefreshCw, Settings2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

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

type Props = {
  inviteCode: string;
  deviceToken: string;
  participantCount: number;
  viewerIsCreator: boolean;
  onError: (message: string) => void;
};

const EMPTY_SCHEDULE: ScheduleData = { settings: null, viewer_preferences: [], summary: [], responded_count: 0 };

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

export default function SchedulePanel({ inviteCode, deviceToken, participantCount, viewerIsCreator, onError }: Props) {
  const [data, setData] = useState<ScheduleData>(EMPTY_SCHEDULE);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [dragOverrides, setDragOverrides] = useState<Record<string, 0 | 1 | 2>>({});
  const dragRef = useRef<{ active: boolean; preference: 0 | 1 | 2; slots: Set<string> }>({ active: false, preference: 1, slots: new Set() });
  const [startDate, setStartDate] = useState(localDateKey());
  const [endDate, setEndDate] = useState(localDateKey(6));
  const [startHour, setStartHour] = useState(9);
  const [endHour, setEndHour] = useState(22);
  const [slotMinutes, setSlotMinutes] = useState<30 | 60>(60);
  const [timezone, setTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Local time");

  const load = useCallback(async () => {
    if (!deviceToken) return;
    const { data: result, error } = await createClient().rpc("get_decision_schedule", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
    });
    setLoading(false);
    if (error) {
      onError(error.message);
      return;
    }
    const next = (result ?? EMPTY_SCHEDULE) as ScheduleData;
    setData(next);
    if (next.settings && !editing) {
      setStartDate(next.settings.start_date);
      setEndDate(next.settings.end_date);
      setStartHour(next.settings.start_hour);
      setEndHour(next.settings.end_hour);
      setSlotMinutes(next.settings.slot_minutes);
      setTimezone(next.settings.timezone);
    }
  }, [deviceToken, editing, inviteCode, onError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (editing) return;
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [editing, load]);

  const dates = useMemo(() => data.settings ? dateKeysBetween(data.settings.start_date, data.settings.end_date) : [], [data.settings]);
  const times = useMemo(() => {
    if (!data.settings) return [];
    const values: number[] = [];
    for (let minute = data.settings.start_hour * 60; minute < data.settings.end_hour * 60; minute += data.settings.slot_minutes) values.push(minute);
    return values;
  }, [data.settings]);
  const savedMine = useMemo(() => Object.fromEntries(data.viewer_preferences.map((item) => [item.slot_key, item.preference])) as Partial<Record<string, 1 | 2>>, [data.viewer_preferences]);
  const summary = useMemo(() => Object.fromEntries(data.summary.map((item) => [item.slot_key, item])) as Record<string, { slot_key: string; available: number; preferred: number }>, [data.summary]);
  const bestSlots = useMemo(() => [...data.summary].filter((item) => item.available > 0).sort((a, b) => b.available - a.available || b.preferred - a.preferred || a.slot_key.localeCompare(b.slot_key)).slice(0, 3), [data.summary]);

  async function saveSetup(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    const { error } = await createClient().rpc("setup_decision_schedule", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_start_date: startDate,
      p_end_date: endDate,
      p_start_hour: startHour,
      p_end_hour: endHour,
      p_slot_minutes: slotMinutes,
      p_timezone: timezone.trim() || "Local time",
    });
    setSaving(false);
    if (error) {
      onError(error.message);
      return;
    }
    setEditing(false);
    await load();
  }

  const saveAvailabilityUpdates = useCallback(async (updates: { slot_key: string; preference: 0 | 1 | 2 }[]) => {
    if (!updates.length) return;
    setSavingAvailability(true);
    const { error } = await createClient().rpc("set_decision_schedule_availability_bulk", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
      p_updates: updates,
    });
    setSavingAvailability(false);
    if (error) {
      setDragOverrides({});
      onError(error.message);
      await load();
      return;
    }
    setDragOverrides({});
    await load();
  }, [deviceToken, inviteCode, load, onError]);

  const finishDrag = useCallback(() => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    const updates = Array.from(drag.slots).map((slot_key) => ({ slot_key, preference: drag.preference }));
    drag.slots = new Set();
    void saveAvailabilityUpdates(updates);
  }, [saveAvailabilityUpdates]);

  useEffect(() => {
    const finish = () => finishDrag();
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
    return () => {
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
    };
  }, [finishDrag]);

  function getPreference(slotKey: string): 0 | 1 | 2 {
    return dragOverrides[slotKey] ?? savedMine[slotKey] ?? 0;
  }

  function beginDrag(slotKey: string) {
    if (savingAvailability) return;
    const current = getPreference(slotKey);
    const next: 0 | 1 | 2 = current === 0 ? 1 : current === 1 ? 2 : 0;
    dragRef.current = { active: true, preference: next, slots: new Set([slotKey]) };
    setDragOverrides((old) => ({ ...old, [slotKey]: next }));
  }

  function paintDraggedSlot(slotKey: string) {
    const drag = dragRef.current;
    if (!drag.active || drag.slots.has(slotKey)) return;
    drag.slots.add(slotKey);
    setDragOverrides((old) => ({ ...old, [slotKey]: drag.preference }));
  }

  function paintFromPoint(clientX: number, clientY: number) {
    if (!dragRef.current.active) return;
    const target = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>("[data-schedule-slot]");
    const slotKey = target?.dataset.scheduleSlot;
    if (slotKey) paintDraggedSlot(slotKey);
  }

  function cycleWithKeyboard(slotKey: string) {
    if (savingAvailability) return;
    const current = getPreference(slotKey);
    const next: 0 | 1 | 2 = current === 0 ? 1 : current === 1 ? 2 : 0;
    setDragOverrides((old) => ({ ...old, [slotKey]: next }));
    void saveAvailabilityUpdates([{ slot_key: slotKey, preference: next }]);
  }

  async function clearMine() {
    if (!data.viewer_preferences.length) return;
    const { error } = await createClient().rpc("clear_decision_schedule_availability", {
      p_invite_code: inviteCode,
      p_device_token: deviceToken,
    });
    if (error) {
      onError(error.message);
      return;
    }
    await load();
  }

  if (loading && !data.settings) {
    return <div className="schedule-card schedule-empty"><RefreshCw className="spin" size={20} /><strong>Loading availability…</strong></div>;
  }

  if (!data.settings && !viewerIsCreator) {
    return (
      <div className="schedule-card schedule-empty">
        <CalendarDays size={24} />
        <div><h2>Find a time</h2><p>The event creator hasn’t set up the availability grid yet.</p></div>
      </div>
    );
  }

  if (!data.settings || editing) {
    return (
      <form className="schedule-card" onSubmit={saveSetup}>
        <div className="schedule-card-head">
          <div><div className="eyebrow">Availability setup</div><h2>When can everyone make it?</h2><p>Choose the days and hours people should mark, similar to When2Meet.</p></div>
        </div>
        <div className="schedule-setup-grid">
          <label className="field">Start date<input className="input" type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <label className="field">End date<input className="input" type="date" value={endDate} min={startDate} onChange={(event) => setEndDate(event.target.value)} required /></label>
          <label className="field">From<select className="input" value={startHour} onChange={(event) => setStartHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{formatMinuteOfDay(hour * 60)}</option>)}</select></label>
          <label className="field">To<select className="input" value={endHour} onChange={(event) => setEndHour(Number(event.target.value))}>{Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => <option key={hour} value={hour}>{formatMinuteOfDay(hour * 60)}</option>)}</select></label>
          <label className="field">Time slots<select className="input" value={slotMinutes} onChange={(event) => setSlotMinutes(Number(event.target.value) as 30 | 60)}><option value={60}>1 hour</option><option value={30}>30 minutes</option></select></label>
          <label className="field">Timezone<input className="input" value={timezone} onChange={(event) => setTimezone(event.target.value)} maxLength={80} required /></label>
        </div>
        <div className="schedule-actions">
          {data.settings && <button type="button" className="button secondary" onClick={() => setEditing(false)}>Cancel</button>}
          <button className="button yellow" disabled={saving}>{saving ? "Saving…" : data.settings ? "Save changes" : "Create availability grid"}</button>
        </div>
      </form>
    );
  }

  return (
    <div className="schedule-panel">
      <div className="schedule-card schedule-overview-clean">
        <div className="schedule-topline">
          <div><div className="eyebrow"><Clock size={13} /> Find a time</div><h2>{data.responded_count}/{participantCount} people responded</h2><p>{data.settings.timezone} · Click or drag across cells. Blank → available → preferred → clear.</p></div>
          {viewerIsCreator && <button type="button" className="button secondary" onClick={() => setEditing(true)}><Settings2 size={14} /> Edit</button>}
        </div>

        {bestSlots.length > 0 && (
          <div className="schedule-best">
            {bestSlots.map((slot, index) => (
              <div className={index === 0 ? "schedule-best-card top" : "schedule-best-card"} key={slot.slot_key}>
                <span>{index === 0 ? "Best match" : `Option ${index + 1}`}</span>
                <strong>{formatSlotLabel(slot.slot_key)}</strong>
                <small>{slot.available}/{participantCount} available{slot.preferred ? ` · ${slot.preferred} preferred` : ""}</small>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="schedule-legend-clean">
        <span><i className="legend-group" /> Group availability</span>
        <span><i className="legend-mine" /> Your available time</span>
        <span><i className="legend-preferred-clean" /> Your preferred time</span>
        <span className="schedule-save-state">{savingAvailability ? "Saving…" : "Drag to paint multiple times"}</span>
        <button type="button" onClick={() => void clearMine()} disabled={!data.viewer_preferences.length || savingAvailability}>Clear my times</button>
      </div>

      <div className="decision-schedule-scroll">
        <div
          className={dragRef.current.active ? "decision-schedule-grid is-dragging" : "decision-schedule-grid"}
          style={{ gridTemplateColumns: `74px repeat(${dates.length}, 82px)` }}
          onPointerMove={(event) => paintFromPoint(event.clientX, event.clientY)}
          onPointerLeave={(event) => paintFromPoint(event.clientX, event.clientY)}
        >
          <div className="decision-schedule-corner">Time</div>
          {dates.map((dateKey) => <div className="decision-schedule-day" key={dateKey}>{formatDay(dateKey)}</div>)}
          {times.map((minute) => (
            <div key={minute} style={{ display: "contents" }}>
              <div className="decision-schedule-time">{formatMinuteOfDay(minute)}</div>
              {dates.map((dateKey) => {
                const slotKey = `${dateKey}|${timeKey(minute)}`;
                const myPreference = getPreference(slotKey);
                const slotSummary = summary[slotKey] ?? { available: 0, preferred: 0 };
                const groupRatio = participantCount ? slotSummary.available / participantCount : 0;
                return (
                  <button
                    type="button"
                    key={slotKey}
                    className={`decision-schedule-cell${myPreference === 1 ? " mine-available" : myPreference === 2 ? " mine-preferred" : ""}`}
                    style={!myPreference && slotSummary.available ? { background: `rgba(39, 140, 105, ${Math.min(.42, .07 + groupRatio * .34)})` } : undefined}
                    data-schedule-slot={slotKey}
                    onPointerDown={() => beginDrag(slotKey)}
                    onPointerEnter={() => paintDraggedSlot(slotKey)}
                    onClick={(event) => { if (event.detail === 0) cycleWithKeyboard(slotKey); }}
                    disabled={savingAvailability}
                    title={`${formatSlotLabel(slotKey)} · ${slotSummary.available} available · ${slotSummary.preferred} preferred`}
                    aria-label={`${formatSlotLabel(slotKey)}. ${slotSummary.available} available. Your status: ${myPreference === 2 ? "preferred" : myPreference === 1 ? "available" : "not selected"}.`}
                  >
                    {slotSummary.available > 0 && <strong>{slotSummary.available}</strong>}
                    {myPreference === 2 && <span>★</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
