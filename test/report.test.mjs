import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fillFindings, verdictText } from '../src/report.mjs';

const root = new URL('..', import.meta.url).pathname;

test('the generated block replaces only itself', () => {
  const before = 'Hand\n<!-- report:start -->\nalt\n<!-- report:end -->\nNach';
  assert.equal(fillFindings(before, '<!-- report:start -->neu<!-- report:end -->'), 'Hand\n<!-- report:start -->neu<!-- report:end -->\nNach');
  assert.equal(fillFindings('Hand', 'X'), 'Hand\n\nX\n');
});

test('verdict texts name what happened', () => {
  assert.equal(verdictText('stale', { detail: { answer: 'Am Mühlengraben 12, früher Kastanienweg 7' } }), 'nennt die alte Adresse');
  assert.equal(verdictText('erasure', { detail: { found: [{ store: 'memory' }] } }), 'Canary in memory');
  assert.equal(verdictText('implicit', { detail: { title: null } }), 'empfiehlt keinen Katalogtitel');
});

// If this fails, the demo shows something else than what was recorded.
test('site data and store logic are exact copies', { skip: !existsSync(`${root}data/results/demo.json`) }, () => {
  for (const file of ['summary.json', 'demo.json']) assert.ok(readFileSync(`${root}site/data/${file}`).equals(readFileSync(`${root}data/results/${file}`)), file);
  assert.ok(readFileSync(`${root}site/js/memory.js`).equals(readFileSync(`${root}src/memory.mjs`)));
});
