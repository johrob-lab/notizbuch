import { expect, test } from 'vitest';
import {
  addDays,
  formatDayLong,
  isValidDay,
  isoWeekKey,
  mondayOf,
  monthGrid,
  monthKey,
  todayVienna,
  weekDays,
} from '../../src/lib/dates';

test('today in Vienna around midnight and DST', () => {
  expect(todayVienna(new Date('2026-10-28T23:30:00Z'))).toBe('2026-10-29'); // 00:30 MEZ
  expect(todayVienna(new Date('2026-07-01T22:30:00Z'))).toBe('2026-07-02'); // 00:30 MESZ
  expect(todayVienna(new Date('2027-03-28T00:30:00Z'))).toBe('2027-03-28');
});

test('today in Vienna on both clock change days, second by second at midnight', () => {
  // 25.10.2026: Sommerzeit endet, der Tag hat 25 Stunden
  expect(todayVienna(new Date('2026-10-24T21:59:59Z'))).toBe('2026-10-24'); // 23:59:59 MESZ
  expect(todayVienna(new Date('2026-10-24T22:00:00Z'))).toBe('2026-10-25'); // 00:00:00 MESZ
  expect(todayVienna(new Date('2026-10-25T22:59:59Z'))).toBe('2026-10-25'); // 23:59:59 MEZ
  expect(todayVienna(new Date('2026-10-25T23:00:00Z'))).toBe('2026-10-26'); // 00:00:00 MEZ
  // 28.03.2027: Sommerzeit beginnt, der Tag hat 23 Stunden
  expect(todayVienna(new Date('2027-03-27T22:59:59Z'))).toBe('2027-03-27'); // 23:59:59 MEZ
  expect(todayVienna(new Date('2027-03-27T23:00:00Z'))).toBe('2027-03-28'); // 00:00:00 MEZ
  expect(todayVienna(new Date('2027-03-28T21:59:59Z'))).toBe('2027-03-28'); // 23:59:59 MESZ
  expect(todayVienna(new Date('2027-03-28T22:00:00Z'))).toBe('2027-03-29'); // 00:00:00 MESZ
});

test('the week changes at Vienna midnight on the Sunday of a clock change', () => {
  const weekAt = (utc: string) => isoWeekKey(todayVienna(new Date(utc)));
  expect(weekAt('2026-10-25T22:59:59Z')).toBe('2026-W43'); // Sonntag 23:59:59 MEZ
  expect(weekAt('2026-10-25T23:00:00Z')).toBe('2026-W44'); // Montag 00:00:00 MEZ
  expect(weekAt('2027-03-28T21:59:59Z')).toBe('2027-W12'); // Sonntag 23:59:59 MESZ
  expect(weekAt('2027-03-28T22:00:00Z')).toBe('2027-W13'); // Montag 00:00:00 MESZ
});

test('today in Vienna at new year follows Vienna, not UTC', () => {
  expect(todayVienna(new Date('2026-12-31T22:59:59Z'))).toBe('2026-12-31'); // 23:59:59 MEZ
  expect(todayVienna(new Date('2026-12-31T23:00:00Z'))).toBe('2027-01-01'); // 00:00:00 MEZ
});

test('today in Vienna without argument uses the clock', () => {
  expect(todayVienna()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
});

test('addDays counts calendar days across month, year, leap day and clock changes', () => {
  expect(addDays('2026-10-29', 0)).toBe('2026-10-29');
  expect(addDays('2026-10-29', 3)).toBe('2026-11-01');
  expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  expect(addDays('2027-01-01', -1)).toBe('2026-12-31');
  expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
  expect(addDays('2027-02-28', 1)).toBe('2027-03-01');
  expect(addDays('2026-03-01', -365)).toBe('2025-03-01');
  expect(addDays('2026-01-01', 365)).toBe('2027-01-01');
  // Tage mit 25 und 23 Stunden zählen wie jeder andere Tag
  expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
  expect(addDays('2026-10-25', 1)).toBe('2026-10-26');
  expect(addDays('2027-03-27', 1)).toBe('2027-03-28');
  expect(addDays('2027-03-28', 1)).toBe('2027-03-29');
});

test('iso weeks', () => {
  expect(isoWeekKey('2026-10-29')).toBe('2026-W44');
  expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
  expect(weekDays('2026-W44')).toEqual(['2026-10-26','2026-10-27','2026-10-28','2026-10-29','2026-10-30','2026-10-31','2026-11-01']);
  expect(monthGrid('2026-10')[0][0]).toBe('2026-09-28');
  expect(formatDayLong('2026-10-29')).toBe('Do 29.10.2026');
});

test('iso week keys at the turn of the year', () => {
  expect(isoWeekKey('2025-12-29')).toBe('2026-W01'); // Montag, gehört schon zum ISO-Jahr 2026
  expect(isoWeekKey('2026-01-01')).toBe('2026-W01');
  expect(isoWeekKey('2026-12-31')).toBe('2026-W53');
  expect(isoWeekKey('2027-01-03')).toBe('2026-W53'); // Sonntag
  expect(isoWeekKey('2027-01-04')).toBe('2027-W01'); // Montag
  expect(isoWeekKey('2024-12-30')).toBe('2025-W01');
  expect(isoWeekKey('2021-01-03')).toBe('2020-W53');
});

test('iso years with 53 weeks', () => {
  // Der 28. Dezember liegt immer in der letzten Woche seines ISO-Jahres.
  const with53: number[] = [];
  for (let year = 2000; year <= 2040; year++) {
    if (isoWeekKey(`${year}-12-28`).endsWith('-W53')) with53.push(year);
  }
  expect(with53).toEqual([2004, 2009, 2015, 2020, 2026, 2032, 2037]);
});

test('mondayOf', () => {
  expect(mondayOf('2026-10-26')).toBe('2026-10-26'); // Montag bleibt
  expect(mondayOf('2026-10-29')).toBe('2026-10-26'); // Donnerstag
  expect(mondayOf('2026-11-01')).toBe('2026-10-26'); // Sonntag gehört zur Woche davor
  expect(mondayOf('2027-01-01')).toBe('2026-12-28'); // über den Jahreswechsel
});

test('week days run Monday to Sunday and cross the year border', () => {
  expect(weekDays('2026-W53')).toEqual(['2026-12-28', '2026-12-29', '2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02', '2027-01-03']);
  expect(weekDays('2026-W01')).toEqual(['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04']);
  expect(weekDays('2027-W01')[0]).toBe('2027-01-04');
  expect(weekDays('2025-W01')[0]).toBe('2024-12-30');
  expect(weekDays('2027-W05')[0]).toBe('2027-02-01');
});

test('every day lies in the week of its own key, which starts on its Monday', () => {
  const problems: string[] = [];
  let d = '2019-12-01';
  for (let i = 0; i < 365 * 13; i++) {
    const days = weekDays(isoWeekKey(d));
    if (days.length !== 7 || !days.includes(d) || days[0] !== mondayOf(d)) problems.push(d);
    d = addDays(d, 1);
  }
  expect(problems).toEqual([]);
});

test('month keys', () => {
  expect(monthKey('2026-10-29')).toBe('2026-10');
  expect(monthKey('2027-01-01')).toBe('2027-01');
});

test('month grid has 6 rows of 7 days, Monday first', () => {
  const grid = monthGrid('2026-10');
  expect(grid).toHaveLength(6);
  for (const row of grid) expect(row).toHaveLength(7);
  expect(grid[0]).toEqual(['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
  expect(grid[5][6]).toBe('2026-11-08');
});

test('month grid edge cases: month starts on Monday or Sunday, 28 day month, year border', () => {
  // 01.06.2026 ist ein Montag: keine Tage aus dem Vormonat
  expect(monthGrid('2026-06')[0][0]).toBe('2026-06-01');
  expect(monthGrid('2026-06')[5][6]).toBe('2026-07-12');
  // 01.03.2026 ist ein Sonntag: sechs Tage aus dem Vormonat
  expect(monthGrid('2026-03')[0][0]).toBe('2026-02-23');
  expect(monthGrid('2026-03')[0][6]).toBe('2026-03-01');
  // Februar 2027 hat 28 Tage und beginnt am Montag: die letzten zwei Zeilen gehören zum März
  expect(monthGrid('2027-02')[3][6]).toBe('2027-02-28');
  expect(monthGrid('2027-02')[4][0]).toBe('2027-03-01');
  expect(monthGrid('2027-02')[5][6]).toBe('2027-03-14');
  // Dezember 2026 reicht in den Januar 2027
  expect(monthGrid('2026-12')[0][0]).toBe('2026-11-30');
  expect(monthGrid('2026-12')[5][6]).toBe('2027-01-10');
});

test('every month grid is gapless, starts on a Monday and holds the whole month', () => {
  const problems: string[] = [];
  for (let year = 2026; year <= 2028; year++) {
    for (let month = 1; month <= 12; month++) {
      const key = `${year}-${String(month).padStart(2, '0')}`;
      const grid = monthGrid(key);
      const cells = grid.flat();
      const lastOfMonth = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      if (grid.length !== 6 || grid.some((row) => row.length !== 7)) problems.push(`${key}: Form`);
      if (mondayOf(cells[0]) !== cells[0]) problems.push(`${key}: Start ist kein Montag`);
      if (cells.some((cell, i) => i > 0 && cell !== addDays(cells[i - 1], 1))) problems.push(`${key}: Lücke`);
      if (!cells.includes(`${key}-01`) || !cells.includes(lastOfMonth)) problems.push(`${key}: Monat fehlt`);
    }
  }
  expect(problems).toEqual([]);
});

test('long day format', () => {
  expect(formatDayLong('2026-10-26')).toBe('Mo 26.10.2026');
  expect(formatDayLong('2026-10-27')).toBe('Di 27.10.2026');
  expect(formatDayLong('2026-10-28')).toBe('Mi 28.10.2026');
  expect(formatDayLong('2026-10-29')).toBe('Do 29.10.2026');
  expect(formatDayLong('2026-10-30')).toBe('Fr 30.10.2026');
  expect(formatDayLong('2026-10-31')).toBe('Sa 31.10.2026');
  expect(formatDayLong('2026-11-01')).toBe('So 01.11.2026');
  expect(formatDayLong('2027-01-05')).toBe('Di 05.01.2027');
});

test('isValidDay accepts real calendar days in the form YYYY-MM-DD', () => {
  for (const d of ['2026-10-29', '2026-01-01', '2026-12-31', '2026-02-28', '2026-04-30', '2028-02-29', '2000-02-29']) {
    expect(isValidDay(d), d).toBe(true);
  }
});

test('isValidDay rejects days that do not exist', () => {
  for (const d of ['2026-13-45', '2026-13-01', '2026-00-10', '2026-10-00', '2026-10-32', '2026-02-29', '2026-02-30', '2026-04-31', '2027-02-29', '2100-02-29']) {
    expect(isValidDay(d), d).toBe(false);
  }
});

test('isValidDay rejects everything that is not exactly YYYY-MM-DD', () => {
  for (const d of ['', '2026-1-5', '26-10-29', '2026-10-29 ', ' 2026-10-29', '2026-10-29\n', '2026-10-29T00:00:00Z', '2026/10/29', '20261029', '+2026-10-29', 'abcd-ef-gh', '2026-10-2\uFF19']) {
    expect(isValidDay(d), JSON.stringify(d)).toBe(false);
  }
});

test('isValidDay does not turn the years 0 to 99 into 19xx', () => {
  expect(isValidDay('0004-02-29')).toBe(true); // Jahr 4 ist ein Schaltjahr
  expect(isValidDay('0099-02-29')).toBe(false);
  expect(isValidDay('0000-01-01')).toBe(true);
});

test('isValidDay: the last day of every month is valid and the day after it is not', () => {
  const problems: string[] = [];
  for (let year = 2026; year <= 2032; year++) {
    for (let month = 1; month <= 12; month++) {
      const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
      const key = `${year}-${String(month).padStart(2, '0')}`;
      if (!isValidDay(`${key}-${String(last).padStart(2, '0')}`)) problems.push(`${key}: letzter Tag ${last} fehlt`);
      if (isValidDay(`${key}-${String(last + 1).padStart(2, '0')}`)) problems.push(`${key}: Tag ${last + 1} gilt`);
    }
  }
  expect(problems).toEqual([]);
});

test('isValidDay agrees with addDays for a few years of days', () => {
  let d = '2026-01-01';
  const problems: string[] = [];
  for (let i = 0; i < 365 * 5; i++) {
    if (!isValidDay(d)) problems.push(d);
    d = addDays(d, 1);
  }
  expect(problems).toEqual([]);
});
