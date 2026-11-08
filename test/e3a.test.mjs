import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { VARIANTS, buildCases, runCase } from '../src/e3a.mjs';

const e2 = JSON.parse(readFileSync(new URL('../data/results/e2.json', import.meta.url), 'utf8'));
const cases = buildCases(e2);
const r = (variant, kase) => runCase(VARIANTS.find((v) => v.id === variant), cases.find((c) => c.id === kase));

test('the real E2 entries: 10 from Mem0 (5 with the diagnosis), 5 from v1 (3 with it), all derived from S1', () => {
  const mem0 = cases.find((c) => c.id === 'real-mem0');
  assert.equal(mem0.items.length, 10);
  assert.equal(r('eine-ohne', 'real-mem0').derivedWithDiagnosis, 5);
  assert.equal(r('eine-ohne', 'real-v1').derivedWithDiagnosis, 3);
  assert.ok(mem0.items.every((i) => i.derivedFrom.join() === 'S1'));
});

test('without provenance, deleting the chat reaches no copy, with either rule', () => {
  for (const v of ['eine-ohne', 'typ-ohne']) {
    assert.equal(r(v, 'real-mem0').leftWithDiagnosis, 5, v);
    assert.equal(r(v, 'a-summary').inPrompt, true, v);
    assert.equal(r(v, 'c-late-job').back, true, v);
    assert.equal(r(v, 'e-shred').storedInLog, true, v);
  }
});

test('with provenance, the cascade removes derived copies and the write check stops late writes', () => {
  for (const v of ['eine-mit', 'typ-mit']) {
    assert.equal(r(v, 'real-mem0').leftWithDiagnosis, 0, v);
    assert.equal(r(v, 'c-late-job').back, false, v);
    assert.equal(r(v, 'c-late-job').rejected, 1, v);
    assert.equal(r(v, 'b-rebuild').retrievable, false, v);
    assert.equal(r(v, 'e-shred').storedInLog, false, v);
  }
});

test('one rule for everything over-deletes: the S2 part of the summary and the explicit preference go too', () => {
  assert.equal(r('eine-mit', 'a-summary').lostOther, true);
  assert.equal(r('eine-mit', 'd-preference').preferenceDeleted, true);
  assert.equal(r('typ-mit', 'a-summary').lostOther, false);
  assert.equal(r('typ-mit', 'a-summary').inPrompt, false);
  assert.equal(r('typ-mit', 'd-preference').preferenceDeleted, false);
  assert.equal(r('typ-mit', 'd-preference').preferenceSourceShown, true);
});

test('a plaintext log keeps the query in every variant, the log is never in the prompt', () => {
  for (const v of VARIANTS.map((x) => x.id)) {
    assert.equal(r(v, 'e-plain').storedInLog, true, v);
    assert.equal(r(v, 'e-plain').inPrompt, false, v);
  }
});

test('only the separated variant without provenance keeps the rebuilt index out of the prompt', () => {
  assert.equal(r('eine-ohne', 'b-rebuild').inPrompt, true);
  assert.equal(r('typ-ohne', 'b-rebuild').inPrompt, false);
  assert.equal(r('typ-ohne', 'b-rebuild').retrievable, true);
});
