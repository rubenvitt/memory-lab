// CLI: node src/run.mjs <plan|smoke|series|plan-e2|smoke-e2|e2> [--max-seconds N] [--concurrency N] [--offline]
import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { SCENARIOS, TOY } from '../fixtures/scenarios.mjs';
import { E2_SCENARIOS } from '../fixtures/scenarios-e2.mjs';
import { checkE2 } from './checks-e2.mjs';
import { loadPrompts } from './agent.mjs';
import { callModel } from './engine/call-model.mjs';
import { countUsed, createSession } from './engine/session.mjs';
import { runScenario } from './scenario.mjs';

const root = new URL('..', import.meta.url).pathname;
// The series has its own raw folder, so smoke calls never eat its budget.
const RAW = join(root, 'data/raw/series');
const RAW_E2 = join(root, 'data/raw/e2');
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
const promptsE2 = loadPrompts('e2');
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

// Rep-major: all cells of repetition 1, then 2, ... A stop leaves balanced cells, not a random subset.
// `variants` is E2's list (A-mem0, A-v1, B), E1 runs the plain architectures.
async function runAll(name, scenarios, reps, s, { variants = null, p = prompts, checkFn } = {}) {
  const runs = [];
  const failures = [];
  const cells = variants ?? ARCHS;
  for (let rep = 1; rep <= reps; rep++) {
    const jobs = scenarios.flatMap((scenario) => cells.map((cell) => ({ scenario, arch: cell[0], rep, ...(variants ? { variant: cell } : {}) })));
    const settled = await Promise.allSettled(jobs.map((j) => runScenario({ ...j, engine: s, prompts: p, hash, ...(checkFn ? { check: checkFn } : {}) })));
    settled.forEach((r, i) => {
      if (r.status === 'fulfilled') runs.push(r.value);
      else failures.push({ scenario: jobs[i].scenario.id, arch: jobs[i].arch, variant: jobs[i].variant, rep, error: String(r.reason?.message ?? r.reason).slice(0, 300) });
    });
    if (s.summary().stopped) break;
  }
  report(name, s, { runs, failures }, scenarios.length * cells.length * reps);
}

function planE2() {
  const { params: q } = promptsE2;
  const per = (s, v) => {
    const turns = s.sessions.flat().length;
    const extraction = v === 'A-mem0' ? 2 * turns : v === 'A-v1' ? turns : 0;
    return { estimate: turns * ESTIMATED_STEPS + extraction, worst: turns * q.max_steps + extraction };
  };
  const cells = E2_SCENARIOS.flatMap((s) => q.variants.map((v) => ({ scenario: s.id, variant: v, ...per(s, v) })));
  const sum = (k) => cells.reduce((n, c) => n + c[k], 0) * q.repetitions;
  console.log(JSON.stringify({ runs: cells.length * q.repetitions, estimate: sum('estimate'), worst_case: sum('worst'), budget: q.budget, used: countUsed(RAW_E2), cells }, null, 1));
}

// Outside the evaluation: one toy scenario, both architectures, once. Checks protocol and mechanics only.
const smoke = () => runAll('smoke', [TOY], 1, session(SMOKE, 150));
const series = () => runAll('series', SCENARIOS, params.repetitions, session(RAW, params.budget));
const e2Options = { variants: promptsE2.params.variants, p: promptsE2, checkFn: checkE2 };
// E2 smoke: the toy scenario through the Mem0 extractor only, protocol and mapping of operations.
const smokeE2 = () => runAll('smoke-e2', [TOY], 1, session(join(SMOKE, 'e2'), 30), { variants: ['A-mem0'], p: promptsE2, checkFn: () => ({ pass: null, detail: {} }) });
const e2 = () => runAll('e2', E2_SCENARIOS, promptsE2.params.repetitions, session(RAW_E2, promptsE2.params.budget), e2Options);

const commands = { plan, smoke, series, 'plan-e2': planE2, 'smoke-e2': smokeE2, e2 };
if (!commands[command]) {
  console.error('usage: node src/run.mjs <plan|smoke|series|plan-e2|smoke-e2|e2> [--max-seconds N] [--concurrency N] [--offline]');
  process.exit(1);
}
await commands[command]();
