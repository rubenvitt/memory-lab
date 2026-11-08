// Architecture A as Mem0 does it (E2): after each message pair, fact extraction on user and assistant text only
// (Mem0's parse_messages drops tool messages), then the update step against existing memories.
// Prompts are the originals from mem0ai/mem0, see prompts/e2/README.md. Rendering mirrors Mem0's Python f-strings.
import { fill } from './agent.mjs';
import { applyExtraction } from './memory.mjs';

const pyStr = (s) => {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  return q + s.replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), `\\${q}`).replace(/\n/g, '\\n') + q;
};
// Python's repr() of lists, dicts and strings, as Mem0 prints them into its prompt.
export const pyRepr = (v) => (Array.isArray(v) ? `[${v.map(pyRepr).join(', ')}]`
  : v && typeof v === 'object' ? `{${Object.entries(v).map(([k, x]) => `${pyStr(k)}: ${pyRepr(x)}`).join(', ')}}` : pyStr(String(v)));

export const FACTS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['facts'],
  properties: { facts: { type: 'array', items: { type: 'string' } } },
};
export const UPDATE_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['memory'],
  properties: {
    memory: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['id', 'text', 'event', 'old_memory'],
        properties: { id: { type: 'string' }, text: { type: 'string' }, event: { type: 'string', enum: ['ADD', 'UPDATE', 'DELETE', 'NONE'] }, old_memory: { type: ['string', 'null'] } },
      },
    },
  },
};

// Mem0 sends the extraction prompt as system message and "Input:\n<parsed messages>" as user message; codex takes one text.
export const extractionPrompt = (prompts, user, answer) => `${prompts['mem0-extraction']}\n\nInput:\nuser: ${user}\nassistant: ${answer}\n`;

export function updatePrompt(prompts, memories, facts) {
  const old = memories.map((m, i) => ({ id: String(i), text: m.text }));
  return memories.length
    ? fill(prompts['mem0-update'], { old_memory: pyRepr(old), facts: pyRepr(facts) })
    : fill(prompts['mem0-update-empty'], { facts: pyRepr(facts) });
}

// Mem0 maps memory ids to "0", "1", ... against hallucinated UUIDs and back afterwards. ADD always creates a new entry.
export function toOperations(memories, entries) {
  return entries.flatMap(({ id, text, event }) => {
    const target = memories[Number(id)]?.id ?? null;
    if (event === 'ADD') return [{ op: 'ADD', id: null, text }];
    if (event === 'UPDATE') return [{ op: 'UPDATE', id: target ?? `?${id}`, text }];
    if (event === 'DELETE') return [{ op: 'DELETE', id: target ?? `?${id}`, text: null }];
    return [];
  });
}

export async function extractMem0({ state, session, turn, user, answer, ctx }) {
  const { prompts, engine, rep, meta } = ctx;
  const call = async (role, prompt, schema) => {
    const reply = await engine.call({ model: prompts.params.models.extractor, effort: prompts.params.models.effort, rep, prompt, schema, meta: { ...meta, role, session, turn } });
    ctx.calls.push({ role, session, turn, raw: ctx.rawOf(reply) });
    return reply.parsed;
  };
  const { facts } = await call('mem0-facts', extractionPrompt(prompts, user, answer ?? ''), FACTS_SCHEMA);
  // Mem0 skips the update call when no facts came out.
  if (!facts.length) return { facts, applied: [] };
  const memories = [...state.memory];
  const { memory } = await call('mem0-update', updatePrompt(prompts, memories, facts), UPDATE_SCHEMA);
  return { facts, applied: applyExtraction(state, session, toOperations(memories, memory)) };
}
