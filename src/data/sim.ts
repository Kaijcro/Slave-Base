import { pick } from '../art/pixel';
import { BIZ, type PlaceKey } from '../world/places';
import type { AgentDef } from '../world/agents';
import { AGENT_TASKS, PLACE_TASKS, CHAT, type DemoTask } from '../world/demoTasks';
import type { AgentSource, Emit } from './types';

interface Plan { kind: 'work' | 'break'; place: PlaceKey; task?: DemoTask }
interface Timer { id: string; t: number; fn: () => void }

/**
 * Demo mode: makes up believable work so the town is alive before any real agents exist.
 * It emits the same AgentEvents a real agent would, so the town code is identical in both modes.
 */
export class SimSource implements AgentSource {
  readonly mode = 'demo' as const;
  private emit!: Emit;
  private plans = new Map<string, Plan>();
  private carry = new Map<string, string>();
  private timers: Timer[] = [];
  private defs: Map<string, AgentDef>;

  constructor(defs: AgentDef[]) { this.defs = new Map(defs.map((d) => [d.id, d])); }

  start(emit: Emit) {
    this.emit = emit;
    // Morning commute: everyone heads out from Town Square to work, a little staggered.
    let delay = 0.3;
    for (const d of this.defs.values()) {
      this.later(d.id, delay, () => this.work(d.id, this.homeOf(d.id)));
      delay += 0.6 + Math.random() * 0.8;
    }
  }

  tick(dt: number) {
    const due = this.timers.filter((t) => (t.t -= dt) <= 0);
    if (!due.length) return;
    this.timers = this.timers.filter((t) => t.t > 0);
    due.forEach((t) => t.fn());
  }

  onArrive(id: string, place: PlaceKey) {
    const plan = this.plans.get(id);
    if (!plan || plan.place !== place) return;
    if (plan.kind === 'break') this.later(id, 6 + Math.random() * 5, () => this.work(id, this.homeOf(id)));
    else {
      const dur = place === 'hall' && id !== 'ines' ? 4 + Math.random() * 2 : 7 + Math.random() * 6;
      this.later(id, dur, () => this.finish(id));
    }
  }

  /** Demo prompts: stop making up work for this agent until release() is called. */
  hold(id: string) {
    this.timers = this.timers.filter((x) => x.id !== id);
    this.plans.delete(id);
  }
  release(id: string) {
    this.later(id, 2 + Math.random() * 2, () => this.work(id, this.homeOf(id)));
  }

  private later(id: string, t: number, fn: () => void) {
    this.timers = this.timers.filter((x) => x.id !== id);
    this.timers.push({ id, t, fn });
  }

  private homeOf(id: string): PlaceKey {
    const d = this.defs.get(id)!;
    if (d.home) return d.home;
    const cur = this.plans.get(id)?.place;
    return pick(BIZ.filter((k) => k !== cur));
  }

  private work(id: string, place: PlaceKey) {
    const carried = this.carry.get(id);
    let task: DemoTask;
    if (place === 'hall' && carried) {
      task = { t: 'Filing: ' + carried, o: () => 'Report filed at Town Hall' };
      this.carry.delete(id);
    } else if (this.defs.get(id)?.home === place && AGENT_TASKS[id]) {
      task = pick(AGENT_TASKS[id]);
    } else {
      task = pick(PLACE_TASKS[place as keyof typeof PLACE_TASKS]);
    }
    this.plans.set(id, { kind: 'work', place, task });
    this.emit({ agent_id: id, kind: 'started', place, text: task.t });
  }

  private rest(id: string) {
    this.plans.set(id, { kind: 'break', place: 'plaza' });
    this.emit({ agent_id: id, kind: 'break', place: 'plaza', text: pick(CHAT) });
  }

  private finish(id: string) {
    const plan = this.plans.get(id);
    if (!plan?.task) return;
    const out = plan.task.o();
    this.emit({ agent_id: id, kind: 'finished', place: plan.place, text: out });
    const d = this.defs.get(id)!;
    if (plan.place === 'hall') {
      if (id === 'ines') return Math.random() < 0.7 ? this.work(id, 'hall') : this.rest(id);
      return this.work(id, this.homeOf(id));
    }
    const r = Math.random();
    if (r < 0.38) return this.work(id, plan.place);
    if (r < 0.74) { this.carry.set(id, out); return this.work(id, 'hall'); }
    if (d.roamer && r < 0.9) return this.work(id, this.homeOf(id));
    this.rest(id);
  }
}
