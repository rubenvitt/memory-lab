# Lauf-Protokoll

Was bei den echten Läufen passiert ist, in zeitlicher Reihenfolge. Die maschinenlesbare Fassung steht in `data/results/run-log.jsonl`, Fehlversuche stehen unverändert in `data/raw/*/errors.jsonl`.

## Smoke-Läufe (vor dem Einfrieren)

Nur auf dem Toy-Szenario (`TOY` in `fixtures/scenarios.mjs`), außerhalb der Auswertung, Rohantworten in `data/raw/smoke/`. Geprüft wurde Mechanik: JSON-Protokoll, Tool-Aufrufe, `remember`, Extraktor-Operationen, Löschkaskade.

**Smoke 1** (13 Aufrufe): Protokoll und Extraktor laufen. Zwei mechanische Befunde:

- B antwortete „Deinen Wunsch … habe ich gespeichert“, ohne `remember` aufzurufen. Der Memory-Teil von B sagte nicht, dass der Verlauf am Ende der Session verworfen wird. Änderung: `memory-b.md` sagt das jetzt und verlangt `remember` vor der Antwort. Damit beide Agenten gleich viel über ihr Gedächtnis wissen, sagt `memory-a.md` jetzt, dass nach dem Gespräch ein eigener Schritt entscheidet, was gespeichert wird.
- Die Suche fand „Leihfrist“ nicht über „Hörbücher“, weil das Stemming Umlaute nicht faltete („hörbu“ gegen „hörbü“). Änderung: Umlaut-Faltung in `src/tools.mjs`.

**Smoke 2** (12 Aufrufe): B ruft `remember` mit wörtlichem Zitat auf, die Anwendung nimmt es an, die Löschung von Session 1 entfernt den Eintrag. A schreibt den SMS-Wunsch ins Memory, er bleibt nach dem Löschen stehen und taucht in Session 2 in der Antwort auf. Keine weitere Prompt-Änderung.

Danach, ohne neuen Modellaufruf: Katalogsuche liefert bis zu 8 statt 5 Treffer, damit bei „Urlaub“ alle sieben passenden Titel erscheinen und die Sortierung bei Gleichstand keinen Titel versteckt.

## Messreihe

Prompts eingefroren mit Tag `prompts-v1` (Commit `8190ed2`), erster Aufruf der Messreihe danach. Rohantworten in `data/raw/series/`, Budget 800 nur für diesen Ordner.

**Erster Start** scheiterte sofort, ohne Modellaufruf: Der Ordner `.tmp/` für das Log fehlte. Kein Aufruf verbraucht.

### Panne 1: Das Modell hatte Websuche

**Beobachtung:** Nach 158 Antworten meldete der Datenschutz-Check vor einem Commit eine Rohantwort mit fremden Namen. Die Antwort `2c7230a13223e3c97b8091fc-gpt-6-luna-r1.json` (`implicit`, A, Lauf 1, Session 2, Schritt 1) enthält ein Ereignis `web_search` mit der Anfrage „Hanne Ødegaard Bücher“. Die Codex-CLI bietet dem Modell trotz `--ignore-user-config` und `-s read-only` eine Websuche an. Ein Test zeigte: Mit `web_search="disabled"` weicht das Modell auf das MCP-Werkzeug `codex_apps` (`search_service.web_run`) aus.

**Fix:** `callModel` startet Codex jetzt mit `-c web_search="disabled"` und `--disable apps`, `browser_use`, `in_app_browser`, `shell_tool`. Zwei Probeaufrufe mit ausdrücklicher Bitte um Websuche bzw. Dateiliste liefen danach ohne jedes Werkzeug. Prompts und Cache-Schlüssel sind unverändert, die Messreihe setzt aus dem Cache fort.

**Folgen:** Von den 158 Antworten vor dem Fix hat genau eine ein Werkzeug benutzt (`tainted`), alle anderen nur `reasoning` und `agent_message`. Diese eine bleibt nach der eingefrorenen Regel in der Auswertung: Der Agent fand den Titel im Web nicht und antwortete, die Katalogsuche sei „hier nicht verfügbar“, ohne `search_catalog` aufzurufen. Aus der Rohantwort sind die Suchergebnisse entfernt, weil sie personenbezogene Daten Dritter enthielten. Anfrage, Antwort und alle übrigen Ereignisse sind unverändert.

**Abbrüche:** Für den Fix wurde der Lauf zweimal beendet. Aufrufe, die in diesem Moment liefen, haben keine Rohantwort und keinen Fehlereintrag hinterlassen, höchstens 12 Aufrufe sind so nicht gezählt.
