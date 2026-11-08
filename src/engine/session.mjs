// Resumable, parallel, budgeted model calls. Every answer lands in data/raw/ before anything else happens.
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { RateLimitError } from './call-model.mjs';

export class RunStopped extends Error {
  constructor(reason) {
    super(`run stopped: ${reason}`);
    this.reason = reason;
  }
}

export function inputHash({ model, prompt, schema, effort = 'low' }) {
  return createHash('sha256').update(JSON.stringify({ model, prompt, schema, effort })).digest('hex').slice(0, 24);
}

export function rawName(call) {
  return `${inputHash(call)}-${call.model}-r${call.rep ?? 0}.json`;
}

const errorFile = (rawDir) => join(rawDir, 'errors.jsonl');

export function countUsed(rawDir) {
  if (!existsSync(rawDir)) return 0;
  const files = readdirSync(rawDir, { recursive: true }).map(String);
  const answers = files.filter((f) => f.endsWith('.json')).length;
  const errors = files.filter((f) => f.endsWith('errors.jsonl'))
    .reduce((n, f) => n + readFileSync(join(rawDir, f), 'utf8').split('\n').filter(Boolean).length, 0);
  return answers + errors;
}

function writeAtomic(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(value, null, 1));
  renameSync(`${file}.tmp`, file);
}

export function createSession({ rawDir, callModel, concurrency = 6, maxSeconds = null, budget = 1500, timeoutMs = 120_000, maxFailuresInRow = 5 }) {
  mkdirSync(rawDir, { recursive: true });
  const deadline = maxSeconds == null ? Infinity : Date.now() + maxSeconds * 1000;
  const inFlight = new Map();
  const waiting = [];
  let free = Math.min(concurrency, 6);
  let used = countUsed(rawDir);
  let made = 0;
  let cached = 0;
  let failed = 0;
  let inRow = 0;
  let stopped = null;

  const stop = (reason) => {
    stopped ??= reason;
    for (const w of waiting.splice(0)) w.reject(new RunStopped(stopped));
  };
  const acquire = () => {
    if (stopped) return Promise.reject(new RunStopped(stopped));
    if (free > 0) { free--; return Promise.resolve(); }
    return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
  };
  const release = () => {
    const next = waiting.shift();
    if (next) next.resolve(); else free++;
  };

  async function execute(call, file) {
    await acquire();
    try {
      if (Date.now() >= deadline) stop('max-seconds');
      if (used >= budget) stop('budget');
      if (stopped) throw new RunStopped(stopped);
      used++;
      made++;
      const started = Date.now();
      const { model, rep = 0, meta = {}, effort = 'low' } = call;
      try {
        const result = await callModel({ model, prompt: call.prompt, schema: call.schema, effort, timeoutMs });
        const record = { model, effort, rep, input_hash: inputHash(call), meta, duration_ms: Date.now() - started, ...result };
        writeAtomic(file, record);
        inRow = 0;
        return { ...record, cached: false };
      } catch (err) {
        failed++;
        appendFileSync(errorFile(rawDir), JSON.stringify({ model, rep, input_hash: inputHash(call), meta, error: String(err.message).slice(0, 2000) }) + '\n');
        if (err instanceof RateLimitError) stop('rate-limit');
        else if (++inRow >= maxFailuresInRow) stop('repeated-failures');
        throw err;
      }
    } finally {
      release();
    }
  }

  return {
    call(call) {
      const name = rawName(call);
      const file = join(rawDir, name);
      if (existsSync(file)) {
        cached++;
        return Promise.resolve({ ...JSON.parse(readFileSync(file, 'utf8')), cached: true });
      }
      if (!inFlight.has(name)) inFlight.set(name, execute(call, file).finally(() => inFlight.delete(name)));
      return inFlight.get(name);
    },
    summary: () => ({ made, cached, failed, used, budget, stopped }),
  };
}
