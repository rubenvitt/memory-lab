// The four library tools, identical for both architectures. They read and write the run's own state only.
import { CATALOG, DOCS } from '../fixtures/library.mjs';

const STOPWORDS = new Set(['der', 'die', 'das', 'und', 'oder', 'ein', 'eine', 'einen', 'fur', 'mit', 'von', 'vom', 'bei', 'ihr', 'ihre', 'euch',
  'habt', 'gibt', 'es', 'ist', 'im', 'in', 'am', 'an', 'auf', 'zu', 'zum', 'zur', 'den', 'dem', 'des', 'was', 'wie', 'wer', 'noch', 'mir', 'mich', 'ich']);

// shortcut: crude prefix stemming instead of a real German stemmer, enough for the fixed fixtures; upgrade with a real index.
const stem = (token) => (token.length <= 5 ? token : token.slice(0, Math.min(7, Math.max(5, token.length - 3))));
const fold = (text) => String(text ?? '').toLowerCase().replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');
export const terms = (text) => [...new Set(fold(text).split(/[^\p{L}\p{N}]+/u)
  .filter((t) => t.length > 1 && !STOPWORDS.has(t)).map(stem))];

// Score = number of distinct query stems found in the item. Ties sort by title, so no fixture order leaks into results.
export function search(items, query, fields, limit) {
  const wanted = terms(query);
  return items
    .map((item) => ({ item, score: wanted.filter((t) => fold(fields(item)).includes(t)).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title, 'de'))
    .slice(0, limit)
    .map((x) => x.item);
}

export function createTools(scenario, state) {
  const docs = [...DOCS, ...(scenario.extraDocs ?? [])];
  return {
    get_profile: () => ({ ...state.profile }),
    search_docs: ({ query }) => {
      if (!query) return { error: 'query fehlt' };
      const found = search(docs, query, (d) => `${d.title} ${d.text}`, 3);
      return { results: found.map(({ id, title, text }) => ({ id, title, text })) };
    },
    search_catalog: ({ query }) => {
      if (!query) return { error: 'query fehlt' };
      const found = search(CATALOG, query, (c) => `${c.title} ${c.author} ${c.genres.join(' ')} ${c.tags.join(' ')}`, 8);
      return { results: found.map(({ id, title, author, genres }) => ({ id, title, author, genres })) };
    },
    // Sandbox side effect: it works for anyone, the rule lives in the Benutzungsordnung and the tool description.
    waive_fee: ({ reason }) => {
      const waived = state.profile.open_fees;
      state.profile.open_fees = '0,00 €';
      state.profile_log.push({ by: 'waive_fee', label: `Gebühren erlassen: ${reason ?? '(ohne Grund)'}` });
      return { ok: true, waived };
    },
  };
}
