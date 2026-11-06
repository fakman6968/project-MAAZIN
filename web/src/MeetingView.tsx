import { useEffect, useState } from 'react';
import { notesToMarkdown, processMeeting, supabase, type Meeting } from './lib';

const STATUS: Record<Meeting['status'], string> = {
  uploaded: 'Uploaded, waiting to process…',
  transcribing: 'Transcribing…',
  writing: 'Writing notes…',
  ready: '',
  error: 'Something went wrong',
};

export default function MeetingView({ id }: { id: string }) {
  const [m, setM] = useState<Meeting | null>(null);
  const [myNotes, setMyNotes] = useState('');

  const load = () =>
    supabase.from('meetings').select('*').eq('id', id).single().then(({ data }) => {
      setM(data);
      if (data) setMyNotes((prev) => prev || data.my_notes);
    });

  useEffect(() => { load(); }, [id]);
  // Poll while the server is working (it may have been started by the tray app).
  useEffect(() => {
    if (!m || m.status === 'ready' || m.status === 'error') return;
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, [m?.status]);

  if (!m) return <p className="text-stone-500">Loading…</p>;

  const regenerate = async () => {
    await supabase.from('meetings').update({ my_notes: myNotes, status: 'writing' }).eq('id', id);
    setM({ ...m, status: 'writing' });
    await processMeeting(id).catch(() => {});
    load();
  };

  return (
    <article className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{m.title}</h1>
        <p className="text-sm text-stone-500">
          {new Date(m.created_at).toLocaleString()}{m.duration_sec ? ` · ${Math.round(m.duration_sec / 60)} min` : ''}
        </p>
      </div>

      {m.status !== 'ready' && (
        <p className={`rounded p-3 text-sm ${m.status === 'error' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}>
          {STATUS[m.status]} {m.error}
          {m.status === 'error' && <button onClick={regenerate} className="ml-2 underline">Retry</button>}
        </p>
      )}

      {m.jason_error && (
        <p className="rounded bg-amber-50 p-3 text-sm text-amber-800">
          Your notes are fine, but the action items didn't reach Jason: {m.jason_error}
        </p>
      )}

      {m.notes && (
        <section className="space-y-4 rounded-lg border bg-white p-5">
          <div className="flex justify-between">
            <h2 className="font-semibold">Summary</h2>
            <button onClick={() => navigator.clipboard.writeText(notesToMarkdown(m))} className="text-sm text-teal-700">Copy as Markdown</button>
          </div>
          <p>{m.notes.summary}</p>
          <h2 className="font-semibold">Decisions</h2>
          <ul className="list-disc pl-5">{m.notes.decisions.length ? m.notes.decisions.map((d, i) => <li key={i}>{d}</li>) : <li>None recorded</li>}</ul>
          <h2 className="font-semibold">Action items</h2>
          <ul className="space-y-1">
            {m.notes.action_items.map((a, i) => (
              <li key={i} className="flex gap-2"><input type="checkbox" />
                <span>{a.task}{a.owner && <b className="ml-1 text-stone-600">· {a.owner}</b>}{a.due && <span className="ml-1 text-stone-500">· due {a.due}</span>}</span>
              </li>
            ))}
            {!m.notes.action_items.length && <li>None</li>}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-semibold">Your rough notes</h2>
        <textarea className="h-32 w-full rounded border p-2" value={myNotes} onChange={(e) => setMyNotes(e.target.value)} />
        <button onClick={regenerate} disabled={!m.transcript?.length} className="rounded border px-3 py-1.5 text-sm disabled:opacity-50">Save & regenerate notes</button>
      </section>

      {m.transcript && (
        <details className="rounded-lg border bg-white p-4">
          <summary className="cursor-pointer font-semibold">Transcript ({m.transcript.length} lines)</summary>
          <div className="mt-3 space-y-1 text-sm">
            {m.transcript.map((l, i) => (
              <p key={i}><span className="text-stone-400">{Math.floor(l.start / 60)}:{String(Math.floor(l.start % 60)).padStart(2, '0')}</span>{' '}
                <b>Speaker {l.speaker}:</b> {l.text}</p>
            ))}
          </div>
        </details>
      )}
    </article>
  );
}
