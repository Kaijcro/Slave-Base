import { existsSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { z } from 'zod';
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { AGENTS } from '../src/world/agents';

/**
 * Hand-offs: an agent can pass a task (and files) to a teammate.
 * The new task waits in the teammate's queue until the sender's task is finished,
 * so the teammate always gets complete work. Chains are limited so agents can't loop forever.
 */
export const HANDOFF_TOOL = 'mcp__town__hand_off';
const MAX_PER_TASK = 3;   // hand-offs one task may make
const MAX_CHAIN = 3;      // how many hand-offs deep a chain may go (you → Kofi → Priya → Inês)

const first = (id: string) => AGENTS.find((a) => a.id === id)?.name.split(' ')[0] ?? id;
export const teammates = (self: string) =>
  AGENTS.filter((a) => a.id !== self).map((a) => `${a.id} (${a.name}, ${a.role})`).join('; ');

async function chainDepth(db: SupabaseClient, taskId: number) {
  let depth = 0, id: number | null = taskId;
  while (id && depth < 10) {
    const { data }: { data: { parent_id: number | null } | null } = await db.from('agent_tasks').select('parent_id').eq('id', id).maybeSingle();
    id = data?.parent_id ?? null;
    if (id) depth++;
  }
  return depth;
}

export function townServer(o: { db: SupabaseClient; taskId: number; agentId: string; cwd: string; onHandoff: (to: string) => void }) {
  let count = 0;
  const ids = AGENTS.map((a) => a.id) as [string, ...string[]];
  return createSdkMcpServer({
    name: 'town',
    version: '1.0.0',
    tools: [
      tool('hand_off',
        `Pass a task to a teammate. Their task starts as soon as you finish yours, so save your work (files) first, then hand off as your last step. Teammates: ${teammates(o.agentId)}.`,
        {
          to: z.enum(ids).describe('The teammate’s id'),
          task: z.string().min(10).max(3000).describe('Exactly what they should do, as clear standalone instructions. Include the key findings or numbers they need.'),
          files: z.array(z.string()).max(10).default([]).describe('Paths of files you saved that they should read'),
        },
        async (a) => {
          const no = (m: string) => ({ content: [{ type: 'text' as const, text: `Didn't hand off: ${m}` }], isError: true });
          if (a.to === o.agentId) return no('you can’t hand a task to yourself.');
          if (count >= MAX_PER_TASK) return no(`you’ve already handed off ${MAX_PER_TASK} tasks this time.`);
          if ((await chainDepth(o.db, o.taskId)) >= MAX_CHAIN) return no('this task was already handed along several times; finish it yourself and report back.');
          const files = a.files.map((f) => (isAbsolute(f) ? f : resolve(o.cwd, f)));
          const missing = files.filter((f) => !existsSync(f));
          if (missing.length) return no(`these files don’t exist: ${missing.join(', ')}. Save them first.`);
          const from = AGENTS.find((x) => x.id === o.agentId)!;
          const prompt = [
            `${from.name} (${from.role}) handed you this task:`,
            '',
            a.task,
            ...(files.length ? ['', `Files from ${first(o.agentId)} (read these first):`, ...files.map((f) => `- ${f}`)] : []),
          ].join('\n');
          const { data, error } = await o.db.from('agent_tasks').insert({ agent_id: a.to, prompt, fresh: true, from_agent: o.agentId, parent_id: o.taskId }).select('id').single();
          if (error) return no(error.message.includes('column') ? 'the database needs the hand-off update (run supabase/handoff.sql).' : error.message);
          count++;
          o.onHandoff(a.to);
          return { content: [{ type: 'text' as const, text: `Handed off to ${first(a.to)} (task ${data.id}). It starts when you finish.` }] };
        }),
    ],
  });
}
