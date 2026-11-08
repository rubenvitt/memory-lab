import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ASSISTANT_LINE, MESSAGES } from '../fixtures/e3-messages.mjs';

test('40 messages, 20 in passing and 20 explicit, five per category and mode', () => {
  assert.equal(MESSAGES.length, 40);
  for (const mode of ['nebenbei', 'ausdrücklich']) {
    for (const c of ['Gesundheit', 'Dritte', 'Religion', 'Finanzen']) assert.equal(MESSAGES.filter((m) => m.mode === mode && m.category === c).length, 5);
  }
  assert.ok(MESSAGES.filter((m) => m.mode === 'ausdrücklich').every((m) => m.text.startsWith('Merk dir bitte')));
});

test('each pattern finds its detail, but not in the library request or the assistant line', () => {
  for (const m of MESSAGES) {
    const re = new RegExp(m.term, 'i');
    assert.ok(re.test(m.text), m.id);
    const request = m.text.split(/(?<=\.)\s/).at(-1);
    assert.ok(!re.test(request), `${m.id}: ${request}`);
    assert.ok(!re.test(ASSISTANT_LINE), m.id);
  }
});
