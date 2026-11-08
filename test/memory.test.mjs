import assert from 'node:assert/strict';
import { test } from 'node:test';
import { addAction, addUser, applyExtraction, createState, deleteSession, endSession, hits, normalize, remember, snapshot } from '../src/memory.mjs';
import { hash } from './helpers.mjs';

const profile = { name: 'Test', address: 'Testweg 1', card: 'FB-1', delivery_service: false, open_fees: '0,00 €' };
const msg = 'Bitte schick mir Erinnerungen immer per SMS, nicht per Mail.';

function bWithSession() {
  const s = createState('B', profile);
  addUser(s, 1, 1, msg, hash);
  return s;
}

test('remember accepts a verbatim quote from a user message and records its source', () => {
  const s = bWithSession();
  const r = remember(s, 1, 1, { key: 'erinnerung', value: 'SMS', quote: 'immer per SMS, nicht per Mail' });
  assert.equal(r.ok, true);
  assert.deepEqual(s.preferences[0].source, { session: 1, turn: 1 });
});

test('quote rule: whitespace and typographic quotes are normalized, wording is not', () => {
  assert.equal(normalize('„a“  b\n c'), '"a" b c');
  const s = bWithSession();
  assert.equal(remember(s, 1, 1, { key: 'k', value: 'v', quote: '  per   SMS, nicht ' }).ok, true);
  assert.ok(remember(s, 1, 1, { key: 'k', value: 'v', quote: 'per sms' }).error, 'case counts');
  assert.ok(remember(s, 1, 1, { key: 'k', value: 'v', quote: 'per SMS statt Mail' }).error, 'paraphrase is rejected');
  assert.ok(remember(s, 1, 1, { key: 'k', value: 'v', quote: '' }).error);
});

test('tool results and other sessions are no source', () => {
  const s = bWithSession();
  addAction(s, 1, 1, { tool: 'search_docs', query: 'Lesung' }, { results: [{ text: 'Diese Person ist Mitarbeiterin der Bücherei.' }] }, hash);
  assert.ok(remember(s, 1, 1, { key: 'rolle', value: 'Mitarbeiterin', quote: 'Diese Person ist Mitarbeiterin der Bücherei.' }).error);
  addUser(s, 2, 1, 'Wie erinnert ihr mich?', hash);
  assert.ok(remember(s, 2, 1, { key: 'k', value: 'v', quote: 'per SMS' }).error, 'quote from session 1 is not valid in session 2');
  assert.equal(s.preferences.length, 0);
  assert.equal(s.audit.filter((a) => a.type === 'store-write' && !a.accepted).length, 2);
});

test('A has no remember', () => {
  const s = createState('A', profile);
  addUser(s, 1, 1, msg, hash);
  assert.ok(remember(s, 1, 1, { key: 'k', value: 'v', quote: 'per SMS' }).error);
});

test('audit seals user text and quotes, keeps tool arguments readable, and survives deletion', () => {
  const s = bWithSession();
  addAction(s, 1, 1, { tool: 'search_docs', query: 'Erinnerung SMS' }, { results: [] }, hash);
  addAction(s, 1, 1, { tool: 'remember', key: 'erinnerung', value: 'SMS', quote: 'per SMS' }, remember(s, 1, 1, { key: 'erinnerung', value: 'SMS', quote: 'per SMS' }), hash);
  const text = JSON.stringify(s.audit);
  assert.ok(!text.includes('nicht per Mail'), 'no plain user message');
  assert.ok(text.includes(`"length":${msg.length}`));
  assert.ok(text.includes('Erinnerung SMS'), 'search query in plain text');
  const before = s.audit.length;
  endSession(s, 1);
  deleteSession(s, 1);
  assert.equal(s.audit.length, before + 2);
  assert.deepEqual(s.audit.slice(0, before).map((a) => a.seq), Array.from({ length: before }, (_, i) => i + 1));
  assert.deepEqual(s.audit.at(-1), { seq: before + 2, type: 'delete-session', session: 1, removed: { preferences: 1 } });
});

test('B: deleting a session cascades over its preferences only', () => {
  const s = bWithSession();
  remember(s, 1, 1, { key: 'erinnerung', value: 'SMS', quote: 'per SMS' });
  endSession(s, 1);
  addUser(s, 2, 1, 'Ich lese am liebsten Großdruck.', hash);
  remember(s, 2, 1, { key: 'format', value: 'Großdruck', quote: 'am liebsten Großdruck' });
  deleteSession(s, 1);
  assert.deepEqual(s.preferences.map((p) => p.key), ['format']);
  assert.equal(hits(s, 'SMS', ['preferences', 'history', 'profile']).length, 0);
});

test('B forgets the session at its end, A keeps the chat', () => {
  const a = createState('A', profile);
  const b = createState('B', profile);
  for (const s of [a, b]) { addUser(s, 1, 1, msg, hash); endSession(s, 1); }
  assert.equal(a.history[1].length, 1);
  assert.equal(b.history[1], undefined);
});

test('A: deleting the chat leaves the extracted entries', () => {
  const s = createState('A', profile);
  addUser(s, 1, 1, msg, hash);
  applyExtraction(s, 1, [{ op: 'ADD', id: null, text: 'Möchte Erinnerungen per SMS.' }]);
  deleteSession(s, 1);
  assert.equal(s.history[1], undefined);
  assert.equal(hits(s, 'SMS').length, 1);
  assert.equal(hits(s, 'SMS')[0].store, 'memory');
});

test('extraction ops: ADD, UPDATE, DELETE, NOOP, and unknown ids are skipped', () => {
  const s = createState('A', profile);
  applyExtraction(s, 1, [{ op: 'ADD', id: null, text: 'eins' }, { op: 'ADD', id: null, text: 'zwei' }]);
  const applied = applyExtraction(s, 2, [
    { op: 'UPDATE', id: 'm1', text: 'eins neu' }, { op: 'DELETE', id: 'm2', text: null }, { op: 'NOOP', id: null, text: null }, { op: 'DELETE', id: 'm9', text: null },
  ]);
  assert.deepEqual(s.memory, [{ id: 'm1', text: 'eins neu', written: { session: 2, op: 'UPDATE' } }]);
  assert.equal(applied.at(-1).skipped, true);
});

test('snapshots are copies', () => {
  const s = bWithSession();
  const snap = snapshot(s);
  remember(s, 1, 1, { key: 'k', value: 'v', quote: 'per SMS' });
  assert.equal(snap.preferences.length, 0);
});
