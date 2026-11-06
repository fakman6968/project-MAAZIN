// POST /api/process  { meetingId }  (Authorization: Bearer <supabase access token>)
// Transcribes the meeting's audio (if any), deletes the audio, then has Claude write notes.
import { createHash } from 'node:crypto';
import Anthropic from '@anthropic-ai/sdk';
import { createClient } from '@supabase/supabase-js';

const admin = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY
const MODEL = process.env.MAAZIN_MODEL || 'claude-haiku-5-5';
const MAX_AUDIO_MINUTES = Number(process.env.MAAZIN_MAX_AUDIO_MINUTES) || 600;
const MAX_NOTE_RUNS = Number(process.env.MAAZIN_MAX_NOTE_RUNS) || 100;

type Line = { speaker: number; start: number; text: string };

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export async function POST(req: Request): Promise<Response> {
  const token = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);
  const { data: auth } = await admin.auth.getUser(token);
  const user = auth?.user;
  if (!user) return json({ error: 'Invalid session' }, 401);

  const { meetingId } = (await req.json().catch(() => ({}))) as { meetingId?: string };
  const { data: m } = await admin
    .from('meetings').select('*').eq('id', meetingId ?? '').eq('user_id', user.id).single();
  if (!m) return json({ error: 'Meeting not found' }, 404);

  const update = (patch: Record<string, unknown>) => admin.from('meetings').update(patch).eq('id', m.id);

  try {
    let transcript: Line[] | null = m.transcript;
    const usage = await getUsage(user.id); // throws if unreadable, so a broken cap never means no cap

    if (m.audio_path) {
      // The service role bypasses RLS, so never touch files outside the caller's folder.
      if (!m.audio_path.startsWith(`${user.id}/`)) return json({ error: 'Bad audio path' }, 403);

      if (usage.audio_seconds >= MAX_AUDIO_MINUTES * 60) {
        // Unprocessed audio must not linger, so it's deleted rather than kept for later.
        await admin.storage.from('audio').remove([m.audio_path]);
        const error = `Monthly limit of ${MAX_AUDIO_MINUTES} audio minutes reached. This recording was not transcribed and has been deleted.`;
        await update({ status: 'error', error, audio_path: null });
        return json({ error }, 429);
      }

      await update({ status: 'transcribing', error: null });
      const { data: signed, error } = await admin.storage.from('audio').createSignedUrl(m.audio_path, 600);
      if (error || !signed) throw new Error(`Could not read audio: ${error?.message}`);
      const result = await transcribe(signed.signedUrl);
      transcript = result.lines;
      await addUsage(user.id, result.seconds, 0);
      await admin.storage.from('audio').remove([m.audio_path]); // privacy: audio gone after transcription
      await update({ transcript, audio_path: null });
    }

    if (!transcript?.length) throw new Error('Transcript is empty. Was anything said?');

    if (usage.note_runs >= MAX_NOTE_RUNS) {
      const error = `Monthly limit of ${MAX_NOTE_RUNS} note generations reached. Your transcript is saved; try again next month.`;
      await update({ status: 'error', error });
      return json({ error }, 429);
    }

    await update({ status: 'writing', error: null });
    await addUsage(user.id, 0, 1); // counted before the call: Anthropic bills even if the result is unusable
    const notes = await writeNotes(m.title, m.my_notes, transcript);
    await update({ notes, status: 'ready' });

    // A Jason problem must never cost the user their notes, so it's recorded, not thrown.
    let jason_error: string | null = null;
    if (process.env.JASON_SYNC_ENABLED === 'true') {
      try {
        await pushToJason(m, user.id, notes, new URL(req.url).origin);
      } catch (e) {
        jason_error = e instanceof Error ? e.message : String(e);
    }
    }
    await update({ jason_error });
    return json({ ok: true });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await update({ status: 'error', error: message });
    return json({ error: message }, 500);
  }
}

type ActionItem = { task: string; owner: string | null; due: string | null };

/**
 * Copies action items into Jason's `tasks` table (same Supabase project). Users have no INSERT
 * policy on `tasks`, so this has to run here with the service role. Each item's id comes from its
 * text, so regenerating notes doesn't duplicate unchanged items.
 */
async function pushToJason(
  m: { id: string; title: string; created_at: string },
  userId: string,
  notes: unknown,
  origin: string,
) {
  const items = (notes as { action_items?: ActionItem[] }).action_items;
  if (!Array.isArray(items) || !items.length) return;

  const base = (process.env.MAAZIN_WEB_URL || origin).replace(/\/+$/, '');
  const rows = new Map<string, Record<string, unknown>>();
  for (const a of items) {
    const hash = createHash('sha256').update(a.task.trim().toLowerCase()).digest('hex').slice(0, 16);
    const source_message_id = `${m.id}:${hash}`;
    rows.set(source_message_id, {
      user_id: userId,
      title: a.task,
      quadrant: a.due ? 'red' : 'blue', // action items matter; a stated due date makes one urgent
      source_medium: 'maazin',
      source_message_id,
      source_link: `${base}/#/m/${m.id}`,
      received_at: m.created_at,
      classified_by: 'rule',
      classification_reasoning: [
        `From meeting "${m.title}".`,
        a.owner && `Owner: ${a.owner}.`,
        a.due && `Due: ${a.due}.`,
      ].filter(Boolean).join(' '),
    });
  }

  const { data: existing, error: readError } = await admin
    .from('tasks').select('source_message_id')
    .eq('user_id', userId).eq('source_medium', 'maazin').in('source_message_id', [...rows.keys()]);
  if (readError) throw new Error(`Could not read Jason tasks: ${readError.message}`);
  for (const row of existing ?? []) rows.delete(row.source_message_id);

  if (!rows.size) return;
  const { error } = await admin.from('tasks').insert([...rows.values()]);
  if (error) throw new Error(`Could not add Jason tasks: ${error.message}`);
}

async function getUsage(userId: string) {
  const month = `${new Date().toISOString().slice(0, 7)}-01`; // first of this month, UTC
  const { data, error } = await admin
    .from('usage_monthly').select('audio_seconds, note_runs').eq('user_id', userId).eq('month', month).maybeSingle();
  if (error) throw new Error(`Could not check usage: ${error.message}`);
  return data ?? { audio_seconds: 0, note_runs: 0 };
}

async function addUsage(userId: string, seconds: number, runs: number) {
  const { error } = await admin.rpc('add_usage', { p_user: userId, p_seconds: seconds, p_runs: runs });
  if (error) throw new Error(`Could not record usage: ${error.message}`);
}

async function transcribe(url: string): Promise<{ lines: Line[]; seconds: number }> {
  // Azure Fast Transcription: synchronous, and Azure fetches the audio itself from the signed URL.
  const form = new FormData();
  form.append(
    'definition',
    JSON.stringify({
      audioUrl: url,
      locales: [process.env.AZURE_SPEECH_LOCALE || 'en-US'],
      diarization: { enabled: true, maxSpeakers: 10 },
      profanityFilterMode: 'None',
    }),
  );
  const base = process.env.AZURE_SPEECH_ENDPOINT!.replace(/\/+$/, '');
  const res = await fetch(`${base}/speechtotext/transcriptions:transcribe?api-version=2025-10-15`, {
    method: 'POST',
    headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY! },
    body: form, // fetch sets the multipart Content-Type and boundary
  }).catch((e: Error & { cause?: { code?: string; message?: string } }) => {
    // Node reports only "fetch failed"; the useful detail (bad address, DNS, timeout) is in `cause`.
    const reason = e.cause?.code ?? e.cause?.message ?? e.message;
    throw new Error(`Could not reach Azure Speech at ${new URL(base).host} (${reason}). Check AZURE_SPEECH_ENDPOINT.`);
  });
  if (!res.ok) throw new Error(`Azure Speech ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const phrases: { speaker?: number; offsetMilliseconds: number; durationMilliseconds: number; text: string }[] =
    data.phrases ?? [];
  // Azure's measured duration, never the client's, so usage can't be under-reported.
  const lastEnd = phrases.reduce((max, p) => Math.max(max, p.offsetMilliseconds + p.durationMilliseconds), 0);
  return {
    seconds: Math.ceil((data.durationMilliseconds ?? lastEnd) / 1000),
    lines: phrases.map((p) => ({ speaker: p.speaker ?? 0, start: p.offsetMilliseconds / 1000, text: p.text })),
  };
}

const SYSTEM = `You turn meeting transcripts into clean, accurate meeting notes.
The user's rough notes show what THEY cared about: use them to decide emphasis, and keep their wording for names and terms.
The transcript has anonymous speaker numbers and may contain recognition errors; never invent facts, owners or dates.
Use null for an unknown owner or due date. Keep the summary to 2-5 sentences.`;

async function writeNotes(title: string, myNotes: string, transcript: Line[]) {
  const text = transcript
    .map((l) => `[${fmt(l.start)}] Speaker ${l.speaker}: ${l.text}`)
    .join('\n');

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM,
    tools: [
      {
        name: 'save_notes',
        description: 'Save the structured notes for this meeting.',
        input_schema: {
          type: 'object',
          properties: {
            summary: { type: 'string' },
            decisions: { type: 'array', items: { type: 'string' } },
            action_items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  task: { type: 'string' },
                  owner: { type: ['string', 'null'] },
                  due: { type: ['string', 'null'] },
                },
                required: ['task', 'owner', 'due'],
              },
            },
          },
          required: ['summary', 'decisions', 'action_items'],
        },
      },
    ],
    tool_choice: { type: 'tool', name: 'save_notes' },
    messages: [
      {
        role: 'user',
        content: `<title>${title}</title>\n<my_notes>\n${myNotes || '(none)'}\n</my_notes>\n<transcript>\n${text}\n</transcript>`,
      },
    ],
  });

  const block = res.content.find((b) => b.type === 'tool_use');
  if (!block || block.type !== 'tool_use') throw new Error('Model returned no notes');
  return block.input;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
