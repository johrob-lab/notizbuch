import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizePath } from '../sync/paths';
import type { SyncEngine } from '../sync/engine';

/**
 * Die letzte Antwort der Engine je Datei (Pfad in NFC): ihr Text, `null` für eine Datei, die fehlt oder sich nicht lesen ließ.
 * `asked` zählt die Anfragen, `answered` ist die Nummer der Anfrage, deren Antwort `text` ist: Eine ältere, die später kommt,
 * ersetzt eine neuere nicht. Je Engine, damit ein anderes Repo mit seinen eigenen Dateien beginnt.
 */
type Remembered = { text: string | null; asked: number; answered: number };
const answers = new WeakMap<SyncEngine, Map<string, Remembered>>();

function remembered(engine: SyncEngine, nfc: string): Remembered {
  let files = answers.get(engine);
  if (!files) {
    files = new Map();
    answers.set(engine, files);
  }
  let entry = files.get(nfc);
  if (!entry) {
    entry = { text: null, asked: 0, answered: 0 };
    files.set(nfc, entry);
  }
  return entry;
}

/** Die Liste aus einem Text, leer ohne Text und wenn `parse` wirft (wie bei einer kaputten Datei). */
function listOf<T>(text: string | null, parse: (text: string) => T[]): T[] {
  if (text === null) return [];
  try {
    return parse(text);
  } catch {
    return [];
  }
}

/**
 * Die Einträge einer Datei des Vaults (zum Beispiel `Termine.md`), solange die Seite offen ist. `parse` macht aus dem Text die
 * Liste. Fehlt die Datei, lässt sie sich nicht lesen oder ist sie kaputt, ist die Liste leer: Die Seite lädt trotzdem. Ändert
 * ein anderes Gerät die Datei, kommt die neue Liste von selbst. Wirft `parse`, zählt das wie eine kaputte Datei: Die Liste ist
 * leer. `parse` darf bei jedem Zeichnen neu entstehen (zum Beispiel als Pfeilfunktion im Aufruf): Eine neue Funktion gilt ab
 * dem nächsten Lesen, sie löst kein Lesen aus. `path` darf in jeder Unicode-Form kommen (auch mit zerlegten Umlauten): Gelesen,
 * verglichen und gemeldet wird mit der NFC-Form.
 *
 * Bis die eigene Anfrage antwortet, gilt die letzte Antwort, die die Engine für diese Datei gab, auch einer Seite davor: Beim
 * Weiterscrollen zeigt die neue Seite so von Anfang an dieselben Termine und Geburtstage wie eben ihre Vorschau, statt sie bis
 * zum Lesen für einen Augenblick zu verlieren. Ohne frühere Antwort beginnt die Liste leer.
 */
export function useVaultList<T>(engine: SyncEngine, path: string, parse: (text: string) => T[]): T[] {
  const [list, setList] = useState<T[]>(() => listOf(remembered(engine, normalizePath(path)).text, parse));
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    const nfc = normalizePath(path);
    const memory = remembered(engine, nfc);
    let current = true;
    // Zählt die Anfragen: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      const ticket = ++memory.asked;
      const keep = (text: string | null) => {
        if (ticket < memory.answered) return;
        memory.answered = ticket;
        memory.text = text;
      };
      // Eine fehlgeschlagene Anfrage und ein `parse`, das wirft, enden beide im zweiten Schritt: leere Liste.
      engine
        .read(nfc)
        .then(
          (text) => {
            keep(text);
            return text === null ? [] : parseRef.current(text);
          },
          (error: unknown) => {
            keep(null);
            throw error;
          },
        )
        .then(
          (items) => current && mine === latest && setList(items),
          () => current && mine === latest && setList([]),
        );
    };
    load();
    const stop = engine.addRemoteChangeListener((paths) => {
      if (paths.some((changed) => normalizePath(changed) === nfc)) load();
    });
    return () => {
      current = false;
      stop();
    };
  }, [engine, path]);

  return list;
}
