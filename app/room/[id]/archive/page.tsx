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
type RevealedVote = { plan_id: string; user_id: string; chips: number };
type Profile = { id: string; display_name: string | null };

function formatEventDate(dateKey: string | null) {
  if (!dateKey) return "Date TBD";
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(year, month - 1, day, 12));
}

function formatArchivedDate(value: string) {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value));
}

function chipLabel(chips: number) {
  return `${chips.toLocaleString()} ${chips === 1 ? "chip" : "chips"}`;
}

export default function ArchivedEventsPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [group, setGroup] = useState<Group | null>(null);
  const [events, setEvents] = useState<GroupEvent[]>([]);
  const [scores, setScores] = useState<Score[]>([]);
  const [revealedVotes, setRevealedVotes] = useState<RevealedVote[]>([]);
  const [profileNames, setProfileNames] = useState<Record<string, string>>({});
  const [currentUserId, setCurrentUserId] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadArchive = useCallback(async () => {
    setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/auth");
    setCurrentUserId(auth.user.id);

    await supabase.rpc("auto_archive_expired_events", { p_group_id: id });

    const [groupResult, eventsResult, scoresResult, votesResult] = await Promise.all([
      supabase.from("groups").select("id,name").eq("id", id).single(),
      supabase
        .from("events")
        .select("id,title,event_date,voting_deadline,archived_at,created_at")
        .eq("group_id", id)
        .not("archived_at", "is", null)
        .order("archived_at", { ascending: false }),
      supabase.from("plan_scores").select("*").eq("group_id", id),
      supabase.from("votes").select("plan_id,user_id,chips").eq("group_id", id),
    ]);

    if (groupResult.error) {
      setError("You do not have access to this room.");
      setLoading(false);
      return;
    }

    setGroup(groupResult.data as Group);
    setEvents((eventsResult.data ?? []) as GroupEvent[]);
    setScores((scoresResult.data ?? []) as Score[]);

    const breakdownVotes = (votesResult.data ?? []) as RevealedVote[];
    setRevealedVotes(breakdownVotes);
    const voterIds = Array.from(new Set(breakdownVotes.map((vote) => vote.user_id)));
    let profileErrorMessage = "";
    if (voterIds.length > 0) {
      const profileResult = await supabase.from("profiles").select("id,display_name").in("id", voterIds);
      if (profileResult.error) profileErrorMessage = profileResult.error.message;
      const profiles = (profileResult.data ?? []) as Profile[];
      setProfileNames(Object.fromEntries(profiles.map((profile) => [profile.id, profile.display_name?.trim() || "Member"])));
    } else {
      setProfileNames({});
    }

    if (eventsResult.error) setError(eventsResult.error.message);
    else if (scoresResult.error) setError(scoresResult.error.message);
    else if (votesResult.error) setError(`Reveal error: ${votesResult.error.message}`);
    else if (profileErrorMessage) setError(`Reveal error: ${profileErrorMessage}`);
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
                    const breakdown = revealedVotes.filter((vote) => vote.plan_id === plan.id).sort((a, b) => b.chips - a.chips);
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

                        {breakdown.length > 0 && (
                          <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(23,24,20,.08)" }}>
                            <div style={{ fontSize: 11, fontWeight: 900, letterSpacing: ".05em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 7 }}>Chip breakdown</div>
                            <div style={{ display: "grid", gap: 6 }}>
                              {breakdown.map((vote) => {
                                const baseName = profileNames[vote.user_id] || "Member";
                                const name = vote.user_id === currentUserId ? (baseName === "Member" ? "You" : `${baseName} (you)`) : baseName;
                                return (
                                  <div key={`${plan.id}-${vote.user_id}`} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: "8px 10px", borderRadius: 12, background: "rgba(117,87,232,.07)", fontSize: 12 }}>
                                    <span style={{ fontWeight: 800, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
                                    <strong style={{ color: "var(--purple)", whiteSpace: "nowrap" }}>{chipLabel(vote.chips)}</strong>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}
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
