/** Kalendertag als Text `YYYY-MM-DD`, immer ein Tag in Europe/Vienna. */
export type Day = string;

const DAY_MS = 86_400_000;
const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

/** Die Monatsnamen, Januar zuerst (Index 0). Sie gehören zur Rechnung mit Tagen und stehen darum hier, nicht bei den Seiten. */
export const MONTHS: readonly string[] = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember',
];

const viennaDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Europe/Vienna',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Tagesrechnung immer auf UTC-Mitternacht des Tages: UTC kennt keine Zeitumstellung,
// ein Tag hat dort immer genau 24 Stunden.
function utcMidnight(d: Day): number {
  return Date.parse(`${d}T00:00:00Z`);
}

function dayFromUtc(ms: number): Day {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Wochentag mit Montag = 0 bis Sonntag = 6. */
function weekdayIndex(d: Day): number {
  return (new Date(utcMidnight(d)).getUTCDay() + 6) % 7;
}

const viennaHour = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Vienna',
  hour: '2-digit',
  hourCycle: 'h23',
});

/**
 * Die nächste volle Stunde als `HH:00`, nach der Uhr in Wien: Um 12:20 ist es `13:00`, um 12:00 genau auch, um 23:30
 * `00:00`. Gerechnet wird mit der Uhrzeit an der Wand und nicht mit Millisekunden, darum gibt es auch am Tag der
 * Zeitumstellung eine Uhrzeit, die in der Zeit davor oder danach liegt (zum Beispiel `02:00` um 01:30 am 28.03.2027). Das
 * ist nur ein Vorschlag für ein Eingabefeld.
 */
export function nextFullHour(now: Date = new Date()): string {
  const hour = Number(viennaHour.formatToParts(now).find((part) => part.type === 'hour')?.value ?? '0');
  return `${pad2((hour + 1) % 24)}:00`;
}

/** Heutiger Tag in Wiener Zeit, unabhängig von der Zeitzone des Geräts. */
export function todayVienna(now: Date = new Date()): Day {
  // Die Teile einzeln lesen (formatToParts) statt format(): so hängt das Ergebnis nicht vom Datumsmuster ab.
  const parts: Record<string, string> = {};
  for (const { type, value } of viennaDate.formatToParts(now)) parts[type] = value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDays(d: Day, n: number): Day {
  return dayFromUtc(utcMidnight(d) + n * DAY_MS);
}

/** Montag der Woche, in der `d` liegt. */
export function mondayOf(d: Day): Day {
  return addDays(d, -weekdayIndex(d));
}

/** ISO-8601-Woche, zum Beispiel `2026-W44`. Das Jahr ist das ISO-Jahr. */
export function isoWeekKey(d: Day): string {
  // Der Donnerstag einer Woche liegt immer im ISO-Jahr dieser Woche.
  const thursday = addDays(mondayOf(d), 3);
  const year = thursday.slice(0, 4);
  const daysSinceNewYear = (utcMidnight(thursday) - utcMidnight(`${year}-01-01`)) / DAY_MS;
  return `${year}-W${pad2(Math.floor(daysSinceNewYear / 7) + 1)}`;
}

/** Die sieben Tage einer Woche, Montag bis Sonntag. */
export function weekDays(weekKey: string): Day[] {
  const [year, week] = weekKey.split('-W');
  // Der 4. Januar liegt immer in Woche 1.
  const monday = addDays(mondayOf(`${year}-01-04`), (Number(week) - 1) * 7);
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** Monat als `YYYY-MM`, zum Beispiel `2026-10`. */
export function monthKey(d: Day): string {
  return d.slice(0, 7);
}

/** Monatsraster mit 6 Zeilen zu 7 Tagen, Montag zuerst. Enthält Tage der Nachbarmonate. */
export function monthGrid(month: string): Day[][] {
  const start = mondayOf(`${month}-01`);
  return Array.from({ length: 6 }, (_, row) =>
    Array.from({ length: 7 }, (_, col) => addDays(start, row * 7 + col)),
  );
}

/** Zum Beispiel `Do 29.10.2026`. */
export function formatDayLong(d: Day): string {
  return `${WEEKDAY_NAMES[weekdayIndex(d)]} ${d.slice(8, 10)}.${d.slice(5, 7)}.${d.slice(0, 4)}`;
}

/**
 * `true`, wenn `d` genau die Form `YYYY-MM-DD` hat und es diesen Tag im Kalender gibt
 * (`2026-02-30` und `2026-13-45` gibt es nicht).
 */
export function isValidDay(d: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  // Zurückrechnen statt Date.parse: Der Tag gilt, wenn er unverändert wieder herauskommt. Mit
  // setUTCFullYear, weil Date.UTC aus den Jahren 0 bis 99 die Jahre 1900 bis 1999 macht.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}
