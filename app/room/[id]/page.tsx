"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CalendarDays, Check, Coins, Copy, Plus, Sparkles, Users, X } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Group = { id: string; name: string; invite_code: string; chip_budget: number };
type Score = {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  planned_for: string | null;
  regular_points: number;
  super_votes: number;
  supporters: number;
  super_value: number;
  total_score: number;
};

function formatPlanTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function RoomPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const supabase = createClient();
  const [group, setGroup] = useState<Group | null>(null);
  const [scores, setScores] = useState<Score[]>([]);
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, number>>({});
  const [superPlan, setSuperPlan] = useState<string | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [showModal, setShowModal] = useState(false);
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [location, setLocation] = useState("");
  const [plannedFor, setPlannedFor] = useState("");
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const loadRoom = useCallback(async () => {
    setError("");
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/auth");
    const month = new Date().toISOString().slice(0, 7) + "-01";
    const [groupResult, scoresResult, votesResult, superResult, membersResult] = await Promise.all([
      supabase.from("groups").select("id,name,invite_code,chip_budget").eq("id", id).single(),
      supabase.from("plan_scores").select("*").eq("group_id", id).order("total_score", { ascending: false }),
      supabase.from("votes").select("plan_id,chips").eq("group_id", id).eq("user_id", auth.user.id).eq("month_key", month),
      supabase.from("super_votes").select("plan_id").eq("group_id", id).eq("user_id", auth.user.id).eq("month_key", month).maybeSingle(),
      supabase.from("group_members").select("user_id", { count: "exact", head: true }).eq("group_id", id),
    ]);
    if (groupResult.error) {
      setError("You do not have access to this room.");
      setLoading(false);
      return;
    }
    setGroup(groupResult.data);
    setScores((scoresResult.data ?? []) as Score[]);
    const next = Object.fromEntries((votesResult.data ?? []).map((vote) => [vote.plan_id, vote.chips]));
    setAllocations(next);
    setDrafts(next);
    setSuperPlan(superResult.data?.plan_id ?? null);
    setMemberCount(membersResult.count ?? 0);
    setLoading(false);
  }, [id, router]);

  useEffect(() => { void loadRoom(); }, [loadRoom]);

  const spent = useMemo(() => Object.values(allocations).reduce((sum, value) => sum + value, 0), [allocations]);
  const budget = group?.chip_budget ?? 100;
  const remaining = budget - spent;
  const remainingPercent = Math.max(0, Math.min(100, (remaining / budget) * 100));

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

  async function addPlan(event: FormEvent) {
    event.preventDefault();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return;
    const { error: insertError } = await supabase.from("plans").insert({
      group_id: id,
      created_by: auth.user.id,
      title,
      description: details || null,
      location: location || null,
      planned_for: plannedFor ? new Date(plannedFor).toISOString() : null,
    });
    if (insertError) return setError(insertError.message);
    setTitle("");
    setDetails("");
    setLocation("");
    setPlannedFor("");
    setShowModal(false);
    await loadRoom();
  }

  async function copyInvite() {
    if (!group) return;
    const inviteUrl = `${window.location.origin}/join/${group.invite_code}`;
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
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
            <div className="eyebrow" style={{ color: "rgba(255,255,255,.48)" }}>Your monthly stash</div>
            <div className="wallet-number">{remaining}</div>
            <small>chips remaining</small>
            <div className="meter"><span style={{ width: `${remainingPercent}%` }} /></div>
            <small>{spent} committed · {budget} total</small>
            <div className="super-box">
              <div className="star">★</div>
              <div><strong>Super Vote</strong><br /><small>{superPlan ? "Used this month · tap another plan to move it" : `Worth ${memberCount * 20} points`}</small></div>
            </div>
          </div>
        </aside>

        <section>
          <div className="room-head">
            <div><div className="eyebrow"><span className="dot" style={{ display: "inline-block", marginRight: 7 }} />{memberCount} members</div><h1 className="room-title">{group.name}</h1></div>
            <button className="button yellow" onClick={() => setShowModal(true)}><Plus size={18} /> Pitch a plan</button>
          </div>
          {error && <div className="error" style={{ marginBottom: 15 }}>{error}</div>}
          {scores.length === 0 ? (
            <div className="empty"><Sparkles size={32} /><h2>No plans yet</h2><p>Be the first person to pitch something worth leaving the group chat for.</p></div>
          ) : scores.map((plan, index) => {
            const current = allocations[plan.id] ?? 0;
            const draft = drafts[plan.id] ?? current;
            const max = current + remaining;
            const activeSuper = superPlan === plan.id;
            const planTime = formatPlanTime(plan.planned_for);
            return (
              <article className="proposal" key={plan.id}>
                <div className="proposal-top">
                  <div className={index === 0 ? "rank first" : "rank"}>{index + 1}</div>
                  <div>
                    <h2>{plan.title}</h2>
                    <p>{[plan.location, plan.description].filter(Boolean).join(" · ") || "Details coming soon"}</p>
                    {planTime && <p><CalendarDays size={13} style={{ verticalAlign: "middle" }} /> {planTime}</p>}
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
        </section>
      </div>

      {showModal && (
        <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <form className="modal" onSubmit={addPlan}>
            <button type="button" onClick={() => setShowModal(false)} style={{ float: "right", border: 0, background: "transparent", cursor: "pointer" }} aria-label="Close"><X /></button>
            <h2>Pitch the next move</h2><p style={{ color: "var(--muted)" }}>It can be a place, activity, purchase, trip, or anything else the group needs to choose.</p>
            <label className="field">Plan name<input className="input" placeholder="Beach bonfire" value={title} onChange={(e) => setTitle(e.target.value)} required /></label>
            <label className="field">Place <span style={{ color: "var(--muted)", fontWeight: 500 }}>(optional)</span><input className="input" placeholder="Huntington Beach" value={location} onChange={(e) => setLocation(e.target.value)} /></label>
            <label className="field">When <span style={{ color: "var(--muted)", fontWeight: 500 }}>(optional)</span><input className="input" type="datetime-local" value={plannedFor} onChange={(e) => setPlannedFor(e.target.value)} /></label>
            <label className="field">Extra details<textarea className="input" rows={3} placeholder="Saturday around sunset" value={details} onChange={(e) => setDetails(e.target.value)} /></label>
            <div className="modal-actions"><button type="button" className="button secondary" onClick={() => setShowModal(false)}>Cancel</button><button className="button">Add plan</button></div>
          </form>
        </div>
      )}
    </main>
  );
}
