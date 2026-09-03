"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowRight, Coins, LogOut, Plus, Trash2, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Group = {
  id: string;
  name: string;
  invite_code: string;
  role: "owner" | "member";
};

export default function Dashboard() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const supabase = createClient();

  const loadGroups = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/auth");
    const { data, error: queryError } = await supabase
      .from("group_members")
      .select("role,groups(id,name,invite_code)")
      .eq("user_id", auth.user.id);
    if (queryError) setError(queryError.message);
    const rows = (data ?? []).flatMap((row: any) => row.groups ? [{ ...row.groups, role: row.role }] : []);
    setGroups(rows);
    setLoading(false);
  }, [router]);

  useEffect(() => { void loadGroups(); }, [loadGroups]);

  async function createGroup(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { data, error: rpcError } = await supabase.rpc("create_group", { p_name: newName });
    if (rpcError) return setError(rpcError.message);
    setNewName("");
    router.push(`/room/${data}`);
  }

  async function joinGroup(event: FormEvent) {
    event.preventDefault();
    setError("");
    const { data, error: rpcError } = await supabase.rpc("join_group", { p_invite_code: joinCode.trim().toUpperCase() });
    if (rpcError) return setError(rpcError.message);
    setJoinCode("");
    router.push(`/room/${data}`);
  }

  async function removeGroup(group: Group) {
    const deleting = group.role === "owner";
    const confirmed = window.confirm(
      deleting
        ? `Delete “${group.name}”? This permanently removes the group, its events, plans, votes, and availability.`
        : `Leave “${group.name}”? Your votes and availability in this group will be removed.`,
    );
    if (!confirmed) return;

    setError("");
    setBusyGroupId(group.id);
    const { error: rpcError } = await supabase.rpc(deleting ? "delete_group" : "leave_group", { p_group_id: group.id });
    setBusyGroupId(null);
    if (rpcError) return setError(rpcError.message);
    setGroups((current) => current.filter((item) => item.id !== group.id));
  }

  async function logout() {
    await supabase.auth.signOut();
    router.push("/");
  }

  return (
    <main className="app-page">
      <nav className="shell app-nav">
        <Link href="/dashboard" className="brand"><span className="brand-mark"><Coins size={20} /></span>ChipNVote</Link>
        <button onClick={logout} className="button secondary"><LogOut size={16} /> Log out</button>
      </nav>
      <section className="shell dashboard">
        <div className="dashboard-head">
          <div><div className="eyebrow">Your groups</div><h1>What are we deciding?</h1></div>
        </div>
        <div className="forms-grid">
          <form className="form-card" onSubmit={createGroup}>
            <strong><Plus size={17} style={{ verticalAlign: "middle" }} /> Create group</strong>
            <div className="inline-form"><input className="input" placeholder="Weekend Crew" value={newName} onChange={(e) => setNewName(e.target.value)} required /><button className="button">Create</button></div>
            <small className="form-hint">Start with 100 chips. Get 10 more every day. Unused chips roll over.</small>
          </form>
          <form className="form-card" onSubmit={joinGroup}>
            <strong><Users size={17} style={{ verticalAlign: "middle" }} /> Join group</strong>
            <div className="inline-form"><input className="input" placeholder="ABC123" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required /><button className="button">Join</button></div>
            <small className="form-hint">Use the room code from your invite link.</small>
          </form>
        </div>
        {error && <div className="error" style={{ marginBottom: 18 }}>{error}</div>}
        {loading ? <div className="loading">Loading your groups…</div> : groups.length === 0 ? (
          <div className="empty"><Users size={32} /><h2>No groups yet</h2><p>Create one above or join with a room code.</p></div>
        ) : (
          <div className="grid">{groups.map((group, i) => (
            <div className="group-card" key={group.id}>
              <Link href={`/room/${group.id}`} style={{ flex: 1 }}>
                <div>
                  <div className="group-emoji">{["🎉", "✈️", "🍜", "🌴"][i % 4]}</div>
                  <h2>{group.name}</h2>
                  <p>Room code: {group.invite_code}</p>
                </div>
              </Link>
              <div style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", marginTop: 18 }}>
                <Link href={`/room/${group.id}`} style={{ fontWeight: 850 }}>Open group <ArrowRight size={16} style={{ verticalAlign: "middle" }} /></Link>
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void removeGroup(group)}
                  disabled={busyGroupId === group.id}
                  style={{ padding: "9px 13px", color: group.role === "owner" ? "#b83131" : "var(--muted)" }}
                >
                  {group.role === "owner" && <Trash2 size={14} />}
                  {busyGroupId === group.id ? "Working…" : group.role === "owner" ? "Delete group" : "Leave group"}
                </button>
              </div>
            </div>
          ))}</div>
        )}
      </section>
    </main>
  );
}
