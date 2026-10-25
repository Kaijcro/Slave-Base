-- Slave Base: prompting your agents from the website.
-- Run this AFTER schema.sql: Supabase > SQL Editor > New query, paste this whole file, then click Run.
--
-- It adds:
--   town_owners    who may send prompts (only you)
--   agent_tasks    the prompts you send and the results your agents write back
--   runner_status  a heartbeat from the town runner on your Mac, so the website knows it's on
--
-- ⚠ Put YOUR email address in the line marked "CHANGE THIS" at the bottom before you click Run.

-- 1. Who owns the town ------------------------------------------------------------
create table if not exists public.town_owners (
  email text primary key
);
alter table public.town_owners enable row level security;
-- No policies on purpose: the website can't read or change this list. Edit it here in the SQL Editor.

create or replace function public.is_town_owner()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.town_owners where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- 2. Prompts and results ----------------------------------------------------------
create table if not exists public.agent_tasks (
  id           bigint generated always as identity primary key,
  agent_id     text        not null,                      -- matches an id in src/world/agents.ts
  prompt       text        not null check (char_length(prompt) between 1 and 4000),
  status       text        not null default 'queued'
               check (status in ('queued', 'running', 'done', 'failed', 'cancelled')),
  fresh        boolean     not null default false,        -- true = start a new conversation
  summary      text,                                      -- one line, shown on the card
  result       text,                                      -- the agent's full answer
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists agent_tasks_queue on public.agent_tasks (status, created_at);
create index if not exists agent_tasks_agent on public.agent_tasks (agent_id, created_at desc);

alter table public.agent_tasks enable row level security;

-- Only owners can see prompts and results; visitors to your site see the town but not this.
drop policy if exists "Owners read tasks" on public.agent_tasks;
create policy "Owners read tasks" on public.agent_tasks
  for select to authenticated using (public.is_town_owner());

-- Only owners can send prompts, and only as new queued tasks.
drop policy if exists "Owners send prompts" on public.agent_tasks;
create policy "Owners send prompts" on public.agent_tasks
  for insert to authenticated
  with check (public.is_town_owner() and status = 'queued' and summary is null and result is null);

-- Owners can cancel a task; everything else is written by the town runner (which uses the secret key).
drop policy if exists "Owners cancel tasks" on public.agent_tasks;
create policy "Owners cancel tasks" on public.agent_tasks
  for update to authenticated
  using (public.is_town_owner() and status in ('queued', 'running'))
  with check (public.is_town_owner() and status = 'cancelled');

-- 3. Runner heartbeat -------------------------------------------------------------
create table if not exists public.runner_status (
  id         int primary key default 1 check (id = 1),
  last_seen  timestamptz,
  running    int not null default 0,
  queued     int not null default 0,
  max_parallel int not null default 2
);
alter table public.runner_status enable row level security;
drop policy if exists "Anyone can see if the runner is on" on public.runner_status;
create policy "Anyone can see if the runner is on" on public.runner_status
  for select to anon, authenticated using (true);
insert into public.runner_status (id) values (1) on conflict (id) do nothing;

-- Real-time updates for the website
do $$ begin alter publication supabase_realtime add table public.agent_tasks; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.runner_status; exception when duplicate_object then null; end $$;

-- 4. You -------------------------------------------------------------------------
insert into public.town_owners (email) values ('you@example.com')   -- ← CHANGE THIS to the email you sign in with
on conflict (email) do nothing;
