import { expect, test } from 'vitest';
import { easterSunday, holidaysAT } from '../../src/lib/holidays';

test('holidays', () => {
  expect(easterSunday(2027)).toBe('2027-03-28');
  const h = holidaysAT(2027);
  expect(h.get('2027-03-29')).toBe('Ostermontag');
  expect(h.get('2027-05-06')).toBe('Christi Himmelfahrt');
  expect(h.get('2027-05-17')).toBe('Pfingstmontag');
  expect(h.get('2027-05-27')).toBe('Fronleichnam');
  expect(holidaysAT(2026).get('2026-10-26')).toBe('Nationalfeiertag');
  expect(holidaysAT(2026).size).toBe(13);
});

test.each([
  [2000, '2000-04-23'],
  [2008, '2008-03-23'], // frühestes Datum seit 1913
  [2011, '2011-04-24'],
  [2024, '2024-03-31'],
  [2025, '2025-04-20'],
  [2026, '2026-04-05'],
  [2027, '2027-03-28'],
  [2028, '2028-04-16'],
  [2029, '2029-04-01'],
  [2030, '2030-04-21'],
  [2031, '2031-04-13'],
  [2038, '2038-04-25'], // spätestes mögliches Datum
  [2049, '2049-04-18'], // Ausnahme der Formel: ohne Korrekturterm käme der 25. April heraus
  [2076, '2076-04-19'], // Ausnahme der Formel: ohne Korrekturterm käme der 26. April heraus
])('easter sunday %i is %s', (year, day) => {
  expect(easterSunday(year)).toBe(day);
});

test('all 13 Austrian public holidays of 2026 with their names', () => {
  const h = holidaysAT(2026);
  expect([...h.keys()].sort().map((day) => [day, h.get(day)])).toEqual([
    ['2026-01-01', 'Neujahr'],
    ['2026-01-06', 'Heilige Drei Könige'],
    ['2026-04-06', 'Ostermontag'],
    ['2026-05-01', 'Staatsfeiertag'],
    ['2026-05-14', 'Christi Himmelfahrt'],
    ['2026-05-25', 'Pfingstmontag'],
    ['2026-06-04', 'Fronleichnam'],
    ['2026-08-15', 'Mariä Himmelfahrt'],
    ['2026-10-26', 'Nationalfeiertag'],
    ['2026-11-01', 'Allerheiligen'],
    ['2026-12-08', 'Mariä Empfängnis'],
    ['2026-12-25', 'Christtag'],
    ['2026-12-26', 'Stefanitag'],
  ]);
});

test('moveable holidays follow Easter in a year with an early Easter', () => {
  // Ostern 2029 ist am 1. April
  const h = holidaysAT(2029);
  expect(h.get('2029-04-02')).toBe('Ostermontag');
  expect(h.get('2029-05-10')).toBe('Christi Himmelfahrt');
  expect(h.get('2029-05-21')).toBe('Pfingstmontag');
  expect(h.get('2029-05-31')).toBe('Fronleichnam');
});

test('moveable holidays follow Easter in a year with a late Easter', () => {
  // Ostern 2038 ist am 25. April
  const h = holidaysAT(2038);
  expect(h.get('2038-04-26')).toBe('Ostermontag');
  expect(h.get('2038-06-03')).toBe('Christi Himmelfahrt');
  expect(h.get('2038-06-14')).toBe('Pfingstmontag');
  expect(h.get('2038-06-24')).toBe('Fronleichnam');
});

test('two holidays on one day leave one entry (Christi Himmelfahrt fell on 1 May in 2008)', () => {
  const h = holidaysAT(2008);
  expect(h.size).toBe(12);
  expect(h.get('2008-05-01')).toBe('Christi Himmelfahrt');
});

test('every year from 2026 to 2100 has 13 different holiday dates', () => {
  const wrong: number[] = [];
  for (let year = 2026; year <= 2100; year++) {
    if (holidaysAT(year).size !== 13) wrong.push(year);
  }
  expect(wrong).toEqual([]);
});
