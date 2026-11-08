// CLI: node src/run.mjs <plan|smoke|series> [--max-seconds N] [--concurrency N] [--offline]
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SCENARIOS, TOY } from '../fixtures/scenarios.mjs';
import { loadPrompts } from './agent.mjs';
import { callModel } from './engine/call-model.mjs';
import { countUsed, createSession } from './engine/session.mjs';
import { runScenario } from './scenario.mjs';

const root = new URL('..', import.meta.url).pathname;
// The series has its own raw folder, so smoke calls never eat its budget.
const RAW = join(root, 'data/raw/series');
const SMOKE = join(root, 'data/raw/smoke');
const RESULTS = join(root, 'data/results');
const ARCHS = ['A', 'B'];
const ESTIMATED_STEPS = 3;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { 'max-seconds': { type: 'string' }, concurrency: { type: 'string' }, offline: { type: 'boolean' } },
});
const command = positionals[0];
const prompts = loadPrompts();
const { params } = prompts;
const hash = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16);

const session = (rawDir, budget) => createSession({
  // Offline replays the raw folder: a budget of 0 lets cached answers through and starts no call.
  rawDir, callModel, budget: values.offline ? 0 : budget,
  concurrency: Number(values.concurrency ?? 6),
  maxSeconds: values['max-seconds'] ? Number(values['max-seconds']) : null,
});

function plan() {
  const per = (s, arch) => {
    const turns = s.sessions.flat().length;
    const extractions = arch === 'A' ? s.sessions.length : 0;
    return { estimate: turns * ESTIMATED_STEPS + extractions, worst: turns * params.max_steps + extractions };
  };
  const cells = SCENARIOS.flatMap((s) => ARCHS.map((arch) => ({ scenario: s.id, arch, ...per(s, arch) })));
  const sum = (k) => cells.reduce((n, c) => n + c[k], 0) * params.repetitions;
  console.log(JSON.stringify({
    runs: cells.length * params.repetitions, estimate: sum('estimate'), worst_case: sum('worst'),
    budget: params.budget, used: countUsed(RAW), smoke_used: countUsed(SMOKE), cells,
  }, null, 1));
}

function report(name, s, payload, expected) {
  const summary = s.summary();
  const complete = !summary.stopped && summary.failed === 0 && payload.runs.length === expected;
  mkdirSync(RESULTS, { recursive: true });
  writeFileSync(join(RESULTS, `${name}.json`), JSON.stringify({ complete, prompt_version: prompts.version, expected, ...payload }, null, 1));
  if (!values.offline) appendFileSync(join(RESULTS, 'run-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), name, ...summary, complete, runs: payload.runs.length }) + '\n');
  console.log(JSON.stringify({ name, complete, runs: payload.runs.length, ...summary }));
  if (summary.stopped === 'rate-limit') { console.error('RATE LIMIT: Stand ist gesichert, Lauf gestoppt.'); process.exit(3); }
  if (summary.stopped && summary.stopped !== 'max-seconds') process.exit(4);
  if (!complete) process.exit(2); // partial: call again to continue
}

// Rep-major: all twelve cells of repetition 1, then 2, ... A stop leaves balanced cells, not a random subset.
async function runAll(name, scenarios, reps, s) {
  const runs = [];
  const failures = [];
  for (let rep = 1; rep <= reps; rep++) {
    const jobs = scenarios.flatMap((scenario) => ARCHS.map((arch) => ({ scenario, arch, rep })));
    const settled = await Promise.allSettled(jobs.map((j) => runScenario({ ...j, engine: s, prompts, hash })));
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') runs.push(r.value);
      else failures.push({ scenario: jobs[i].scenario.id, arch: jobs[i].arch, rep, error: String(r.reason?.message ?? r.reason).slice(0, 300) });
    });
    if (s.summary().stopped) break;
  }
  report(name, s, { runs, failures }, scenarios.length * ARCHS.length * reps);
}

// Outside the evaluation: one toy scenario, both architectures, once. Checks protocol and mechanics only.
const smoke = () => runAll('smoke', [TOY], 1, session(SMOKE, 150));
const series = () => runAll('series', SCENARIOS, params.repetitions, session(RAW, params.budget));

const commands = { plan, smoke, series };
if (!commands[command]) {
  console.error('usage: node src/run.mjs <plan|smoke|series> [--max-seconds N] [--concurrency N] [--offline]');
  process.exit(1);
}
await commands[command]();
