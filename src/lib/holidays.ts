import { addDays, type Day } from './dates';

/** Ostersonntag nach Gauß/Meeus (gregorianischer Kalender). */
export function easterSunday(year: number): Day {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Die 13 gesetzlichen Feiertage in Österreich, je Tag ein Name.
 * Fällt Christi Himmelfahrt auf den 1. Mai (2008, wieder 2160), steht an dem Tag nur dieser Name
 * und die Karte hat 12 Einträge.
 */
export function holidaysAT(year: number): Map<Day, string> {
  const easter = easterSunday(year);
  return new Map<Day, string>([
    [`${year}-01-01`, 'Neujahr'],
    [`${year}-01-06`, 'Heilige Drei Könige'],
    [addDays(easter, 1), 'Ostermontag'],
    [`${year}-05-01`, 'Staatsfeiertag'],
    [addDays(easter, 39), 'Christi Himmelfahrt'],
    [addDays(easter, 50), 'Pfingstmontag'],
    [addDays(easter, 60), 'Fronleichnam'],
    [`${year}-08-15`, 'Mariä Himmelfahrt'],
    [`${year}-10-26`, 'Nationalfeiertag'],
    [`${year}-11-01`, 'Allerheiligen'],
    [`${year}-12-08`, 'Mariä Empfängnis'],
    [`${year}-12-25`, 'Christtag'],
    [`${year}-12-26`, 'Stefanitag'],
  ]);
}
