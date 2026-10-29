import { isValidDay, type Day } from './dates';

/**
 * Ein Termin aus `Termine.md`. Alle Schlüssel sind immer da, fehlende Werte sind `undefined`:
 * `start` und `end` bei ganztägigen Terminen, `place` und `source`, wenn die Zeile sie leer lässt oder weglässt.
 */
export type Termin = {
  date: Day;
  /** Beginn als `HH:MM`. */
  start?: string;
  /** Ende als `HH:MM`. */
  end?: string;
  allDay: boolean;
  title: string;
  place?: string;
  /** Kalender, aus dem der Termin kommt, zum Beispiel `Outlook`. */
  source?: string;
};

// Uhrzeit von 00:00 bis 23:59, Stunde und Minute immer zweistellig.
const CLOCK = String.raw`(?:[01]\d|2[0-3]):[0-5]\d`;

// Eine Terminzeile, so wie das Morgenbriefing sie schreibt:
//   - 2026-10-29 08:00 bis 14:00 | Titel | Ort | Quelle
//   - 2026-10-30 ganztägig | Titel | Ort | Quelle
// Gruppen: 1 Tag, 2 Beginn, 3 Ende (2 und 3 fehlen bei ganztägig), 4 Titel, 5 Ort, 6 Quelle (5 und 6 dürfen
// fehlen). Ein Teil enthält keinen senkrechten Strich, eine Zeile mit mehr als vier Teilen passt also nicht.
// Ob es den Tag im Kalender gibt, prüft `isValidDay`, nicht der Ausdruck.
const TERMIN_LINE = new RegExp(
  String.raw`^- (\d{4}-\d{2}-\d{2}) (?:(${CLOCK}) bis (${CLOCK})|ganztägig)\s*\|([^|]*)(?:\|([^|]*))?(?:\|([^|]*))?$`,
);

/** Teil ohne Leerraum an den Enden. Ein fehlender oder leerer Teil ist `undefined`. */
function clean(part: string | undefined): string | undefined {
  return part?.trim() || undefined;
}

/**
 * Liest die Termine aus dem Text von `Termine.md`, in der Reihenfolge der Datei. Alles, was keine gültige
 * Terminzeile ist, wird still übersprungen: Überschriften, Leerzeilen, falsche Formate, Tage, die es nicht
 * gibt, Uhrzeiten außerhalb von 00:00 bis 23:59 und Zeilen ohne Titel.
 */
export function parseTermine(md: string): Termin[] {
  const termine: Termin[] = [];
  for (const line of md.split(/\r?\n/)) {
    const match = TERMIN_LINE.exec(line);
    if (!match) continue;
    // Gruppen, die nicht mitgespielt haben, sind undefined (auch wenn der Typ von match das nicht zeigt).
    const [, date, start, end, title, place, source] = match;
    const name = clean(title);
    if (!isValidDay(date) || name === undefined) continue;
    termine.push({ date, start, end, allDay: start === undefined, title: name, place: clean(place), source: clean(source) });
  }
  return termine;
}

// `HH:MM` ist immer fünf Zeichen lang, darum genügt der Textvergleich.
function compareInDay(a: Termin, b: Termin): number {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const startA = a.start ?? '';
  const startB = b.start ?? '';
  if (startA === startB) return 0;
  return startA < startB ? -1 : 1;
}

/**
 * Die Termine eines Tages: ganztägige zuerst, dann nach Beginn. Bei gleichem Schlüssel bleibt die Reihenfolge
 * der Liste (`sort` ist seit ES2019 stabil). Die übergebene Liste bleibt unverändert, `filter` macht eine Kopie.
 */
export function termineAm(list: Termin[], d: Day): Termin[] {
  return list.filter((t) => t.date === d).sort(compareInDay);
}
