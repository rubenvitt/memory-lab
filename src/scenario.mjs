// One run: a scenario, one architecture, one repetition, empty stores at the start.
// The record is a timeline of points, each with a snapshot of all stores. A and B get the same points:
// session n, then "after session n" (A: extraction, B: session discarded), then the events after session n.
import { extract, runTurn } from './agent.mjs';
import { check } from './checks.mjs';
import { createState, deleteSession, endSession, patchProfile, snapshot } from './memory.mjs';
import { createTools } from './tools.mjs';
import { DOCS_VERSION } from '../fixtures/library.mjs';

export const rawOf = (reply) => `${reply.input_hash}-${reply.model}-r${reply.rep}.json`;

export async function runScenario({ scenario, arch, rep, engine, prompts, hash }) {
  const state = createState(arch, scenario.profile, DOCS_VERSION);
  const tools = createTools(scenario, state);
  const calls = [];
  const ctx = { prompts, engine, rep, hash, calls, rawOf, meta: { scenario: scenario.id, arch, rep } };
  const points = [];
  const at = (point) => points.push({ ...point, stores: snapshot(state) });

  for (const [i, messages] of scenario.sessions.entries()) {
    const session = i + 1;
    const turns = [];
    for (const [j, userText] of messages.entries()) {
      turns.push(await runTurn({ state, tools, session, turn: j + 1, userText, ctx }));
    }
    at({ kind: 'session', session, label: `Session ${session}`, turns });
    if (arch === 'A') {
      const { proposed, applied } = await extract({ state, session, ctx });
      at({ kind: 'after', session, label: `Nach Session ${session}`, note: 'Extraktor schreibt ins Memory', proposed, applied });
    } else {
      endSession(state, session);
      at({ kind: 'after', session, label: `Nach Session ${session}`, note: 'Session endet, Verlauf wird verworfen' });
    }
    for (const event of (scenario.events ?? []).filter((e) => e.after === session)) {
      if (event.kind === 'profile') patchProfile(state, event.patch, event.label);
      if (event.kind === 'delete-session') deleteSession(state, event.session);
      at({ kind: 'event', session, label: event.label, event });
    }
  }
  const run = { scenario: scenario.id, arch, rep, prompt_version: prompts.version, points, calls };
  return { ...run, check: check(scenario, run) };
}
