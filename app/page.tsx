"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { ArrowRight, Coins, Link2, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getDeviceToken } from "@/lib/device";

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
  const [name, setName] = useState("");
  const [question, setQuestion] = useState("");
  const [choices, setChoices] = useState(["", ""]);
  const [eventDate, setEventDate] = useState("");
  const [allowGuestChoices, setAllowGuestChoices] = useState(true);
  const [joinCode, setJoinCode] = useState("");
  const [error, setError] = useState("");
  const [creating, setCreating] = useState(false);

  function updateChoice(index: number, value: string) {
    setChoices((current) => current.map((choice, choiceIndex) => choiceIndex === index ? value : choice));
  }

  async function createEvent(event: FormEvent) {
    event.preventDefault();
    setError("");
    const cleanChoices = choices.map((choice) => choice.trim()).filter(Boolean);
    if (cleanChoices.length < 2) {
      setError("Add at least two choices.");
      return;
    }

    setCreating(true);
    const supabase = createClient();
    const { data, error: createError } = await supabase.rpc("create_decision_event", {
      p_question: question.trim(),
      p_choices: cleanChoices,
      p_display_name: name.trim(),
      p_device_token: getDeviceToken(),
      p_event_date: eventDate || null,
      p_allow_guest_choices: allowGuestChoices,
    });
    setCreating(false);

    if (createError) {
      setError(createError.message);
      return;
    }
    router.push(`/e/${data.invite_code}`);
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
          <h1>Spend your chips on what you <span>actually want.</span></h1>
          <p>Make an event, share the link, and let everyone split 100 chips across the choices. More chips means they want it more.</p>

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

        <form className="create-event-card" onSubmit={createEvent}>
          <div>
            <div className="eyebrow">Create an event</div>
            <h2>What are you deciding?</h2>
          </div>

          <label className="field">Your display name<input className="input" placeholder="Alex" value={name} onChange={(event) => setName(event.target.value)} maxLength={50} required /></label>
          <label className="field">Question<input className="input" placeholder="Where should we eat Friday?" value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={160} required /></label>

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

          <label className="field">Event date <span className="optional">(optional)</span><input className="input" type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} /></label>
          <label className="check-row"><input type="checkbox" checked={allowGuestChoices} onChange={(event) => setAllowGuestChoices(event.target.checked)} /><span><strong>Let friends add choices</strong><small>Anyone who joins can suggest another option.</small></span></label>

          {error && <div className="error">{error}</div>}
          <button className="button yellow create-button" disabled={creating}>{creating ? "Creating…" : <>Create & share <ArrowRight size={18} /></>}</button>
          <p className="no-account-note"><Link2 size={14} /> No account, email, or password required.</p>
        </form>
      </section>
    </main>
  );
}
