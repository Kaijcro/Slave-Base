import { PLACES } from '../world/places';
import type { Town, Figure } from '../game/Town';
import type { Tasks, AgentTask } from '../data/tasks';
import { store } from './store';
import { portrait, line, STATUS, fmtTime } from './sidebar';

/**
 * The agent monitor under the map: one card per agent with what they're doing, their recent steps,
 * their latest result, and a box to send them a prompt.
 * Inside a building it shows only the people who work there or are there right now.
 */
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const first = (f: Figure) => f.name.split(' ')[0];
const ago = (iso?: string | null) => {
  if (!iso) return '';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : new Date(iso).toLocaleDateString();
};
const TASK_LABEL: Record<AgentTask['status'], string> = { queued: 'Waiting in line', running: 'Working on it', done: 'Done', failed: 'Didn’t finish', cancelled: 'Cancelled' };

interface Card { el: HTMLElement; status: HTMLElement; now: HTMLElement; where: HTMLElement; steps: HTMLElement; result: HTMLElement; queue: HTMLElement; form: HTMLFormElement; ta: HTMLTextAreaElement; send: HTMLButtonElement; fresh: HTMLInputElement; err: HTMLElement; key: string }

export function mountMonitor(town: Town, tasks: Tasks) {
  const grid = $('monGrid');
  const cards = new Map<string, Card>();
  const open = new Set<number>(); // results the owner has expanded

  for (const f of town.figs) {
    const el = document.createElement('article');
    el.className = 'mon-card';
    el.innerHTML = `
      <header><span class="mon-face"></span><div class="mon-who"><b></b><small></small></div><span class="chip"></span></header>
      <dl class="kv"><dt>Now</dt><dd class="m-now"></dd><dt>Where</dt><dd class="m-where"></dd></dl>
      <div class="m-label">Recent steps</div><ol class="m-steps"></ol>
      <div class="m-result"></div>
      <ul class="m-queue"></ul>
      <form class="m-form">
        <textarea rows="2" maxlength="4000"></textarea>
        <div class="m-row"><label><input type="checkbox"> New conversation</label><button type="submit">Send</button></div>
        <p class="m-err" hidden></p>
      </form>`;
    el.querySelector('.mon-face')!.appendChild(portrait(f.look, 3, false, f.id));
    el.querySelector('.mon-who b')!.textContent = f.name;
    el.querySelector('.mon-who small')!.textContent = f.role;
    el.querySelector('header')!.addEventListener('click', () => store.select({ type: 'agent', id: f.id }));
    const form = el.querySelector('form')!, ta = form.querySelector('textarea')!;
    ta.placeholder = `Ask ${first(f)} to…`;
    ta.setAttribute('aria-label', `Prompt for ${f.name}`);
    const card: Card = {
      el, form, ta, key: '',
      status: el.querySelector('.chip')!, now: el.querySelector('.m-now')!, where: el.querySelector('.m-where')!,
      steps: el.querySelector('.m-steps')!, result: el.querySelector('.m-result')!, queue: el.querySelector('.m-queue')!,
      send: form.querySelector('button')!, fresh: form.querySelector('input')!, err: form.querySelector('.m-err')!,
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      card.send.disabled = true; card.err.hidden = true;
      try { await tasks.send(f.id, text, card.fresh.checked); ta.value = ''; card.fresh.checked = false; }
      catch (err) { card.err.textContent = (err as Error).message; card.err.hidden = false; }
      card.send.disabled = false;
      render();
    });
    card.result.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest('button[data-open]') as HTMLButtonElement | null;
      if (!b) return;
      const id = Number(b.dataset.open);
      if (open.has(id)) open.delete(id); else open.add(id);
      card.key = ''; render();
    });
    card.queue.addEventListener('click', async (e) => {
      const b = (e.target as HTMLElement).closest('button[data-cancel]') as HTMLButtonElement | null;
      if (b) { b.disabled = true; await tasks.cancel(Number(b.dataset.cancel)).catch((err) => alert(err.message)); }
    });
    grid.appendChild(el);
    cards.set(f.id, card);
  }

  /* ---------------- header: runner status and sign-in ---------------- */
  const authBox = $('authBox');
  function renderHeader() {
    const inside = store.inside;
    $('monTitle').textContent = inside ? `Inside ${PLACES[inside].name}` : 'Agent monitor';
    $('monSub').textContent = inside ? 'Who works here and who’s here right now' : 'What every agent is doing right now';
    const pill = $('runnerPill'), r = tasks.runner;
    if (tasks.mode === 'demo') pill.innerHTML = '<i class="dot live"></i><span>Demo agents</span>';
    else if (!r) pill.innerHTML = '<span>Checking runner…</span>';
    else pill.innerHTML = r.online
      ? `<i class="dot live"></i><span>Runner on · ${r.running} working${r.queued ? `, ${r.queued} waiting` : ''}</span>`
      : '<i class="dot" style="background:var(--muted)"></i><span>Runner off</span>';
    const note = $('monNote');
    if (tasks.mode === 'demo') { note.hidden = false; note.textContent = 'Demo mode: prompts here are pretend, so you can try it out. Connect Supabase and start the town runner to use real agents.'; }
    else if (tasks.owner && r && !r.online) { note.hidden = false; note.innerHTML = 'Your town runner is off, so prompts will wait in line. Start it on your Mac: <code>cd ~/Documents/Slave-Base &amp;&amp; npm run town</code>'; }
    else if (tasks.user && !tasks.owner) { note.hidden = false; note.textContent = `Signed in as ${tasks.user}, but that email isn’t on the town owner list, so you can watch but not send prompts.`; }
    else note.hidden = true;
  }
  let authFor: string | null | undefined;
  function renderAuth() {
    if (authFor === tasks.user) return; // only rebuild when you sign in or out
    authFor = tasks.user;
    if (tasks.mode === 'demo') { authBox.innerHTML = ''; return; }
    if (tasks.user) {
      authBox.innerHTML = '<span class="mon-user"></span> <button type="button" class="linkbtn">Sign out</button>';
      authBox.querySelector('.mon-user')!.textContent = tasks.user;
      authBox.querySelector('button')!.addEventListener('click', () => tasks.signOut());
    } else {
      authBox.innerHTML = '<form class="signin"><input type="email" required placeholder="Your email" aria-label="Your email"><button type="submit">Sign in to send prompts</button></form>';
      const f = authBox.querySelector('form')!;
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = (f.querySelector('input') as HTMLInputElement).value.trim();
        const btn = f.querySelector('button')!;
        btn.disabled = true;
        try { await tasks.signIn(email); f.innerHTML = '<span class="mon-user">Check your email for a sign-in link.</span>'; }
        catch (err) { btn.disabled = false; alert((err as Error).message); }
      });
    }
  }

  /* ---------------- cards ---------------- */
  function renderCard(f: Figure, c: Card) {
    const st = STATUS[f.status];
    c.status.textContent = st.label; c.status.className = 'chip ' + st.cls;
    c.now.textContent = line(f);
    c.where.textContent = f.state === 'walk' ? `On the way to ${PLACES[f.target ?? f.at].name}` : PLACES[f.at].name;
    c.el.classList.toggle('chosen', store.sel.type === 'agent' && store.sel.id === f.id);

    const steps = f.log.slice(0, 5);
    const stepsKey = steps.map((s) => s.mins + s.text).join('|');
    if (c.steps.dataset.k !== stepsKey) {
      c.steps.dataset.k = stepsKey;
      c.steps.innerHTML = steps.length ? '' : '<li class="m-empty">Nothing yet</li>';
      for (const s of steps) {
        const li = document.createElement('li');
        li.className = 'k-' + s.kind;
        li.innerHTML = '<time></time><span></span>';
        li.querySelector('time')!.textContent = fmtTime(s.mins);
        li.querySelector('span')!.textContent = (s.kind === 'finished' ? '✓ ' : s.kind === 'started' ? '▶ ' : '') + s.text;
        c.steps.appendChild(li);
      }
    }

    const mine = tasks.forAgent(f.id);
    const latest = mine.find((t) => t.status === 'done' || t.status === 'failed');
    const key = (latest ? `${latest.id}:${latest.status}:${open.has(latest.id)}` : 'none:' + f.lastOut) + '|' + mine.filter((t) => t.status === 'queued' || t.status === 'running').map((t) => t.id + t.status).join(',');
    if (c.key !== key) {
      c.key = key;
      if (latest) {
        c.result.innerHTML = '<div class="m-label">Latest result <small></small></div><p class="m-sum"></p>' + (latest.result ? `<button type="button" class="linkbtn" data-open="${latest.id}"></button><pre class="m-full" hidden></pre>` : '');
        c.result.querySelector('small')!.textContent = `· ${ago(latest.finished_at)}`;
        c.result.querySelector('.m-sum')!.textContent = latest.summary || TASK_LABEL[latest.status];
        if (latest.result) {
          const isOpen = open.has(latest.id);
          c.result.querySelector('button')!.textContent = isOpen ? 'Hide full answer' : 'Show full answer';
          const pre = c.result.querySelector('pre')!;
          pre.hidden = !isOpen; pre.textContent = latest.result;
        }
      } else {
        c.result.innerHTML = '<div class="m-label">Latest result</div><p class="m-sum"></p>';
        c.result.querySelector('.m-sum')!.textContent = f.lastOut;
      }
      c.queue.innerHTML = '';
      for (const t of mine.filter((t) => t.status === 'queued' || t.status === 'running').reverse()) {
        const li = document.createElement('li');
        li.innerHTML = `<span class="chip ${t.status === 'running' ? 'work' : 'wait'}"></span><span class="q-text"></span><button type="button" class="linkbtn" data-cancel="${t.id}">Cancel</button>`;
        li.querySelector('.chip')!.textContent = TASK_LABEL[t.status];
        li.querySelector('.q-text')!.textContent = t.prompt;
        c.queue.appendChild(li);
      }
    }
    const canPrompt = tasks.mode === 'demo' || tasks.owner;
    c.form.hidden = !canPrompt;
  }

  function render() {
    const inside = store.inside;
    for (const f of town.figs) {
      const c = cards.get(f.id)!;
      const show = !inside || f.home === inside || (f.state === 'inside' && f.at === inside) || f.target === inside;
      c.el.hidden = !show;
      if (show) renderCard(f, c);
    }
    renderHeader();
  }

  tasks.onChange(() => { renderAuth(); render(); });
  store.listeners.add(render);
  renderAuth();
  render();
  setInterval(render, 500);
}
