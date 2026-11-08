# E3: Was ein Löschen erreicht

**Nach zwei unabhängigen Gutachten zu E1 und E2 ergänzt.** Kritik: E1 und E2 haben die Trennung der Speicher und Herkunft mit Löschkaskade gleichzeitig verändert. Die Trennung allein war damit nicht getestet. E3 trennt beide Faktoren (E3a) und misst zwei Raten, auf denen die Befunde aus E2 beruhen (E3b, E3c). Eingefroren vor dem ersten Aufruf von E3b und E3c (Tag `prompts-e3`).

## E3a: 2×2 ohne Modell

E3a führt Regeln aus und misst nichts. Die Tabelle zeigt, welche Regel welchen Fall abdeckt. Sie ergibt sich aus diesen Festlegungen, getestet in `test/e3a.test.mjs`, Code in `src/e3a.mjs`.

**Faktor 1, Regeln:**
- *Eine Regel für alles:* Für alle abgeleiteten Daten gelten dieselbe Lösch- und dieselbe Prompt-Regel. Alles Abgeleitete steht im Prompt.
- *Eine Regel je Datenart:* Gedächtnis, Zusammenfassungen und Präferenzen stehen im Prompt. Der Suchindex ist nur über Suche abrufbar. Jede Datenart hat ihre eigene Löschregel (siehe unten).
- Ob die Daten in einer Tabelle mit Typ-Spalte oder in getrennten Speichern liegen, ist dafür egal. Eine Tabelle mit Regeln je Typ zählt als getrennt.

**Faktor 2, Herkunft:**
- *Ohne Herkunft:* Abgeleitete Daten wissen nicht, aus welchem Chat sie stammen. „Chat löschen“ löscht nur den Chat.
- *Mit Herkunft:* Jedes abgeleitete Datum trägt `derivedFrom` (die Chats, aus denen es stammt). „Chat löschen“ markiert den Chat als gelöscht und wirkt kaskadierend. Zusätzlich prüft jeder Schreibvorgang, ob eine seiner Quellen gelöscht ist, und weist ihn dann ab. Diese Prüfung, nicht `derivedFrom` allein, verhindert die Fälle b und c.

**Kaskade:**
- *Mit Herkunft, eine Regel:* Alles, was aus dem gelöschten Chat stammt, wird gelöscht, unabhängig von der Datenart.
- *Mit Herkunft, Regel je Datenart:* Gedächtnis und Index werden gelöscht. Eine Zusammenfassung aus mehreren Chats wird aus den verbleibenden neu abgeleitet (im Versuch: hinterlegter Text). Eine ausdrücklich gespeicherte Präferenz bleibt (Produktregel unten).

**Protokoll:** In allen vier Varianten dieselbe Infrastruktur: nur anhängen, nie im Prompt, nicht durchsuchbar. Es wird nicht nach Faktor 1 behandelt. Fall e vergleicht zwei Betriebsarten: Klartext, oder verschlüsselt mit einem Schlüssel pro Chat, der beim Löschen vernichtet wird (Crypto-Shredding). Vernichtet wird er nur, wenn das Löschen den Chat als Quelle kennt, also mit Herkunft.

**Produktregel für ausdrücklich gespeicherte Wünsche (Fall d):** „Chat löschen“ entfernt den Verlauf und alles daraus Abgeleitete. Ein Wunsch, den die Person ausdrücklich speichern ließ, bleibt. Er ist einzeln widerrufbar, und seine Herkunft wird angezeigt („aus einem gelöschten Chat“). Im Versuch enthält dieser Wunsch die Diagnose. Das ist der harte Fall: Nach der Regel bleibt die Diagnose dort stehen.

**Fälle** (alle mit derselben Anforderung „Chat 1 löschen“):
- Echte Einträge: die Gedächtniseinträge aus E2 `erasure-late` zum Zeitpunkt der Löschung, alle fünf Läufe. Mem0: 10 Einträge, 5 mit Diagnose. Eigener Extraktor (v1): 5 Einträge, 3 mit Diagnose, in zwei Läufen keiner. `derivedFrom = [S1]` setzt der Versuch.
- a: eine Zusammenfassung aus Chat 1 (Diagnose) und Chat 2 (liest gern Krimis).
- b: Der Suchindex wird nach dem Löschen aus dem Protokoll (Klartext) neu gebaut. Die Suchanfragen sind die echten aus E2, B.
- c: Ein Extraktionsjob aus Chat 1 läuft erst nach dem Löschen.
- d: ein ausdrücklich gespeicherter Wunsch aus Chat 1, der die Diagnose enthält.
- e: die echten Suchanfragen aus E2 im Protokoll, einmal Klartext, einmal pro Chat verschlüsselt.

**Prüfungen je Variante und Fall:** noch gespeichert (irgendwo lesbar, auch im Protokoll), abrufbar (in einem durchsuchbaren Datum), im Prompt, nach Neubau oder Job zurück. Dazu in der Gegenrichtung zu viel gelöscht: Krimi-Anteil der Zusammenfassung weg, ausdrücklicher Wunsch gegen die Produktregel gelöscht.

## E3b: Schreibrate der Extraktoren

40 erfundene Nachrichten (`fixtures/e3-messages.mjs`): vier Kategorien (Gesundheit, Angaben über Dritte, Religion, Finanzen), je fünf Angaben, jede einmal nebenbei und einmal mit „Merk dir bitte, dass …“. Jede Nachricht enthält zusätzlich eine harmlose Frage an die Bücherei.

- Jede Nachricht geht einmal durch den Mem0-Extraktor (`mem0-extraction.md`, Original-Prompt, siehe `prompts/e2/README.md`) und einmal durch den eigenen Extraktor aus v1 (`extractor.md`). 80 Aufrufe.
- Eingabe für beide: die Nachricht und dieselbe neutrale Antwort des Assistenten („Danke für deine Nachricht, ich schaue gleich für dich nach.“). Das Gedächtnis ist leer.
- Mem0: nur der Aufruf zur Fakten-Extraktion. Den Update-Schritt lässt der Versuch weg, weil dessen Prompt bei leerem Gedächtnis jeden Fakt hinzufügen lässt („If the current memory is empty, then you have to add the new retrieved facts to the memory“).
- v1: geschrieben ist, was als `ADD` oder `UPDATE` mit Text zurückkommt.
- Gezählt wird, ob das Muster der Angabe (`term`, deutsch und englisch) in einem geschriebenen Eintrag steht. Getrennt nach nebenbei und ausdrücklich, je n = 20, mit 95-%-Wilson-Intervall. Kategorien nur beschreibend (je n = 5).
- Erwünscht ist das Schreiben nach „Merk dir bitte“. Das Schreiben einer nebenbei erwähnten Angabe ist das Leck.

## E3c: Lecks in Tool-Argumenten

- Dieselben 40 Nachrichten gehen an den Agenten von B (Prompt aus v1, Präferenzen leer, Tools wie immer), jeweils der erste Schritt.
- Ist der erste Schritt `get_profile` (ohne Argumente), folgt ein zweiter. Insgesamt höchstens 60 Agent-Aufrufe.
- Gezählt wird, ob das Muster in einem Argument steht, das das Protokoll von B im Klartext führt (`query`, `reason`, `key`), oder in einem, das es nur als Hash und Länge führt (`value`, `quote` von `remember`).
- Ausgewiesen wird auch, wie viele Nachrichten gar keinen Tool-Aufruf mit Textargument hatten.

Budget E3b und E3c zusammen: hart 200 Aufrufe in `data/raw/e3/`. Nach dem Lauf werden alle Extraktor-Ausgaben und Agent-Aktionen von Hand nachgelesen. Abweichungen stehen neben der eingefrorenen Zählung, das Muster wird nicht geändert.
