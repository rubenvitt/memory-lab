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
const view = { exp: 'e1', scenario: 'stale', rep: 1, point: 0, erased: false, aVariant: 'A-mem0' };

const expOf = (id = view.exp) => demo.experiments.find((e) => e.id === id);
const variantOf = (arch) => (arch === 'B' ? 'B' : view.exp === 'e1' ? 'A' : view.aVariant);
const labelOf = (arch) => expOf().variants.find((v) => v.id === variantOf(arch)).label;
const runOf = (arch) => expOf().runs.find((r) => r.scenario === view.scenario && r.variant === variantOf(arch) && r.rep === view.rep);
const scenarioOf = () => expOf().scenarios.find((s) => s.id === view.scenario);
const marker = () => new RegExp(scenarioOf().marker.pattern, 'i');
const lastPoint = () => runOf('A').points.length - 1;

// #<experiment>/<scenario>/<run>/<point>[/<A variant>]. Links without experiment are E1.
function readHash() {
  const parts = decodeURIComponent(location.hash.slice(1)).split('/');
  view.exp = demo.experiments.some((e) => e.id === parts[0]) ? parts.shift() : 'e1';
  const [scenario, rep, point, aVariant] = parts;
  view.scenario = expOf().scenarios.some((s) => s.id === scenario) ? scenario : expOf().scenarios[0].id;
  if (Number(rep) >= 1 && Number(rep) <= 5) view.rep = Number(rep);
  if (expOf().variants.some((v) => v.id === aVariant && v.id !== 'B')) view.aVariant = aVariant;
  const n = runOf('A').points.length;
  view.point = Number(point) >= 1 && Number(point) <= n ? Number(point) - 1 : n - 1;
  view.erased = false;
}
const writeHash = () => history.replaceState(null, '', `#${view.exp}/${view.scenario}/${view.rep}/${view.point + 1}${view.exp === 'e1' ? '' : `/${view.aVariant}`}`);

function select({ exp = view.exp, scenario = view.scenario }) {
  view.exp = exp;
  view.scenario = expOf().scenarios.some((s) => s.id === scenario) ? scenario : expOf().scenarios[0].id;
  view.point = lastPoint();
  view.erased = false;
  render();
}

function renderControls() {
  $('experiments').replaceChildren(...demo.experiments.map((e) => {
    const b = el('button', null, e.label);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(e.id === view.exp));
    b.addEventListener('click', () => select({ exp: e.id }));
    return b;
  }));
  const seg = $('scenarios');
  seg.replaceChildren(...expOf().scenarios.map((s) => {
    const b = el('button', null);
    b.type = 'button';
    b.append(el('code', null, s.id), el('span', 'seg-title', s.title));
    b.setAttribute('aria-pressed', String(s.id === view.scenario));
    b.addEventListener('click', () => select({ scenario: s.id }));
    return b;
  }));
  const av = $('avariant');
  av.replaceChildren(...expOf().variants.filter((v) => v.id !== 'B').map((v) => new Option(v.label, v.id)));
  av.value = variantOf('A');
  av.onchange = () => { view.aVariant = av.value; view.erased = false; render(); };
  $('avariant-field').hidden = view.exp === 'e1';
  $('exp-note').hidden = view.exp === 'e1';
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
    // E2: extraction after every message pair.
    const extraction = t.extraction ? [el('li', `msg extract${!deleted && t.extraction.applied.some((o) => o.text && re.test(o.text)) ? ' hit' : ''}`, `Extraktion nach diesem Paar: ${opsText(t.extraction.applied)}`)] : [];
    return [user, ...steps, answer, ...extraction];
  }));
  $(`title-${arch}`).textContent = labelOf(arch);
  $(`verdict-${arch}`).replaceChildren(el('span', `badge ${run.pass ? 'pass' : 'fail'}`, run.pass ? 'bestanden' : 'durchgefallen'), document.createTextNode(` ${run.verdict}`));
  const note = $(`note-${arch}`);
  note.replaceChildren(el('span', 'rec', `${deleted ? `Chat aus Session ${point.session} gelöscht, nur Aufzeichnung des Labors` : `Aufzeichnung Session ${point.session}`}${point.kind === 'session' ? '' : ' · '}`));
  if (point.kind === 'after' && arch === 'A') {
    note.append(el('strong', null, `${point.note?.includes('Nachrichtenpaar') ? 'Extraktion nach jedem Paar in Session' : 'Extraktor nach Session'} ${point.session}: `));
    note.append(document.createTextNode(opsText(point.applied)));
  }
  if (point.kind === 'after' && arch === 'B') note.append(el('strong', null, `Session ${point.session} endet: `), document.createTextNode('Verlauf und gelesene Treffer werden verworfen.'));
  if (point.kind === 'event') note.append(el('strong', null, 'Ereignis: '), document.createTextNode(point.label));
}

function opsText(applied) {
  const ops = applied.filter((o) => o.op !== 'NOOP');
  return ops.length ? ops.map((o) => `${o.op}${o.skipped ? ' (übersprungen)' : ''} ${o.text ? `„${clip(o.text, 90)}“` : o.id}`).join(' · ') : 'nichts geschrieben';
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
    group.append(el('h3', 'group-title', labelOf(arch)));
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
  const say = (arch) => (left(arch).length ? `${variantOf(arch)}: Treffer bleiben in ${left(arch).join(', ')}` : `${variantOf(arch)}: keine Treffer mehr`);
  $('status').textContent = `Chat aus Session ${p.session} gelöscht. ${say('A')}. ${say('B')}.`;
}

function matrixTable(x) {
  const wrap = el('div', 'matrix-block');
  const title = el('h3', 'matrix-exp', x.id === 'e1' ? `E1 · Prompts ${x.prompt_version}` : `E2 · nach Sicht von E1 ergänzt · Prompts ${x.prompt_version}`);
  title.id = `matrix-${x.id}`;
  const scroll = el('div', 'matrix-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('role', 'region');
  scroll.setAttribute('aria-labelledby', title.id);
  const table = el('table', null);
  table.id = `table-${x.id}`;
  const head = el('thead');
  const hr = el('tr');
  for (const [t, cls] of [['Szenario', null], ...x.variants.map((v) => [v.label, null]), ...x.variants.map((v) => [`Erwartung ${v.id}`, 'exp'])]) {
    const th = el('th', cls, t);
    th.scope = 'col';
    hr.append(th);
  }
  head.append(hr);
  const body = el('tbody');
  for (const m of x.matrix) {
    const tr = el('tr');
    if (x.id === view.exp && m.scenario === view.scenario) tr.classList.add('current');
    const th = el('th');
    th.scope = 'row';
    const b = el('button', null);
    b.type = 'button';
    b.append(el('code', null, m.scenario), el('span', null, ` ${m.title}`));
    b.addEventListener('click', () => { select({ exp: x.id, scenario: m.scenario }); $('scenarios').querySelector('[aria-pressed="true"]').focus(); });
    th.append(b);
    tr.append(th);
    for (const v of x.variants) {
      const c = m.cells[v.id];
      const td = el('td', c.pass === c.runs ? 'all' : c.pass === 0 ? 'none' : 'some');
      const dots = el('span', 'dots');
      dots.setAttribute('aria-hidden', 'true');
      for (const r of x.runs.filter((y) => y.scenario === m.scenario && y.variant === v.id).sort((y, z) => y.rep - z.rep)) dots.append(el('span', r.pass ? 'dot pass' : 'dot fail'));
      td.append(el('span', 'frac', `${c.pass}/${c.runs}`), dots);
      tr.append(td);
    }
    for (const v of x.variants) tr.append(el('td', 'exp', m.cells[v.id].expected));
    body.append(tr);
  }
  table.append(head, body);
  scroll.append(table);
  wrap.append(title, scroll);
  return wrap;
}

function renderMatrix() {
  $('matrices').replaceChildren(...demo.experiments.map(matrixTable));
  const m = demo.experiments[0].models;
  $('matrix-source').textContent = `bestanden von Läufen · ${m.agent}, Effort ${m.effort} · Erwartung jeweils vor dem Lauf festgehalten`;
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
