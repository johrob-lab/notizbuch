import { excelStandPath } from '../lib/filenames';
import type { Fachlinie } from '../lib/sperren';
import { NICHT_LESBAR, pruefeExcelDatei, uebernommenText, ZU_GROSS } from '../lib/sperrenExcel';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';
import { announceNoteWrite } from './noteQueue';
import { FAILED } from './texts';

/** Mehr als das nimmt die App nicht als Excel-Stand. */
const MAX_BYTES = 1_000_000;

/**
 * Nimmt die Datei, die jemand für den Excel-Stand gewählt hat, prüft sie und schreibt sie unverändert in den Vault (die Engine
 * lädt sie hoch). Gibt die Meldung für den Kopf zurück, auch bei einem Fehler. Wirft nie.
 */
export async function excelStandHolen(
  file: Pick<File, 'name' | 'size' | 'arrayBuffer'>,
  o: { engine: Pick<SyncEngine, 'lookupFresh' | 'write'>; fachlinie: Fachlinie; jahr: number },
): Promise<string> {
  try {
    if (file.size > MAX_BYTES) return ZU_GROSS;
    let text: string;
    try {
      // Das BOM bleibt im Text (`ignoreBOM`), damit die Bytes beim Schreiben gleich bleiben.
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer());
    } catch {
      return NICHT_LESBAR;
    }
    const lesung = pruefeExcelDatei(text, file.name, o);
    if (!lesung.ok) return lesung.fehler;
    const pfad = excelStandPath(o.fachlinie, o.jahr);
    await o.engine.lookupFresh(pfad);
    await o.engine.write(pfad, text, 'md');
    announceNoteWrite(o.engine, normalizePath(pfad));
    return uebernommenText(lesung.stand);
  } catch {
    return FAILED;
  }
}
