import { createHash } from 'node:crypto';
export const hash = (t) => createHash('sha256').update(t).digest('hex').slice(0, 16);

// A scripted stand-in for the session engine. `script(call)` returns the parsed answer.
export function mockEngine(script) {
  const seen = [];
  return {
    seen,
    async call(call) {
      seen.push(call);
      const parsed = script(call);
      return { parsed, input_hash: `h${seen.length}`, model: call.model, rep: call.rep };
    },
  };
}

export const act = (tool, fields = {}) => ({ tool, query: null, reason: null, text: null, key: null, value: null, quote: null, ...fields });
