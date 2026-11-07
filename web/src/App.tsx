import { useEffect, useState, type FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { fetchUsage, supabase, type Meeting, type Usage } from './lib';
import MeetingView from './MeetingView';
import NewMeeting from './NewMeeting';
import { Embers, UsageMeter } from './ui';

// Tiny hash router: #/ , #/new , #/m/<id>
function useRoute() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#/, '') || '/';
}

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const route = useRoute();

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return null;
  if (!session) return <Login />;

  return (
    <>
    <div className="fire-band" />
    <div className="mx-auto max-w-3xl px-5 py-6">
      <header className="mb-8 flex items-center justify-between gap-2">
        <a href="#/" className="flex shrink-0 items-center gap-2 text-xl font-bold tracking-tight">
          <img src="/icon.svg" alt="" className="size-8" /> Maazin
        </a>
        <div className="flex items-center gap-3 whitespace-nowrap text-sm">
          <button onClick={() => supabase.auth.signOut()} className="font-medium text-muted hover:text-ink">Sign out</button>
          <a href="#/new" className="btn btn-primary">+ New<span className="hidden sm:inline"> meeting</span></a>
        </div>
      </header>
      {route === '/new' ? <NewMeeting /> : route.startsWith('/m/') ? <MeetingView id={route.slice(3)} /> : <MeetingList />}
    </div>
    </>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  // Open sign-up: the first link for a new email creates the account. Per-user monthly caps
  // in api/process.ts limit what each account can spend.
  const go = async (e: FormEvent) => {
    e.preventDefault();
    setState('sending');
    setError('');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, emailRedirectTo: location.origin },
    });
    if (error) {
      setState('idle');
      setError(error.message);
    } else setState('sent');
  };
  return (
    <main className="fire-hero grid min-h-dvh place-items-center p-5">
      <Embers />
      <div className="card rise relative w-full max-w-sm space-y-5 text-center shadow-2xl">
        <img src="/icon.svg" alt="" className="mx-auto size-14" />
        {state === 'sent' ? (
          <div role="status" className="space-y-1">
            <h1 className="text-2xl font-bold tracking-tight">Check your inbox ✦</h1>
            <p className="text-muted">We sent a sign-in link to <b className="text-ink">{email}</b>.</p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h1 className="fire-text text-3xl font-extrabold tracking-tight">Welcome to Maazin</h1>
              <p className="text-muted">Your meetings, written up for you. No bots in the call.</p>
            </div>
            <form onSubmit={go} className="space-y-3">
              <input className="field" type="email" required autoComplete="email" aria-label="Email" placeholder="you@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <button disabled={state === 'sending'} className="btn btn-primary w-full">{state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button>
            </form>
            {error && <p role="alert" className="text-sm font-medium text-rec">{error}</p>}
          </>
        )}
      </div>
    </main>
  );
}

const PILL: Record<Meeting['status'], { label: string; style: string }> = {
  uploaded: { label: 'Working…', style: 'bg-amber-100 text-amber-900' },
  transcribing: { label: 'Working…', style: 'bg-amber-100 text-amber-900' },
  writing: { label: 'Working…', style: 'bg-amber-100 text-amber-900' },
  ready: { label: 'Ready', style: 'bg-tint text-brand-dark' },
  error: { label: 'Needs a retry', style: 'bg-red-100 text-rec' },
};

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function MeetingList() {
  const [meetings, setMeetings] = useState<Meeting[] | null>(null);
  const [q, setQ] = useState('');
  const [usage, setUsage] = useState<Usage | null>(null);
  useEffect(() => {
    fetchUsage().then(setUsage);
    supabase.from('meetings').select('*').order('created_at', { ascending: false }).then(({ data }) => setMeetings(data ?? []));
  }, []);
  const needle = q.toLowerCase();
  const shown = (meetings ?? []).filter((m) =>
    [m.title, m.my_notes, m.notes?.summary, ...(m.notes?.action_items.map((a) => a.task) ?? [])]
      .join(' ').toLowerCase().includes(needle),
  );
  return (
    <div className="rise space-y-5">
      <h1 className="text-3xl font-extrabold tracking-tight"><span className="fire-text">{greeting()}</span> <span className="text-flame">✦</span></h1>
      {usage && <UsageMeter usage={usage} />}

      {meetings?.length === 0 ? (
        <div className="card space-y-3 py-12 text-center">
          <p className="text-4xl text-flame" aria-hidden>✦</p>
          <h2 className="text-xl font-bold">Your first notes are one meeting away</h2>
          <p className="text-muted">Record a call or upload a file, and Maazin will write it up.</p>
          <a href="#/new" className="btn btn-primary">Start a meeting</a>
        </div>
      ) : (
        <>
          <input className="field" aria-label="Search" placeholder="Search meetings, notes and action items…" value={q} onChange={(e) => setQ(e.target.value)} />
          {meetings && shown.length === 0 && <p className="text-center text-muted">Nothing matches "{q}".</p>}
          <div className="space-y-3">
            {shown.map((m) => (
              <a key={m.id} href={`#/m/${m.id}`} className="fire-card block">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-bold">{m.title}</span>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${PILL[m.status].style}`}>{PILL[m.status].label}</span>
                </div>
                {m.notes && <p className="mt-1 line-clamp-2 text-sm text-muted">{m.notes.summary}</p>}
                <p className="mt-2 text-xs text-muted">
                  {new Date(m.created_at).toLocaleDateString(undefined, { dateStyle: 'medium' })}
                  {m.notes?.action_items.length ? ` · ${m.notes.action_items.length} to-do${m.notes.action_items.length > 1 ? 's' : ''}` : ''}
                </p>
              </a>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
