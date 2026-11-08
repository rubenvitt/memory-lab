// Static page: renders data/page.json (written by `npm run report`). No switching, no state.
const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const DIAGNOSIS = /[\p{L}-]*(?:makula|macula)[\p{L}-]*/giu;
function marked(text) {
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(DIAGNOSIS)) {
    frag.append(text.slice(last, m.index), el('mark', null, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}
const WORDS = ['keinem', 'einem', 'zwei', 'drei', 'vier', 'fünf'];
const ofRuns = (k, n) => (k === n ? `in allen ${WORDS[n]} Läufen` : `in ${WORDS[k]} von ${WORDS[n]} Läufen`);

// The four cells of the 2×2, in words. Each claim is checked by test/e3a.test.mjs.
const HEADLINE = {
  'eine-ohne': ['Nur der Chat ist weg', 'Gedächtnis, Zusammenfassung und Suchindex behalten die Diagnose und geben sie in den Prompt. Ein verspäteter Extraktionsjob schreibt sie neu.'],
  'typ-ohne': ['Auch nur der Chat', 'Eigene Regeln je Datenart ändern daran nichts. Sie halten nur den neu gebauten Index aus dem Prompt, abrufbar bleibt er.'],
  'eine-mit': ['Weg, aber zu viel', 'Die Diagnose ist aus allem Abgeleiteten verschwunden, auch Job und Neubau scheitern. Mit ihr verschwinden der ausdrücklich gespeicherte Wunsch und der Krimi-Teil der Zusammenfassung.'],
  'typ-mit': ['Weg, bis auf den ausdrücklichen Wunsch', 'Aus Gedächtnis, Index und Job ist die Diagnose verschwunden. Die Zusammenfassung wird durch einen vorgegebenen Text aus Chat 2 ersetzt. Der gespeicherte Wunsch enthält hier die Diagnose und bleibt nach der Produktregel stehen, mit sichtbarer Herkunft und einzeln widerrufbar.'],
};

function copies(d) {
  const msg = $('message');
  msg.append(el('span', 'who', 'Die Person schreibt'));
  msg.append(marked(d.message));
  $('fan').textContent = 'Daraus entstehen Kopien:';
  // Source of each copy: observed in E2 runs, or constructed for E3a.
  const items = [
    ['Chat', d.message, 'der Verlauf selbst', true, 'beobachtet: Nachricht aus E2'],
    ['Gedächtnis', d.memory, `vom Modell abgeleitet, ${ofRuns(d.memory_runs, d.runs)} mit Diagnose`, false, 'beobachtet: E2, A mit Mem0-Prompt'],
    ['Protokoll', `Suche nach „${d.query}“`, `der Assistent hat so gesucht, ${ofRuns(d.query_runs, d.runs)}; nur anhängen`, false, 'beobachtet: E2, B'],
    ['Suchindex', `„${d.query}“`, 'aus dem Protokoll gebaut', false, 'konstruiert für E3a'],
  ];
  $('copy-list').replaceChildren(...items.map(([name, what, how, reached, source]) => {
    const li = el('li', `copy${reached ? ' reached' : ''}`);
    li.append(el('span', `source${source.startsWith('konstruiert') ? ' made' : ''}`, source), el('h3', null, name));
    const p = el('p', 'what');
    p.append(marked(what.length > 90 ? `${what.slice(0, 88)}…` : what));
    li.append(p, el('p', 'how', how), el('p', 'state', reached ? '„Chat löschen“: weg' : '„Chat löschen“: bleibt'));
    return li;
  }));
  $('takeaway').textContent = '„Chat löschen“ trifft nur den ersten Kasten. Die anderen drei erreicht es nur, wenn jede Kopie weiß, aus welchem Chat sie stammt.';
}

function grid(d) {
  $('grid-intro').textContent = 'Zwei Stellschrauben: Gelten für alle abgeleiteten Daten dieselben Regeln oder je Datenart eigene? Und weiß jede Kopie, aus welchem Chat sie stammt, sodass das Löschen sie mitnimmt? Geprüft an den echten Kopien von oben und an vier ausgedachten Fällen: eine Zusammenfassung aus diesem Chat und einem zweiten über Krimis, ein Extraktionsjob, der erst nach dem Löschen läuft, ein Neubau des Suchindex aus dem Protokoll und ein Wunsch, den die Person ausdrücklich speichern ließ. Die Tabelle wendet Regeln an, sie misst nichts.';
  const g = $('grid');
  const cell = (cls, text, role) => { const c = el('div', cls, text); c.setAttribute('role', role); return c; };
  g.append(cell('corner', '', 'columnheader'), cell('col', 'Eine Regel für alles', 'columnheader'), cell('col', 'Eine Regel je Datenart', 'columnheader'));
  for (const [row, ids] of [['Ohne Herkunft', ['eine-ohne', 'typ-ohne']], ['Mit Herkunft und Kaskade', ['eine-mit', 'typ-mit']]]) {
    g.append(cell('row', row, 'rowheader'));
    for (const id of ids) {
      const tone = id.endsWith('ohne') ? 'bad' : id === 'eine-mit' ? 'mixed' : 'good';
      const c = cell(`cell ${tone}`, null, 'cell');
      const v = d.variants.find((x) => x.id === id);
      c.append(el('span', 'tag-col', v.label), el('strong', null, HEADLINE[id][0]), document.createTextNode(HEADLINE[id][1]));
      g.append(c);
    }
  }
  const after = el('p', 'note', 'In allen vier Varianten bleibt die Suchanfrage im Protokoll, solange es im Klartext geführt wird. Beobachtet sind nur Chat, Gedächtnis und Protokoll aus E2. Zusammenfassung, Extraktionsjob, Index-Neubau und Wunsch sind konstruiert. Die Verschlüsselung pro Chat ist simuliert: Der Versuch markiert den Schlüssel als vernichtet, echte Kryptografie ist nicht geprüft.');
  g.after(after);
  const table = $('cases');
  const head = el('tr');
  head.append(el('th', null, 'Fall'), ...d.variants.map((v) => el('th', null, v.label)));
  head.querySelectorAll('th').forEach((th) => { th.scope = 'col'; });
  const thead = el('thead');
  thead.append(head);
  const body = el('tbody');
  for (const c of d.cases) {
    const tr = el('tr');
    const th = el('th', null, c.label);
    th.scope = 'row';
    tr.append(th, ...d.variants.map((v) => {
      const x = d.cells.find((y) => y.case === c.id && y.variant === v.id);
      return el('td', x.tone, x.text);
    }));
    body.append(tr);
  }
  table.append(thead, body);
}

function bars(box, title, text, rows, note) {
  box.append(el('h3', null, title), el('p', null, text));
  const ul = el('ul', 'bars');
  for (const [label, r, leak] of rows) {
    const li = el('li', `bar${leak ? ' leak' : ''}`);
    const track = el('span', 'track');
    const fill = el('span', 'fill');
    fill.style.width = `${(100 * r.k) / r.n}%`;
    track.append(fill);
    li.append(el('span', 'label', label), track, el('span', 'num', `${r.k} von ${r.n}`));
    ul.append(li);
  }
  box.append(ul);
  if (note) box.append(el('p', 'note', note));
}

function legend(box) {
  box.querySelector('.bars').before(el('p', 'note', 'Orange: ohne Wunsch gespeichert. Blaugrün: auf ausdrücklichen Wunsch gespeichert.'));
}

function rates(d) {
  const { e3b: b, e3c: c, n } = d;
  bars($('rate-memory'), 'Ins Gedächtnis', `${n} erfundene Nachrichten erwähnen Gesundheit, Angehörige, Religion oder Geld, die Hälfte nur nebenbei, die andere Hälfte mit „Merk dir bitte“. Der Original-Prompt von Mem0 speichert jede nebenbei erwähnte Angabe. Der eigene Prompt verbietet das und hält es bei Gesundheit und Angehörigen ein, bei Religion und Geld nicht immer.`, [
    ['Mem0, nur nebenbei erwähnt', b.mem0.nebenbei, true],
    ['Eigener Prompt, nur nebenbei erwähnt', b.v1.nebenbei, true],
    ['Mem0, „Merk dir bitte“', b.mem0.ausdruecklich, false],
    ['Eigener Prompt, „Merk dir bitte“', b.v1.ausdruecklich, false],
  ]);
  legend($('rate-memory'));
  bars($('rate-log'), 'Ins Protokoll', `Dieselben Nachrichten an den Assistenten von B, jeweils sein erster Schritt. So oft steht die Angabe in einer Suchanfrage oder einem Speicherschlüssel, also im Klartext im Protokoll, das sich nicht löschen lässt.`, [
    ['nur nebenbei erwähnt, automatisch gezählt', c.plain.nebenbei, true],
    ['nur nebenbei erwähnt, von Hand gezählt', d.e3c_hand.nebenbei, true],
    ['„Merk dir bitte“, automatisch gezählt', c.plain.ausdruecklich, true],
    ['„Merk dir bitte“, von Hand gezählt', d.e3c_hand.ausdruecklich, true],
  ], `Zusammen ${c.plain.total.k} von ${c.plain.total.n} automatisch, ${d.e3c_hand.total.k} von ${d.e3c_hand.total.n} von Hand. Das Suchmuster übersah zwei Suchanfragen („Gefangene“, „Suchterkrankung“) und zählte den Schlüssel „monatliches_einkommen“ als Leck, obwohl er den Betrag nicht nennt. Nach „Merk dir bitte“ speichert B die Angabe außerdem ${c.sealed.ausdruecklich.k}-mal als Wunsch, davon führt das Protokoll nur Prüfsumme und Länge.`);
}

async function start() {
  const d = await fetch('data/page.json').then((r) => r.json());
  copies(d);
  grid(d);
  rates(d);
  $('limits').textContent = 'Erfundene Bücherei, erfundene Nachrichten, ein Sprachmodell (gpt-6-luna), jede Nachricht einmal. Gemessen sind nur die beiden Raten.';
}

start();
