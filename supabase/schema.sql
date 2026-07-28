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
