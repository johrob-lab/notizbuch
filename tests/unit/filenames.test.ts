import { expect, test } from 'vitest';
import { todayVienna } from '../../src/lib/dates';
import {
  besprechungBase,
  besprechungPagePath,
  conflictPath,
  dailyNotePath,
  monatPagePath,
  sanitizeThema,
  tagPagePath,
  TERMINE_PATH,
  wochePagePath,
} from '../../src/lib/filenames';

test('paths', () => {
  expect(dailyNotePath('2026-10-29')).toBe('05 Daily Notes/2026-10-29.md');
  expect(tagPagePath('2026-10-29')).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg');
  expect(wochePagePath('2026-W53')).toBe('07 Anhänge/Notizbuch/2026/2026 KW53 Woche.svg');
  expect(wochePagePath('2027-W05')).toBe('07 Anhänge/Notizbuch/2027/2027 KW05 Woche.svg');
  expect(monatPagePath('2026-10')).toBe('07 Anhänge/Notizbuch/2026/2026-10 Monat.svg');
  expect(besprechungBase('2026-10-29', '08:00', 'Abstimmung: Beispiel / 2027?')).toBe('2026-10-29 0800 Abstimmung Beispiel 2027');
  expect(besprechungPagePath('2026-10-29 0800 Abstimmung Beispiel 2027', 2)).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 0800 Abstimmung Beispiel 2027 S2.svg');
  expect(sanitizeThema('  a\\b:c*d?e"f<g>h|i#j^k[l]m  ')).toBe('a b c d e f g h i j k l m');
  expect(sanitizeThema('x'.repeat(120)).length).toBe(80);
  expect(conflictPath('05 Daily Notes/2026-10-29.md')).toBe('05 Daily Notes/2026-10-29 (Konflikt).md');
});

test('daily note and day page of today follow Vienna midnight', () => {
  const today = todayVienna(new Date('2026-10-28T23:30:00Z')); // 00:30 MEZ am 29.10.2026
  expect(dailyNotePath(today)).toBe('05 Daily Notes/2026-10-29.md');
  expect(tagPagePath(today)).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg');
});

test('year folders: day and month pages by calendar year, week pages by iso year', () => {
  expect(dailyNotePath('2027-01-01')).toBe('05 Daily Notes/2027-01-01.md');
  expect(tagPagePath('2027-01-01')).toBe('07 Anhänge/Notizbuch/2027/2027-01-01 Tag.svg');
  expect(monatPagePath('2027-01')).toBe('07 Anhänge/Notizbuch/2027/2027-01 Monat.svg');
  // 01.01.2027 liegt in der Woche 2026-W53: Ordner und Zahl nach dem ISO-Jahr
  expect(wochePagePath('2026-W53')).toBe('07 Anhänge/Notizbuch/2026/2026 KW53 Woche.svg');
  expect(besprechungPagePath('2027-01-04 1430 Muster anrufen', 1)).toBe('07 Anhänge/Notizbuch/2027/2027-01-04 1430 Muster anrufen S1.svg');
});

test('besprechungBase builds date, time without colon and cleaned Thema', () => {
  expect(besprechungBase('2026-10-29', '14:30', 'Muster anrufen')).toBe('2026-10-29 1430 Muster anrufen');
  expect(besprechungBase('2026-10-29', '08:00', 'Sperren & "Muster" <2027>')).toBe('2026-10-29 0800 Sperren & Muster 2027');
});

test('sanitizeThema replaces forbidden characters and collapses white space', () => {
  expect(sanitizeThema('a/b')).toBe('a b');
  expect(sanitizeThema('Sperren & "Muster" <2027>')).toBe('Sperren & Muster 2027');
  expect(sanitizeThema('a\t\n  b')).toBe('a b');
  expect(sanitizeThema('Prüfung Brücke Süd')).toBe('Prüfung Brücke Süd');
  expect(sanitizeThema('')).toBe('');
  expect(sanitizeThema(' ?*/: ')).toBe('');
});

test('sanitizeThema trims again after cutting to 80 characters', () => {
  // Das 80. Zeichen ist ein Leerzeichen: der Name darf danach nicht mit Leerzeichen enden.
  const result = sanitizeThema('a'.repeat(79) + ' bcd');
  expect(result).toBe('a'.repeat(79));
});

test('sanitizeThema does not cut an emoji in half', () => {
  // Ein halbes Zeichen (Surrogatpaar) wäre kein gültiger Text mehr und lässt encodeURIComponent scheitern.
  const result = sanitizeThema('a'.repeat(79) + '😀');
  expect(result).toBe('a'.repeat(79));
  expect(() => encodeURIComponent(result)).not.toThrow();
  expect(sanitizeThema('Test 😀')).toBe('Test 😀');
});

test('besprechungBase falls back to Besprechung when the cleaned Thema is empty', () => {
  expect(besprechungBase('2026-10-29', '08:00', '')).toBe('2026-10-29 0800 Besprechung');
  expect(besprechungBase('2026-10-29', '08:00', ' ?*/: ')).toBe('2026-10-29 0800 Besprechung');
});

test('conflictPath inserts the marker before the last extension only', () => {
  expect(conflictPath('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg')).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 Tag (Konflikt).svg');
  expect(conflictPath('a.b.md')).toBe('a.b (Konflikt).md');
  expect(conflictPath('05 Daily Notes/ohne Endung')).toBe('05 Daily Notes/ohne Endung (Konflikt)');
  // ein Punkt im Ordnernamen ist keine Dateiendung
  expect(conflictPath('04 Ressourcen/Version 1.2/Notiz')).toBe('04 Ressourcen/Version 1.2/Notiz (Konflikt)');
});

test('the appointments file lives in the read only calendar folder', () => {
  expect(TERMINE_PATH).toBe('04 Ressourcen/Kalender/Termine.md');
});
