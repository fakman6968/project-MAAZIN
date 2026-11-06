// Maazin tray recorder: captures system audio (other speakers) + mic, then hands off to the web API.
const { app, BrowserWindow, Tray, Menu, nativeImage, session, desktopCapturer, ipcMain, clipboard, shell } = require('electron');
const path = require('node:path');
const crypto = require('node:crypto');
const { createClient } = require('@supabase/supabase-js');

try { process.loadEnvFile(path.join(__dirname, '.env')); } catch { /* fall back to real env vars */ }
const { SUPABASE_URL, SUPABASE_ANON_KEY, MAAZIN_WEB_URL = 'http://localhost:3000' } = process.env;
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: false } });

const CONSENT = "Heads up: I'm using Maazin to take notes on this call. The audio is transcribed, then deleted. Tell me if you'd rather I didn't.";

// 16x16 dot icons drawn in code, so there are no asset files.
function dot(r, g, b) {
  const s = 16, buf = Buffer.alloc(s * s * 4);
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    if (Math.hypot(x - 7.5, y - 7.5) < 6.5) buf.set([b, g, r, 255], (y * s + x) * 4); // BGRA
  }
  return nativeImage.createFromBitmap(buf, { width: s, height: s });
}
const ICON_IDLE = () => dot(15, 118, 110);
const ICON_REC = () => dot(220, 38, 38);

let win, tray;

function showWindow() {
  if (win) return win.show();
  win = new BrowserWindow({
    width: 380, height: 560, title: 'Maazin', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.loadFile('recorder.html');
  win.on('close', (e) => { if (!app.isQuitting) { e.preventDefault(); win.hide(); } }); // keep running in tray
}

app.whenReady().then(() => {
  // getDisplayMedia() in the renderer → whole screen + Windows loopback (all system audio). No picker.
  session.defaultSession.setDisplayMediaRequestHandler((_req, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then(([screen]) => callback({ video: screen, audio: 'loopback' }));
  });

  tray = new Tray(ICON_IDLE());
  tray.setToolTip('Maazin: not recording');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Maazin', click: showWindow },
    { label: 'Copy consent message', click: () => clipboard.writeText(CONSENT) },
    { label: 'Open web app', click: () => shell.openExternal(MAAZIN_WEB_URL) },
    { type: 'separator' },
    { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showWindow);
  showWindow();
});
app.on('window-all-closed', (e) => e.preventDefault());

ipcMain.handle('auth:signIn', async (_e, email, password) => {
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  return error ? error.message : null;
});
ipcMain.handle('auth:user', async () => (await supabase.auth.getSession()).data.session?.user.email ?? null);
ipcMain.handle('consent:copy', () => clipboard.writeText(CONSENT));
ipcMain.handle('web:open', (_e, id) => shell.openExternal(`${MAAZIN_WEB_URL}/#/m/${id}`));
ipcMain.handle('tray:recording', (_e, on) => {
  tray.setImage(on ? ICON_REC() : ICON_IDLE());
  tray.setToolTip(on ? 'Maazin: ● RECORDING' : 'Maazin: not recording');
});

// Upload audio → create meeting row → ask the web API to transcribe (audio deleted) + write notes.
ipcMain.handle('meeting:save', async (_e, { title, myNotes, durationSec, audio }) => {
  const { data } = await supabase.auth.getSession();
  const s = data.session;
  if (!s) throw new Error('Not signed in');
  const id = crypto.randomUUID();
  const audio_path = `${s.user.id}/${id}.webm`;
  const up = await supabase.storage.from('audio').upload(audio_path, Buffer.from(audio), { contentType: 'audio/webm' });
  if (up.error) throw new Error(up.error.message);
  const ins = await supabase.from('meetings').insert({ id, title, my_notes: myNotes, duration_sec: durationSec, audio_path });
  if (ins.error) throw new Error(ins.error.message);
  const res = await fetch(`${MAAZIN_WEB_URL}/api/process`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${s.access_token}` },
    body: JSON.stringify({ meetingId: id }),
  });
  const body = await res.json().catch(() => ({}));
  return { id, error: res.ok ? null : body.error ?? `HTTP ${res.status}` };
});
