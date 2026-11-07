import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY);

export type ActionItem = { task: string; owner: string | null; due: string | null };
export type Notes = { summary: string; decisions: string[]; action_items: ActionItem[] };
export type Line = { speaker: number; start: number; text: string };
export type Meeting = {
  id: string; title: string; duration_sec: number | null; my_notes: string;
  status: 'uploaded' | 'transcribing' | 'writing' | 'ready' | 'error'; error: string | null;
  transcript: Line[] | null; notes: Notes | null; created_at: string; jason_error: string | null;
};

export const CONSENT_MESSAGE =
  "Heads up: I'm using Maazin to take notes on this call. The audio is transcribed, then deleted. Tell me if you'd rather I didn't.";

/** Ask the server to (re)transcribe and/or (re)write notes for a meeting. */
export async function processMeeting(meetingId: string) {
  const { data } = await supabase.auth.getSession();
  const res = await fetch('/api/process', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token}` },
    body: JSON.stringify({ meetingId }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
}

export type Usage = { spentUsd: number; budgetUsd: number; minutesLeft: number; paused: boolean };

/** This month's budget. Returns null if unavailable: the server still enforces the limit. */
export async function fetchUsage(): Promise<Usage | null> {
  const { data } = await supabase.auth.getSession();
  const res = await fetch('/api/process', { headers: { authorization: `Bearer ${data.session?.access_token}` } }).catch(() => null);
  return res?.ok ? res.json().catch(() => null) : null;
}

/** Upload audio to the temporary bucket, create the meeting row, and kick off processing. */
export async function createMeeting(audio: Blob, title: string, myNotes: string, durationSec: number | null) {
  const { data: u } = await supabase.auth.getUser();
  const id = crypto.randomUUID();
  const ext = audio.type.includes('webm') ? 'webm' : (audio.type.split('/')[1] || 'bin').split(';')[0];
  const audio_path = `${u.user!.id}/${id}.${ext}`;
  const up = await supabase.storage.from('audio').upload(audio_path, audio, { contentType: audio.type });
  if (up.error) throw up.error;
  const ins = await supabase.from('meetings').insert({ id, title, my_notes: myNotes, duration_sec: durationSec, audio_path });
  if (ins.error) throw ins.error;
  processMeeting(id).catch(() => {}); // status/error are written to the row; the meeting view polls it
  return id;
}

/** Record mic, optionally mixed with a browser tab's audio (Meet/Teams in the browser). */
export async function startRecording(includeTab: boolean) {
  const streams: MediaStream[] = [await navigator.mediaDevices.getUserMedia({ audio: true })];
  if (includeTab) {
    const tab = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    streams.push(tab);
    if (!tab.getAudioTracks().length) {
      streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
      throw new Error("No meeting audio came through. Share your meeting tab again and turn on \"Also share tab audio\".");
    }
  }
  const ctx = new AudioContext();
  const dest = ctx.createMediaStreamDestination();
  for (const s of streams) if (s.getAudioTracks().length) ctx.createMediaStreamSource(s).connect(dest);
  const rec = new MediaRecorder(dest.stream, { mimeType: 'audio/webm;codecs=opus', audioBitsPerSecond: 32000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.start(1000);
  const startedAt = Date.now();
  return {
    stop: () =>
      new Promise<{ blob: Blob; durationSec: number }>((resolve) => {
        rec.onstop = () => {
          streams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
          ctx.close();
          resolve({ blob: new Blob(chunks, { type: 'audio/webm' }), durationSec: Math.round((Date.now() - startedAt) / 1000) });
        };
        rec.stop();
      }),
  };
}

export function notesToMarkdown(m: Meeting) {
  if (!m.notes) return '';
  const n = m.notes;
  return [
    `# ${m.title}`, '', '## Summary', n.summary, '',
    '## Decisions', ...(n.decisions.length ? n.decisions.map((d) => `- ${d}`) : ['- None']), '',
    '## Action items',
    ...(n.action_items.length
      ? n.action_items.map((a) => `- [ ] ${a.task}${a.owner ? ` (${a.owner})` : ''}${a.due ? `, due ${a.due}` : ''}`)
      : ['- None']),
  ].join('\n');
}
