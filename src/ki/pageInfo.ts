import type { PageKind } from '../ink/types';
import { MONTHS, formatDayLong, formatDayShort, isValidDay, weekDays, type Day } from '../lib/dates';
import { pagesLabel, type DayEntry } from '../lib/dayMeetings';
import { parseSperrenKey, quartalMonate, sperrenMonatsname, sperrenTitel } from '../lib/sperren';

// Was Claude über die offene Seite erfährt, als Text: der Kurzname für den Schalter, die Kopfzeile und die Angaben zu
// einem Tag. Reine Rechnung ohne DOM und ohne Netz.

// Wochenschlüssel `2026-W44`: die Zahl nach `W` ohne führende Null und das Jahr davor.
function weekNumber(key: string): number {
  return Number(key.split('-W')[1]);
}

function monthName(key: string): string {
  return `${MONTHS[Number(key.slice(5, 7)) - 1] ?? ''} ${key.slice(0, 4)}`;
}

/** Der kurze Name der Seite für den Schalter, zum Beispiel `Do 29.10.2026` oder `Abstimmung Beispiel 2027, Seite 2`. */
export function pageLabel(kind: PageKind, key: string, meta: Record<string, string>): string {
  if (kind === 'tag') return formatDayLong(key);
  if (kind === 'woche') return `KW ${weekNumber(key)} ${key.slice(0, 4)}`;
  if (kind === 'monat') return monthName(key);
  if (kind === 'sperren') return sperrenTitel(key);
  return `${meta.thema || 'Besprechung'}, Seite ${meta.seitennr || 1}`;
}

/** Die Kopfzeile der Seite für Claude: welche Art Seite es ist und was man über sie weiß. */
export function pageHeader(kind: PageKind, key: string, meta: Record<string, string>): string {
  if (kind === 'tag') return `Tagesseite ${formatDayLong(key)}`;
  if (kind === 'woche') {
    const days = weekDays(key);
    return `Wochenseite KW ${weekNumber(key)}, ${formatDayShort(days[0])} bis ${formatDayLong(days[6])}`;
  }
  if (kind === 'monat') return `Monatsseite ${monthName(key)}`;
  if (kind === 'sperren') {
    const s = parseSperrenKey(key);
    if (!s) return `Sperrenkalender ${key}`;
    const months = quartalMonate(s);
    const von = sperrenMonatsname(months[0]);
    const bis = sperrenMonatsname(months[2]);
    return `Sperrenkalender ${s.fachlinie}, ${s.quartal}. Quartal ${s.jahr} (${von} bis ${bis} ${s.jahr})`;
  }
  let text = 'Besprechung';
  if (meta.thema) text += ` „${meta.thema}“`;
  if (meta.datum && isValidDay(meta.datum)) text += ` am ${formatDayLong(meta.datum)}`;
  if (meta.zeit) text += ` um ${meta.zeit}`;
  text += `, Seite ${meta.seitennr || 1}`;
  if (meta.art === 'tabelle') text += ', Tabellenseite';
  if (meta.ort) text += `, Ort: ${meta.ort}`;
  if (meta.projekt) text += `, Projekt: ${meta.projekt}`;
  return text;
}

/** Der Tag, dessen Tagesnotiz zur Seite gehört: der Tag selbst, bei einer Besprechung ihr Datum, sonst `null`. */
export function noteDayOf(kind: PageKind, key: string, meta: Record<string, string>): Day | null {
  if (kind === 'tag') return key;
  if (kind === 'besprechung') return meta.datum && isValidDay(meta.datum) ? meta.datum : null;
  return null;
}

/** Eine Zeile der Karte „Besprechungen“, so wie die Karte sie zeigt, getrennt durch ` · `. */
export function entryText(e: DayEntry): string {
  if (e.kind === 'besprechung') return [e.zeit, e.thema, pagesLabel(e.meeting.pages.length)].join(' · ');
  const { termin, meeting } = e;
  const parts = [termin.allDay || termin.start === undefined ? 'ganztägig' : termin.start, termin.title];
  if (termin.place) parts.push(termin.place);
  if (meeting) parts.push(pagesLabel(meeting.pages.length));
  return parts.join(' · ');
}

/** Die Angaben zu einem Tag: der Anfang seiner Tagesnotiz und die Karte „Besprechungen“. */
export function dayExtras(day: Day, note: string | null, entries: DayEntry[]): string {
  const notePart = note === null ? 'Zu diesem Tag gibt es keine Tagesnotiz.' : `Tagesnotiz ${day}, Anfang:\n${note}\nTagesnotiz, Ende.`;
  const cardPart =
    entries.length === 0
      ? 'Karte „Besprechungen“ dieses Tages: keine Termine.'
      : `Karte „Besprechungen“ dieses Tages:\n${entries.map((e) => `- ${entryText(e)}`).join('\n')}`;
  return `${notePart}\n\n${cardPart}`;
}
