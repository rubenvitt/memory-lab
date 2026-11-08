import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ModelError, RateLimitError, interpret } from '../src/engine/call-model.mjs';
import { RunStopped, countUsed, createSession, inputHash, rawName } from '../src/engine/session.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'gl-'));
const call = (n = 1, rep = 1) => ({ model: 'm', prompt: `p${n}`, schema: {}, rep });
const ok = async () => ({ text: '{"a":1}', parsed: { a: 1 }, usage: null, tainted: false, events: [] });
const line = (o) => JSON.stringify(o);
const message = (text) => line({ type: 'item.completed', item: { type: 'agent_message', text } });

test('the key depends on input, model and repetition', () => {
  assert.notEqual(rawName(call(1, 1)), rawName(call(1, 2)));
  assert.notEqual(rawName(call(1)), rawName(call(2)));
  assert.notEqual(rawName(call(1)), rawName({ ...call(1), model: 'n' }));
  assert.equal(inputHash(call(1)), inputHash({ ...call(1), rep: 9, meta: { x: 1 } }));
});

test('answers land in raw and a second session resumes from there', async () => {
  const rawDir = dir();
  let calls = 0;
  const counted = async () => { calls++; return ok(); };
  const first = createSession({ rawDir, callModel: counted });
  const a = await first.call(call());
  assert.equal(a.cached, false);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(readFileSync(join(rawDir, rawName(call())))).model, 'm');
  const second = createSession({ rawDir, callModel: counted });
  const b = await second.call(call());
  assert.equal(b.cached, true);
  assert.deepEqual(b.parsed, a.parsed);
  assert.equal(calls, 1);
  assert.equal(second.summary().cached, 1);
});

test('at most six calls run at once, also when more are asked for', async () => {
  let active = 0;
  let peak = 0;
  const slow = async () => { peak = Math.max(peak, ++active); await new Promise((r) => setTimeout(r, 5)); active--; return ok(); };
  const s = createSession({ rawDir: dir(), callModel: slow, concurrency: 50 });
  await Promise.all(Array.from({ length: 30 }, (_, i) => s.call(call(i))));
  assert.equal(peak, 6);
});

test('identical calls in flight share one model call', async () => {
  let calls = 0;
  const s = createSession({ rawDir: dir(), callModel: async () => { calls++; return ok(); } });
  await Promise.all([s.call(call()), s.call(call())]);
  assert.equal(calls, 1);
});

test('the budget counts across sessions, including errors', async () => {
  const rawDir = dir();
  const s = createSession({ rawDir, callModel: ok, budget: 2 });
  await s.call(call(1));
  await s.call(call(2));
  await assert.rejects(s.call(call(3)), RunStopped);
  assert.equal(s.summary().stopped, 'budget');
  appendFileSync(join(rawDir, 'errors.jsonl'), '{}\n');
  assert.equal(countUsed(rawDir), 3);
  mkdirSync(join(rawDir, 'smoke'));
  appendFileSync(join(rawDir, 'smoke/errors.jsonl'), '{}\n');
  assert.equal(countUsed(rawDir), 4);
  const next = createSession({ rawDir, callModel: ok, budget: 4 });
  await assert.rejects(next.call(call(4)), RunStopped);
});

test('rate limit stops the run, keeps what is there and is not cached', async () => {
  const rawDir = dir();
  let calls = 0;
  const limited = async () => { if (++calls > 1) throw new RateLimitError('429'); return ok(); };
  const s = createSession({ rawDir, callModel: limited, concurrency: 1 });
  const out = await Promise.allSettled([s.call(call(1)), s.call(call(2)), s.call(call(3)), s.call(call(4))]);
  assert.deepEqual(out.map((o) => o.status), ['fulfilled', 'rejected', 'rejected', 'rejected']);
  assert.equal(s.summary().stopped, 'rate-limit');
  assert.equal(calls, 2);
  assert.ok(existsAnswer(rawDir, call(1)) && !existsAnswer(rawDir, call(2)));
  assert.equal(readFileSync(join(rawDir, 'errors.jsonl'), 'utf8').trim().split('\n').length, 1);
  assert.equal(createSession({ rawDir, callModel: ok }).summary().used, 2);
});
const existsAnswer = (rawDir, c) => readdirSync(rawDir).includes(rawName(c));

test('repeated failures stop the run, single failures do not', async () => {
  let fail = true;
  const flaky = async () => { if (fail) throw new ModelError('boom'); return ok(); };
  const s = createSession({ rawDir: dir(), callModel: flaky, maxFailuresInRow: 2, concurrency: 1 });
  await assert.rejects(s.call(call(1)), ModelError);
  fail = false;
  await s.call(call(2));
  assert.equal(s.summary().stopped, null);
  fail = true;
  await assert.rejects(s.call(call(3)));
  await assert.rejects(s.call(call(4)));
  assert.equal(s.summary().stopped, 'repeated-failures');
});

test('max-seconds starts nothing new but lets a running call finish', async () => {
  const rawDir = dir();
  const s = createSession({ rawDir, callModel: async () => { await new Promise((r) => setTimeout(r, 30)); return ok(); }, maxSeconds: 0.01, concurrency: 1 });
  const running = s.call(call(1));
  const queued = s.call(call(2));
  assert.equal((await running).cached, false);
  await assert.rejects(queued, RunStopped);
  assert.equal(s.summary().stopped, 'max-seconds');
});

test('interpret takes the last message and the usage', () => {
  const stdout = ['not json', line({ type: 'turn.started' }), message('{"a":0}'), message('{"a":1}'), line({ type: 'turn.completed', usage: { input_tokens: 5 } })].join('\n');
  const r = interpret({ code: 0, stdout, stderr: '' });
  assert.deepEqual(r.parsed, { a: 1 });
  assert.equal(r.usage.input_tokens, 5);
  assert.equal(r.tainted, false);
});

test('interpret marks a judge that ran a command', () => {
  const stdout = [line({ type: 'item.completed', item: { type: 'command_execution', command: 'cat x' } }), message('{}')].join('\n');
  assert.equal(interpret({ code: 0, stdout, stderr: '' }).tainted, true);
});

test('interpret keeps an answer that arrived after reconnect notices', () => {
  const notice = line({ type: 'error', message: 'Reconnecting... 2/5 (unexpected status 403 Forbidden)' });
  const done = line({ type: 'turn.completed', usage: { input_tokens: 1 } });
  const r = interpret({ code: 0, stdout: [notice, message('{"pass":true}'), done].join('\n'), stderr: '' });
  assert.deepEqual(r.parsed, { pass: true });
  assert.throws(() => interpret({ code: 0, stdout: [notice, message('{"pass":true}'), line({ type: 'turn.failed', error: {} })].join('\n'), stderr: '' }), ModelError);
  assert.throws(() => interpret({ code: 1, stdout: line({ type: 'error', message: 'usage limit reached' }), stderr: '' }), RateLimitError);
});

test('interpret separates rate limits from other failures', () => {
  assert.throws(() => interpret({ code: 1, stdout: line({ type: 'turn.failed', error: { message: 'You hit your usage limit' } }), stderr: '' }), RateLimitError);
  assert.throws(() => interpret({ code: 1, stdout: '', stderr: 'HTTP 429 Too Many Requests' }), RateLimitError);
  assert.throws(() => interpret({ code: 1, stdout: '', stderr: 'boom' }), ModelError);
  assert.throws(() => interpret({ code: 0, stdout: message('not json'), stderr: '' }), ModelError);
  assert.throws(() => interpret({ code: null, stdout: '', stderr: '', timedOut: true }), /timeout/);
});
