import { expect, test } from 'vitest';
import { calendarWeeks, monthTitle, type CalendarCell } from '../../src/lib/miniCalendar';
import { parseTermine } from '../../src/lib/termine';
import { fixture } from './helpers';

const termine = parseTermine(fixture('04 Ressourcen/Kalender/Termine.md'));
const flat = (weeks: CalendarCell[][]) => weeks.flat();
const cell = (weeks: CalendarCell[][], day: string) => {
  const found = flat(weeks).find((c) => c.day === day);
  if (!found) throw new Error(`Kein Tag ${day}`);
  return found;
};
const october = () => calendarWeeks('2026-10', { today: '2026-10-29', shown: '2026-10-29', termine });

test('the month starts on Monday and shows only the weeks that have days of the month', () => {
  const weeks = october();
  expect(weeks).toHaveLength(5);
  expect(weeks.every((week) => week.length === 7)).toBe(true);
  expect(weeks[0][0].day).toBe('2026-09-28'); // der 1.10.2026 ist ein Donnerstag
  expect(weeks[0][3].day).toBe('2026-10-01');
  expect(weeks[4][6].day).toBe('2026-11-01');
  expect(flat(weeks).map((c) => c.number).slice(0, 8)).toEqual([28, 29, 30, 1, 2, 3, 4, 5]);
});

test('a month can take four, five or six weeks', () => {
  const rows = (month: string) => calendarWeeks(month, { today: '2026-10-29', shown: '2026-10-29', termine: [] }).length;
  expect(rows('2027-02')).toBe(4); // 1.2.2027 ist ein Montag, der Monat hat 28 Tage
  expect(rows('2026-12')).toBe(5);
  expect(rows('2026-08')).toBe(6); // 1.8.2026 ist ein Samstag
});

test('days outside the month are there, but not part of the month', () => {
  const weeks = october();
  expect(cell(weeks, '2026-09-28').inMonth).toBe(false);
  expect(cell(weeks, '2026-11-01').inMonth).toBe(false);
  expect(cell(weeks, '2026-10-01').inMonth).toBe(true);
  expect(cell(weeks, '2026-10-31').inMonth).toBe(true);
});

test('today and the shown day are marked', () => {
  const weeks = calendarWeeks('2026-10', { today: '2026-10-29', shown: '2026-10-30', termine });
  expect(flat(weeks).filter((c) => c.today).map((c) => c.day)).toEqual(['2026-10-29']);
  expect(flat(weeks).filter((c) => c.shown).map((c) => c.day)).toEqual(['2026-10-30']);
});

test('today is only marked where it is, also for another month', () => {
  const weeks = calendarWeeks('2026-11', { today: '2026-10-29', shown: '2026-11-05', termine: [] });
  expect(flat(weeks).some((c) => c.today)).toBe(false);
  expect(flat(weeks).filter((c) => c.shown).map((c) => c.day)).toEqual(['2026-11-05']);
});

test('holidays of the month carry their name, like in the month planner', () => {
  const weeks = october();
  expect(cell(weeks, '2026-10-26').holiday).toBe('Nationalfeiertag');
  expect(cell(weeks, '2026-10-27').holiday).toBeUndefined();
  // Allerheiligen steht im Raster, gehört aber zum November: kein Feiertag in dieser Ansicht.
  expect(cell(weeks, '2026-11-01').holiday).toBeUndefined();
  const november = calendarWeeks('2026-11', { today: '2026-10-29', shown: '2026-11-01', termine: [] });
  expect(cell(november, '2026-11-01').holiday).toBe('Allerheiligen');
});

test('holidays are found in a month that is shown with days of the next year', () => {
  const weeks = calendarWeeks('2026-12', { today: '2026-12-01', shown: '2026-12-01', termine: [] });
  expect(cell(weeks, '2026-12-25').holiday).toBe('Christtag');
  expect(cell(weeks, '2026-12-26').holiday).toBe('Stefanitag');
  expect(cell(weeks, '2027-01-01').inMonth).toBe(false);
});

test('days with appointments count them, also all day appointments and days outside the month', () => {
  const list = parseTermine(
    [
      '- 2026-10-29 08:00 bis 09:00 | A',
      '- 2026-10-29 ganztägig | B',
      '- 2026-10-29 15:00 bis 16:00 | C',
      '- 2026-11-01 10:00 bis 11:00 | Im Raster, aber im November',
      '- 2026-11-02 10:00 bis 11:00 | Nicht im Raster',
    ].join('\n'),
  );
  const weeks = calendarWeeks('2026-10', { today: '2026-10-29', shown: '2026-10-29', termine: list });
  expect(cell(weeks, '2026-10-29').appointments).toBe(3);
  expect(cell(weeks, '2026-11-01').appointments).toBe(1);
  expect(cell(weeks, '2026-10-28').appointments).toBe(0);
  expect(flat(weeks).some((c) => c.day === '2026-11-02')).toBe(false);
});

test('the label names the day, today, the holiday and the appointments for screen readers and tests', () => {
  const weeks = october();
  expect(cell(weeks, '2026-10-29').label).toBe('Do 29.10.2026, heute, 1 Termin');
  expect(cell(weeks, '2026-10-26').label).toBe('Mo 26.10.2026, Nationalfeiertag');
  expect(cell(weeks, '2026-10-30').label).toBe('Fr 30.10.2026, 1 Termin');
  expect(cell(weeks, '2026-10-23').label).toBe('Fr 23.10.2026');
  expect(cell(weeks, '2026-09-28').label).toBe('Mo 28.09.2026');
});

test('the label puts the parts in a fixed order and uses the plural for several appointments', () => {
  const list = parseTermine('- 2026-10-26 08:00 bis 09:00 | A\n- 2026-10-26 ganztägig | B\n');
  const weeks = calendarWeeks('2026-10', { today: '2026-10-26', shown: '2026-10-26', termine: list });
  expect(cell(weeks, '2026-10-26').label).toBe('Mo 26.10.2026, heute, Nationalfeiertag, 2 Termine');
});

test('every cell has the number of its day', () => {
  for (const c of flat(october())) expect(c.number).toBe(Number(c.day.slice(8, 10)));
});

test('the month title is the German month name and the year', () => {
  expect(monthTitle('2026-10')).toBe('Oktober 2026');
  expect(monthTitle('2027-03')).toBe('März 2027');
  expect(monthTitle('2026-01')).toBe('Januar 2026');
});
