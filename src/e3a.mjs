// E3a: what a deletion of chat S1 reaches, as a 2×2 of rules. No model calls: this executes rules, it measures nothing.
// Factor 1: one delete and one prompt rule for all derived data, or one rule per data type.
// Factor 2: without or with provenance (derivedFrom) plus cascade and a write check against deleted sources.
// The audit log is the same infrastructure in all four variants: append-only, never in a prompt, never searched.
// Its mode (plaintext or encrypted per chat) is case e, not a variant.
// Rules are frozen in prompts/e3/README.md.

export const DIAGNOSIS = /makula|macula/i;

export const VARIANTS = [
  { id: 'eine-ohne', perType: false, provenance: false, label: 'Eine Regel für alles, ohne Herkunft' },
  { id: 'typ-ohne', perType: true, provenance: false, label: 'Eine Regel je Datenart, ohne Herkunft' },
  { id: 'eine-mit', perType: false, provenance: true, label: 'Eine Regel für alles, mit Herkunft' },
  { id: 'typ-mit', perType: true, provenance: true, label: 'Eine Regel je Datenart, mit Herkunft' },
];

const S1_MESSAGE = 'Ich brauche Bücher in Großdruck, wegen meiner Makuladegeneration kann ich normale Schrift kaum noch lesen. Was habt ihr da?';
const S2_MESSAGE = 'Habt ihr neue Krimis? Die lese ich am liebsten.';

// Cases. Each starts from the same two chats; `items` are derived data, `audit` are log entries, `job` runs after the deletion.
export function buildCases(e2) {
  const real = (variant) => e2.runs.filter((r) => r.scenario === 'erasure-late' && r.variant === variant)
    .flatMap((r) => r.points.find((p) => p.kind === 'event').stores.memory.map((m) => ({ kind: 'memory', text: m.text, derivedFrom: ['S1'] })));
  const queries = e2.runs.filter((r) => r.scenario === 'erasure-late' && r.variant === 'B')
    .flatMap((r) => r.points.find((p) => p.kind === 'event').stores.audit.filter((a) => a.args?.query).map((a) => a.args.query));
  const s1Queries = [...new Set(queries)];
  return [
    { id: 'real-mem0', label: 'Echte Einträge aus E2, Mem0-Extraktor', items: real('A-mem0') },
    { id: 'real-v1', label: 'Echte Einträge aus E2, eigener Extraktor', items: real('A-v1') },
    {
      id: 'a-summary', label: 'Zusammenfassung aus Chat 1 und Chat 2',
      items: [{ kind: 'summary', text: 'Hat eine Makuladegeneration und liest am liebsten Krimis.', derivedFrom: ['S1', 'S2'], rederive: { S2: 'Liest am liebsten Krimis.' }, keep: /Krimi/ }],
    },
    {
      id: 'b-rebuild', label: 'Suchindex wird nach dem Löschen aus dem Protokoll neu gebaut', rebuild: true,
      audit: [...s1Queries.map((q) => ({ session: 'S1', text: q })), { session: 'S2', text: 'neue Krimis' }],
      items: s1Queries.map((q) => ({ kind: 'index', text: q, derivedFrom: ['S1'] })),
    },
    {
      id: 'c-late-job', label: 'Extraktionsjob aus Chat 1 läuft erst nach dem Löschen',
      job: { kind: 'memory', text: 'Die Person hat Makuladegeneration.', derivedFrom: ['S1'] },
    },
    {
      id: 'd-preference', label: 'Ausdrücklich gespeicherter Wunsch aus Chat 1',
      items: [{ kind: 'preference', text: 'Immer Großdruck, wegen Makuladegeneration', derivedFrom: ['S1'], explicit: true }],
    },
    { id: 'e-plain', label: 'Suchanfrage im Protokoll, Klartext', auditMode: 'plain', audit: s1Queries.map((q) => ({ session: 'S1', text: q })) },
    { id: 'e-shred', label: 'Suchanfrage im Protokoll, pro Chat verschlüsselt', auditMode: 'shred', audit: s1Queries.map((q) => ({ session: 'S1', text: q })) },
  ].map((c) => ({ chats: { S1: S1_MESSAGE, S2: S2_MESSAGE }, items: [], audit: [], auditMode: 'plain', ...c }));
}

const touches = (item, dead) => (item.derivedFrom ?? []).some((s) => dead.has(s));

export function runCase(variant, kase) {
  const strip = (i) => (variant.provenance ? { ...i } : { ...i, derivedFrom: null });
  const state = {
    chats: { ...kase.chats },
    items: kase.items.map(strip),
    audit: kase.audit.map((a) => ({ ...a, keyAlive: true })),
    dead: new Set(),
    rejected: [],
  };
  const readableAudit = () => state.audit.filter((a) => kase.auditMode === 'plain' || a.keyAlive);
  // Write path: with provenance, nothing derived from a deleted chat may be written again.
  const write = (item) => {
    if (variant.provenance && touches(item, state.dead)) { state.rejected.push(item.text); return; }
    state.items.push(strip(item));
  };
  const snapshot = () => ({ items: state.items.map((i) => i.text).join('\n'), audit: readableAudit().map((a) => a.text).join('\n') });

  // 1. "Chat S1 löschen"
  delete state.chats.S1;
  if (variant.provenance) {
    state.dead.add('S1');
    const kept = [];
    for (const item of state.items) {
      if (!touches(item, state.dead)) { kept.push(item); continue; }
      if (!variant.perType) continue; // one rule: everything derived from S1 goes
      if (item.kind === 'preference' && item.explicit) { kept.push({ ...item, sourceDeleted: true }); continue; } // product rule
      if (item.kind === 'summary') {
        const rest = item.derivedFrom.filter((s) => !state.dead.has(s));
        const text = rest.length ? item.rederive?.[rest.join('+')] : null;
        if (text) kept.push({ ...item, text, derivedFrom: rest });
        continue;
      }
      // memory, index: go
    }
    state.items = kept;
    // The log stays append-only. Encrypted per chat, the key of S1 is destroyed.
    for (const a of state.audit) if (state.dead.has(a.session)) a.keyAlive = false;
  }
  const afterDelete = snapshot();

  // 2. A job queued during S1 runs now.
  if (kase.job) write(kase.job);
  // 3. The search index is rebuilt from what the log still lets read.
  if (kase.rebuild) {
    state.items = state.items.filter((i) => i.kind !== 'index');
    for (const a of readableAudit()) write({ kind: 'index', text: a.text, derivedFrom: [a.session] });
  }
  const after = snapshot();

  const inPrompt = state.items.filter((i) => (variant.perType ? ['memory', 'summary', 'preference'].includes(i.kind) : true));
  const retrievable = state.items; // every derived item is searchable, the log is not
  const has = (texts) => texts.some((t) => DIAGNOSIS.test(t));
  const keepOriginal = kase.items.find((i) => i.keep);
  return {
    variant: variant.id, case: kase.id,
    stored: DIAGNOSIS.test(after.items) || DIAGNOSIS.test(after.audit),
    storedInLog: DIAGNOSIS.test(after.audit),
    retrievable: has(retrievable.map((i) => i.text)),
    inPrompt: has(inPrompt.map((i) => i.text)),
    back: !DIAGNOSIS.test(afterDelete.items) && DIAGNOSIS.test(after.items),
    // Over-deletion: the S2 part of a mixed summary is gone, or an explicit preference was deleted against the product rule.
    lostOther: Boolean(keepOriginal) && !state.items.some((i) => keepOriginal.keep.test(i.text)),
    preferenceDeleted: kase.items.some((i) => i.explicit) && !state.items.some((i) => i.explicit),
    preferenceSourceShown: state.items.some((i) => i.explicit && i.sourceDeleted),
    derivedWithDiagnosis: kase.items.filter((i) => DIAGNOSIS.test(i.text)).length,
    derived: kase.items.length,
    leftWithDiagnosis: state.items.filter((i) => DIAGNOSIS.test(i.text)).length,
    rejected: state.rejected.length,
  };
}

// One short German verdict per cell, built from the checks.
export function cellText(r) {
  if (r.case === 'd-preference') {
    if (r.preferenceDeleted) return 'gelöscht, gegen die Produktregel';
    return r.preferenceSourceShown ? 'bleibt nach Produktregel, Herkunft sichtbar' : 'bleibt, Herkunft unbekannt';
  }
  if (r.case.startsWith('real')) {
    return r.leftWithDiagnosis ? `${r.leftWithDiagnosis} von ${r.derivedWithDiagnosis} Einträgen mit Diagnose bleiben, im Prompt` : `alle ${r.derivedWithDiagnosis} Einträge mit Diagnose weg`;
  }
  const parts = [];
  if (r.back) parts.push(r.case === 'c-late-job' ? 'kommt durch den Job zurück' : 'kommt durch den Neubau zurück');
  else if (r.retrievable || r.inPrompt) parts.push(r.inPrompt ? 'bleibt, im Prompt' : 'bleibt, abrufbar');
  if (r.storedInLog) parts.push('bleibt im Protokoll');
  if (!parts.length) parts.push(r.case === 'e-shred' && r.variant.endsWith('mit') ? 'unlesbar, Schlüssel vernichtet' : 'weg');
  if (r.lostOther) parts.push('Krimi-Anteil aus Chat 2 auch weg');
  if (r.rejected && !r.back) parts.push(r.case === 'c-late-job' ? 'Job abgewiesen' : 'Index bleibt sauber, Neubau weist Chat 1 ab');
  return parts.join('; ');
}

export function runAll(e2) {
  const cases = buildCases(e2);
  const results = VARIANTS.flatMap((v) => cases.map((c) => ({ ...runCase(v, c), text: null })));
  for (const r of results) r.text = cellText(r);
  return { variants: VARIANTS, cases: cases.map(({ id, label, items }) => ({ id, label, derived: items.length })), results };
}
