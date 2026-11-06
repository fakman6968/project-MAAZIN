# Maazin: MVP spec (milestone 1)

Maazin is a bot-free AI meeting-notes app. Nothing joins the call: your own computer records it.

## Pieces
| Piece | Tech | Job |
|---|---|---|
| `desktop/` tray recorder | Electron (Windows first) | Records **system audio (other speakers) + mic** from any app (Zoom app, Zoom/Meet/Teams in a browser, Teams app). Shows a red tray dot and a "Recording" banner. Has a rough-notes box, Start/Stop, and "Copy consent message". |
| `web/` app | Vite + React 19 + TS + Tailwind | Sign-in, meeting list + search, meeting view (notes, action items, transcript), edit rough notes → regenerate. Can also record from the mic or a browser tab, or upload an audio file. |
| `web/api/process.ts` | One Vercel function (fits the Hobby plan) | Verifies the user, transcribes (Azure Fast Transcription, with speaker labels), **deletes the audio**, then Claude writes the notes and saves them. |
| Supabase | **Maazin's own project** | Separate sign-in. `meetings` table (RLS) + a private `audio` bucket used only as a short-lived upload area. |

## Flow
record → upload to `audio/{uid}/{id}.webm` → insert `meetings` row → `POST /api/process` → Azure reads a short-lived signed URL and returns the transcript → audio deleted → Claude (`claude-haiku-5-5`, env-configurable) → `notes` = `{ summary, decisions[], action_items[{task, owner, due}] }`.

## Consent & privacy
- The tray dot and a banner show while recording. Recording only happens on explicit Start/Stop.
- A one-click consent message to paste into the meeting chat. Maazin can't post it itself, because no bot is in the call.
- Audio is deleted as soon as transcription succeeds. Only the transcript and notes are kept.

## Jason integration
Maazin is a standalone product with its own Supabase project, and people can use it without Jason. The copy of action items into Jason's `tasks` is off (`JASON_SYNC_ENABLED`) because it needs a database shared with Jason.

Planned, after the demo:
- **One-click login:** Jason's server signs a one-minute, single-use ticket containing the user's email. Maazin's server verifies it, then signs that person in.
- **Action items:** Maazin sends them to a protected Jason endpoint, replacing the direct database write.

## Usage caps
Each user gets a $1 monthly budget, estimated at $1 per audio hour and $0.02 per note generation (about 55 minutes of audio a month). All three values are env vars. The server measures audio using Azure's reported duration, in a table users can't edit. Uploads are limited to 12 MB. If a user is over budget, the recording is deleted untranscribed. The check runs before each transcription, so a final recording can go over by up to one file. Sign-up is open to everyone. A total cap across all users (1,800 audio minutes and 1,000 note generations a month, set by env vars) stops new work with a clear message. Like the per-user check, it runs before each job, so the total can go over by whatever is already running.

## Install
The web app is an installable PWA (Chrome/Edge → "Install Maazin"). In the browser it records the mic plus a shared Meet/Teams/Zoom-web tab. The desktop tray app is what covers the native Zoom/Teams apps.

## Cost (estimates, check current prices)
The demo runs on a personal Azure subscription using its $200 credit: expect $2–10 of Azure Speech for about 10 hours of audio, plus under $1 of Claude Haiku billed by Anthropic.
The ~$1/month for 20 hours target is not met by Azure and needs revisiting after the demo. Batch transcription (about $3.60 for 20 h) is cheaper but slower, and local Whisper is free but slower still.

Azure is only "comfortable for ASU IT" under an ASU-managed subscription, so demo on staged meetings, not real ASU ones.

## Roadmap (everything stays, in phases)
1. **Milestone 1 (this build):** record → transcript → notes; auth + per-user data; search; consent UX; audio deleted.
2. **Jason link:** one-click login, then action items through a Jason endpoint (see above).
3. **Speaker names:** stereo You/Them channels, then rename "Speaker 1" → a person.
4. **Calendar sync:** auto-title meetings and pre-fill attendees (Google, then Outlook).
5. **Live transcription:** streaming STT during the call.
6. **Team sharing:** share a meeting or workspace (new RLS policies), then macOS audio and installers.
