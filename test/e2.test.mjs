import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOG, DOCS } from '../fixtures/library.mjs';
import { E2_SCENARIOS } from '../fixtures/scenarios-e2.mjs';
import { loadPrompts } from '../src/agent.mjs';
import { CANARY_E2, misattributedE2 } from '../src/checks-e2.mjs';
import { checkE2 } from '../src/checks-e2.mjs';
import { extractionPrompt, pyRepr, toOperations, updatePrompt } from '../src/mem0.mjs';
import { runScenario } from '../src/scenario.mjs';
import { act, hash, mockEngine } from './helpers.mjs';

const prompts = loadPrompts('e2');
const scenario = (id) => E2_SCENARIOS.find((s) => s.id === id);

test('E2 keeps agent, memory blocks and extractor of v1 byte for byte', () => {
  for (const f of ['agent.md', 'memory-a.md', 'memory-b.md', 'extractor.md']) {
    assert.ok(readFileSync(new URL(`../prompts/e2/${f}`, import.meta.url)).equals(readFileSync(new URL(`../prompts/v1/${f}`, import.meta.url))), f);
  }
});

test('pyRepr prints like Python repr()', () => {
  assert.equal(pyRepr([{ id: '0', text: 'Mag Krimis' }]), "[{'id': '0', 'text': 'Mag Krimis'}]");
  assert.equal(pyRepr(["Sagt 'hallo'"]), `["Sagt 'hallo'"]`);
  assert.equal(pyRepr(['a\\b', 'x\ny']), "['a\\\\b', 'x\\ny']");
  assert.equal(pyRepr([]), '[]');
});

test('Mem0 prompts render without placeholders and with a fixed date', () => {
  const p = extractionPrompt(prompts, 'Hallo', 'Hi');
  assert.ok(p.endsWith('Input:\nuser: Hallo\nassistant: Hi\n'));
  assert.ok(p.includes("Today's date is 2026-11-08."));
  assert.ok(!/\{\{|\}\}/.test(p));
  const u = updatePrompt(prompts, [{ id: 'm1', text: 'Mag Krimis' }], ['Braucht Großdruck']);
  assert.ok(u.includes("[{'id': '0', 'text': 'Mag Krimis'}]") && u.includes("['Braucht Großdruck']"));
  assert.ok(updatePrompt(prompts, [], ['x']).includes('Current memory is empty.'));
});

test('Mem0 ids map back, NONE is dropped, unknown ids stay visible as skipped', () => {
  const memories = [{ id: 'm1', text: 'a' }, { id: 'm4', text: 'b' }];
  assert.deepEqual(toOperations(memories, [
    { id: '0', text: 'a', event: 'NONE', old_memory: null }, { id: '1', text: 'b2', event: 'UPDATE', old_memory: 'b' },
    { id: '2', text: 'c', event: 'ADD', old_memory: null }, { id: '7', text: 'x', event: 'DELETE', old_memory: null },
  ]), [{ op: 'UPDATE', id: 'm4', text: 'b2' }, { op: 'ADD', id: null, text: 'c' }, { op: 'DELETE', id: '?7', text: null }]);
});

test('canary of E2 appears only in the user message', () => {
  const re = new RegExp(CANARY_E2, 'i');
  assert.ok(!re.test(JSON.stringify({ DOCS, CATALOG })));
  assert.equal(E2_SCENARIOS.filter((s) => re.test(JSON.stringify(s.sessions))).map((s) => s.id).join(), 'erasure-late');
});

test('misattribution also in English', () => {
  assert.equal(misattributedE2('Is 82 years old'), true);
  assert.equal(misattributedE2("User's mother is 82 and cannot leave the house"), false);
});

// Mem0 pipeline: facts per pair, update against existing memory. The diagnosis survives the chat deletion.
test('A-mem0 extracts after every pair and keeps the canary after deletion; B does not', async () => {
  const script = ({ meta }) => {
    if (meta.role === 'mem0-facts') return { facts: meta.session === 1 ? ['Hat Makuladegeneration'] : [] };
    if (meta.role === 'mem0-update') return { memory: [{ id: '0', text: 'Hat Makuladegeneration', event: 'ADD', old_memory: null }] };
    return act('answer', { text: meta.session === 2 ? 'Ich weiß, dass du Makuladegeneration hast.' : 'Wir haben Großdruck.' });
  };
  const run = await runScenario({ scenario: scenario('erasure-late'), arch: 'A', variant: 'A-mem0', rep: 1, engine: mockEngine(script), prompts, hash, check: checkE2 });
  assert.equal(run.variant, 'A-mem0');
  assert.deepEqual(run.calls.map((c) => c.role), ['agent', 'mem0-facts', 'mem0-update', 'agent', 'mem0-facts']);
  assert.equal(run.check.pass, false);
  assert.equal(run.check.detail.found[0].store, 'memory');
  assert.equal(run.check.detail.answer_names_canary, true);
  const b = await runScenario({ scenario: scenario('erasure-late'), arch: 'B', variant: 'B', rep: 1, engine: mockEngine(() => act('answer', { text: 'Nichts.' })), prompts, hash, check: checkE2 });
  assert.equal(b.check.pass, true);
});

test('A-v1 in E2 extracts per turn on that turn only', async () => {
  const engine = mockEngine(({ meta }) => (meta.role === 'extractor' ? { operations: [] } : act('answer', { text: 'ok' })));
  const run = await runScenario({ scenario: scenario('stale'), arch: 'A', variant: 'A-v1', rep: 1, engine, prompts, hash, check: checkE2 });
  assert.deepEqual(run.calls.map((c) => `${c.role}${c.turn ?? ''}`), ['agent1', 'extractor1', 'agent1', 'extractor1']);
  assert.deepEqual(run.points.map((p) => p.kind), ['session', 'after', 'event', 'session', 'after']);
});
