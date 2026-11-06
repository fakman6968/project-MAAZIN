-- Maazin schema. Run in the Supabase SQL editor (Jason's project is fine: same auth.users).

create table if not exists public.meetings (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users on delete cascade,
  title        text not null default 'Untitled meeting',
  duration_sec int,
  my_notes     text not null default '',
  audio_path   text,            -- set only until transcription succeeds, then cleared
  status       text not null default 'uploaded'
               check (status in ('uploaded','transcribing','writing','ready','error')),
  error        text,
  transcript   jsonb,           -- [{ speaker, start, text }]
  notes        jsonb,           -- { summary, decisions[], action_items[{task, owner, due}] }
  created_at   timestamptz not null default now()
);

-- Set when action items couldn't be copied to Jason's `tasks`; the notes themselves are still fine.
alter table public.meetings add column if not exists jason_error text;

alter table public.meetings enable row level security;

drop policy if exists "own meetings" on public.meetings;
create policy "own meetings" on public.meetings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Monthly usage, measured by the server. Kept apart from `meetings` because users can
-- edit and delete their own meetings, which would let them reset their usage.
-- RLS with no policies: only the service role (api/process.ts) can touch this table.
create table if not exists public.usage_monthly (
  user_id       uuid not null references auth.users on delete cascade,
  month         date not null,
  audio_seconds int  not null default 0,
  note_runs     int  not null default 0,
  primary key (user_id, month)
);
alter table public.usage_monthly enable row level security;

create or replace function public.add_usage(p_user uuid, p_seconds int, p_runs int)
returns void language sql as $$
  insert into public.usage_monthly as u (user_id, month, audio_seconds, note_runs)
  values (p_user, date_trunc('month', now() at time zone 'utc')::date, p_seconds, p_runs)
  on conflict (user_id, month) do update
    set audio_seconds = u.audio_seconds + excluded.audio_seconds,
        note_runs     = u.note_runs + excluded.note_runs;
$$;
revoke all on function public.add_usage(uuid, int, int) from public, anon, authenticated;
grant execute on function public.add_usage(uuid, int, int) to service_role;

-- This month's usage across everyone, for the app-wide cap in api/process.ts.
create or replace function public.total_usage()
returns table (audio_seconds bigint, note_runs bigint) language sql stable as $$
  select coalesce(sum(u.audio_seconds), 0)::bigint, coalesce(sum(u.note_runs), 0)::bigint
  from public.usage_monthly u
  where u.month = date_trunc('month', now() at time zone 'utc')::date;
$$;
revoke all on function public.total_usage() from public, anon, authenticated;
grant execute on function public.total_usage() to service_role;

-- Private, temporary audio bucket. Users may only upload into their own folder.
-- The 12 MB limit (about 50 minutes at Maazin's bitrate) bounds what one upload can cost.
insert into storage.buckets (id, name, public, file_size_limit) values ('audio', 'audio', false, 12582912)
on conflict (id) do update set file_size_limit = excluded.file_size_limit;

drop policy if exists "upload own audio" on storage.objects;
create policy "upload own audio" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'audio' and (storage.foldername(name))[1] = auth.uid()::text);
