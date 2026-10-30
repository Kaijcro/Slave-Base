-- Slave Base: Finances for the Town Hall vault.
-- Run this once, AFTER prompts.sql: Supabase > SQL Editor > New query, paste this file, then click Run.
--
-- The numbers live in the "Finances" Google Sheet in your Slave Base Drive folder. The town runner on your Mac
-- copies its rows here every few minutes. Only you (signed in) can read them; nobody else can read or change them.

create table if not exists public.finance_entries (
  row_number  integer     primary key,          -- the row in the sheet
  entry_date  date        not null,
  amount      numeric     not null,             -- spending (invested) is negative, income is positive
  description text,
  company     text        not null
);

create table if not exists public.finance_meta (
  id         integer     primary key default 1 check (id = 1),
  sheet_url  text,
  synced_at  timestamptz,
  problems   jsonb       not null default '[]'::jsonb  -- rows that were skipped and why
);

alter table public.finance_entries enable row level security;
alter table public.finance_meta    enable row level security;

drop policy if exists "owners read finance entries" on public.finance_entries;
create policy "owners read finance entries" on public.finance_entries for select to authenticated using (public.is_town_owner());
drop policy if exists "owners read finance meta" on public.finance_meta;
create policy "owners read finance meta" on public.finance_meta for select to authenticated using (public.is_town_owner());
