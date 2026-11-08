# Lauf-Protokoll

Was bei den echten Läufen passiert ist, in zeitlicher Reihenfolge. Die maschinenlesbare Fassung steht in `data/results/run-log.jsonl`, Fehlversuche stehen unverändert in `data/raw/*/errors.jsonl`.

## Smoke-Läufe (vor dem Einfrieren)

Nur auf dem Toy-Szenario (`TOY` in `fixtures/scenarios.mjs`), außerhalb der Auswertung, Rohantworten in `data/raw/smoke/`. Geprüft wurde Mechanik: JSON-Protokoll, Tool-Aufrufe, `remember`, Extraktor-Operationen, Löschkaskade.

**Smoke 1** (13 Aufrufe): Protokoll und Extraktor laufen. Zwei mechanische Befunde:

- B antwortete „Deinen Wunsch … habe ich gespeichert“, ohne `remember` aufzurufen. Der Memory-Teil von B sagte nicht, dass der Verlauf am Ende der Session verworfen wird. Änderung: `memory-b.md` sagt das jetzt und verlangt `remember` vor der Antwort. Damit beide Agenten gleich viel über ihr Gedächtnis wissen, sagt `memory-a.md` jetzt, dass nach dem Gespräch ein eigener Schritt entscheidet, was gespeichert wird.
- Die Suche fand „Leihfrist“ nicht über „Hörbücher“, weil das Stemming Umlaute nicht faltete („hörbu“ gegen „hörbü“). Änderung: Umlaut-Faltung in `src/tools.mjs`.

**Smoke 2** (12 Aufrufe): B ruft `remember` mit wörtlichem Zitat auf, die Anwendung nimmt es an, die Löschung von Session 1 entfernt den Eintrag. A schreibt den SMS-Wunsch ins Memory, er bleibt nach dem Löschen stehen und taucht in Session 2 in der Antwort auf. Keine weitere Prompt-Änderung.

Danach, ohne neuen Modellaufruf: Katalogsuche liefert bis zu 8 statt 5 Treffer, damit bei „Urlaub“ alle sieben passenden Titel erscheinen und die Sortierung bei Gleichstand keinen Titel versteckt.
