-- Slave Base: one table of agent status updates.
-- Paste this whole file into Supabase > SQL Editor > New query, then click Run.

create table if not exists public.agent_events (
  id          bigint generated always as identity primary key,
  agent_id    text        not null,                 -- matches an id in src/world/agents.ts, e.g. 'hank'
  kind        text        not null check (kind in ('started', 'progress', 'finished', 'break')),
  place       text        not null check (place in ('refuge', 'goose', 'ai', 'plaza', 'hall')),
  text        text        not null default '',      -- the task, the step, or the result
  created_at  timestamptz not null default now()
);

create index if not exists agent_events_agent_time on public.agent_events (agent_id, created_at desc);
create index if not exists agent_events_time on public.agent_events (created_at desc);

-- Security: the website can only READ. Only your agents (using the secret key) can WRITE.
alter table public.agent_events enable row level security;

drop policy if exists "Website can read events" on public.agent_events;
create policy "Website can read events"
  on public.agent_events for select
  to anon, authenticated
  using (true);

-- Turn on real-time updates for this table so the town moves instantly.
do $$
begin
  alter publication supabase_realtime add table public.agent_events;
exception when duplicate_object then null;
end $$;

-- Optional: a few starter rows so the town isn't empty the first time you open it.
insert into public.agent_events (agent_id, kind, place, text) values
  ('ines', 'started', 'hall', 'Compiling the daily brief'),
  ('hank', 'started', 'refuge', 'Scanning vacant lots in Lehigh Acres'),
  ('kofi', 'started', 'ai', 'Researching new AI business ideas'),
  ('june', 'break',   'plaza', 'Waiting for the first task');
