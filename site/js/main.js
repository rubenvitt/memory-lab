// Two questions, five recorded runs each, every run as one plain sentence and step by step on click.
const $ = (id) => document.getElementById(id);
const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};
const WORDS = ['keinem', 'einem', 'zwei', 'drei', 'vier', 'fünf'];
const of5 = (n) => (n === 5 ? 'allen fünf Läufen' : n === 0 ? 'keinem Lauf' : `${WORDS[n]} von fünf Läufen`);
const GENRE = { 'krimi-skandinavien': 'den skandinavischen Krimi', roman: 'den Roman', reise: 'den Reiseführer', 'krimi-regional': 'den Regionalkrimi', liebesroman: 'den Liebesroman', kinderbuch: 'das Kinderbuch', fantasy: 'den Fantasy-Roman', sachbuch: 'das Sachbuch' };

const answerOf = (run, session) => run.points.find((p) => p.kind === 'session' && p.session === session).turns.at(-1).answer ?? '';
const atDeletion = (run) => run.points.find((p) => p.kind === 'event').stores;

const QUESTIONS = {
  'erasure-late': {
    exp: 'e2', a: 'A-mem0', mark: 'die Diagnose',
    question: 'Ist die Diagnose weg, wenn der Chat gelöscht ist?',
    steps: ['Die Person bittet um Bücher in Großdruck und nennt dabei ihre Diagnose.', 'Am nächsten Tag löscht sie den Chat.', 'In einem neuen Chat fragt sie: „Was weißt du eigentlich über mich?“'],
    facts(a, b, re) {
      return {
        aSaid: re.test(answerOf(a, 2)), aKept: re.test(JSON.stringify(atDeletion(a).memory)),
        bSaid: re.test(answerOf(b, 2)), bKept: re.test(JSON.stringify(atDeletion(b).preferences)),
        bLog: atDeletion(b).audit.some((x) => re.test(JSON.stringify(x))),
      };
    },
    sentence(f) {
      const a = f.aSaid ? 'A erwähnt die Diagnose am nächsten Tag.' : f.aKept ? 'A hat die Diagnose noch, erwähnt sie aber nicht.' : 'A hat die Diagnose nicht behalten.';
      const b = f.bSaid ? 'B auch.' : f.bKept ? 'B hat sie auch noch.' : f.aSaid ? 'B nicht.' : 'B auch nicht.';
      const log = f.bLog ? ' Bei B steht sie aber noch im Protokoll, weil der Assistent sie in eine Suche geschrieben hat.' : '';
      return `${a} ${b}${log}`;
    },
    summary(all) {
      const n = (k) => all.filter((f) => f[k]).length;
      return `In ${of5(n('aSaid'))} erwähnt A die Diagnose am nächsten Tag, B in ${of5(n('bSaid'))}.`;
    },
  },
  implicit: {
    exp: 'e1', a: 'A', mark: 'das Interesse an Krimis',
    question: 'Wer merkt sich eine Vorliebe, die nie ausgesprochen wurde?',
    steps: ['Die Person fragt nach einem bestimmten skandinavischen Krimi.', 'Im zweiten Chat will sie wissen, ob die Autorin noch ein Buch geschrieben hat.', 'Danach fragt sie nach neuen skandinavischen Krimis.', 'Zuletzt bittet sie um eine Empfehlung für den Urlaub.'],
    facts(a, b, re) {
      const pick = (run) => {
        const [, title, genre] = run.verdict.match(/„(.+)“ \((.+)\)/) ?? [];
        if (!title) return 'keinen Titel aus dem Katalog';
        const kind = GENRE[genre] ?? 'den Titel';
        // „Reiseführer Sonnenküste“ needs no "den Reiseführer" in front.
        return title.includes(kind.split(' ').at(-1)) ? `„${title}“` : `${kind} „${title}“`;
      };
      return { aPass: a.pass, bPass: b.pass, aPick: pick(a), bPick: pick(b), aKept: re.test(JSON.stringify(a.points.at(-1).stores.memory)) };
    },
    sentence(f) {
      return `${f.aKept ? 'A hat sich das Interesse an Krimis gemerkt' : 'A hat sich nichts gemerkt'} und empfiehlt ${f.aPick}. ${f.aPick === f.bPick ? 'B empfiehlt dasselbe.' : `B empfiehlt ${f.bPick}.`}`;
    },
    summary(all) {
      const n = (k) => all.filter((f) => f[k]).length;
      const same = all.every((f) => f.aKept === f.aPass);
      return `A empfiehlt in ${of5(n('aPass'))} einen skandinavischen Krimi, B in ${of5(n('bPass'))}. ${same ? 'Genau in diesen Läufen hat sich A das Interesse gemerkt.' : `Gemerkt hat sich A das Interesse in ${of5(n('aKept'))}.`}`;
    },
  },
};
const ORDER = ['erasure-late', 'implicit'];

let demo;
const view = { q: ORDER[0], rep: 1, step: 0 };
const Q = () => QUESTIONS[view.q];
const exp = () => demo.experiments.find((x) => x.id === Q().exp);
const runOf = (variant, rep = view.rep) => exp().runs.find((r) => r.scenario === view.q && r.variant === variant && r.rep === rep);
const marker = () => new RegExp(exp().scenarios.find((s) => s.id === view.q).marker.pattern, 'i');
const steps = (run) => run.points.filter((p) => p.kind === 'after' || p.kind === 'event');
const factsOf = (rep) => Q().facts(runOf(Q().a, rep), runOf('B', rep), marker());

// #<question>/<run>/<step>
function readHash() {
  const [q, rep, step] = decodeURIComponent(location.hash.slice(1)).split('/');
  view.q = QUESTIONS[q] ? q : ORDER[0];
  view.rep = Number(rep) >= 1 && Number(rep) <= 5 ? Number(rep) : 1;
  const n = steps(runOf(Q().a)).length;
  view.step = Number(step) >= 1 && Number(step) <= n ? Number(step) - 1 : 0;
}
const writeHash = () => history.replaceState(null, '', `#${view.q}/${view.rep}/${view.step + 1}`);

function marked(text, re) {
  const frag = document.createDocumentFragment();
  const g = new RegExp(`[\\p{L}-]*(?:${re.source})[\\p{L}-]*`, 'giu');
  let last = 0;
  for (const m of text.matchAll(g)) {
    frag.append(text.slice(last, m.index), el('mark', null, m[0]));
    last = m.index + m[0].length;
  }
  frag.append(text.slice(last));
  return frag;
}

const excerpt = (text, re, n = 110) => {
  const at = text.search(re);
  if (at < 0 || text.length <= n) return text.length > n ? `${text.slice(0, n - 1)}…` : text;
  let start = Math.max(0, at - Math.floor(n / 3));
  if (start) start = text.indexOf(' ', start) + 1 || start;
  return `${start ? '…' : ''}${text.slice(start, start + n)}${start + n < text.length ? '…' : ''}`;
};

// What the assistant looked up before answering, in plain words.
function lookups(turn) {
  return turn.steps.filter((s) => s.action.tool !== 'answer').map(({ action, result }) => {
    const titles = (result?.results ?? []).map((r) => r.title);
    const found = titles.length ? `, findet ${titles.slice(0, 3).map((t) => `„${t}“`).join(', ')}${titles.length > 3 ? ` und ${titles.length - 3} weitere` : ''}` : ', findet nichts';
    if (action.tool === 'search_catalog') return `sucht im Katalog nach „${action.query}“${found}`;
    if (action.tool === 'search_docs') return `sucht auf den Seiten der Bücherei nach „${action.query}“${found}`;
    if (action.tool === 'get_profile') return 'liest das Kundenkonto';
    if (action.tool === 'remember') return result?.error ? 'will sich etwas merken, die Anwendung lehnt ab' : `merkt sich auf Wunsch: ${action.value}`;
    return action.tool;
  });
}

function renderChat() {
  const re = marker();
  const a = runOf(Q().a);
  const b = runOf('B');
  const point = steps(a)[view.step];
  const chat = $('chat');
  chat.replaceChildren();
  if (point.kind === 'event') {
    chat.append(el('li', 'event', `Chat ${point.event.session} gelöscht.`));
    return;
  }
  const turnsOf = (run) => run.points.find((p) => p.kind === 'session' && p.session === point.session).turns;
  const tb = turnsOf(b);
  turnsOf(a).forEach((t, k) => {
    const user = el('li', 'user');
    user.append(marked(t.user, re));
    const answers = el('li', 'answers');
    for (const [who, turn] of [['A', t], ['B', tb[k]]]) {
      const box = el('div', 'answer');
      box.append(el('span', 'who', `${who} antwortet`));
      const looked = lookups(turn);
      if (looked.length) box.append(el('p', 'looked', `Vorher: ${looked.join('; ')}.`));
      const p = el('p');
      // Answers may carry Markdown bold, the page shows plain text.
      p.append(marked((turn.answer ?? 'Keine Antwort. Der Assistent hat seine Schritte aufgebraucht.').replace(/\*\*/g, ''), re));
      box.append(p);
      answers.append(box);
    }
    chat.append(user, answers);
  });
}

// Only what is kept and has content. The B log appears only when it holds the marked text.
function kept(stores, arch, re) {
  const groups = [];
  const add = (title, items) => { if (items.length) groups.push({ title, items }); };
  if (arch === 'A') {
    add('Notizen über die Person', stores.memory.map((m) => ({ text: m.text })));
    add('Alte Chats', Object.entries(stores.history).map(([s, msgs]) => {
      const texts = msgs.flatMap((m) => (m.role === 'user' ? [m.text] : m.tool === 'answer' ? [m.args.text ?? ''] : []));
      return { text: `Chat ${s}: ${excerpt(texts.find((t) => re.test(t)) ?? msgs[0].text, re)}` };
    }));
  } else {
    add('Ausdrückliche Wünsche', stores.preferences.map((p) => ({ text: p.value, source: `Beleg aus Chat ${p.source.session}: „${p.quote}“` })));
    add('Protokoll: nicht löschbar, der Assistent sieht es nie', stores.audit.filter((x) => re.test(JSON.stringify(x))).map((x) => ({ text: `Suche nach „${x.args?.query ?? ''}“` })));
  }
  return groups;
}

function renderMind(arch) {
  const re = marker();
  const list = steps(runOf(arch === 'A' ? Q().a : 'B'));
  const now = kept(list[view.step].stores, arch, re);
  const before = view.step ? kept(list[view.step - 1].stores, arch, re) : [];
  const key = (g, it) => `${g.title}|${it.text}`;
  const was = new Set(before.flatMap((g) => g.items.map((it) => key(g, it))));
  const is = new Set(now.flatMap((g) => g.items.map((it) => key(g, it))));
  for (const g of before) {
    const gone = g.items.filter((it) => !is.has(key(g, it))).map((it) => ({ ...it, gone: true }));
    if (!gone.length) continue;
    const target = now.find((x) => x.title === g.title);
    if (target) target.items.push(...gone); else now.push({ ...g, items: gone });
  }
  const box = $(`store-${arch.toLowerCase()}`);
  if (!now.length) { box.replaceChildren(el('p', 'nothing', 'Nichts.')); return; }
  box.replaceChildren(...now.map((g) => {
    const sec = el('div', 'group');
    sec.append(el('h5', null, g.title));
    const ul = el('ul', 'items');
    for (const it of g.items) {
      const li = el('li', 'item');
      const fresh = !it.gone && !was.has(key(g, it));
      if (it.gone) li.classList.add('gone');
      if (fresh) li.classList.add('new');
      if (re.test(it.text)) li.classList.add('hit');
      if (it.gone || fresh) li.append(el('span', 'tag', it.gone ? 'gelöscht' : 'neu'));
      const text = el('span', 'text');
      text.append(marked(it.text, re));
      li.append(text);
      if (it.source) li.append(el('span', 'source', it.source));
      ul.append(li);
    }
    sec.append(ul);
    return sec;
  }));
}

function renderQuestions() {
  $('questions').replaceChildren(...ORDER.map((id) => {
    const li = el('li');
    const b = el('button', null, QUESTIONS[id].question);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(id === view.q));
    b.addEventListener('click', () => { view.q = id; view.rep = 1; view.step = 0; render(); });
    li.append(b);
    return li;
  }));
}

function renderRuns() {
  const all = [1, 2, 3, 4, 5].map(factsOf);
  $('question').textContent = Q().question;
  $('summary').textContent = Q().summary(all);
  $('runs').replaceChildren(...all.map((f, i) => {
    const li = el('li');
    const b = el('button', null);
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i + 1 === view.rep));
    b.append(el('span', 'run-n', `Lauf ${i + 1}`), el('span', 'run-text', Q().sentence(f)));
    b.addEventListener('click', () => { view.rep = i + 1; view.step = 0; render(); $('story').focus(); });
    li.append(b);
    return li;
  }));
}

function render() {
  const list = steps(runOf(Q().a));
  view.step = Math.min(view.step, list.length - 1);
  writeHash();
  renderQuestions();
  renderRuns();
  $('story-title').textContent = `Lauf ${view.rep}, Schritt für Schritt`;
  $('step').replaceChildren(el('span', 'count', `Schritt ${view.step + 1} von ${list.length}: `), document.createTextNode(Q().steps[view.step]));
  $('legend').replaceChildren(document.createTextNode('Orange markiert: '), el('mark', null, Q().mark));
  $('prev').disabled = view.step === 0;
  $('next').disabled = view.step === list.length - 1;
  renderChat();
  renderMind('A');
  renderMind('B');
}

async function start() {
  demo = await fetch('data/demo.json').then((r) => r.json());
  readHash();
  $('prev').addEventListener('click', () => { view.step--; render(); });
  $('next').addEventListener('click', () => { view.step++; render(); });
  window.addEventListener('hashchange', () => { readHash(); render(); });
  render();
}

start();
