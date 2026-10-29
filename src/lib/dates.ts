/** Kalendertag als Text `YYYY-MM-DD`, immer ein Tag in Europe/Vienna. */
export type Day = string;

const DAY_MS = 86_400_000;
const WEEKDAY_NAMES = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];

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
