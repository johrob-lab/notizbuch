import { appendErgaenzung, editItemText, isItemLine, newDailyNote, parseItem, toggleTask } from './dailyNote';
import type { Day } from './dates';

// Was die Karte „Morgenbriefing“ an der Tagesnotiz ändert. Jede Änderung geht vom neuesten Text der Notiz aus (nicht von dem,
// was die Karte zeigt) und trifft nur die Zeile, die man angetippt hat. Stimmt diese Zeile an ihrer Stelle nicht mehr genau
// mit der überein, die man gesehen hat, wird nichts geschrieben: Die Notiz wurde inzwischen woanders geändert, und ein Tipp
// auf eine andere Zeile wäre ein Fehler, der nicht auffällt. Reine Rechnung ohne DOM und ohne Netz.

/** Der Hinweis, wenn eine Änderung nicht mehr passt, weil sich die Zeile geändert hat. */
export const STALE_NOTICE = 'Die Zeile hat sich geändert, bitte noch einmal.';

/** Der neue Text der Notiz, oder `ok: false`, wenn nichts geschrieben werden darf. */
export type Change = { ok: true; text: string } | { ok: false };

const NOTHING: Change = { ok: false };

/** Steht an der Stelle `line` des Textes genau die Zeile, die man gesehen hat? Mit Zeilenende, Byte für Byte. */
function sameLine(latest: string | null, line: number, shown: string): latest is string {
  return latest !== null && latest.split('\n')[line] === shown;
}

/** Setzt den Haken der Aufgabe in Zeile `line` oder nimmt ihn weg. Nur eine Zeile mit Kästchen, die noch so dasteht wie gesehen. */
export function tickLine(latest: string | null, line: number, shown: string): Change {
  if (!sameLine(latest, line, shown) || parseItem(shown)?.box === undefined) return NOTHING;
  return { ok: true, text: toggleTask(latest, line) };
}

/**
 * Ersetzt den sichtbaren Text des Listenpunkts in Zeile `line`. Kästchen und Marker bleiben, die Marker stehen danach am Ende
 * der Zeile (siehe `editItemText`). Nur ein Listenpunkt, der noch so dasteht wie gesehen.
 */
export function editLine(latest: string | null, line: number, shown: string, text: string): Change {
  if (!sameLine(latest, line, shown) || !isItemLine(shown)) return NOTHING;
  return { ok: true, text: editItemText(latest, line, text) };
}

/**
 * Hängt eine Ergänzung an die Notiz an (Abschnitt „Ergänzungen“, bei Bedarf neu angelegt). Gibt es für den Tag noch keine
 * Notiz (`latest` ist `null`), beginnt eine neue. `null`, wenn der Text nichts Sichtbares enthält: Dann ändert sich nichts,
 * und es entsteht auch keine Notiz.
 */
export function addToNote(latest: string | null, day: Day, text: string, asTask: boolean): string | null {
  const base = latest ?? newDailyNote(day);
  const next = appendErgaenzung(base, text, asTask);
  return next === base ? null : next;
}

/**
 * Wo steht die Zeile `expected` jetzt? An der Stelle `hint`, wenn sie dort noch steht, sonst an der einzigen Stelle, an der
 * es genau diese Zeile gibt. `null`, wenn sie fehlt, sich geändert hat oder mehrfach vorkommt: Dann lässt sich nicht sagen,
 * welche gemeint war.
 */
export function findLine(md: string | null, expected: string, hint: number): number | null {
  if (md === null) return null;
  const lines = md.split('\n');
  if (lines[hint] === expected) return hint;
  const found = lines.flatMap((line, index) => (line === expected ? [index] : []));
  return found.length === 1 ? found[0] : null;
}
