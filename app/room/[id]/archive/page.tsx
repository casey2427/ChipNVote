"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Archive, ArrowLeft, CalendarDays, Coins, Users } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Group = { id: string; name: string };
type GroupEvent = {
  id: string;
  title: string;
  event_date: string | null;
  voting_deadline: string | null;
  archived_at: string;
  created_at: string;
};
type Score = {
  id: string;
  event_id: string;
  title: string;
  description: string | null;
  location: string | null;
  created_at: string;
  regular_points: number;
  supporters: number;
  total_score: number;
};

function formatEventDate(dateKey: string | null) {
  if (!dateKey) return "Date TBD";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function formatArchivedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

export default function ArchivedEventsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [group, setGroup] = useState<Group | null>(null);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadArchive = useCallback(async () => {
    setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/auth");

    await supabase.rpc("auto_archive_expired_events", { p_group_id: id });

    const [groupResult, eventsResult, scoresResult] = await Promise.all([
      supabase.from("groups").select("id,name").eq("id", id).single(),
      supabase
        .from("events")
        .select("id,title,event_date,voting_deadline,archived_at,created_at")
        .eq("group_id", id)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false }),
      supabase.from("plan_scores").select("*").eq("group_id", id),
    ]);

    if (groupResult.error) {
      setError("You do not have access to this room.");
      setLoading(false);
      return;
    }

    setGroup(groupResult.data as Group);
    setEvents((eventsResult.data ?? []) as GroupEvent[]);
    setScores((scoresResult.data ?? []) as Score[]);

    if (eventsResult.error) setError(eventsResult.error.message);
    else if (scoresResult.error) setError(scoresResult.error.message);
    setLoading(false);
  }, [id, router]);

  useEffect(() => { void loadArchive(); }, [loadArchive]);

  if (loading) return <main className="loading">Opening archive…</main>;
  if (!group) return <main className="loading"><div><p>{error}</p><Link className="button" href="/dashboard">Back to groups</Link></div></main>;

  return (
    <main className="app-page">
      <nav className="shell app-nav">
        <Link href="/dashboard" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
      </nav>

      <div className="shell" style={{ maxWidth: 980, paddingBottom: 70 }}>
        <Link href={`/room/${id}`} style={{ display: "inline-flex", gap: 7, alignItems: "center", color: "var(--muted)", fontSize: 13, fontWeight: 800, marginBottom: 20 }}><ArrowLeft size={15} /> Back to {group.name}</Link>

        <div className="room-head" style={{ marginBottom: 24 }}>
          <div>
            <div className="eyebrow"><Archive size={14} style={{ verticalAlign: "middle", marginRight: 7 }} />Archive</div>
            <h1 className="room-title">Archived events</h1>
          </div>
        </div>

        {error && <div className="error" style={{ marginBottom: 15 }}>{error}</div>}

        {events.length === 0 ? (
          <div className="empty"><Archive size={32} /><h2>No archived events yet</h2></div>
        ) : (
          <div className="event-list">
            {events.map((groupEvent) => {
              const eventPlans = scores
                .filter((plan) => plan.event_id === groupEvent.id)
                .sort((a, b) => b.total_score - a.total_score || a.created_at.localeCompare(b.created_at));

              return (
                <article className="event-card" key={groupEvent.id}>
                  <div className="event-card-head">
                    <div>
                      <div className={groupEvent.event_date ? "event-date-pill" : "event-date-pill tbd"}><CalendarDays size={14} /> {formatEventDate(groupEvent.event_date)}</div>
                      <h2>{groupEvent.title}</h2>
                      <p className="event-budget-copy">Archived {formatArchivedDate(groupEvent.archived_at)}</p>
                    </div>
                  </div>

                  {eventPlans.length === 0 ? (
                    <div className="event-empty">No activities.</div>
                  ) : eventPlans.map((plan, index) => {
                    const detailsLine = [plan.location, plan.description].filter(Boolean).join(" · ");
                    return (
                      <article className="proposal event-proposal" key={plan.id}>
                        <div className="proposal-top">
                          <div className={index === 0 ? "rank first" : "rank"}>{index + 1}</div>
                          <div>
                            <h2>{plan.title}</h2>
                            {detailsLine && <p>{detailsLine}</p>}
                            <p><Users size={13} style={{ verticalAlign: "middle" }} /> {plan.supporters} &nbsp; <Coins size={13} style={{ verticalAlign: "middle" }} /> {plan.regular_points}</p>
                          </div>
                          <div className="total"><small>Score</small>{plan.total_score}</div>
                        </div>
                      </article>
                    );
                  })}
                </article>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
