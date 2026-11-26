import { useMemo, useRef } from 'preact/hooks';
import type { SyncEngine } from '../sync/engine';
import { listFrom } from './lastAnswers';
import { useVaultText } from './useVaultText';

/**
 * Die Einträge einer Datei des Vaults (zum Beispiel `Termine.md`), solange die Seite offen ist: der Text aus `useVaultText`, mit
 * `parse` zur Liste gemacht. Wann gelesen wird und womit die Liste beginnt (mit der letzten Antwort der Engine), steht dort. Leer
 * ist sie ohne Text (noch keine Antwort, keine Datei, nicht lesbar) und wenn `parse` wirft: Die Seite lädt trotzdem. Neu entsteht
 * sie nur mit neuem Text. `parse` darf bei jedem Zeichnen neu entstehen (zum Beispiel als Pfeilfunktion im Aufruf): Eine neue
 * Funktion löst weder Lesen noch Parsen aus, sie gilt ab dem nächsten neuen Text.
 */
export function useVaultList<T>(engine: SyncEngine, path: string, parse: (text: string) => T[]): T[] {
  const text = useVaultText(engine, path);
  const parseRef = useRef(parse);
  parseRef.current = parse;
  return useMemo(() => listFrom(typeof text === 'string' ? text : null, parseRef.current), [text]);
}
