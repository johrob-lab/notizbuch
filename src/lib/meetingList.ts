import { PAGES_DIR } from './filenames';
import { MONTHS, formatDayShort, isValidDay, monthKey, type Day } from './dates';
import type { MeetingRef } from './dayMeetings';
import { MEETING_PAGE, parseMeetingBase } from './meetings';

// Die Liste aller Besprechungen, neueste zuerst: aus Dateipfaden werden Besprechungen, aus diesen Monate mit Einträgen.
// Reine Rechnung ohne DOM und ohne Netz.

const YEAR_FOLDER = /^\d{4}$/;

/** Ein Eintrag der Liste: Name ohne Seitennummer, Tag, Uhrzeit (`HH:MM`), Thema und die Seiten aufsteigend. */
export type MeetingListEntry = { base: string; datum: Day; zeit: string; thema: string; pages: number[] };

/** Ein Monat der Liste: `month` ist `JJJJ-MM`, `title` zum Beispiel `November 2026`. */
export type MeetingMonth = { month: string; title: string; entries: MeetingListEntry[] };

/**
 * Die Besprechungen aus Dateipfaden: nur Seiten direkt in einem Jahresordner von `07 Anhänge/Notizbuch`, mit gültigem Tag.
 * Je Besprechung die Seiten aufsteigend, die Besprechungen nach Namen sortiert. Alles andere bleibt außen vor.
 */
export function meetingsInPaths(paths: string[]): MeetingRef[] {
  const prefix = `${PAGES_DIR}/`;
  const found = new Map<string, Set<number>>();
  for (const path of paths) {
    const nfc = path.normalize('NFC');
    if (!nfc.startsWith(prefix)) continue;
    const parts = nfc.slice(prefix.length).split('/');
    if (parts.length !== 2 || !YEAR_FOLDER.test(parts[0])) continue;
    const g = MEETING_PAGE.exec(parts[1])?.groups;
    if (!g || !isValidDay(g.datum)) continue;
    const page = Number(g.seite);
    if (!Number.isSafeInteger(page)) continue;
    const base = `${g.datum} ${g.zeit} ${g.thema}`;
    const set = found.get(base) ?? new Set<number>();
    set.add(page);
    found.set(base, set);
  }
  return [...found]
    .map(([base, set]) => ({ base, pages: [...set].sort((a, b) => a - b) }))
    .sort((a, b) => a.base.localeCompare(b.base, 'de'));
}

/** Neueste zuerst: Tag absteigend, Uhrzeit absteigend, bei gleicher Uhrzeit das Thema aufsteigend. */
function newestFirst(a: MeetingListEntry, b: MeetingListEntry): number {
  return b.datum.localeCompare(a.datum) || b.zeit.localeCompare(a.zeit) || a.thema.localeCompare(b.thema, 'de');
}

/** Die Besprechungen als Monate, neueste zuerst. Namen, die die App nicht versteht, fallen weg. */
export function meetingMonths(meetings: MeetingRef[]): MeetingMonth[] {
  const entries: MeetingListEntry[] = [];
  for (const meeting of meetings) {
    const info = parseMeetingBase(meeting.base);
    if (info) entries.push({ base: meeting.base, ...info, pages: meeting.pages });
  }
  entries.sort(newestFirst);
  const months: MeetingMonth[] = [];
  for (const entry of entries) {
    const month = monthKey(entry.datum);
    let current = months[months.length - 1];
    if (!current || current.month !== month) {
      current = { month, title: `${MONTHS[Number(month.slice(5, 7)) - 1]} ${month.slice(0, 4)}`, entries: [] };
      months.push(current);
    }
    current.entries.push(entry);
  }
  return months;
}

/** `Di 17.11. · 09:00 · Thema`, ab 2 Seiten mit ` · 2 Seiten` (die Anzahl, nicht die Nummern). */
export function meetingLabel(e: MeetingListEntry): string {
  const label = `${formatDayShort(e.datum)} · ${e.zeit} · ${e.thema}`;
  return e.pages.length >= 2 ? `${label} · ${e.pages.length} Seiten` : label;
}
