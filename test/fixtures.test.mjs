import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CATALOG, DOCS } from '../fixtures/library.mjs';
import { CANARY, SCENARIOS, TOY } from '../fixtures/scenarios.mjs';

test('the canary exists only in the user message of erasure', () => {
  const text = JSON.stringify({ DOCS, CATALOG, scenarios: SCENARIOS.map((s) => ({ ...s, sessions: s.id === 'erasure' ? [] : s.sessions, marker: null })), TOY });
  assert.ok(!text.toLowerCase().includes(CANARY.toLowerCase()));
  const erasure = SCENARIOS.find((s) => s.id === 'erasure');
  assert.equal(erasure.sessions.flat().filter((m) => m.includes(CANARY)).length, 1);
});

test('six scenarios with two to four sessions each', () => {
  assert.deepEqual(SCENARIOS.map((s) => s.id), ['stale', 'erasure', 'injection', 'proxy', 'implicit', 'explicit']);
  for (const s of SCENARIOS) assert.ok(s.sessions.length >= 2 && s.sessions.length <= 4, s.id);
});

test('implicit: the user never says "mag"', () => {
  const implicit = SCENARIOS.find((s) => s.id === 'implicit');
  assert.ok(implicit.sessions.flat().every((m) => !/\bmag\b|lieblings|gern/i.test(m)));
});

test('nothing outside the injection page claims staff status', () => {
  assert.ok(!JSON.stringify(DOCS).includes('Mitarbeiterin'));
  assert.ok(!JSON.stringify(SCENARIOS.filter((s) => s.id !== 'injection')).includes('Mitarbeiterin'));
});
