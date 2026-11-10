import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizePath } from '../sync/paths';
import type { SyncEngine } from '../sync/engine';
import { askingFor, lastAnswer, listFrom } from './lastAnswers';

/**
 * Die Einträge einer Datei des Vaults (zum Beispiel `Termine.md`), solange die Seite offen ist. `parse` macht aus dem Text die
 * Liste. Fehlt die Datei, lässt sie sich nicht lesen oder ist sie kaputt, ist die Liste leer: Die Seite lädt trotzdem. Ändert
 * ein anderes Gerät die Datei, kommt die neue Liste von selbst. Wirft `parse`, zählt das wie eine kaputte Datei: Die Liste ist
 * leer. `parse` darf bei jedem Zeichnen neu entstehen (zum Beispiel als Pfeilfunktion im Aufruf): Eine neue Funktion gilt ab
 * dem nächsten Lesen, sie löst kein Lesen aus. `path` darf in jeder Unicode-Form kommen (auch mit zerlegten Umlauten): Gelesen,
 * verglichen und gemeldet wird mit der NFC-Form.
 *
 * Bis die eigene Anfrage antwortet, gilt die letzte Antwort, die die Engine für diese Datei gab, auch einer Seite davor (siehe
 * `lastAnswers.ts`). Ohne frühere Antwort beginnt die Liste leer.
 */
export function useVaultList<T>(engine: SyncEngine, path: string, parse: (text: string) => T[]): T[] {
  const [list, setList] = useState<T[]>(() => listFrom(lastAnswer(engine, normalizePath(path)), parse));
  const parseRef = useRef(parse);
  parseRef.current = parse;

  useEffect(() => {
    const nfc = normalizePath(path);
    let current = true;
    // Zählt die Anfragen: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      const keep = askingFor(engine, nfc);
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
