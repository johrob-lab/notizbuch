import { normalizePath } from '../sync/paths';
import type { Day } from './dates';
import { besprechungBase, sanitizeThema } from './filenames';
import { parseMeetingBase } from './meetings';
import { termineAm, type Termin } from './termine';

// Die Karte „Besprechungen“ auf der Tagesseite: Aus den Terminen eines Tages (`Termine.md`) und den Besprechungen, die es
// zu dem Tag schon gibt, wird eine Liste. Reine Rechnung ohne DOM und ohne Netz.

/** Eine Besprechung, die es gibt: ihr Name ohne Seitennummer (`2026-10-29 0800 Thema`) und ihre Seiten aufsteigend. */
export type MeetingRef = { base: string; pages: number[] };

/** Ein Eintrag der Karte: ein Termin (mit seiner Besprechung, wenn es sie schon gibt) oder eine Besprechung ohne Termin. */
export type DayEntry =
  | { kind: 'termin'; termin: Termin; meeting: MeetingRef | null }
  // `zeit` ist die Uhrzeit der Besprechung als `HH:MM`.
  | { kind: 'besprechung'; zeit: string; thema: string; meeting: MeetingRef };

/** Das Thema, das `createMeeting` aus dem Titel eines Termins macht: wie im Dateinamen, mit Umlauten als ein Zeichen. */
function topicOf(title: string): string {
  return sanitizeThema(title.trim().normalize('NFC')) || 'Besprechung';
}

/**
 * Die Einträge der Karte für den Tag `d`: erst die ganztägigen Termine, dann alles mit einer Uhrzeit nach der Uhrzeit,
 * Termine vor Besprechungen derselben Zeit.
 *
 * Eine Besprechung gehört zu einem Termin, wenn sie so heißt, wie die App sie für den Termin anlegen würde (dieselbe
 * Uhrzeit, dasselbe Thema). Bei einem ganztägigen Termin zählt nur das Thema: Seine Uhrzeit hat man beim Anlegen gewählt.
 * Eine Besprechung gehört zu höchstens einem Termin. Alle anderen Besprechungen des Tages stehen für sich.
 */
export function dayEntries(d: Day, termine: Termin[], meetings: MeetingRef[]): DayEntry[] {
  // Nur Besprechungen dieses Tages mit einem Namen, den die App versteht, nach Uhrzeit.
  const known: { meeting: MeetingRef; info: { datum: Day; zeit: string; thema: string } }[] = [];
  for (const meeting of meetings) {
    const info = parseMeetingBase(meeting.base.normalize('NFC'));
    if (info && info.datum === d) known.push({ meeting, info });
  }
  known.sort((a, b) => a.info.zeit.localeCompare(b.info.zeit) || a.meeting.base.localeCompare(b.meeting.base, 'de'));
  const taken = new Set<MeetingRef>();
  const meetingOf = new Map<Termin, MeetingRef>();

  const today = termineAm(termine, d);
  // Zuerst die Termine mit Uhrzeit: Sie finden ihre Besprechung am genauen Namen und nehmen sie keinem ganztägigen weg.
  for (const termin of today) {
    if (termin.allDay || termin.start === undefined) continue;
    const base = besprechungBase(d, termin.start, topicOf(termin.title));
    const found = known.find((candidate) => !taken.has(candidate.meeting) && candidate.meeting.base.normalize('NFC') === base);
    if (found) {
      taken.add(found.meeting);
      meetingOf.set(termin, found.meeting);
    }
  }
  for (const termin of today) {
    if (!termin.allDay) continue;
    const topic = topicOf(termin.title);
    const found = known.find((candidate) => !taken.has(candidate.meeting) && candidate.info.thema === topic);
    if (found) {
      taken.add(found.meeting);
      meetingOf.set(termin, found.meeting);
    }
  }

  const allDay: DayEntry[] = today.filter((termin) => termin.allDay).map((termin) => ({ kind: 'termin', termin, meeting: meetingOf.get(termin) ?? null }));
  const timed: { time: string; entry: DayEntry }[] = [
    ...today
      .filter((termin) => !termin.allDay)
      .map((termin): { time: string; entry: DayEntry } => ({ time: termin.start ?? '', entry: { kind: 'termin', termin, meeting: meetingOf.get(termin) ?? null } })),
    ...known
      .filter((candidate) => !taken.has(candidate.meeting))
      .map((candidate): { time: string; entry: DayEntry } => ({
        time: candidate.info.zeit,
        entry: { kind: 'besprechung', zeit: candidate.info.zeit, thema: candidate.info.thema, meeting: candidate.meeting },
      })),
  ];
  // `sort` ist stabil: Bei gleicher Uhrzeit bleiben die Termine vor den Besprechungen.
  timed.sort((a, b) => a.time.localeCompare(b.time));
  return [...allDay, ...timed.map((item) => item.entry)];
}

/**
 * Was `createMeeting` für einen Termin braucht: Tag, Uhrzeit, Thema (der Titel) und Ort. `null` bei einem ganztägigen
 * Termin: Er hat keine Uhrzeit, man muss sie erst wählen.
 */
export function meetingRequest(d: Day, termin: Termin): { datum: Day; zeit: string; thema: string; ort: string | undefined } | null {
  if (termin.allDay || termin.start === undefined) return null;
  return { datum: d, zeit: termin.start, thema: termin.title, ort: termin.place };
}

/**
 * Die Besprechungen eines Tages aus zwei Quellen: was GitHub listet (`listed`) und was dieses Gerät hat (`local`, auch
 * Seiten, die noch nicht hochgeladen sind). Seiten, deren Löschen noch auf den Abgleich wartet (`deleted`), zählen nicht
 * mehr: GitHub listet sie bis dahin weiter. Eine Besprechung ohne Seite fällt weg. Nach Namen sortiert.
 */
export function mergeMeetings(o: { listed: MeetingRef[]; local: MeetingRef[]; deleted: MeetingRef[] }): MeetingRef[] {
  const pages = new Map<string, Set<number>>();
  for (const meeting of [...o.listed, ...o.local]) {
    const base = meeting.base.normalize('NFC');
    const set = pages.get(base) ?? new Set<number>();
    for (const page of meeting.pages) set.add(page);
    pages.set(base, set);
  }
  for (const meeting of o.deleted) {
    const set = pages.get(meeting.base.normalize('NFC'));
    for (const page of meeting.pages) set?.delete(page);
  }
  return [...pages]
    .filter(([, set]) => set.size > 0)
    .map(([base, set]) => ({ base, pages: [...set].sort((a, b) => a - b) }))
    .sort((a, b) => a.base.localeCompare(b.base, 'de'));
}

/** Die Namen der Dateien, die direkt in diesem Ordner liegen (nicht in einem Unterordner darin). */
export function namesIn(folder: string, paths: string[]): string[] {
  const prefix = `${normalizePath(folder)}/`;
  return paths
    .map(normalizePath)
    .filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
    .map((path) => path.slice(prefix.length));
}
