import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, type Meeting } from './lib';
import MeetingView from './MeetingView';
import NewMeeting from './NewMeeting';

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
    <div className="mx-auto max-w-3xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <a href="#/" className="text-xl font-semibold tracking-tight">Maazin</a>
        <div className="flex items-center gap-3 text-sm">
          <a href="#/new" className="rounded-md bg-teal-700 px-3 py-1.5 text-white">New meeting</a>
          <button onClick={() => supabase.auth.signOut()} className="text-stone-500">Sign out</button>
        </div>
      </header>
      {route === '/new' ? <NewMeeting /> : route.startsWith('/m/') ? <MeetingView id={route.slice(3)} /> : <MeetingList />}
    </div>
  );
}

function Login() {
  const [email, setEmail] = useState('');
  const [msg, setMsg] = useState('');
  // Same email-link sign-in as Jason. shouldCreateUser: false means only existing Jason accounts
  // get in, so strangers can't sign up and spend your Azure and Claude credit.
  const go = async () => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false, emailRedirectTo: location.origin },
    });
    setMsg(error ? error.message : 'Check your email for the sign-in link.');
  };
  return (
    <div className="mx-auto mt-24 max-w-sm space-y-3 p-6">
      <h1 className="text-2xl font-semibold">Maazin</h1>
      <p className="text-sm text-stone-500">Bot-free meeting notes. Uses the same account as Jason.</p>
      <input className="w-full rounded border p-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button onClick={go} className="rounded bg-teal-700 px-3 py-1.5 text-white">Email me a sign-in link</button>
      {msg && <p className="text-sm text-stone-700">{msg}</p>}
    </div>
  );
}

function MeetingList() {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    supabase.from('meetings').select('*').order('created_at', { ascending: false }).then(({ data }) => setMeetings(data ?? []));
  }, []);
  const needle = q.toLowerCase();
  const shown = meetings.filter((m) =>
    [m.title, m.my_notes, m.notes?.summary, ...(m.notes?.action_items.map((a) => a.task) ?? [])]
      .join(' ').toLowerCase().includes(needle),
  );
  return (
    <div className="space-y-3">
      <input className="w-full rounded border p-2" placeholder="Search meetings, notes, action items…" value={q} onChange={(e) => setQ(e.target.value)} />
      {shown.length === 0 && <p className="text-stone-500">No meetings yet. Record one in the Maazin tray app, or click New meeting.</p>}
      {shown.map((m) => (
        <a key={m.id} href={`#/m/${m.id}`} className="block rounded-lg border bg-white p-4 hover:border-teal-700">
          <div className="flex justify-between">
            <span className="font-medium">{m.title}</span>
            <span className="text-xs text-stone-500">{new Date(m.created_at).toLocaleString()} · {m.status}</span>
          </div>
          {m.notes && <p className="mt-1 line-clamp-2 text-sm text-stone-600">{m.notes.summary}</p>}
        </a>
      ))}
    </div>
  );
}
