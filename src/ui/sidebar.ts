import { S } from '../config';
import { drawHuman, type Look } from '../art/human';
import { PLACES, type PlaceKey } from '../world/places';
import type { Town, Figure, FeedItem } from '../game/Town';
import { store } from './store';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const STATUS: Record<Figure['status'], { label: string; cls: string; color: string }> = {
  working: { label: 'Working', cls: 'work', color: 'var(--mint)' },
  done: { label: 'Done', cls: 'work', color: 'var(--mint)' },
  walking: { label: 'Walking', cls: 'walk', color: 'var(--gold)' },
  break: { label: 'On break', cls: 'idle', color: 'var(--pink)' },
  waiting: { label: 'Waiting', cls: 'wait', color: 'var(--muted)' },
  church: { label: 'At church', cls: 'idle', color: 'var(--gold)' },
};

function line(f: Figure) {
  switch (f.status) {
    case 'working': return f.task || 'Working';
    case 'done': return 'Finished: ' + f.lastOut;
    case 'walking': return `Walking to ${PLACES[f.target ?? f.at].name}`;
    case 'break': return 'On break at Town Square';
    case 'church': return 'At the Sunday service';
    default: return 'Waiting for a task in Town Square';
  }
}
const where = (f: Figure) => (f.state === 'walk' ? 'On the street' : PLACES[f.at].name);
const first = (f: Figure) => f.name.split(' ')[0];

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function fmtTime(m: number) {
  m = ((m % 1440) + 1440) % 1440;
  let h = Math.floor(m / 60);
  const mm = Math.floor(m % 60);
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(mm).padStart(2, '0')} ${ap}`;
}

function portrait(L: Look, scale: number, full: boolean) {
  const w = 12, h = full ? 24 : 13;
  const c = document.createElement('canvas');
  c.width = w * scale; c.height = h * scale;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.setTransform(scale, 0, 0, scale, 0, 0);
  drawHuman(g, L, 6, full ? 22 : 21, 'down', 0, false);
  return c;
}

export function mountSidebar(town: Town, gameCanvas: () => HTMLCanvasElement | undefined, statusText: () => string | undefined) {
  // Roster
  const roster = $('roster');
  const rows: Record<string, { b: HTMLButtonElement; task: HTMLElement; chip: HTMLElement }> = {};
  for (const f of town.figs) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.appendChild(portrait(f.look, 4, false));
    const mid = document.createElement('span');
    mid.style.minWidth = '0';
    mid.innerHTML = '<span class="rname"></span><span class="rtask"></span>';
    mid.querySelector('.rname')!.textContent = f.name;
    const chip = document.createElement('span');
    chip.className = 'chip';
    b.append(mid, chip);
    b.addEventListener('click', () => store.select({ type: 'agent', id: f.id }));
    li.appendChild(b);
    roster.appendChild(li);
    rows[f.id] = { b, task: mid.querySelector('.rtask')!, chip };
  }

  // Building legend
  const legend = $('legend');
  const legBtns = {} as Record<PlaceKey, HTMLButtonElement>;
  for (const [k, p] of Object.entries(PLACES) as [PlaceKey, (typeof PLACES)[PlaceKey]][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.innerHTML = `<i class="sw" style="background:${p.color}"></i>`;
    b.append(p.name);
    b.addEventListener('click', () => store.select({ type: 'place', key: k }));
    legend.appendChild(b);
    legBtns[k] = b;
  }

  // Feed
  const feed = $('feed');
  town.onFeed = (it: FeedItem) => {
    const li = document.createElement('li');
    const verb = it.kind === 'started' ? 'started: ' : it.kind === 'finished' ? 'finished: ' : it.kind === 'progress' ? '' : '';
    li.innerHTML = `<time>${fmtTime(it.mins)}</time><div><span class="who" style="color:${it.fig.tag}"></span> <span class="v"></span></div>`;
    li.querySelector('.who')!.textContent = first(it.fig);
    li.querySelector('.v')!.textContent = verb + it.text + (it.kind !== 'break' ? ` · ${PLACES[it.place].name}` : '');
    if (it.kind === 'progress') li.classList.add('minor');
    feed.prepend(li);
    while (feed.children.length > 60) feed.lastChild!.remove();
  };

  // Focus card
  const focus = $('focus');
  let focusKey = '';
  function renderFocus() {
    const sel = store.sel;
    if (sel.type === 'agent') {
      const f = town.byId.get(sel.id);
      if (!f) return;
      if (focusKey !== f.id) {
        focusKey = f.id;
        focus.innerHTML = '';
        focus.appendChild(portrait(f.look, 6, true));
        const d = document.createElement('div');
        d.style.minWidth = '0';
        d.innerHTML = '<h2></h2><p class="role"></p><span class="status"><i class="dot"></i><span class="sl"></span></span><dl class="kv"><dt>Now</dt><dd class="now"></dd><dt>Where</dt><dd class="where"></dd><dt>Last output</dt><dd class="out"></dd><dt>Tasks done</dt><dd class="dn"></dd></dl><p class="bio"></p><p class="aid"></p>';
        d.querySelector('h2')!.textContent = f.name;
        d.querySelector('.role')!.textContent = `${f.role} · ${f.home ? PLACES[f.home].name : 'All buildings'}`;
        d.querySelector('.bio')!.textContent = f.bio;
        d.querySelector('.aid')!.innerHTML = `Agent ID: <code></code>`;
        d.querySelector('.aid code')!.textContent = f.id;
        focus.appendChild(d);
      }
      const st = STATUS[f.status];
      (focus.querySelector('.dot') as HTMLElement).style.background = st.color;
      focus.querySelector('.sl')!.textContent = st.label;
      focus.querySelector('.now')!.textContent = line(f);
      focus.querySelector('.where')!.textContent = where(f);
      focus.querySelector('.out')!.textContent = f.lastOut;
      focus.querySelector('.dn')!.textContent = String(f.done);
    } else {
      const k = sel.key, p = PLACES[k];
      if (focusKey !== 'p:' + k) {
        focusKey = 'p:' + k;
        focus.innerHTML = '';
        const c = document.createElement('canvas');
        c.width = 144; c.height = 144;
        focus.appendChild(c);
        const d = document.createElement('div');
        d.style.minWidth = '0';
        d.innerHTML = '<h2></h2><p class="role"></p><span class="status"><i class="dot"></i><span class="sl"></span></span><dl class="kv"><dt>Inside</dt><dd class="in"></dd><dt>Assigned</dt><dd class="as"></dd><dt>Latest</dt><dd class="out"></dd></dl><p class="aid"></p>';
        d.querySelector('h2')!.textContent = p.name;
        d.querySelector('.role')!.textContent = p.biz;
        d.querySelector('.aid')!.innerHTML = 'Place key: <code></code>';
        d.querySelector('.aid code')!.textContent = k;
        focus.appendChild(d);
      }
      const here = town.figs.filter((f) => f.at === k && (f.state === 'inside' || (k === 'plaza' && f.state === 'idle')));
      (focus.querySelector('.dot') as HTMLElement).style.background = here.length ? 'var(--mint)' : 'var(--muted)';
      focus.querySelector('.sl')!.textContent = here.length ? (k === 'plaza' ? `${here.length} here` : `${here.length} at work`) : 'Quiet right now';
      focus.querySelector('.in')!.textContent = here.length ? here.map(first).join(', ') : 'Nobody';
      const asg = town.figs.filter((f) => f.home === k).map(first);
      focus.querySelector('.as')!.textContent = asg.length ? asg.join(', ') : 'Anyone';
      const fin = town.feed.find((i) => i.place === k && i.kind === 'finished');
      focus.querySelector('.out')!.textContent = fin ? `${fin.text} (${first(fin.fig)}, ${fmtTime(fin.mins)})` : 'Nothing yet today';
      const c = focus.querySelector('canvas') as HTMLCanvasElement;
      const src = gameCanvas();
      if (src) {
        const g = c.getContext('2d')!;
        g.imageSmoothingEnabled = false;
        const [rx, ry, rw, rh] = p.rect;
        const sz = Math.max(rw, rh);
        g.fillStyle = '#2b2748'; g.fillRect(0, 0, c.width, c.height);
        g.drawImage(src, (rx + rw / 2 - sz / 2) * S, (ry + rh / 2 - sz / 2) * S, sz * S, sz * S, 0, 0, c.width, c.height);
      }
    }
  }

  function render() {
    for (const f of town.figs) {
      const st = STATUS[f.status], r = rows[f.id];
      r.task.textContent = line(f);
      r.chip.textContent = st.label;
      r.chip.className = 'chip ' + st.cls;
      r.b.setAttribute('aria-current', String(store.sel.type === 'agent' && store.sel.id === f.id));
    }
    for (const [k, b] of Object.entries(legBtns)) b.setAttribute('aria-current', String(store.sel.type === 'place' && store.sel.key === k));
    $('clock').textContent = `${DAYS[town.weekday()]} ${fmtTime(town.mins)}`;
    $('kWork').textContent = String(town.workingCount());
    $('kDone').textContent = String(town.totalDone);
    const st = statusText();
    if (st) $('live').textContent = st;
    renderFocus();
  }

  store.listeners.add(() => { focusKey = ''; render(); });
  render();
  setInterval(render, 300);
}
