-- Slave Base: the AI receptionist business (prospects and clients).
-- Run this once, AFTER prompts.sql: Supabase > SQL Editor > New query, paste this file, then click Run.
--
-- prospects  businesses your agents found (from Google Places) and where each one is in your outreach
-- clients    businesses paying you for an AI receptionist, used for the monthly reports
--
-- Only the town runner on your Mac (secret key) writes here. Signed-in owners can read; nobody else can.

create table if not exists public.prospects (
  id            bigint generated always as identity primary key,
  name          text        not null,
  contact_name  text,                                   -- owner or manager, if the agents found one
  category      text,                                   -- e.g. Plumber, HVAC contractor
  search        text,                                   -- the search that found it, e.g. "plumber in Stuart, FL"
  address       text,
  city          text,
  state         text,
  phone         text,
  website       text,
  email         text,
  rating        numeric,
  reviews       integer,
  source        text        not null default 'manual',  -- google or manual
  source_id     text unique,                            -- Google place id, used to skip duplicates
  status        text        not null default 'new'
                check (status in ('new', 'queued', 'emailed', 'replied', 'interested', 'demo_sent', 'won', 'lost', 'do_not_contact')),
  demo_agent_id text,                                   -- Retell demo built for them
  campaign_id   text,                                   -- Instantly campaign they were added to
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists prospects_status on public.prospects (status);

create table if not exists public.clients (
  id              bigint generated always as identity primary key,
  business_name   text        not null,
  contact_name    text,
  email           text,
  phone           text,
  retell_agent_id text,                                 -- their receptionist in Retell
  phone_number    text,                                 -- the number it answers
  monthly_fee     numeric,                              -- what they pay you
  avg_job_value   numeric,                              -- their average job, for "estimated revenue"
  start_date      date        not null default current_date,
  status          text        not null default 'active' check (status in ('trial', 'active', 'paused', 'cancelled')),
  prospect_id     bigint references public.prospects (id) on delete set null,
  notes           text,
  created_at      timestamptz not null default now()
);

alter table public.prospects enable row level security;
alter table public.clients   enable row level security;

drop policy if exists "owners read prospects" on public.prospects;
create policy "owners read prospects" on public.prospects for select to authenticated using (public.is_town_owner());
drop policy if exists "owners read clients" on public.clients;
create policy "owners read clients" on public.clients for select to authenticated using (public.is_town_owner());
