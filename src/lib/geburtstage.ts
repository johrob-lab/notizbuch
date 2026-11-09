import { isValidDay, type Day } from './dates';

/**
 * Ein Eintrag aus `Geburtstage.md`. `source` fehlt, wenn die Zeile den Teil leer lässt oder weglässt.
 */
export type Geburtstag = {
  date: Day;
  name: string;
  art: 'Geburtstag' | 'Jahrestag';
  /** Kalender, aus dem der Eintrag kommt, zum Beispiel `Google`. */
  source?: string;
};

// Eine Zeile, so wie das Morgenbriefing sie schreibt:
//   - 2026-11-15 | Name | Geburtstag | Quelle
// Gruppen: 1 Tag, 2 Name, 3 Art, 4 Quelle (3 und 4 dürfen fehlen). Ein Teil enthält keinen senkrechten Strich,
// eine Zeile mit mehr als vier Teilen passt also nicht. Ob es den Tag im Kalender gibt, prüft `isValidDay`.
const GEBURTSTAG_LINE = /^- (\d{4}-\d{2}-\d{2})\s*\|([^|]*)(?:\|([^|]*))?(?:\|([^|]*))?$/;

/** Teil ohne Leerraum an den Enden. Ein fehlender oder leerer Teil ist `undefined`. */
function clean(part: string | undefined): string | undefined {
  return part?.trim() || undefined;
}

/**
 * Liest die Geburtstage und Jahrestage aus dem Text von `Geburtstage.md`, in der Reihenfolge der Datei. Alles, was
 * keine gültige Zeile ist, wird still übersprungen: Überschriften, Leerzeilen, falsche Formate, Tage, die es nicht
 * gibt, und Zeilen ohne Namen. Die Art ist `Jahrestag`, wenn die Zeile es so sagt (Groß- und Kleinschreibung egal),
 * sonst `Geburtstag`. Dieselbe Person am selben Tag zählt einmal, die erste Zeile gewinnt. Ein Byte Order Mark am
 * Anfang der Datei und CRLF stören nicht, und jede Zeile wird in die NFC-Form gebracht, damit zerlegte Umlaute
 * gleich gelten.
 */
export function parseGeburtstage(md: string): Geburtstag[] {
  const liste: Geburtstag[] = [];
  const gesehen = new Set<string>();
  for (const raw of (md.charCodeAt(0) === 0xfeff ? md.slice(1) : md).split(/\r?\n/)) {
    const match = GEBURTSTAG_LINE.exec(raw.normalize('NFC'));
    if (!match) continue;
    // Gruppen, die nicht mitgespielt haben, sind undefined (auch wenn der Typ von match das nicht zeigt).
    const [, date, rawName, rawArt, rawSource] = match;
    const name = clean(rawName);
    if (!isValidDay(date) || name === undefined) continue;
    const key = `${date} ${name.toLowerCase().replace(/\s+/g, ' ')}`;
    if (gesehen.has(key)) continue;
    gesehen.add(key);
    const art = clean(rawArt)?.toLowerCase() === 'jahrestag' ? 'Jahrestag' : 'Geburtstag';
    liste.push({ date, name, art, source: clean(rawSource) });
  }
  return liste;
}

/** Die Einträge eines Tages in der Reihenfolge der Liste. Die übergebene Liste bleibt unverändert. */
export function geburtstageAm(list: Geburtstag[], d: Day): Geburtstag[] {
  return list.filter((g) => g.date === d);
}
