import { useRef, useState } from 'react';
import { CONSENT_MESSAGE, createMeeting, startRecording } from './lib';

export default function NewMeeting() {
  const [title, setTitle] = useState('');
  const [myNotes, setMyNotes] = useState('');
  const [includeTab, setIncludeTab] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState('');
  const recRef = useRef<Awaited<ReturnType<typeof startRecording>> | null>(null);

  const submit = async (blob: Blob, durationSec: number | null) => {
    setBusy('Uploading…');
    try {
      const id = await createMeeting(blob, title || 'Untitled meeting', myNotes, durationSec);
      location.hash = `#/m/${id}`;
    } catch (e) {
      setBusy(`Failed: ${e instanceof Error ? e.message : e}`);
    }
  };

  const toggle = async () => {
    if (!recording) {
      try {
        recRef.current = await startRecording(includeTab);
        setRecording(true);
      } catch (e) {
        setBusy(`Could not start: ${e instanceof Error ? e.message : e}`);
      }
    } else {
      setRecording(false);
      const { blob, durationSec } = await recRef.current!.stop();
      await submit(blob, durationSec);
    }
  };

  return (
    <div className="space-y-4">
      {recording && <div className="rounded bg-red-600 px-3 py-2 text-sm font-medium text-white">● Recording: everyone on this call is being transcribed</div>}
      <input className="w-full rounded border p-2 text-lg" placeholder="Meeting title" value={title} onChange={(e) => setTitle(e.target.value)} />
      <textarea className="h-48 w-full rounded border p-2" placeholder="Your rough notes. Maazin uses them to decide what matters." value={myNotes} onChange={(e) => setMyNotes(e.target.value)} />
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={toggle} disabled={!!busy && !busy.startsWith('Could')} className={`rounded px-4 py-2 text-white ${recording ? 'bg-red-600' : 'bg-teal-700'}`}>
          {recording ? 'Stop & write notes' : 'Start recording'}
        </button>
        <label className="flex items-center gap-1 text-sm">
          <input type="checkbox" checked={includeTab} disabled={recording} onChange={(e) => setIncludeTab(e.target.checked)} />
          Also capture a browser tab's audio (Meet/Teams web)
        </label>
        <button onClick={() => navigator.clipboard.writeText(CONSENT_MESSAGE)} className="rounded border px-3 py-2 text-sm">Copy consent message</button>
      </div>
      <div className="text-sm text-stone-600">
        …or upload a recording:{' '}
        <input type="file" accept="audio/*,video/*" disabled={recording} onChange={(e) => e.target.files?.[0] && submit(e.target.files[0], null)} />
      </div>
      {busy && <p className="text-sm text-stone-600">{busy}</p>}
      <p className="text-xs text-stone-500">For the Zoom or Teams desktop apps, use the Maazin tray app. It records system audio.</p>
    </div>
  );
}
