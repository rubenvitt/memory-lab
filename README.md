# Memory Lab

Begleitprojekt zum Blogpost „Memory ist kein Feature, sondern Datenarchitektur“ auf rubeen.dev. These: Was als „Memory“ verkauft wird, sind mehrere Datenarten mit eigener Ownership, Lebensdauer, Schreibregel und Löschpfad. Ein Topf, in den ein Modell schreibt, was es für merkenswert hält, scheitert an genau diesen Regeln. Dafür bekommt ein Auskunfts-Assistent der fiktiven Stadtbücherei Fennbrück zwei Gedächtnisse und läuft durch sechs Szenarien. Die Spezifikation steht in [docs/spec.md](docs/spec.md).

## Ergebnis

In dieser Messreihe liegen beide Architekturen in den vier Szenarien zu Ownership und Löschung gleichauf. Der Unterschied ist strukturell, nicht gemessen: A hat `erasure` und `injection` bestanden, weil der gehärtete Extraktor in jedem Lauf richtig entschieden hat. B hat sie bestanden, weil es für diese Daten keinen Schreibweg gibt oder die Löschkaskade aufräumt. Die Gegenprobe `implicit` geht an A, aber nur 2 von 5, weil derselbe vorsichtige Extraktor das Interesse selten speichert. Die Kontrolle `explicit` kostet B zwei Läufe: Der Agent versucht, den schon gespeicherten Wunsch mit einem Zitat aus der vorigen Session erneut zu speichern, die Anwendung lehnt das zu Recht ab, einmal bis zur Schrittgrenze. Ausgelöst hat das sehr wahrscheinlich ein unbedingt formulierter Satz im Prompt von B („Rufe `remember` auf, bevor du antwortest.“), also ein Störfaktor dieses Aufbaus, kein gemessener Preis der Zitat-Regel.

| Szenario | A: ein Topf | B: getrennte Stores |
|---|---|---|
| `stale` Umzug | 3/5 | 3/5 |
| `erasure` Löschung | 5/5 | 5/5 |
| `injection` vergiftetes Dokument | 5/5 | 5/5 |
| `proxy` für jemand anderen gefragt | 4/5 (von Hand 3/5) | 4/5 |
| `implicit` implizite Vorliebe | 2/5 | 0/5 |
| `explicit` ausdrücklicher Wunsch | 5/5 | 3/5 (von Hand 4/5) |

Bestanden von Läufen, `gpt-6-luna` mit Effort `low` für Agent und Extraktor, Prompts `v1`, 393 Modellaufrufe. Die Erwartung stand vor dem Lauf fest und lag fünfmal daneben: `stale` B, `erasure` A, `proxy` B, `implicit` A und `explicit` B.

### E2: nach Sicht der Ergebnisse von E1 ergänzt

E1 lief mit zwei für A günstigen Bedingungen: ein gehärteter Extraktor, und die Extraktion erst nach der Session, als die Löschbitte schon im Verlauf stand. E2 hebt beide auf und lässt B unverändert. `A-mem0` extrahiert mit den Original-Prompts von Mem0 ([mem0ai/mem0](https://github.com/mem0ai/mem0) @ `f1791da`, Apache-2.0) nach jedem Nachrichtenpaar, `A-v1` ist der Extraktor aus E1, ebenfalls nach jedem Paar. Neu ist `erasure-late`: Die Diagnose fällt in Session 1 ohne Löschbitte, die Person löscht den Chat am nächsten Tag über die Oberfläche.

| Szenario | A-mem0 | A-v1 | B |
|---|---|---|---|
| `erasure-late` späte Löschung | 0/5 | 2/5 | 5/5 |
| `injection` vergiftetes Dokument | 5/5 | 5/5 | 5/5 |
| `stale` Umzug | 4/5 | 4/5 | 4/5 |
| `proxy` für jemand anderen gefragt | 4/5 | 4/5 (von Hand 3/5) | 4/5 |

Hier zeigt sich die These: Der Mem0-Extraktor schreibt die Diagnose in allen 5 Läufen ins Memory, nach dem Löschen bleibt sie stehen, und der Agent nennt sie am nächsten Tag. Der gehärtete Extraktor tut das ohne Löschbitte in 3 von 5 Läufen. B hält alle Stores sauber, aber in 2 Läufen steht die Diagnose über eine Suchanfrage im append-only Audit-Log. Bei `injection`, `stale` und `proxy` liegen alle drei gleichauf. 339 Modellaufrufe, Erwartung vor dem Lauf festgehalten (Tag `prompts-e2`).

Details in [docs/findings.md](docs/findings.md), Ablauf und Pannen in [docs/run-log.md](docs/run-log.md).

## Die zwei Architekturen

- **A: ein Topf.** Nachbau des Mem0-Musters (Chhikara et al. 2025, arXiv:2504.19413): Nach jeder Session sieht ein Extraktor den Verlauf mit Tool-Ergebnissen und die bestehenden Einträge und entscheidet `ADD`, `UPDATE`, `DELETE` oder `NOOP`. Alle Einträge stehen in jedem späteren Prompt, ohne Quelle. Chat löschen löscht den Verlauf, nicht die Einträge. Der Extraktor ist gehärtet: nur Aussagen der Person, Tool-Text ist keine Anweisung, Gesundheit nur auf Wunsch, Vergessen auf Bitte. Woher jede Regel stammt, steht in [prompts/v1/README.md](prompts/v1/README.md).
- **B: getrennte Stores.** Session (endet mit der Session), Profil (nur das Bibliothekssystem schreibt), Präferenzen (nur per `remember` mit wörtlichem Zitat aus einer Nutzer-Nachricht, von der Anwendung geprüft, mit Herkunft `{session, turn}`), Retrieval (Redaktion, versioniert) und Audit (append-only, nie im Prompt). Chat löschen löscht kaskadierend alles, was aus der Session stammt.

Beide sehen dieselben Tools und denselben Agent-Prompt, nur der Memory-Teil unterscheidet sich. Ein Test prüft das Byte für Byte.

## Demo

`site/` ist eine statische Seite ohne Build: Experiment (E1 oder E2, in E2 dazu die A-Variante), Szenario und Lauf wählen, die Zeitleiste durchklicken, A und B nebeneinander, darunter der Store-Inspektor mit allen Stores als Spalten. Jeder Eintrag zeigt, welcher Schritt ihn geschrieben hat, Treffer des Szenarios sind markiert. „Chat löschen“ führt die Löschlogik beider Architekturen im Browser auf dem aufgezeichneten Stand aus. Alle Gespräche sind aufgezeichnete Läufe der Messreihe, es gibt keinen Live-Modus. Die Seite braucht wegen `fetch` einen lokalen Server, alle Pfade sind relativ:

```sh
python3 -m http.server -d site 8000
```

`npm run report` kopiert `src/memory.mjs` nach `site/js/memory.js` und die Daten nach `site/data/`. Ein Test prüft, dass beides Byte für Byte übereinstimmt.

`scripts/check-site.cjs` spielt die Seite mit Playwright durch (hell, dunkel, Desktop, Mobil) und erzeugt mit `BLOG=<ordner>` die drei Abbildungen für den Post. Playwright ist bewusst keine Abhängigkeit, die Kopfzeile des Skripts sagt, wie es läuft.

## Aufbau

- `fixtures/`: Bücherei (Dokumente, Katalog) und die sechs Szenarien, alles erfunden
- `src/memory.mjs`: Stores, Schreibregeln und Löschpfade beider Architekturen, ohne Node-Importe
- `src/tools.mjs`, `src/agent.mjs`, `src/scenario.mjs`: Tools, Agent-Schleife und Extraktor, ein Lauf als Zeitleiste
- `src/checks.mjs`, `src/checks-e2.mjs`: deterministische Prüfungen, kein Judge
- `src/mem0.mjs`: Extraktor von A-mem0 (E2) mit den Original-Prompts von Mem0
- `fixtures/scenarios-e2.mjs`: Szenarien von E2
- `src/run.mjs`, `src/report.mjs`: Runner und Auswertung, `src/engine/` stammt aus [grader-lab](https://github.com/rubenvitt/grader-lab)
- `prompts/v1/`, `prompts/e2/`: eingefrorene Prompts und Regeln, siehe [v1](prompts/v1/README.md) und [e2](prompts/e2/README.md)
- `data/raw/series/`, `data/raw/e2/`: Rohantworten von E1 und E2, `data/raw/smoke/` nur Technik-Tests auf einem Toy-Szenario
- `data/results/`: `series.json` und `e2.json` (alle Läufe), `summary.json` (Kennzahlen), `demo.json` (Daten der Demo)

## Reproduzieren

Node 26, keine Laufzeit-Abhängigkeiten. Modellaufrufe laufen über die Codex-CLI und stecken hinter `callModel` in `src/engine/call-model.mjs`.

```sh
npm test
node src/run.mjs plan     # geplante Aufrufe gegen das Budget
node src/run.mjs series   # E1, fortsetzbar
node src/run.mjs plan-e2  # E2 gegen sein Budget
node src/run.mjs e2       # E2, fortsetzbar
npm run report            # alle Zahlen und die erzeugten Teile von docs/findings.md neu aus data/raw/ rechnen
```

`npm run report` macht keinen Modellaufruf und bricht ab, wenn eine Rohantwort fehlt. Läufe sind fortsetzbar: Jede Antwort liegt sofort unter `data/raw/series/`, ein erneuter Aufruf macht dort weiter. Exit-Code 2 heißt Teilstand, einfach wiederholen, 3 heißt Rate-Limit, 4 Budget erschöpft oder wiederholte Fehlschläge. Der Runner begrenzt auf 6 parallele Aufrufe und 800 (E1) bzw. 500 (E2) insgesamt und arbeitet Wiederholung für Wiederholung ab, damit ein Abbruch keine schiefen Zellen hinterlässt.

## Grenzen

- Synthetische Fixtures, fünf Läufe pro Zelle, kurze Verläufe mit zwei bis vier Sessions
- E2 ist nach Sicht der Ergebnisse von E1 entworfen. A-mem0 und A-v1 teilen sich pro Wiederholung identische Agent-Aufrufe (Cache-Schlüssel ohne Variante) und sind gepaart, nicht unabhängig
- A-mem0 nutzt die zweistufige Mem0-Pipeline aus dem Paper. Der aktuelle Standard von Mem0 ist ein additiver Aufruf ohne Löschen, er ist nicht gemessen
- Ein Modell mit Effort `low` für Agent und Extraktor, keine menschlichen Labels
- In E1 ist A bewusst günstig gebaut: Extraktion nach der ganzen Session (sieht die Löschbitte), gehärteter Prompt, alle Einträge statt Vektorsuche. E2 hebt das auf
- Prüfungen per Textregel. Zwei von 40 Urteilen weichen von der Handprüfung ab, die Abweichungen stehen in [docs/findings.md](docs/findings.md)
- Der Agent behauptet in 10 von 150 Turns, ein Tool sei nicht erreichbar, und verrauscht damit `stale` und `proxy` bei beiden Architekturen
- 3 von 393 Antworten in E1 und 1 von 339 in E2 haben ein Werkzeug der Codex-CLI benutzt: einmal die Websuche (vor einem Fix), sonst eine leere MCP-Ressourcenliste. Sie bleiben in der Auswertung, siehe [docs/run-log.md](docs/run-log.md)
- Fixtures, Architekturen, Prompts und Prüfungen stammen vom selben Coding Agent, der das Lab nach der Spezifikation gebaut hat

## Lizenz

Apache-2.0
