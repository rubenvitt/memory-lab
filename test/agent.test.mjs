import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../fixtures/scenarios.mjs';
import { actionSchema, agentPrompt, loadPrompts, renderMemory } from '../src/agent.mjs';
import { addUser, createState } from '../src/memory.mjs';
import { runScenario } from '../src/scenario.mjs';
import { act, hash, mockEngine } from './helpers.mjs';

const prompts = loadPrompts();
const profile = SCENARIOS[0].profile;

test('fairness: A and B prompts are byte-identical outside the memory block', () => {
  const a = createState('A', profile);
  const b = createState('B', profile);
  for (const s of [a, b]) addUser(s, 1, 1, 'Hallo', hash);
  const pa = agentPrompt(a, 1, prompts);
  const pb = agentPrompt(b, 1, prompts);
  assert.notEqual(pa, pb);
  assert.equal(pa.replace(renderMemory(a, prompts), '<MEMORY>'), pb.replace(renderMemory(b, prompts), '<MEMORY>'));
});

test('fairness: the action schemas differ only by remember', () => {
  const a = actionSchema('A');
  const b = actionSchema('B');
  assert.deepEqual(b.properties.tool.enum.filter((t) => t !== 'remember'), a.properties.tool.enum);
  assert.deepEqual(Object.keys(b.properties).filter((k) => !['key', 'value', 'quote'].includes(k)), Object.keys(a.properties));
});

// Agent: get_profile, then answer with the address. Extractor: remembers the first user message.
function scripted({ prompt, meta }) {
  if (meta.role === 'extractor') return { operations: [{ op: 'ADD', id: null, text: `Merkt sich: ${meta.scenario} ${meta.session}` }] };
  if (meta.step === 1) return act('get_profile');
  if (meta.step === 2 && meta.arch === 'B') return act('remember', { key: 'k', value: 'v', quote: 'nicht im Text' });
  const address = JSON.parse(prompt.match(/get_profile \{\}\n\[Turn \d+\] Ergebnis: (\{.*\})/)[1]).address;
  return act('answer', { text: `Wir liefern an ${address}.` });
}

test('a stale run: both see the new address via get_profile, B rejects the bad quote, points line up', async () => {
  const stale = SCENARIOS.find((s) => s.id === 'stale');
  const runs = {};
  for (const arch of ['A', 'B']) {
    const engine = mockEngine(scripted);
    runs[arch] = await runScenario({ scenario: stale, arch, rep: 1, engine, prompts, hash });
    assert.equal(runs[arch].check.pass, true, arch);
    assert.equal(runs[arch].check.detail.answer, 'Wir liefern an Am Mühlengraben 12, Fennbrück.');
    assert.ok(runs[arch].calls.every((c) => /^h\d+-gpt-6-luna-r1\.json$/.test(c.raw)));
  }
  assert.deepEqual(runs.A.points.map((p) => p.kind), runs.B.points.map((p) => p.kind));
  assert.deepEqual(runs.A.points.map((p) => p.label), ['Session 1', 'Nach Session 1', stale.events[0].label, 'Session 2', 'Nach Session 2']);
  assert.equal(runs.A.points.at(-1).stores.memory.length, 2);
  assert.equal(runs.B.points.at(-1).stores.preferences.length, 0);
  assert.ok(runs.B.points[0].turns[0].steps[1].result.error.startsWith('abgelehnt'));
  assert.equal(runs.A.calls.filter((c) => c.role === 'extractor').length, 2);
});

test('a turn without answer ends after max_steps', async () => {
  const engine = mockEngine(() => act('get_profile'));
  const run = await runScenario({ scenario: SCENARIOS.find((s) => s.id === 'explicit'), arch: 'B', rep: 1, engine, prompts, hash });
  assert.equal(run.points[0].turns[0].steps.length, prompts.params.max_steps);
  assert.equal(run.points[0].turns[0].answer, null);
  assert.equal(run.check.pass, false);
});

test('two runs share no state', async () => {
  const erasure = SCENARIOS.find((s) => s.id === 'erasure');
  const memorize = ({ meta }) => (meta.role === 'extractor' ? { operations: [{ op: 'ADD', id: null, text: 'Hat Makuladegeneration.' }] } : act('answer', { text: 'ok' }));
  const first = await runScenario({ scenario: erasure, arch: 'A', rep: 1, engine: mockEngine(memorize), prompts, hash });
  assert.equal(first.check.pass, false);
  assert.equal(first.check.detail.found[0].store, 'memory');
  const clean = await runScenario({ scenario: erasure, arch: 'A', rep: 2, engine: mockEngine(({ meta }) => (meta.role === 'extractor' ? { operations: [] } : act('answer', { text: 'ok' }))), prompts, hash });
  assert.equal(clean.check.pass, true);
  assert.equal(clean.points.at(-1).stores.memory.length, 0);
});

test('erasure in B: canary in a preference goes with the cascade, the audit keeps a sealed trace', async () => {
  const erasure = SCENARIOS.find((s) => s.id === 'erasure');
  const engine = mockEngine(({ meta }) => {
    if (meta.session === 1 && meta.turn === 1 && meta.step === 1) return act('search_docs', { query: 'Großdruck Makuladegeneration' });
    if (meta.session === 1 && meta.turn === 1 && meta.step === 2) return act('remember', { key: 'format', value: 'Großdruck wegen Makuladegeneration', quote: 'wegen meiner Makuladegeneration' });
    return act('answer', { text: 'ok' });
  });
  const run = await runScenario({ scenario: erasure, arch: 'B', rep: 1, engine, prompts, hash });
  const deletion = run.points.find((p) => p.kind === 'event');
  assert.equal(run.points.find((p) => p.kind === 'after').stores.preferences.length, 1);
  assert.equal(deletion.stores.preferences.length, 0);
  assert.equal(run.check.pass, true);
  assert.equal(run.check.detail.audit_hits, 1, 'the search query, logged in plain text');
});
