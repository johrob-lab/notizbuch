import { useEffect, useState } from 'preact/hooks';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';
import { askingFor, lastAnswer } from './lastAnswers';
import { onNoteWrite } from './noteQueue';

/** Die Antwort für eine Datei, die es gibt, die sich aber nicht lesen lässt (zum Beispiel Text, der kein UTF-8 ist). */
export const UNLESBAR = Symbol('unlesbar');

/**
 * Der Text einer Datei des Vaults (zum Beispiel des Excel-Stands der Sperren), solange die Seite offen ist: `undefined`, bis die
 * Engine geantwortet hat, `null`, wenn die Datei fehlt oder sich ohne Netz nicht holen lässt (keine Kopie auf dem Gerät),
 * `UNLESBAR`, wenn sie sich nicht lesen lässt. Ändert ein anderes Gerät die Datei, kommt der neue Text von selbst, ebenso nach
 * `announceNoteWrite` für sie (dieses Gerät hat sie geschrieben). `path` darf in jeder Unicode-Form kommen (auch mit zerlegten
 * Umlauten): Gelesen, verglichen und gemeldet wird mit der NFC-Form.
 *
 * Bis die eigene Anfrage antwortet, gilt die letzte Antwort, die die Engine für diese Datei gab, auch einer Seite davor (siehe
 * `lastAnswers.ts`). Für eine Datei, die sich nicht lesen ließ, merkt sich die Engine `null`. Antwortet eine frühere Anfrage erst
 * nach einer späteren, gilt die spätere.
 */
export function useVaultText(engine: SyncEngine, path: string): string | null | undefined | typeof UNLESBAR {
  const [text, setText] = useState<string | null | undefined | typeof UNLESBAR>(() => lastAnswer(engine, normalizePath(path)));

  useEffect(() => {
    const nfc = normalizePath(path);
    let current = true;
    // Zählt die Anfragen: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    let latest = 0;
    const load = () => {
      const mine = ++latest;
      const keep = askingFor(engine, nfc);
      engine.read(nfc).then(
        (answer) => {
          keep(answer);
          if (current && mine === latest) setText(answer);
        },
        () => {
          keep(null);
          if (current && mine === latest) setText(UNLESBAR);
        },
      );
    };
    load();
    const stop = engine.addRemoteChangeListener((paths) => {
      if (paths.some((changed) => normalizePath(changed) === nfc)) load();
    });
    const stopWrites = onNoteWrite(engine, (written) => {
      if (normalizePath(written) === nfc) load();
    });
    return () => {
      current = false;
      stop();
      stopWrites();
    };
  }, [engine, path]);

  return text;
}
