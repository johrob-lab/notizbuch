import { useEffect, useState } from 'preact/hooks';
import type { Day } from '../lib/dates';
import { dailyNotePath } from '../lib/filenames';
import { parsePrioritaeten, type Prioritaet } from '../lib/prioritaeten';
import { normalizePath } from '../sync/paths';
import type { SyncEngine } from '../sync/engine';

/**
 * Die Prioritäten der Tage `days` aus ihren Tagesnotizen, solange die Seite offen ist. Fehlt eine Notiz oder lässt sie sich
 * nicht lesen, hat dieser Tag keine: Die anderen Tage und die Seite laden trotzdem. Ändert ein anderes Gerät eine der Notizen
 * (zum Beispiel die Abendroutine), kommt die neue Liste dieses Tages von selbst. `days` bleibt dasselbe Array, solange sich die
 * Tage nicht ändern (`useMemo`), sonst würde bei jedem Zeichnen neu gelesen.
 */
export function usePrioritaeten(engine: SyncEngine, days: Day[]): Map<Day, Prioritaet[]> {
  const [prioritaeten, setPrioritaeten] = useState<Map<Day, Prioritaet[]>>(() => new Map());

  useEffect(() => {
    let current = true;
    // Zählt die Anfragen je Tag: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    const latest = new Map<Day, number>();
    const load = (day: Day) => {
      const mine = (latest.get(day) ?? 0) + 1;
      latest.set(day, mine);
      void engine
        .read(dailyNotePath(day))
        .then((text) => (text === null ? [] : parsePrioritaeten(text)))
        .catch((): Prioritaet[] => [])
        .then((list) => {
          if (current && mine === latest.get(day)) setPrioritaeten((before) => new Map(before).set(day, list));
        });
    };
    for (const day of days) load(day);
    const stop = engine.addRemoteChangeListener((paths) => {
      const changed = new Set(paths.map(normalizePath));
      for (const day of days) if (changed.has(dailyNotePath(day))) load(day);
    });
    return () => {
      current = false;
      stop();
    };
  }, [engine, days]);

  return prioritaeten;
}
