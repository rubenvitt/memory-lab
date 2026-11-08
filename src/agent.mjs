// The assistant under test (a JSON tool loop over stateless model calls) and the extractor of architecture A.
// Prompt rendering must stay deterministic: it feeds the cache key, so no clock, no random ids.
import { existsSync, readFileSync } from 'node:fs';
import { addAction, addUser, applyExtraction, noteRead, remember } from './memory.mjs';

const dir = (version) => new URL(`../prompts/${version}/`, import.meta.url);

export function loadPrompts(version = 'v1') {
  const read = (name) => readFileSync(new URL(name, dir(version)), 'utf8');
  return {
    version,
    params: JSON.parse(read('params.json')),
    agent: read('agent.md'),
    'memory-A': read('memory-a.md').trim(),
    'memory-B': read('memory-b.md').trim(),
    extractor: read('extractor.md'),
    // E2 only: the original Mem0 prompts.
    ...(existsSync(new URL('mem0-extraction.md', dir(version))) ? {
      'mem0-extraction': read('mem0-extraction.md'), 'mem0-update': read('mem0-update.md'), 'mem0-update-empty': read('mem0-update-empty.md'),
    } : {}),
  };
}

export const fill = (template, values) => template.replace(/\{\{(\w+)\}\}/g, (_, k) => {
  if (values[k] == null) throw new Error(`missing value for {{${k}}}`);
  return values[k];
});

const text = { type: ['string', 'null'] };
const TOOLS = ['get_profile', 'search_docs', 'search_catalog', 'waive_fee', 'answer'];

// A and B differ only in `remember` and its three fields.
export function actionSchema(arch) {
  const extra = arch === 'B' ? { key: text, value: text, quote: text } : {};
  const properties = { tool: { type: 'string', enum: arch === 'B' ? [...TOOLS, 'remember'] : TOOLS }, query: text, reason: text, text, ...extra };
  return { type: 'object', additionalProperties: false, required: Object.keys(properties), properties };
}

export const EXTRACTOR_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['operations'],
  properties: {
    operations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['op', 'id', 'text'],
        properties: { op: { type: 'string', enum: ['ADD', 'UPDATE', 'DELETE', 'NOOP'] }, id: text, text },
      },
    },
  },
};

const NONE = '(noch nichts)';
const ARG_FIELDS = { search_docs: ['query'], search_catalog: ['query'], waive_fee: ['reason'], answer: ['text'], remember: ['key', 'value', 'quote'], get_profile: [] };
export const argsOf = (action) => Object.fromEntries((ARG_FIELDS[action.tool] ?? []).map((f) => [f, action[f] ?? null]));

export function renderHistory(messages = []) {
  if (!messages.length) return '(noch leer)';
  return messages.map((m) => {
    if (m.role === 'user') return `[Turn ${m.turn}] Person: ${m.text}`;
    if (m.tool === 'answer') return `[Turn ${m.turn}] Du (answer): ${m.args.text}`;
    return `[Turn ${m.turn}] Du: ${m.tool} ${JSON.stringify(m.args)}\n[Turn ${m.turn}] Ergebnis: ${JSON.stringify(m.result)}`;
  }).join('\n');
}

export function renderMemory(state, prompts) {
  if (state.arch === 'A') {
    const memories = state.memory.length ? state.memory.map((m) => `- ${m.text}`).join('\n') : NONE;
    return fill(prompts['memory-A'], { memories });
  }
  const preferences = state.preferences.length
    ? state.preferences.map((p) => `- ${p.key}: ${p.value} (Quelle: Session ${p.source.session}, Turn ${p.source.turn}, „${p.quote}“)`).join('\n')
    : NONE;
  return fill(prompts['memory-B'], { preferences });
}

export function agentPrompt(state, session, prompts) {
  return fill(prompts.agent, {
    max_steps: prompts.params.max_steps,
    memory: renderMemory(state, prompts),
    history: renderHistory(state.history[session]),
  });
}

// One user message: up to max_steps actions, the last one should be `answer`.
export async function runTurn({ state, tools, session, turn, userText, ctx }) {
  const { prompts, engine, rep, hash, meta } = ctx;
  const { params } = prompts;
  addUser(state, session, turn, userText, hash);
  const steps = [];
  for (let step = 1; step <= params.max_steps; step++) {
    const reply = await engine.call({
      model: params.models.agent, effort: params.models.effort, rep,
      prompt: agentPrompt(state, session, prompts), schema: actionSchema(state.arch),
      meta: { ...meta, role: 'agent', session, turn, step },
    });
    ctx.calls.push({ role: 'agent', session, turn, step, raw: ctx.rawOf(reply) });
    const action = { tool: reply.parsed.tool, ...argsOf(reply.parsed) };
    let result;
    if (action.tool === 'answer') result = { ok: true };
    else if (action.tool === 'remember') result = remember(state, session, turn, action);
    else if (tools[action.tool]) result = tools[action.tool](action);
    else result = { error: `unbekanntes Tool ${action.tool}` };
    if (action.tool === 'search_docs' && result.results) noteRead(state, session, turn, result.results);
    addAction(state, session, turn, action, result, hash);
    steps.push({ step, action, result });
    if (action.tool === 'answer') return { turn, user: userText, steps, answer: action.text ?? '' };
  }
  return { turn, user: userText, steps, answer: null };
}

// Mem0 pattern, after each session of A: transcript including tool results plus existing entries in, operations out.
// E1: after the session on the whole transcript. E2 (`turn` set): after each message pair on that turn's part.
export async function extract({ state, session, ctx, turn }) {
  const { prompts, engine, rep, meta } = ctx;
  const memories = state.memory.length ? state.memory.map((m) => `- ${m.id}: ${m.text}`).join('\n') : NONE;
  const messages = (state.history[session] ?? []).filter((m) => turn == null || m.turn === turn);
  const reply = await engine.call({
    model: prompts.params.models.extractor, effort: prompts.params.models.effort, rep,
    prompt: fill(prompts.extractor, { memories, transcript: renderHistory(messages) }),
    schema: EXTRACTOR_SCHEMA,
    meta: { ...meta, role: 'extractor', session, ...(turn == null ? {} : { turn }) },
  });
  ctx.calls.push({ role: 'extractor', session, ...(turn == null ? {} : { turn }), raw: ctx.rawOf(reply) });
  return { proposed: reply.parsed.operations, applied: applyExtraction(state, session, reply.parsed.operations) };
}
