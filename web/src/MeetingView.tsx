import { useEffect, useRef, useState } from 'react';
import { notesToMarkdown, processMeeting, supabase, type Meeting } from './lib';
import { celebrate, CopyButton } from './ui';

const STEPS: { status: Meeting['status']; label: string }[] = [
  { status: 'uploaded', label: 'Got your audio' },
  { status: 'transcribing', label: 'Listening back' },
  { status: 'writing', label: 'Writing your notes' },
];

function Progress({ status }: { status: Meeting['status'] }) {
  const current = STEPS.findIndex((s) => s.status === status);
  return (
    <ol role="status" className="card rise grid gap-3 sm:grid-cols-3">
      {STEPS.map((s, i) => (
        <li key={s.status} className={`flex items-center gap-2 text-sm font-medium ${i > current ? 'text-muted' : ''}`}>
          <span className={`grid size-6 shrink-0 place-items-center rounded-full text-xs ${i < current ? 'bg-brand text-white' : i === current ? 'animate-pulse bg-spark text-ink' : 'bg-tint text-muted'}`}>
            {i < current ? '✓' : i + 1}
          </span>
          {s.label}
        </li>
      ))}
    </ol>
  );
}

const SPEAKER_COLOURS = ['text-brand', 'text-amber-800', 'text-violet-700', 'text-rose-700', 'text-sky-700'];
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export default function MeetingView({ id }: { id: string }) {
  const [m, setM] = useState<Meeting | null>(null);
  const [myNotes, setMyNotes] = useState('');
  const lastStatus = useRef<Meeting['status'] | null>(null);

  const load = () =>
    supabase.from('meetings').select('*').eq('id', id).single().then(({ data }) => {
      setM(data);
      if (data) setMyNotes((prev) => prev || data.my_notes);
    });

  useEffect(() => { load(); }, [id]);
  // Poll while the server is working (it may have been started by the tray app).
  useEffect(() => {
    if (!m) return;
    // Only celebrate notes finishing now, not opening an old meeting.
    if (m.status === 'ready' && lastStatus.current && lastStatus.current !== 'ready') celebrate();
    lastStatus.current = m.status;
    if (m.status === 'ready' || m.status === 'error') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [m?.status]);

  if (!m) return <p className="text-muted">Loading…</p>;

  const regenerate = async () => {
    await supabase.from('meetings').update({ my_notes: myNotes, status: 'writing' }).eq('id', id);
    setM({ ...m, status: 'writing' });
    await processMeeting(id).catch(() => {});
    load();
  };

  const working = m.status !== 'ready' && m.status !== 'error';

  return (
    <article className="rise space-y-6">
      <div>
        <a href="#/" className="text-sm font-medium text-muted hover:text-brand">← All meetings</a>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{m.title}</h1>
        <p className="text-sm text-muted">
          {new Date(m.created_at).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          {m.duration_sec ? ` · ${Math.max(1, Math.round(m.duration_sec / 60))} min` : ''}
        </p>
      </div>

      {working && <Progress status={m.status} />}

      {m.status === 'error' && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-rec/30 bg-red-50 p-4 text-sm">
          <div>
            <p className="font-semibold text-rec">That didn't work</p>
            <p className="text-ink">{m.error}</p>
          </div>
          <button onClick={regenerate} className="btn">Try again</button>
        </div>
      )}

      {m.jason_error && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900">
          Your notes are fine, but the action items didn't reach Jason: {m.jason_error}
        </p>
      )}

      {m.notes && (
        <section className="card space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold">Summary</h2>
              <CopyButton text={notesToMarkdown(m)} label="Copy notes" />
            </div>
            <p className="leading-relaxed">{m.notes.summary}</p>
          </div>

          <div>
            <h2 className="mb-2 text-lg font-bold">Decisions</h2>
            {m.notes.decisions.length ? (
              <ul className="list-disc space-y-1 pl-5 marker:text-spark">
                {m.notes.decisions.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            ) : <p className="text-muted">No decisions this time.</p>}
          </div>

          <div>
            <h2 className="mb-2 text-lg font-bold">Action items</h2>
            {m.notes.action_items.length ? (
              <ul className="space-y-1">
                {m.notes.action_items.map((a, i) => (
                  <li key={i}>
                    <label className="flex cursor-pointer items-start gap-3 rounded-xl p-2 transition hover:bg-tint">
                      <input type="checkbox" className="peer mt-1 size-4 accent-brand" />
                      <span className="peer-checked:text-muted peer-checked:line-through">
                        {a.task}
                        {a.owner && <span className="ml-2 rounded-full bg-tint px-2 py-0.5 text-xs font-semibold text-brand-dark">{a.owner}</span>}
                        {a.due && <span className="ml-2 text-xs text-muted">due {a.due}</span>}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : <p className="text-muted">Nothing to do. Enjoy that.</p>}
          </div>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-bold">Your rough notes</h2>
        <textarea
          className="field h-32 resize-y"
          aria-label="Your rough notes"
          placeholder="Add what mattered to you, then regenerate."
          value={myNotes}
          onChange={(e) => setMyNotes(e.target.value)}
        />
        <button onClick={regenerate} disabled={!m.transcript?.length || working} className="btn">Update my notes</button>
      </section>

      {m.transcript && (
        <details className="card">
          <summary className="cursor-pointer font-bold">Transcript <span className="font-normal text-muted">({m.transcript.length} lines)</span></summary>
          <div className="mt-4 space-y-2 text-sm leading-relaxed">
            {m.transcript.map((l, i) => (
              <p key={i}>
                <span className="mr-2 text-xs tabular-nums text-muted">{clock(l.start)}</span>
                <b className={SPEAKER_COLOURS[l.speaker % SPEAKER_COLOURS.length]}>Speaker {l.speaker}</b> {l.text}
              </p>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
