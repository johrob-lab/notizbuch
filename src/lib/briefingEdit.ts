import { appendErgaenzung, editItemText, isItemLine, newDailyNote, parseItem, splitMarkers, toggleTask } from './dailyNote';
import type { Day } from './dates';

// Was die Karte „Morgenbriefing“ an der Tagesnotiz ändert. Jede Änderung geht vom neuesten Text der Notiz aus (nicht von dem,
// was die Karte zeigt) und trifft nur die Zeile, die man angetippt hat. Stimmt diese Zeile an ihrer Stelle nicht mehr genau
// mit der überein, die man gesehen hat, wird nichts geschrieben: Die Notiz wurde inzwischen woanders geändert, und ein Tipp
// auf eine andere Zeile wäre ein Fehler, der nicht auffällt. Ausnahme ist die Betra-Nr.: Sie findet ihre Erinnerung an der
// Kennung der Sperre wieder (`setBetraLine`). Reine Rechnung ohne DOM und ohne Netz.

/** Der Hinweis, wenn eine Änderung nicht mehr passt, weil sich die Zeile geändert hat. */
export const STALE_NOTICE = 'Die Zeile hat sich geändert, bitte noch einmal.';

/** Der Hinweis, wenn im Feld einer Erinnerung „Betra anmelden“ keine Betra-Nr. steht. */
export const BETRA_FALSCH = 'Bitte nur die Betra-Nr. eintragen, 5 bis 8 Ziffern.';

/** Eine Betra-Nr.: nur Ziffern, 5 bis 8 Stellen. */
const BETRA_NR = /^\d{5,8}$/;

/** Die Betra-Nr. aus dem, was im Feld steht: Leerzeichen am Rand zählen nicht. `null`, wenn es keine ist. */
export function betraNummer(eingabe: string): string | null {
  const nummer = eingabe.trim();
  return BETRA_NR.test(nummer) ? nummer : null;
}

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

/** Ein Punkt für „Ergänzungen“: sein Text, und ob er ein Kästchen bekommt. */
export type NoteItem = { text: string; asTask: boolean };

/**
 * Hängt mehrere Punkte der Reihe nach an „Ergänzungen“ an (wie `addToNote` je Punkt). Gibt es für den Tag noch keine Notiz, beginnt
 * eine neue. `null`, wenn sich nichts ändert (keine Punkte oder nur Punkte ohne sichtbaren Text): Dann entsteht auch keine Notiz.
 */
export function addItemsToNote(latest: string | null, day: Day, items: NoteItem[]): string | null {
  const base = latest ?? newDailyNote(day);
  const next = items.reduce((md, item) => appendErgaenzung(md, item.text, item.asTask), base);
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

// ---------- Die Betra-Nr. an einer Erinnerung „Betra anmelden“ ----------
//
// Das Morgenbriefing schreibt die Erinnerungen mit einem Marker wie `%%sperre:IB-2027-03-01-1 rot%%`. Die Betra-Nr. kommt als
// Wort `betra:<Nummer>` in denselben Marker, sonst ändert sich an der Zeile nichts.

/** Ist `word` das Markerwort `name:wert` mit einem Wert? */
const isWord = (word: string, name: string): boolean => word.startsWith(`${name}:`) && word.length > name.length + 1;

/** Der Wert des ersten Markerworts `name:wert` der Zeile, `null` ohne eines. Text außerhalb der Marker zählt nicht. */
function markerValue(line: string, name: string): string | null {
  const content = line.endsWith('\r') ? line.slice(0, -1) : line;
  for (const marker of splitMarkers(content).markers) {
    const word = marker
      .replace(/^%%|%%$/g, '')
      .split(/\s+/)
      .find((w) => isWord(w, name));
    if (word !== undefined) return word.slice(name.length + 1);
  }
  return null;
}

/** Die Kennung der Sperre, an die die Zeile erinnert (`sperre:` in ihren Markern), oder `null`. */
export function sperreOf(line: string): string | null {
  return markerValue(line, 'sperre');
}

/** Die Betra-Nr., die an der Zeile eingetragen ist (`betra:` in ihren Markern), oder `null`. */
export function betraOf(line: string): string | null {
  return markerValue(line, 'betra');
}

/**
 * Ändert den ersten Marker der Zeile (ohne Zeilenende), für dessen Inhalt zwischen den `%%` `change` etwas liefert. Die Marker
 * sind dieselben wie bei `splitMarkers`, auch ein offener bis zum Zeilenende. `null`, wenn `change` für keinen etwas liefert.
 */
function changeMarker(content: string, change: (inner: string) => string | null): string | null {
  for (let pos = 0; ; ) {
    const open = content.indexOf('%%', pos);
    if (open < 0) return null;
    const close = content.indexOf('%%', open + 2);
    const end = close < 0 ? content.length : close;
    const next = change(content.slice(open + 2, end));
    if (next !== null) return content.slice(0, open + 2) + next + content.slice(end);
    if (close < 0) return null;
    pos = close + 2;
  }
}

/** Ein Wort `betra:…` im Inhalt eines Markers, mit dem Leerraum davor. */
const BETRA_WORD = /(^|\s)betra:\S*/;

/**
 * Die Zeile mit `betra:<nummer>`: Steht schon eine Betra-Nr. in einem Marker, ersetzt die neue sie dort. Sonst kommt sie ans Ende
 * des Markers mit `sperre:`, vor Leerraum, der dort steht. Alles andere bleibt Byte für Byte, auch das Zeilenende.
 */
function withBetra(line: string, nummer: string): string {
  const eol = line.endsWith('\r') ? '\r' : '';
  const content = line.slice(0, line.length - eol.length);
  const next =
    changeMarker(content, (inner) => (BETRA_WORD.test(inner) ? inner.replace(BETRA_WORD, `$1betra:${nummer}`) : null)) ??
    changeMarker(content, (inner) => {
      if (!inner.split(/\s+/).some((word) => isWord(word, 'sperre'))) return null;
      const body = inner.trimEnd();
      return `${body} betra:${nummer}${inner.slice(body.length)}`;
    });
  return (next ?? content) + eol;
}

/**
 * Trägt die Betra-Nr. `nummer` an der Erinnerung ein, die man in Zeile `line` als `shown` gesehen hat (siehe `withBetra`). Hat
 * sich die Zeile inzwischen geändert (das Morgenbriefing lief neu, die Stufe ist eine andere, die Zeile ist verrutscht), gilt
 * die Zeile, die `relocate` findet, aber nur mit derselben `sperre:`-Kennung. `ok: false` ohne Notiz, wenn `shown` keine
 * Erinnerung ist, die Erinnerung fehlt oder nicht eindeutig ist, oder wenn `nummer` keine Betra-Nr. ist (siehe `betraNummer`).
 */
export function setBetraLine(latest: string | null, line: number, shown: string, nummer: string): Change {
  const sperre = sperreOf(shown);
  if (sperre === null || !isItemLine(shown) || !BETRA_NR.test(nummer)) return NOTHING;
  const found = relocate(latest, shown, line);
  if (latest === null || found === null || sperreOf(found.source) !== sperre) return NOTHING;
  const lines = latest.split('\n');
  lines[found.line] = withBetra(found.source, nummer);
  return { ok: true, text: lines.join('\n') };
}
