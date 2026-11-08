// Store logic of both architectures. Pure and without node imports: `npm run report` copies this file into the demo,
// whose "Chat löschen" button runs deleteSession() in the browser. Hashing is passed in by the caller.
//
// A (one pot): history keeps every chat until the user deletes it, memory holds what the extractor decided, without source.
// B (separate stores): history holds the running session only, preferences carry {session, turn} and a verbatim quote,
//   audit is append-only and never part of a prompt.

export const STORES = {
  A: ['history', 'memory', 'profile'],
  B: ['history', 'preferences', 'profile', 'retrieval', 'audit'],
};
// Stores whose content reaches a later prompt. The injection and proxy checks look only here.
export const PERSISTENT = { A: ['memory', 'profile'], B: ['preferences', 'profile'] };
export const AUDIT = 'audit';

export function createState(arch, profile, docsVersion = 'v1') {
  if (!STORES[arch]) throw new Error(`unknown architecture ${arch}`);
  return {
    arch,
    profile: { ...profile },
    profile_log: [{ by: 'Bibliothekssystem', label: 'Stammdaten bei Anmeldung' }],
    history: {},
    memory: [],
    preferences: [],
    retrieval: { version: docsVersion, read: [] },
    audit: [],
    next_id: 1,
  };
}

const quoteChars = (t) => t.replace(/[„“”"]/g, '"').replace(/[‚‘’]/g, "'");
// Quote rule: verbatim after unifying typographic quotes and collapsing whitespace. Case and punctuation count.
export const normalize = (t) => quoteChars(String(t ?? '')).replace(/\s+/g, ' ').trim();

const audit = (state, entry) => {
  if (state.arch === 'B') state.audit.push({ seq: state.audit.length + 1, ...entry });
};
const sealed = (text, hash) => ({ sha256: hash(text), length: text.length });

function push(state, session, message) {
  (state.history[session] ??= []).push(message);
}

export function addUser(state, session, turn, text, hash) {
  push(state, session, { turn, role: 'user', text });
  audit(state, { type: 'user-message', session, turn, ...sealed(text, hash) });
}

// Tool calls are logged with their arguments in plain text (that is what an audit log is for),
// except fields that are user text by construction (`quote`) or the answer itself.
export function addAction(state, session, turn, action, result, hash) {
  const { tool, ...args } = action;
  push(state, session, { turn, role: 'action', tool, args, result });
  if (tool === 'answer') {
    audit(state, { type: 'answer', session, turn, ...sealed(args.text ?? '', hash) });
    return;
  }
  const logged = { ...args };
  if (logged.quote != null) logged.quote = sealed(logged.quote, hash);
  if (logged.value != null) logged.value = sealed(logged.value, hash);
  audit(state, { type: 'tool-call', session, turn, tool, args: logged, ok: !result?.error, ...(tool === 'waive_fee' ? { side_effect: true } : {}) });
}

export function noteRead(state, session, turn, docs) {
  for (const d of docs) state.retrieval.read.push({ session, turn, id: d.id, title: d.title, text: d.text });
}

// B only. The application, not the prompt, enforces the source rule.
export function remember(state, session, turn, { key, value, quote }) {
  if (state.arch !== 'B') return { error: 'remember gibt es nur in Architektur B' };
  if (!key || !value || !quote) return { error: 'key, value und quote sind Pflicht' };
  const q = normalize(quote);
  const source = (state.history[session] ?? []).find((m) => m.role === 'user' && normalize(m.text).includes(q));
  if (!q || !source) {
    audit(state, { type: 'store-write', store: 'preferences', key, session, turn, accepted: false });
    return { error: 'abgelehnt: quote steht nicht wörtlich in einer Nachricht der Person aus dieser Session' };
  }
  const entry = { key, value, quote, source: { session, turn: source.turn } };
  const at = state.preferences.findIndex((p) => p.key === key);
  if (at >= 0) state.preferences[at] = entry; else state.preferences.push(entry);
  audit(state, { type: 'store-write', store: 'preferences', key, session, turn, accepted: true });
  return { ok: true, stored: { key, value, source: entry.source } };
}

// A only: the Mem0 update step. Ids that do not exist are reported and skipped.
export function applyExtraction(state, session, operations) {
  const applied = [];
  for (const { op, id, text } of operations) {
    const at = state.memory.findIndex((m) => m.id === id);
    if (op === 'ADD' && text) {
      const entry = { id: `m${state.next_id++}`, text, written: { session, op } };
      state.memory.push(entry);
      applied.push({ op, id: entry.id, text });
    } else if (op === 'UPDATE' && at >= 0 && text) {
      applied.push({ op, id, text, before: state.memory[at].text });
      state.memory[at] = { id, text, written: { session, op } };
    } else if (op === 'DELETE' && at >= 0) {
      applied.push({ op, id, before: state.memory[at].text });
      state.memory.splice(at, 1);
    } else if (op === 'NOOP') {
      applied.push({ op });
    } else {
      applied.push({ op, id, text, skipped: true });
    }
  }
  return applied;
}

// B forgets the running session at its end, A keeps it as a chat in the list.
export function endSession(state, session) {
  if (state.arch !== 'B') return;
  delete state.history[session];
  state.retrieval.read = state.retrieval.read.filter((r) => r.session !== session);
  audit(state, { type: 'session-end', session });
}

// "Chat löschen". A: the chat goes, memory entries stay (as documented for ChatGPT and Claude).
// B: cascade over everything that names this session as source. The audit gets an entry and keeps its old ones.
export function deleteSession(state, session) {
  delete state.history[session];
  state.retrieval.read = state.retrieval.read.filter((r) => r.session !== session);
  if (state.arch === 'B') {
    const before = state.preferences.length;
    state.preferences = state.preferences.filter((p) => p.source.session !== session);
    audit(state, { type: 'delete-session', session, removed: { preferences: before - state.preferences.length } });
  }
}

export function patchProfile(state, patch, label) {
  Object.assign(state.profile, patch);
  state.profile_log.push({ by: 'Bibliothekssystem', label });
}

export const snapshot = (state) => JSON.parse(JSON.stringify(state));

// Every store as a list of entries with the step that wrote it. Used by the checks and by the demo.
export function storeEntries(s) {
  const historyEntries = Object.entries(s.history).flatMap(([session, messages]) => messages.map((m) => ({
    session: Number(session), turn: m.turn,
    text: m.role === 'user' ? m.text : `${m.tool}(${JSON.stringify(m.args)}) → ${JSON.stringify(m.result)}`,
    by: m.role === 'user' ? `Person, Session ${session}` : `Engine, Session ${session}`,
  })));
  const all = {
    history: historyEntries,
    memory: s.memory.map((m) => ({ text: m.text, by: `Extraktor nach Session ${m.written.session} (${m.written.op})`, id: m.id })),
    preferences: s.preferences.map((p) => ({ text: `${p.key}: ${p.value} („${p.quote}“)`, by: `remember, Session ${p.source.session}, Turn ${p.source.turn}` })),
    profile: [{ text: `${s.profile.name}, ${s.profile.address}, Ausweis ${s.profile.card}, Bringdienst: ${s.profile.delivery_service ? 'ja' : 'nein'}, offene Gebühren: ${s.profile.open_fees}`, by: s.profile_log.at(-1).label }],
    retrieval: s.retrieval.read.map((r) => ({ text: `${r.title}: ${r.text}`, by: `Redaktion ${s.retrieval.version}, gelesen in Session ${r.session}` })),
    audit: s.audit.map((a) => ({ text: JSON.stringify(a), by: 'Engine, append-only' })),
  };
  return Object.fromEntries(STORES[s.arch].map((name) => [name, all[name]]));
}

// Entries of the given stores whose text matches. `pattern` is a RegExp source, matched case-insensitively.
export function hits(s, pattern, stores = STORES[s.arch]) {
  const re = new RegExp(pattern, 'i');
  const entries = storeEntries(s);
  return stores.flatMap((store) => (entries[store] ?? []).filter((e) => re.test(e.text)).map((e) => ({ store, ...e })));
}
