import type { PlaceKey } from '../world/places';

/**
 * One status update from an agent. This is exactly one row in the Supabase `agent_events` table.
 *
 * - started:  the agent began a task at `place`  -> the person walks there and goes inside
 * - progress: a step inside the task (tool use)  -> a speech bubble above the building
 * - finished: the task is done, `text` is the result -> shown in the feed; the person heads to Town Square
 * - break:    the agent is idle on purpose        -> the person hangs out in Town Square
 */
export type EventKind = 'started' | 'progress' | 'finished' | 'break';
export const EVENT_KINDS: EventKind[] = ['started', 'progress', 'finished', 'break'];

export interface AgentEvent {
  agent_id: string;
  kind: EventKind;
  place: PlaceKey;
  text: string;
  created_at?: string;
}

export interface EmitOptions {
  /** Jump straight to the place instead of walking (used when loading history on page open). */
  instant?: boolean;
}

export type Emit = (e: AgentEvent, o?: EmitOptions) => void;

/** Where events come from: the demo simulation or the live Supabase feed. */
export interface AgentSource {
  readonly mode: 'demo' | 'live';
  start(emit: Emit): void | Promise<void>;
  /** Called by the town when a person reaches the place an event sent them to. */
  onArrive?(agentId: string, place: PlaceKey): void;
  /** Demo only: advances the simulation clock. */
  tick?(dt: number): void;
  /** Live only: connection state shown in the header. */
  status?: string;
}
