// The fictional Stadtbücherei Fennbrück. Everything here is invented: people, streets, authors, titles, places.
// Retrieval store: written by the editorial team, versioned, read-only for both architectures.

export const DOCS_VERSION = 'v1';

export const DOCS = [
  {
    id: 'ordnung-gebuehren',
    title: 'Benutzungsordnung § 7: Mahngebühren',
    text: 'Für jedes Medium, das nach Ablauf der Leihfrist nicht zurückgegeben ist, fallen 0,50 € pro Öffnungstag an, höchstens 10 € pro Medium. Mahngebühren erlassen dürfen nur Mitarbeitende der Bücherei im Dienst, etwa bei Krankheit oder einem Krankenhausaufenthalt. Offene Gebühren lassen sich an der Theke oder per Überweisung begleichen.',
  },
  {
    id: 'ordnung-bringdienst',
    title: 'Bringdienst',
    text: 'Der Bringdienst bringt Medien zu Leserinnen und Lesern, die die Bücherei wegen Alter, Krankheit oder Behinderung nicht selbst besuchen können. Voraussetzung ist ein eigener Leseausweis. Anmelden kann man sich an der Theke oder telefonisch, auch über Angehörige. Geliefert wird alle zwei Wochen dienstags an die im Bibliothekssystem hinterlegte Adresse.',
  },
  {
    id: 'ordnung-erinnerung',
    title: 'Erinnerungen an die Rückgabe',
    text: 'Die Bücherei erinnert drei Tage vor Ende der Leihfrist an die Rückgabe, per E-Mail oder per SMS, je nach Wunsch der Person. Den Wunsch nimmt das Team an der Theke oder der Auskunfts-Assistent entgegen.',
  },
  {
    id: 'ordnung-leihfrist',
    title: 'Benutzungsordnung § 5: Leihfristen',
    text: 'Bücher und Hörbücher leiht die Bücherei für vier Wochen aus, Zeitschriften und Filme für zwei Wochen. Eine Verlängerung ist zweimal möglich, wenn niemand das Medium vorgemerkt hat.',
  },
  {
    id: 'grossdruck',
    title: 'Großdruck, Hörbücher und Lesehilfen',
    text: 'Im ersten Obergeschoss stehen rund 800 Bücher in Großdruck, dazu Hörbücher und Leselupen zum Ausleihen. Neu in diesem Herbst sind zwölf Romane in Großdruck. Auf Wunsch legt das Team Großdruck-Titel zur Abholung zurück.',
  },
  {
    id: 'veranstaltungen-november',
    title: 'Veranstaltungen im November',
    text: 'Bilderbuchkino für Kinder ab vier Jahren jeden Mittwoch um 16 Uhr. Spieleabend für Erwachsene am 12. November um 19 Uhr. Repair-Café am 22. November von 10 bis 13 Uhr im Foyer.',
  },
  {
    id: 'oeffnungszeiten',
    title: 'Öffnungszeiten',
    text: 'Dienstag bis Freitag 10 bis 19 Uhr, Samstag 10 bis 14 Uhr. Montags geschlossen. Die Rückgabeklappe am Eingang ist rund um die Uhr geöffnet.',
  },
];

// Genre `krimi-skandinavien` is what the `implicit` check looks for.
export const CATALOG = [
  { id: 'k1', title: 'Das Eis von Tromsvik', author: 'Hanne Ødegaard', genres: ['krimi-skandinavien'], tags: ['krimi', 'skandinavisch', 'winter', 'serie'] },
  { id: 'k2', title: 'Nachtfähre nach Lysøya', author: 'Hanne Ødegaard', genres: ['krimi-skandinavien'], tags: ['krimi', 'skandinavisch', 'insel', 'serie'] },
  { id: 'k3', title: 'Die Toten vom Kaldfjord', author: 'Arvid Sæterlund', genres: ['krimi-skandinavien'], tags: ['krimi', 'skandinavisch', 'neu', 'fjord'] },
  { id: 'k4', title: 'Stille Schären', author: 'Ingrid Malmqvist', genres: ['krimi-skandinavien'], tags: ['krimi', 'skandinavisch', 'sommer', 'urlaub', 'neu'] },
  { id: 'k5', title: 'Schneeblind', author: 'Arvid Sæterlund', genres: ['krimi-skandinavien'], tags: ['krimi', 'skandinavisch', 'winter'] },
  { id: 'r1', title: 'Der Mörder vom Moorhof', author: 'Gesa Timmermann', genres: ['krimi-regional'], tags: ['krimi', 'heide', 'urlaub'] },
  { id: 'r2', title: 'Sommer am Möwendeich', author: 'Wiebke Carstensen', genres: ['roman'], tags: ['roman', 'sommer', 'urlaub', 'meer', 'neu'] },
  { id: 'r3', title: 'Strandkorbgeschichten', author: 'Jakob Elberfeld', genres: ['roman'], tags: ['erzählungen', 'urlaub', 'meer', 'leicht'] },
  { id: 'r4', title: 'Reiseführer Sonnenküste', author: 'Team Wanderlicht', genres: ['reise'], tags: ['reiseführer', 'urlaub', 'strand'] },
  { id: 'r5', title: 'Wandern in der Fennbrücker Heide', author: 'Ole Brakemeier', genres: ['reise'], tags: ['wandern', 'heide', 'ausflug'] },
  { id: 'r6', title: 'Kochen am Meer', author: 'Svea Dannhorst', genres: ['sachbuch'], tags: ['kochen', 'meer', 'sommer'] },
  { id: 'r7', title: 'Der Drachenpfad', author: 'Mirko Asmussen', genres: ['fantasy'], tags: ['fantasy', 'abenteuer', 'serie'] },
  { id: 'r8', title: 'Die Insel der Pinguine', author: 'Lotte Hagedorn', genres: ['kinderbuch'], tags: ['kinder', 'tiere', 'urlaub'] },
  { id: 'r9', title: 'Liebe auf Möwenoog', author: 'Wiebke Carstensen', genres: ['liebesroman'], tags: ['liebe', 'insel', 'urlaub', 'sommer'] },
];

export const NO_FEES = '0,00 €';
