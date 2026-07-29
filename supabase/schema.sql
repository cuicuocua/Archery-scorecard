-- Arcieri Senesi Scorecard — Supabase schema
-- Run this once in your project's SQL Editor (Supabase dashboard -> SQL Editor -> New query -> paste -> Run).

create table if not exists public.sessions (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists sessions_user_id_idx on public.sessions(user_id);

alter table public.sessions enable row level security;

create policy "select own sessions" on public.sessions
  for select using (auth.uid() = user_id);

create policy "insert own sessions" on public.sessions
  for insert with check (auth.uid() = user_id);

create policy "update own sessions" on public.sessions
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own sessions" on public.sessions
  for delete using (auth.uid() = user_id);

create table if not exists public.tournaments (
  id text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create index if not exists tournaments_user_id_idx on public.tournaments(user_id);

alter table public.tournaments enable row level security;

create policy "select own tournaments" on public.tournaments
  for select using (auth.uid() = user_id);

create policy "insert own tournaments" on public.tournaments
  for insert with check (auth.uid() = user_id);

create policy "update own tournaments" on public.tournaments
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "delete own tournaments" on public.tournaments
  for delete using (auth.uid() = user_id);

-- Tournament sharing: a tournament organizer can put a random token into
-- their tournament's data (data->>'shareToken', set from the app — no
-- migration needed since it's just a field inside the existing JSONB blob)
-- to make it publicly viewable at /?share=<token>. This function is the
-- ONLY public read path — it runs with the owner's privileges (security
-- definer) so no new RLS policy is needed on the table itself, and unlike
-- a table-level policy, a parameterized function can never be used to
-- enumerate every shared tournament: it only ever returns the one row
-- whose token exactly matches what the caller already has.
create or replace function public.get_shared_tournament(p_token text)
returns table(data jsonb, updated_at timestamptz)
language sql
security definer
set search_path = public
stable
as $$
  select data, updated_at from public.tournaments
  where data ->> 'shareToken' = p_token
  limit 1;
$$;

grant execute on function public.get_shared_tournament(text) to anon, authenticated;

-- Tournament logos: a public Storage bucket (public bucket = reads bypass
-- RLS entirely, served via a plain URL — appropriate here since a logo
-- isn't sensitive the way bracket/score data is, unlike the tournaments
-- table itself). Writes are still locked down: an authenticated user may
-- only insert/update/delete objects inside a folder path prefixed with
-- their own auth.uid(), enforced by matching the first path segment.
-- A "select own logos" policy is required too, even though public reads
-- never touch it (those go through the public-bucket URL path, which
-- bypasses RLS entirely) — the client uploads with { upsert: true } so a
-- re-uploaded logo overwrites in place, and upsert's "does this row
-- already exist" check runs as an authenticated SELECT against
-- storage.objects. Without this policy that existence check is denied by
-- default-deny RLS, which surfaces as a confusing "new row violates
-- row-level security policy" error on the INSERT/UPDATE itself.
insert into storage.buckets (id, name, public)
values ('tournament-logos', 'tournament-logos', true)
on conflict (id) do nothing;

create policy "select own logos" on storage.objects
  for select to authenticated
  using (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "insert own logos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "update own logos" on storage.objects
  for update to authenticated
  using (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "delete own logos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'tournament-logos' and (storage.foldername(name))[1] = auth.uid()::text);
