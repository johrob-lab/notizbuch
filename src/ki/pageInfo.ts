import type { PageKind } from '../ink/types';
import { MONTHS, formatDayLong, formatDayShort, isValidDay, weekDays, type Day } from '../lib/dates';
import { pagesLabel, type DayEntry } from '../lib/dayMeetings';
import { parseSperrenKey, sperrenTitel, sperrenZeitraum } from '../lib/sperren';

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
    return `Sperrenkalender ${s.fachlinie}, ${sperrenZeitraum(s)}`;
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

/**
 * Die Angaben zu einem Tag: der Anfang seiner Tagesnotiz und die Karte „Besprechungen“. Ließ sich die Notiz nicht laden
 * (`unknown`), kommt sie, wenn es sie gibt, aus der Kopie des Vaults (`ausKopie`), sonst sagt der Text das.
 */
export function dayExtras(day: Day, look: { text: string | null; unknown: boolean }, entries: DayEntry[], ausKopie: string | null): string {
  let notePart: string;
  if (look.text !== null) notePart = `Tagesnotiz ${day}, Anfang:\n${look.text}\nTagesnotiz, Ende.`;
  else if (look.unknown) {
    notePart =
      ausKopie !== null
        ? `Tagesnotiz ${day} (aus der Kopie des Vaults), Anfang:\n${ausKopie}\nTagesnotiz, Ende.`
        : 'Die Tagesnotiz dieses Tages ließ sich gerade nicht laden.';
  } else notePart = 'Zu diesem Tag gibt es keine Tagesnotiz.';
  const cardPart =
    entries.length === 0
      ? 'Karte „Besprechungen“ dieses Tages: keine Termine.'
      : `Karte „Besprechungen“ dieses Tages:\n${entries.map((e) => `- ${entryText(e)}`).join('\n')}`;
  return `${notePart}\n\n${cardPart}`;
}
