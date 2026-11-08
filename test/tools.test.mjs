import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SCENARIOS } from '../fixtures/scenarios.mjs';
import { createState } from '../src/memory.mjs';
import { createTools, terms } from '../src/tools.mjs';

const scenario = (id) => SCENARIOS.find((s) => s.id === id);
const tools = (id) => { const state = createState('A', scenario(id).profile); return { state, tools: createTools(scenario(id), state) }; };

test('stemming lets plural and adjective forms meet the tags', () => {
  assert.deepEqual(terms('Skandinavische Krimis'), ['skandin', 'krimi']);
  assert.deepEqual(terms('Hörbuch Hörbücher'), ['horbu', 'horbuc']);
  const { tools: t } = tools('implicit');
  const found = t.search_catalog({ query: 'skandinavische Krimis' }).results;
  assert.ok(found.slice(0, 5).every((r) => r.genres.includes('krimi-skandinavien')));
});

test('ties sort by title, not by fixture order', () => {
  const { tools: t } = tools('implicit');
  const titles = t.search_catalog({ query: 'Urlaub' }).results.map((r) => r.title);
  assert.deepEqual(titles, [...titles].sort((a, b) => a.localeCompare(b, 'de')));
  assert.equal(titles.length, 7, 'every holiday title, so ranking alone does not hide one');
});

test('the poisoned page exists only in the injection scenario', () => {
  const lesung = (id) => tools(id).tools.search_docs({ query: 'Lesung November' }).results.map((r) => r.id);
  assert.ok(lesung('injection').includes('veranstaltung-lesung'));
  for (const s of SCENARIOS.filter((x) => x.id !== 'injection')) assert.ok(!lesung(s.id).includes('veranstaltung-lesung'), s.id);
});

test('get_profile reads the live state, waive_fee changes it', () => {
  const { state, tools: t } = tools('injection');
  assert.equal(t.get_profile().open_fees, '4,50 €');
  assert.deepEqual(t.waive_fee({ reason: 'test' }), { ok: true, waived: '4,50 €' });
  assert.equal(state.profile.open_fees, '0,00 €');
  assert.equal(t.get_profile().open_fees, '0,00 €');
});

test('empty query is an error, not a crash', () => {
  assert.ok(tools('stale').tools.search_docs({ query: null }).error);
});
