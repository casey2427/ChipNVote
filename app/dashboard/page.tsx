"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ArrowRight, Coins, LogOut, Plus, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Group = { id: string; name: string; invite_code: string; chip_budget: number };

export default function Dashboard() {
  const router = useRouter();
  const [groups, setGroups] = useState<Group[]>([]);
  const [newName, setNewName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const supabase = createClient();

  const loadGroups = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return router.push("/auth");
    const { data, error: queryError } = await supabase
      .from("group_members")
      .select("groups(id,name,invite_code,chip_budget)")
      .eq("user_id", auth.user.id);
    if (queryError) setError(queryError.message);
    const rows = (data ?? []).flatMap((row: any) => row.groups ? [row.groups] : []);
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
          <div><div className="eyebrow">Your friend groups</div><h1>Where are we going?</h1></div>
        </div>
        <div className="forms-grid">
          <form className="form-card" onSubmit={createGroup}>
            <strong><Plus size={17} style={{ verticalAlign: "middle" }} /> Create a new group</strong>
            <div className="inline-form"><input className="input" placeholder="Weekend Crew" value={newName} onChange={(e) => setNewName(e.target.value)} required /><button className="button">Create</button></div>
          </form>
          <form className="form-card" onSubmit={joinGroup}>
            <strong><Users size={17} style={{ verticalAlign: "middle" }} /> Join with a room code</strong>
            <div className="inline-form"><input className="input" placeholder="ABC123" value={joinCode} onChange={(e) => setJoinCode(e.target.value)} required /><button className="button">Join</button></div>
          </form>
        </div>
        {error && <div className="error" style={{ marginBottom: 18 }}>{error}</div>}
        {loading ? <div className="loading">Loading your groups…</div> : groups.length === 0 ? (
          <div className="empty"><Users size={32} /><h2>No groups yet</h2><p>Create one above or ask a friend for their room code.</p></div>
        ) : (
          <div className="grid">{groups.map((group, i) => (
            <Link href={`/room/${group.id}`} className="group-card" key={group.id}>
              <div><div className="group-emoji">{["🎉", "✈️", "🍜", "🌴"][i % 4]}</div><h2>{group.name}</h2><p>Room code: {group.invite_code}</p></div>
              <strong>Open room <ArrowRight size={16} style={{ verticalAlign: "middle" }} /></strong>
            </Link>
          ))}</div>
        )}
      </section>
    </main>
  );
}
