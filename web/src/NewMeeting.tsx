import { useEffect, useRef, useState } from 'react';
import { CONSENT_MESSAGE, createMeeting, fetchUsage, startRecording, type Usage } from './lib';
import { CopyButton, outOfBudget, UsageNotice } from './ui';

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export default function NewMeeting() {
  const [title, setTitle] = useState('');
  const [myNotes, setMyNotes] = useState('');
  const [includeTab, setIncludeTab] = useState(true);
  const [recording, setRecording] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [usage, setUsage] = useState<Usage | null>(null);
  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);
  const blocked = !!usage && outOfBudget(usage);

  useEffect(() => { fetchUsage().then(setUsage); }, []);

  useEffect(() => {
    if (!recording) return;
    setSeconds(0);
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  const submit = async (blob: Blob, durationSec: number | null) => {
    setUploading(true);
    setError('');
    try {
      const id = await createMeeting(blob, title || 'Untitled meeting', myNotes, durationSec);
      location.hash = `#/m/${id}`;
    } catch (e) {
      setUploading(false);
      setError(`The upload didn't work: ${e instanceof Error ? e.message : e}`);
    }
  };

  const toggle = async () => {
    if (recording) {
      setRecording(false);
      const { blob, durationSec } = await recRef.current!.stop();
      await submit(blob, durationSec);
      return;
    }
    setError('');
    try {
      recRef.current = await startRecording(includeTab);
      setRecording(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="rise space-y-5">
      <h1 className="text-3xl font-bold tracking-tight">New meeting</h1>

      {usage && !recording && <UsageNotice usage={usage} />}

      {recording && (
        <div role="status" className="flex items-center gap-3 rounded-xl bg-rec px-4 py-3 font-semibold text-white">
          <span className="relative flex size-3">
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75" />
            <span className="relative inline-flex size-3 rounded-full bg-white" />
          </span>
          Recording
          <span className="ml-auto tabular-nums">{clock(seconds)}</span>
        </div>
      )}

      <input
        className="field text-lg font-semibold"
        aria-label="Meeting title"
        placeholder="What's this meeting about?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="field h-44 resize-y"
        aria-label="Your rough notes"
        placeholder="Jot down anything that matters. Maazin uses your notes to decide what to focus on."
        value={myNotes}
        onChange={(e) => setMyNotes(e.target.value)}
      />

      <section className="card space-y-4">
        {!recording && (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">What should Maazin hear?</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {[
                { value: true, label: 'Me + the meeting tab', hint: 'For Meet, Zoom or Teams in your browser' },
                { value: false, label: 'Just my mic', hint: 'For in-person chats' },
              ].map((o) => (
                <label
                  key={o.label}
                  className={`cursor-pointer rounded-xl border p-3 transition ${includeTab === o.value ? 'border-brand bg-tint' : 'border-line hover:border-brand'}`}
                >
                  <input type="radio" name="source" className="sr-only" checked={includeTab === o.value} onChange={() => setIncludeTab(o.value)} />
                  <span className="block text-sm font-semibold">{o.label}</span>
                  <span className="block text-xs text-muted">{o.hint}</span>
                </label>
              ))}
            </div>
            {includeTab && (
              <p className="mt-2 text-xs text-muted">
                When Chrome asks, pick your meeting tab and turn on <b>Also share tab audio</b>, or Maazin will only hear you.
              </p>
            )}
          </fieldset>
        )}

        <button onClick={toggle} disabled={uploading || (blocked && !recording)} className={`btn w-full py-3.5 text-base ${recording ? 'btn-rec' : 'btn-primary'}`}>
          {uploading ? 'Uploading…' : recording ? 'Stop and write my notes' : '● Start recording'}
        </button>
        {error && <p role="alert" className="text-sm font-medium text-rec">{error}</p>}
      </section>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-tint p-4">
        <div>
          <h2 className="text-sm font-semibold">Let everyone know first</h2>
          <p className="text-sm text-muted">Paste this into the meeting chat before you start.</p>
        </div>
        <CopyButton text={CONSENT_MESSAGE} label="Copy message" />
      </section>

      {!recording && !blocked && (
        <label className="block cursor-pointer rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted transition hover:border-brand">
          Already have a recording? <span className="font-semibold text-brand">Upload a file</span>
          <input
            type="file"
            accept="audio/*,video/*"
            className="sr-only"
            disabled={uploading}
            onChange={(e) => e.target.files?.[0] && submit(e.target.files[0], null)}
          />
        </label>
      )}
    </div>
  );
}
