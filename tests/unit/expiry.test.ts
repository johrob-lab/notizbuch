import { expect, test } from 'vitest';
import { todayVienna } from '../../src/lib/dates';
import { defaultExpiry, endOfDayVienna, expiryWarning, knownExpiry } from '../../src/lib/expiry';

// Alles hier ist erfunden. Gerechnet wird in Kalendertagen nach Wiener Zeit, nie in Stunden.

const TEXT = (day: string) => `Dein Zugang läuft am ${day} ab. Bitte rechtzeitig erneuern.`;

// ---------- Test aus dem Brief ----------

test('expiry warning 14 days before', () => {
  const now = new Date('2027-10-15T08:00:00Z');
  expect(expiryWarning(new Date('2027-10-30T10:00:00Z'), now)).toBeNull();
  expect(expiryWarning(new Date('2027-10-29T10:00:00Z'), now)).toBe('Dein Zugang läuft am 29.10.2027 ab. Bitte rechtzeitig erneuern.');
  expect(expiryWarning(null, now)).toBeNull();
});

// ---------- Die Warnung ----------

test('the warning starts exactly 14 calendar days before and stays until the token is gone', () => {
  const now = new Date('2027-06-10T09:00:00Z');
  expect(expiryWarning(new Date('2027-06-25T09:00:00Z'), now)).toBeNull(); // 15 Tage
  expect(expiryWarning(new Date('2027-06-24T09:00:00Z'), now)).toBe(TEXT('24.06.2027')); // 14 Tage
  expect(expiryWarning(new Date('2027-06-11T09:00:00Z'), now)).toBe(TEXT('11.06.2027'));
  expect(expiryWarning(new Date('2027-06-10T09:00:00Z'), now)).toBe(TEXT('10.06.2027')); // heute
});

test('a token that has expired already is warned about, too', () => {
  const now = new Date('2027-06-10T09:00:00Z');
  expect(expiryWarning(new Date('2027-06-09T09:00:00Z'), now)).toBe(TEXT('09.06.2027'));
  expect(expiryWarning(new Date('2025-01-02T09:00:00Z'), now)).toBe(TEXT('02.01.2025'));
});

test('the days are Vienna days: late in the evening still counts for the day it is in Vienna', () => {
  // 2027-10-15 23:30 in Wien (Sommerzeit, UTC+2) ist noch der 15. und schon 2027-10-15T21:30:00Z.
  const evening = new Date('2027-10-15T21:30:00Z');
  expect(todayVienna(evening)).toBe('2027-10-15');
  // Der 30.10. liegt 15 Tage weiter: keine Warnung. Eine Stunde später ist es in Wien der 16., und es sind nur noch 14.
  const expiry = new Date('2027-10-30T11:00:00Z');
  expect(expiryWarning(expiry, evening)).toBeNull();
  const afterMidnight = new Date('2027-10-15T22:30:00Z');
  expect(todayVienna(afterMidnight)).toBe('2027-10-16');
  expect(expiryWarning(expiry, afterMidnight)).toBe(TEXT('30.10.2027'));
});

test('the day of the expiry is the day in Vienna, not the day in UTC', () => {
  const now = new Date('2027-10-15T08:00:00Z');
  // 2027-10-29T21:30:00Z ist in Wien schon der 30. (Sommerzeit endet erst am 31.10.): 15 Tage, keine Warnung.
  expect(expiryWarning(new Date('2027-10-29T22:30:00Z'), now)).toBeNull();
  // Eine Stunde früher ist es in Wien noch der 29.
  expect(expiryWarning(new Date('2027-10-29T21:30:00Z'), now)).toBe(TEXT('29.10.2027'));
});

test('a change between summer and winter time does not move the border', () => {
  // Die Zeitumstellung liegt am 31.10.2027. Von Mitte Oktober bis Mitte November sind es 14 Kalendertage, auch wenn eine Stunde dazukommt.
  const now = new Date('2027-10-20T10:00:00Z');
  expect(expiryWarning(new Date('2027-11-03T10:00:00Z'), now)).toBe(TEXT('03.11.2027'));
  expect(expiryWarning(new Date('2027-11-04T10:00:00Z'), now)).toBeNull();
  // Und ebenso im Frühjahr (28.03.2027).
  const spring = new Date('2027-03-20T10:00:00Z');
  expect(expiryWarning(new Date('2027-04-03T10:00:00Z'), spring)).toBe(TEXT('03.04.2027'));
  expect(expiryWarning(new Date('2027-04-04T10:00:00Z'), spring)).toBeNull();
});

test('the border moves across the end of the year, and across a leap day', () => {
  // Vom 22.12. bis zum 05.01. sind es 14 Kalendertage, vom 21.12. 15.
  const expiry = new Date('2027-01-05T10:00:00Z');
  expect(expiryWarning(expiry, new Date('2026-12-22T10:00:00Z'))).toBe(TEXT('05.01.2027'));
  expect(expiryWarning(expiry, new Date('2026-12-21T10:00:00Z'))).toBeNull();
  // Im Schaltjahr 2028 hat der Februar 29 Tage: Vom 16.02. bis zum 01.03. sind es 14.
  const march = new Date('2028-03-01T10:00:00Z');
  expect(expiryWarning(march, new Date('2028-02-16T10:00:00Z'))).toBe(TEXT('01.03.2028'));
  expect(expiryWarning(march, new Date('2028-02-15T10:00:00Z'))).toBeNull();
});

test('after midnight in Vienna on New Year the new year counts, although it is still the old one in UTC', () => {
  // 2026-12-31T23:30:00Z ist in Wien schon der 1. Januar 2027, 00:30 Uhr.
  const now = new Date('2026-12-31T23:30:00Z');
  expect(todayVienna(now)).toBe('2027-01-01');
  expect(expiryWarning(new Date('2027-01-15T10:00:00Z'), now)).toBe(TEXT('15.01.2027')); // 14 Tage
  expect(expiryWarning(new Date('2027-01-16T10:00:00Z'), now)).toBeNull(); // 15 Tage
});

// ---------- Das Datum aus der Einrichtung ----------

test('a day is expressed as its last moment in Vienna, in summer time and in winter time', () => {
  for (const day of ['2027-01-15', '2027-03-27', '2027-03-28', '2027-03-29', '2027-07-01', '2027-10-30', '2027-10-31', '2027-11-01', '2028-02-29']) {
    const end = endOfDayVienna(day);
    expect(end).toBeInstanceOf(Date);
    expect(todayVienna(end), day).toBe(day);
    // Das Ende des Tages: Eine Stunde später ist es der nächste Tag.
    expect(todayVienna(new Date(end.getTime() + 3_600_000)), day).not.toBe(day);
  }
});

test('the warning for a stored day matches the day itself', () => {
  const now = new Date('2027-10-15T08:00:00Z');
  expect(expiryWarning(endOfDayVienna('2027-10-29'), now)).toBe(TEXT('29.10.2027'));
  expect(expiryWarning(endOfDayVienna('2027-10-30'), now)).toBeNull();
});

test('a day a year from now', () => {
  expect(defaultExpiry('2026-10-29')).toBe('2027-10-29');
  expect(defaultExpiry('2027-01-01')).toBe('2028-01-01');
  expect(defaultExpiry('2027-12-31')).toBe('2028-12-31');
});

test('the 29th of February has no day a year later: it is the 28th', () => {
  expect(defaultExpiry('2028-02-29')).toBe('2029-02-28');
  expect(defaultExpiry('2027-02-28')).toBe('2028-02-28');
});

// ---------- Woher das Ablaufdatum kommt ----------

test('the date GitHub reports wins over the date that was typed in', () => {
  const header = new Date('2027-05-05T10:00:00Z');
  expect(knownExpiry({ lastTokenExpiry: header }, '2027-10-29')).toBe(header);
  expect(knownExpiry({ lastTokenExpiry: header }, undefined)).toBe(header);
});

test('without a date from GitHub the typed-in day counts, as its last moment in Vienna', () => {
  const found = knownExpiry({ lastTokenExpiry: null }, '2027-10-29');
  expect(found).not.toBeNull();
  expect(todayVienna(found!)).toBe('2027-10-29');
});

test('with no date at all there is none', () => {
  expect(knownExpiry({ lastTokenExpiry: null }, undefined)).toBeNull();
});
