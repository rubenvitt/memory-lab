// Replays recorded runs. The only logic computed here is "Chat löschen", with the store module the runs used (memory.js).
import { deleteSession, storeEntries } from './memory.js';

const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
// A long entry with a hit shows the passage around the hit, not its beginning.
const excerpt = (t, re, n) => {
  const at = t.search(re);
  if (at < 0 || t.length <= n) return clip(t, n);
  const start = Math.max(0, Math.min(at - Math.floor(n / 3), t.length - n));
  return `${start ? '…' : ''}${t.slice(start, start + n)}${start + n < t.length ? '…' : ''}`;
};

const TOOL_ARG = { search_docs: 'query', search_catalog: 'query', waive_fee: 'reason', remember: 'key' };
const KEEP = { history: 6, audit: 4, retrieval: 4 }; // newest entries shown per long store, hits always shown

let demo;
const view = { scenario: 'stale', rep: 1, point: 0, erased: false };

const runOf = (arch) => demo.runs.find((r) => r.scenario === view.scenario && r.arch === arch && r.rep === view.rep);
const scenarioOf = () => demo.scenarios.find((s) => s.id === view.scenario);
const marker = () => new RegExp(scenarioOf().marker.pattern, 'i');

function readHash() {
  const [scenario, rep, point] = decodeURIComponent(location.hash.slice(1)).split('/');
  if (demo.scenarios.some((s) => s.id === scenario)) view.scenario = scenario;
  if (Number(rep) >= 1 && Number(rep) <= 5) view.rep = Number(rep);
  const n = runOf('A').points.length;
  view.point = Number(point) >= 1 && Number(point) <= n ? Number(point) - 1 : n - 1;
  view.erased = false;
}
const writeHash = () => history.replaceState(null, '', `#${view.scenario}/${view.rep}/${view.point + 1}`);

function renderControls() {
  const seg = $('scenarios');
  seg.replaceChildren(...demo.scenarios.map((s) => {
    const b = el('button', null);
    b.type = 'button';
    b.append(el('code', null, s.id), el('span', 'seg-title', s.title));
    b.setAttribute('aria-pressed', String(s.id === view.scenario));
    b.addEventListener('click', () => { view.scenario = s.id; view.point = runOf('A').points.length - 1; view.erased = false; render(); });
    return b;
  }));
  const rep = $('rep');
  if (!rep.options.length) {
    for (let i = 1; i <= 5; i++) rep.append(new Option(String(i), String(i)));
    rep.addEventListener('change', () => { view.rep = Number(rep.value); view.erased = false; render(); });
  }
  rep.value = String(view.rep);
  $('check').replaceChildren(el('strong', null, 'Prüfung: '), document.createTextNode(scenarioOf().check.replace(/`/g, '')));
}

function renderTimeline() {
  const points = runOf('A').points;
  $('timeline').replaceChildren(...points.map((p, i) => {
    const li = el('li', `t-${p.kind}`);
    const b = el('button', null);
    b.type = 'button';
    b.append(el('span', 't-n', String(i + 1)), el('span', 't-label', p.kind === 'after' ? `Nach S${p.session}` : p.label));
    if (i === view.point) b.setAttribute('aria-current', 'step');
    b.addEventListener('click', () => { view.point = i; view.erased = false; render(); });
    li.append(b);
    return li;
  }));
}

function stepLine(step) {
  const { tool } = step.action;
  const li = el('li', `msg step${step.result?.error ? ' rejected' : ''}`);
  const arg = TOOL_ARG[tool] ? step.action[TOOL_ARG[tool]] : null;
  const head = el('span', 'tool', tool);
  li.append(head);
  if (arg) li.append(el('span', 'arg', ` „${clip(arg, 80)}“`));
  if (tool === 'remember') li.append(el('span', 'arg', ` = ${clip(step.action.value ?? '', 60)} („${clip(step.action.quote ?? '', 70)}“)`));
  const result = step.result?.error ? `abgelehnt: ${step.result.error.replace(/^abgelehnt: /, '')}` : summarize(tool, step.result);
  if (result) li.append(el('span', 'result', ` → ${result}`));
  return li;
}

function summarize(tool, result) {
  if (!result) return '';
  if (tool === 'get_profile') return `${result.address}, Bringdienst ${result.delivery_service ? 'ja' : 'nein'}, Gebühren ${result.open_fees}`;
  if (tool === 'search_docs' || tool === 'search_catalog') return result.results?.length ? result.results.map((r) => r.title).join(' · ') : 'keine Treffer';
  if (tool === 'waive_fee') return `erlassen: ${result.waived}`;
  if (tool === 'remember') return 'gespeichert';
  return '';
}

function renderChat(arch) {
  const run = runOf(arch);
  const point = run.points[view.point];
  const sessionPoint = run.points.find((p) => p.kind === 'session' && p.session === point.session);
  const re = marker();
  const log = $(`log-${arch}`);
  // Once its chat is deleted, the panel only shows the lab's recording: dimmed and without hit marks.
  const deleted = view.erased || run.points.slice(0, view.point + 1).some((p) => p.event?.kind === 'delete-session' && p.event.session === point.session);
  log.classList.toggle('deleted', deleted);
  log.replaceChildren(...sessionPoint.turns.flatMap((t) => {
    const user = el('li', 'msg user');
    user.append(el('span', 'who', 'Person'), el('span', 'text', t.user));
    if (!deleted && re.test(t.user)) user.classList.add('hit');
    const steps = t.steps.filter((s) => s.action.tool !== 'answer').map(stepLine);
    const answer = el('li', 'msg answer');
    answer.append(el('span', 'who', 'Assistent'), el('span', 'text', t.answer ?? `keine Antwort nach ${t.steps.length} Schritten`));
    return [user, ...steps, answer];
  }));
  $(`verdict-${arch}`).replaceChildren(el('span', `badge ${run.pass ? 'pass' : 'fail'}`, run.pass ? 'bestanden' : 'durchgefallen'), document.createTextNode(` ${run.verdict}`));
  const note = $(`note-${arch}`);
  note.replaceChildren(el('span', 'rec', `${deleted ? `Chat aus Session ${point.session} gelöscht, nur Aufzeichnung des Labors` : `Aufzeichnung Session ${point.session}`}${point.kind === 'session' ? '' : ' · '}`));
  if (point.kind === 'after' && arch === 'A') {
    note.append(el('strong', null, 'Extraktor nach Session ' + point.session + ': '));
    const ops = point.applied.filter((o) => o.op !== 'NOOP');
    note.append(document.createTextNode(ops.length ? ops.map((o) => `${o.op}${o.skipped ? ' (übersprungen)' : ''} ${o.text ? `„${clip(o.text, 90)}“` : o.id}`).join(' · ') : 'nichts geschrieben'));
  }
  if (point.kind === 'after' && arch === 'B') note.append(el('strong', null, `Session ${point.session} endet: `), document.createTextNode('Verlauf und gelesene Treffer werden verworfen.'));
  if (point.kind === 'event') note.append(el('strong', null, 'Ereignis: '), document.createTextNode(point.label));
}

function auditText(text) {
  const a = JSON.parse(text);
  const sealed = (v) => (v && typeof v === 'object' && 'sha256' in v ? `#${v.sha256.slice(0, 8)} (${v.length} Z.)` : JSON.stringify(v));
  if (a.type === 'user-message' || a.type === 'answer') return `${a.seq} ${a.type === 'answer' ? 'Antwort' : 'Nachricht'} S${a.session} ${sealed(a)}`;
  if (a.type === 'tool-call') return `${a.seq} ${a.tool} ${Object.entries(a.args).filter(([, v]) => v != null).map(([k, v]) => `${k}=${sealed(v)}`).join(' ')}`;
  if (a.type === 'store-write') return `${a.seq} Schreiben ${a.store}.${a.key}: ${a.accepted ? 'angenommen' : 'abgelehnt'}`;
  if (a.type === 'session-end') return `${a.seq} Session ${a.session} beendet`;
  if (a.type === 'delete-session') return `${a.seq} Chat S${a.session} gelöscht, ${a.removed.preferences} Präferenz(en) entfernt`;
  return `${a.seq} ${a.type}`;
}

function storesNow(arch) {
  const point = runOf(arch).points[view.point];
  if (!view.erased) return point.stores;
  const copy = JSON.parse(JSON.stringify(point.stores));
  deleteSession(copy, point.session);
  return copy;
}

function renderStores() {
  const re = marker();
  const { label } = scenarioOf().marker;
  const groups = ['A', 'B'].map((arch) => {
    const entries = storeEntries(storesNow(arch));
    const group = el('div', `store-group g-${arch}`);
    group.append(el('h3', 'group-title', arch === 'A' ? 'A · ein Topf' : 'B · getrennte Stores'));
    const cols = el('div', 'cols');
    for (const info of demo.stores[arch]) {
      const list = entries[info.id] ?? [];
      const col = el('section', 'store');
      col.setAttribute('aria-label', `${arch}: ${info.label}`);
      const head = el('div', 'store-head');
      const hitCount = list.filter((e) => re.test(e.text)).length;
      head.append(el('h4', null, info.label), el('p', 'meta', `${info.writer} · ${info.lifetime} · im Prompt: ${info.prompt}`));
      col.append(head);
      const keep = KEEP[info.id];
      const shown = keep ? list.filter((e, i) => re.test(e.text) || i >= list.length - keep) : list;
      const ul = el('ul', 'entries');
      if (keep && shown.length < list.length) ul.append(el('li', 'more', `${list.length - shown.length} ältere Einträge ohne Treffer ausgeblendet`));
      for (const e of shown) {
        const li = el('li', 'entry');
        const hit = re.test(e.text);
        if (hit) { li.classList.add('hit'); li.append(el('span', 'hit-label', `Treffer: ${label}`)); }
        li.append(el('span', 'entry-text', info.id === 'audit' ? auditText(e.text) : excerpt(e.text, re, info.id === 'history' ? 130 : 220)));
        li.append(el('span', 'by', arch === 'A' && info.id === 'memory' ? `ohne Quelle · Labor: ${e.by}` : e.by));
        ul.append(li);
      }
      if (!list.length) ul.append(el('li', 'empty', 'leer'));
      col.append(ul);
      if (hitCount) col.classList.add('has-hit');
      cols.append(col);
    }
    group.append(cols);
    return group;
  });
  $('stores').replaceChildren(...groups);
  const p = runOf('A').points[view.point];
  $('inspector-source').textContent = `${view.erased ? `simuliert: Chat aus Session ${p.session} gelöscht` : 'aufgezeichnet'} · Zeitpunkt ${view.point + 1}: ${p.kind === 'after' ? `nach Session ${p.session}` : p.label} · markiert: ${label}`;
}

function renderErase() {
  const p = runOf('A').points[view.point];
  const button = $('erase');
  button.textContent = view.erased ? 'Löschen zurücknehmen' : `Chat löschen (Session ${p.session})`;
  button.setAttribute('aria-pressed', String(view.erased));
  if (!view.erased) { $('status').textContent = ''; return; }
  const re = marker();
  const left = (arch) => Object.entries(storeEntries(storesNow(arch))).filter(([, list]) => list.some((e) => re.test(e.text))).map(([store]) => demo.stores[arch].find((s) => s.id === store).label);
  const say = (arch) => (left(arch).length ? `${arch}: Treffer bleiben in ${left(arch).join(', ')}` : `${arch}: keine Treffer mehr`);
  $('status').textContent = `Chat aus Session ${p.session} gelöscht. ${say('A')}. ${say('B')}.`;
}

function renderMatrix() {
  const table = $('matrix');
  const head = el('thead');
  const hr = el('tr');
  for (const [t, cls] of [['Szenario', null], ['A · ein Topf', null], ['B · getrennte Stores', null], ['Erwartung A', 'exp'], ['Erwartung B', 'exp']]) {
    const th = el('th', cls, t);
    th.scope = 'col';
    hr.append(th);
  }
  head.append(hr);
  const body = el('tbody');
  for (const m of demo.matrix) {
    const tr = el('tr');
    if (m.scenario === view.scenario) tr.classList.add('current');
    const th = el('th');
    th.scope = 'row';
    const b = el('button', null);
    b.type = 'button';
    b.append(el('code', null, m.scenario), el('span', null, ` ${m.title}`));
    b.addEventListener('click', () => { view.scenario = m.scenario; view.point = runOf('A').points.length - 1; view.erased = false; render(); $('scenarios').querySelector('[aria-pressed="true"]').focus(); });
    th.append(b);
    tr.append(th);
    for (const arch of ['A', 'B']) {
      const c = m[arch];
      const td = el('td', c.pass === c.runs ? 'all' : c.pass === 0 ? 'none' : 'some');
      const dots = el('span', 'dots');
      dots.setAttribute('aria-hidden', 'true');
      for (const r of demo.runs.filter((x) => x.scenario === m.scenario && x.arch === arch).sort((x, y) => x.rep - y.rep)) dots.append(el('span', r.pass ? 'dot pass' : 'dot fail'));
      td.append(el('span', 'frac', `${c.pass}/${c.runs}`), dots);
      tr.append(td);
    }
    for (const arch of ['A', 'B']) tr.append(el('td', 'exp', m[arch].expected));
    body.append(tr);
  }
  table.replaceChildren(head, body);
  $('matrix-source').textContent = `bestanden von Läufen · ${demo.models.agent}, Effort ${demo.models.effort}, Prompts ${demo.prompt_version} · Erwartung vor dem Lauf festgehalten`;
}

function render() {
  writeHash();
  renderControls();
  renderTimeline();
  renderChat('A');
  renderChat('B');
  renderStores();
  renderErase();
  renderMatrix();
}

async function start() {
  demo = await fetch('data/demo.json').then((r) => r.json());
  readHash();
  $('erase').addEventListener('click', () => { view.erased = !view.erased; renderChat('A'); renderChat('B'); renderStores(); renderErase(); });
  window.addEventListener('hashchange', () => { readHash(); render(); });
  render();
}

start();
