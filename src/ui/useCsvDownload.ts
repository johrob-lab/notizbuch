import { useRef, useState } from 'preact/hooks';
import { ERNEUT_TIPPEN, OHNE_NETZ, standHinweis } from '../lib/tabelleCsv';
import { OfflineError, type ReadFile } from '../sync/github';
import { csvAusgeben } from './csvAusgabe';
import { FAILED } from './texts';

/** So lange gilt eine geladene CSV nach einem gescheiterten Teilen, danach lädt der nächste Tipp sie neu. */
const KEEP_CSV_MS = 60_000;

export type CsvDownload = {
  /** Die Datei im Repository (CSV und Zeilenspeicher), der Name der Ausgabe und die Seite, deren Stand der Speicher kennt. */
  csvPath: string;
  jsonPath: string;
  name: string;
  seite: number;
  /** Zeit des neuesten Strichs der offenen Seite. */
  neuester: number;
  /** Der Hinweis, wenn es die CSV (noch) nicht gibt. */
  keine: string;
};

// Die CSV holt die App von GitHub (die Abendroutine schreibt sie dort) und gibt sie unverändert aus: am Firmen-PC als Download,
// sonst über das Teilen-Blatt. Hat die Seite neuere Striche als die CSV, kommt die Datei trotzdem, mit einem Hinweis.
// Das Teilen braucht den Fingertipp noch frisch (iOS). Dauert das Laden zu lang, scheitert es mit `NotAllowedError`: Dann bleibt
// der geladene Text für den nächsten Tipp liegen, der ohne Warten teilt. Er gilt nur für diesen einen Tipp, nur auf dieser Seite
// und nur eine Minute lang (`KEEP_CSV_MS`, gemessen beim nächsten Tipp): Ein späterer Tipp lädt die CSV neu, denn die
// Abendroutine kann sie inzwischen neu geschrieben haben. Liegt die Zeit des Behaltens in der Zukunft (Uhr zurückgestellt),
// gilt der Text ebenfalls als verfallen.
export function useCsvDownload(o: { readFile: ReadFile; readOnly: boolean }): { hinweis: string; download(d: CsvDownload): Promise<void> } {
  const [hinweis, setHinweis] = useState('');
  const downloading = useRef(false);
  const loaded = useRef<{ csv: string; at: number } | null>(null);
  const download = async (d: CsvDownload) => {
    if (downloading.current) return;
    downloading.current = true;
    const kept = loaded.current;
    loaded.current = null;
    setHinweis('');
    try {
      const age = kept === null ? -1 : Date.now() - kept.at;
      const csv = kept !== null && age >= 0 && age < KEEP_CSV_MS ? kept.csv : await o.readFile(d.csvPath);
      if (csv === null) {
        setHinweis(d.keine);
        return;
      }
      try {
        await csvAusgeben(csv, d.name, o.readOnly ? 'laden' : 'teilen');
      } catch (error) {
        if (error instanceof DOMException && error.name === 'NotAllowedError') {
          loaded.current = { csv, at: Date.now() };
          setHinweis(ERNEUT_TIPPEN);
          return;
        }
        throw error;
      }
      // Der Zeilenspeicher kommt erst nach der Ausgabe. Ein fehlender oder unlesbarer ist kein Grund, die Datei zurückzuhalten.
      const store = await o.readFile(d.jsonPath).catch(() => null);
      setHinweis(standHinweis(store, d.seite, d.neuester) ?? '');
    } catch (error) {
      if (error instanceof OfflineError) setHinweis(OHNE_NETZ);
      else if (!(error instanceof DOMException && error.name === 'AbortError')) setHinweis(FAILED);
    } finally {
      downloading.current = false;
    }
  };
  return { hinweis, download };
}
