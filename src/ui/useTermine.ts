import { useEffect, useState } from 'preact/hooks';
import { TERMINE_PATH } from '../lib/filenames';
import { parseTermine, type Termin } from '../lib/termine';
import { normalizePath } from '../sync/paths';
import type { SyncEngine } from '../sync/engine';

/**
 * Die Termine aus `Termine.md`, solange die Seite offen ist. Fehlt die Datei, lässt sie sich nicht lesen oder ist sie kaputt,
 * gibt es keine Termine: Die Seite lädt trotzdem. Ändert ein anderes Gerät die Datei, kommt die neue Liste von selbst.
 */
export function useTermine(engine: SyncEngine): Termin[] {
  const [termine, setTermine] = useState<Termin[]>([]);

  useEffect(() => {
    let current = true;
    // Zählt die Anfragen: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      engine.read(TERMINE_PATH).then(
        (text) => current && mine === latest && setTermine(text === null ? [] : parseTermine(text)),
        () => current && mine === latest && setTermine([]),
      );
    };
    load();
    const stop = engine.addRemoteChangeListener((paths) => {
      if (paths.some((path) => normalizePath(path) === TERMINE_PATH)) load();
    });
    return () => {
      current = false;
      stop();
    };
  }, [engine]);

  return termine;
}
