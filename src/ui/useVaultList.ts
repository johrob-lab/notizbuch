import { useEffect, useState } from 'preact/hooks';
import { normalizePath } from '../sync/paths';
import type { SyncEngine } from '../sync/engine';

/**
 * Die Einträge einer Datei des Vaults (zum Beispiel `Termine.md`), solange die Seite offen ist. `parse` macht aus dem Text die
 * Liste. Fehlt die Datei, lässt sie sich nicht lesen oder ist sie kaputt, ist die Liste leer: Die Seite lädt trotzdem. Ändert
 * ein anderes Gerät die Datei, kommt die neue Liste von selbst. `parse` muss eine Funktion eines Moduls sein (wie
 * `parseTermine`), dann bleibt sie dieselbe. Eine Funktion, die bei jedem Zeichnen neu entsteht, ließe den Effekt bei jedem
 * Zeichnen neu laufen und die Datei neu lesen. `path` darf in jeder Unicode-Form kommen (auch mit zerlegten Umlauten): Verglichen
 * wird mit der NFC-Form.
 */
export function useVaultList<T>(engine: SyncEngine, path: string, parse: (text: string) => T[]): T[] {
  const [list, setList] = useState<T[]>([]);

  useEffect(() => {
    const nfc = normalizePath(path);
    let current = true;
    // Zählt die Anfragen: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      engine.read(path).then(
        (text) => current && mine === latest && setList(text === null ? [] : parse(text)),
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
  }, [engine, path, parse]);

  return list;
}
