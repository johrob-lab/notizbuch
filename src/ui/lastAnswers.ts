import type { SyncEngine } from '../sync/engine';

// Die letzte Antwort der Engine je Datei, für die Haken, die beim Aufgehen einer Seite Dateien lesen (`useVaultList`,
// `usePrioritaeten`): Eine Seite, die neu aufgeht, beginnt damit statt leer, bis ihre eigene Anfrage antwortet. Beim Weiterscrollen
// zeigt die neue Seite so im ersten Bild dieselben Termine, Geburtstage und Prioritäten wie eben ihre Vorschau oder sie selbst
// davor, statt sie bis zum Lesen für einen Augenblick zu verlieren.

/**
 * Was die Engine für eine Datei zuletzt geliefert hat: ihr Text, `null` für eine Datei, die fehlt oder sich nicht lesen ließ.
 * `asked` zählt die Anfragen, `answered` ist die Nummer der Anfrage, deren Antwort `text` ist: Eine ältere, die später kommt,
 * ersetzt eine neuere nicht. Je Engine, damit ein anderes Repo mit seinen eigenen Dateien beginnt.
 */
type Remembered = { text: string | null; asked: number; answered: number };
const answers = new WeakMap<SyncEngine, Map<string, Remembered>>();

function remembered(engine: SyncEngine, path: string): Remembered {
  let files = answers.get(engine);
  if (!files) {
    files = new Map();
    answers.set(engine, files);
  }
  let entry = files.get(path);
  if (!entry) {
    entry = { text: null, asked: 0, answered: 0 };
    files.set(path, entry);
  }
  return entry;
}

/** Der Text der letzten Antwort für die Datei `path` (in NFC), `null` ohne Text, `undefined`, solange noch keine kam. */
export function lastAnswer(engine: SyncEngine, path: string): string | null | undefined {
  const entry = answers.get(engine)?.get(path);
  return entry && entry.answered > 0 ? entry.text : undefined;
}

/**
 * Eine neue Anfrage nach der Datei `path` (in NFC). Die Funktion, die zurückkommt, merkt sich ihre Antwort (`null` für keine
 * Datei oder einen Fehler), außer eine neuere Anfrage hat schon geantwortet.
 */
export function askingFor(engine: SyncEngine, path: string): (text: string | null) => void {
  const entry = remembered(engine, path);
  const ticket = ++entry.asked;
  return (text) => {
    if (ticket < entry.answered) return;
    entry.answered = ticket;
    entry.text = text;
  };
}

/** Die Liste aus einem Text: leer ohne Text und wenn `parse` wirft (wie bei einer kaputten Datei). */
export function listFrom<T>(text: string | null | undefined, parse: (text: string) => T[]): T[] {
  if (text === null || text === undefined) return [];
  try {
    return parse(text);
  } catch {
    return [];
  }
}
