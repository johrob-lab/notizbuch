import { appendErgaenzung, editItemText, isItemLine, newDailyNote, parseItem, splitMarkers, toggleTask } from './dailyNote';
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

/** Ein Wort im Marker mit Namen und Wert, zum Beispiel `todo:AAMkTEST2` oder `ob:k3x9`. Ohne Wert (`todo:`) oder ohne Namen ist es keins. */
const ID_WORD = /^[A-Za-z][\w-]*:\S+$/;

/**
 * Die Kennungen einer Zeile: die Wörter ihrer Marker mit Namen und Wert (`todo:AAMkTEST2`, `ob:k3x9`). Sie bleiben, wenn sich
 * Text, Haken oder ein anderes Wort im Marker ändert (zum Beispiel `gemeldet`), und sagen darum, welche Zeile gemeint ist.
 * Wörter ohne Wert sind Merkmale und keine Kennung.
 */
export function idsOf(line: string): string[] {
  const content = line.endsWith('\r') ? line.slice(0, -1) : line;
  return splitMarkers(content).markers.flatMap((marker) => marker.replace(/^%%|%%$/g, '').split(/\s+/).filter((word) => ID_WORD.test(word)));
}

/**
 * Wo steht die Zeile, die man bearbeitet, jetzt, und wie lautet sie dort? Genau so, wie man sie gesehen hat: wie `findLine`.
 * Hat sie sich geändert, hilft ihre Kennung: Die Zeile, die eine ihrer Kennungen trägt und ein Listenpunkt ist, ist sie. Das
 * ist die an der gesehenen Stelle, sonst die einzige. `null`, wenn sie fehlt, keine Kennung hat und sich geändert hat, oder
 * wenn die Kennung mehrfach vorkommt und keine an ihrem Platz steht: Dann lässt sich nicht sagen, welche gemeint war.
 */
export function relocate(md: string | null, expected: string, hint: number): { line: number; source: string } | null {
  if (md === null) return null;
  const exact = findLine(md, expected, hint);
  if (exact !== null) return { line: exact, source: expected };
  const ids = idsOf(expected);
  if (ids.length === 0) return null;
  const lines = md.split('\n');
  const carries = (line: string | undefined): line is string => line !== undefined && isItemLine(line) && idsOf(line).some((id) => ids.includes(id));
  const here = lines[hint];
  if (carries(here)) return { line: hint, source: here };
  const found = lines.flatMap((line, index) => (carries(line) ? [index] : []));
  return found.length === 1 ? { line: found[0], source: lines[found[0]] } : null;
}
