-- Slave Base: agents handing work to each other.
-- Run this once, AFTER prompts.sql: Supabase > SQL Editor > New query, paste this file, then click Run.
alter table public.agent_tasks add column if not exists from_agent text;       -- who handed this task over (null = you)
alter table public.agent_tasks add column if not exists parent_id  bigint references public.agent_tasks (id) on delete set null; -- the task it came from
create index if not exists agent_tasks_parent on public.agent_tasks (parent_id);
