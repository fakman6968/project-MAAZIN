# Maazin

Bot-free AI meeting notes. A tray app on your computer records the call (other speakers + your mic). Azure Speech transcribes it, the audio is deleted, and Claude turns your rough notes plus the transcript into a summary, decisions and action items. See [SPEC.md](SPEC.md).

```
project MAAZIN/
  desktop/   Electron tray recorder (Windows: system-audio loopback + mic)
  web/       Vite + React 19 + Tailwind app, plus one Vercel function: api/process.ts
  web/supabase/schema.sql
```

## 1. Accounts and keys
- **Supabase**: create a new project for Maazin. You need the project URL, the anon key and the service-role key.
- **Anthropic**: an API key. The default model is `claude-haiku-5-5`; change it with `MAAZIN_MODEL`.
- **Azure Speech**: in the Azure portal, create a **Speech** resource on the standard (S0) tier, in a region that supports fast transcription. Copy its endpoint and key into `AZURE_SPEECH_ENDPOINT` and `AZURE_SPEECH_KEY`.

## 2. Database
In the SQL editor of Maazin's Supabase project, run `web/supabase/schema.sql`. It creates the `meetings` and usage tables (RLS) and a private `audio` bucket.

Sign-in only accepts existing accounts. Add yourself under **Authentication → Users**, and set **Site URL** under **URL Configuration** to Maazin's address.
Free-plan Storage caps uploads at 50 MB. That's roughly 3 hours of audio at the 32 kbps Maazin records.

## 3. Web app + API
```bash
cd web
cp .env.example .env.local   # fill in all values
npm install
npx vercel dev               # serves the app AND /api/process on http://localhost:3000
```
`npm run dev` (plain Vite) serves the UI but not `/api/process`, so use `vercel dev` for the full flow.

Deploy: create a Vercel project with **Root Directory = `web`**, and add every variable from `.env.example` in its settings.
Hobby-plan reminder: Vercel only deploys commits authored by `fakman6968 <oluwafeyi.fakoya@gmail.com>`, with no co-author trailers. The app uses a single serverless function to stay inside the Hobby limit.

## 4. Desktop tray recorder
```bash
cd desktop
cp .env.example .env         # SUPABASE_URL, SUPABASE_ANON_KEY, MAAZIN_WEB_URL (localhost:3000 or your Vercel URL)
npm install
npm start
```
Sign in, type a title and rough notes, then press **Start recording**. The tray dot turns red and a banner appears. **Stop & write notes** uploads the audio and opens the finished notes in the web app.
Use **Copy consent message** and paste it into the meeting chat. Maazin is bot-free, so it can't announce itself.

## Install as an app (PWA)
Open the deployed site (or `vercel dev` on localhost) in Chrome or Edge, then click the install icon in the address bar. The service worker only registers in production builds.

## Testing without a meeting
Web app → **New meeting** → upload any audio/video file, or record from the mic. Tick "capture a browser tab" to grab Meet/Teams-web audio.

## Known limits (milestone 1)
- Each user is capped at 600 audio minutes and 100 note generations a month (`MAAZIN_MAX_AUDIO_MINUTES`, `MAAZIN_MAX_NOTE_RUNS`). Uploads are limited to 30 MB. There's no cap across all users, so keep sign-ups off while the app is public.
- System audio capture is Windows-only (`audio: 'loopback'`). macOS needs extra work.
- The desktop app forgets your sign-in when it restarts.
- Without headphones, the mic re-records your speakers, so other people may appear twice.
- `/api/process` has a 60-second limit, so a long recording could time out and stay on "Transcribing…". Keep demo meetings short. Long meetings will need a background job.
- If transcription fails, the audio is kept so you can press **Retry**. It's deleted only after a successful transcript.
