import { expect, test } from 'vitest';
import { dayExtras, noteDayOf, pageHeader, pageLabel } from '../../src/ki/pageInfo';
import type { DayEntry } from '../../src/lib/dayMeetings';

const M = { thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', seitennr: '2' };

test('pages have short names for the switch', () => {
  expect(pageLabel('tag', '2026-10-29', {})).toBe('Do 29.10.2026');
  expect(pageLabel('woche', '2026-W44', {})).toBe('KW 44 2026');
  expect(pageLabel('monat', '2026-10', {})).toBe('Oktober 2026');
  expect(pageLabel('besprechung', 'x', M)).toBe('Abstimmung Beispiel 2027, Seite 2');
  expect(pageLabel('besprechung', 'x', {})).toBe('Besprechung, Seite 1');
});

test('the header says what kind of page it is', () => {
  expect(pageHeader('tag', '2026-10-29', {})).toBe('Tagesseite Do 29.10.2026');
  expect(pageHeader('woche', '2026-W44', {})).toBe('Wochenseite KW 44, Mo 26.10. bis So 01.11.2026');
  expect(pageHeader('monat', '2026-10', {})).toBe('Monatsseite Oktober 2026');
  expect(pageHeader('besprechung', 'x', { ...M, ort: 'Raum 3', projekt: 'Muster' })).toBe(
    'Besprechung „Abstimmung Beispiel 2027“ am Do 29.10.2026 um 08:00, Seite 2, Ort: Raum 3, Projekt: Muster',
  );
  expect(pageHeader('besprechung', 'x', { ...M, art: 'tabelle' })).toBe(
    'Besprechung „Abstimmung Beispiel 2027“ am Do 29.10.2026 um 08:00, Seite 2, Tabellenseite',
  );
  expect(pageHeader('besprechung', 'x', { ...M, datum: '' })).toBe('Besprechung „Abstimmung Beispiel 2027“ um 08:00, Seite 2');
});

test('the note day follows the page', () => {
  expect(noteDayOf('tag', '2026-10-29', {})).toBe('2026-10-29');
  expect(noteDayOf('besprechung', 'x', M)).toBe('2026-10-29');
  expect(noteDayOf('besprechung', 'x', { ...M, datum: '2026-02-30' })).toBeNull();
  expect(noteDayOf('woche', '2026-W44', {})).toBeNull();
  expect(noteDayOf('monat', '2026-10', {})).toBeNull();
});

const entries: DayEntry[] = [
  { kind: 'termin', termin: { date: '2026-10-29', allDay: true, title: 'Betriebsausflug', place: 'Graz' }, meeting: null },
  { kind: 'besprechung', zeit: '09:00', thema: 'Abstimmung Muster 2028', meeting: { base: '2026-10-29 0900 Abstimmung Muster 2028', pages: [1, 2] } },
  {
    kind: 'termin',
    termin: { date: '2026-10-29', start: '14:00', end: '15:00', allDay: false, title: 'Abstimmung Beispiel 2027' },
    meeting: { base: '2026-10-29 1400 Abstimmung Beispiel 2027', pages: [1] },
  },
];

test('the day text has the note and the card entries', () => {
  expect(dayExtras('2026-10-29', 'Zeile 1\nZeile 2', entries)).toBe(
    [
      'Tagesnotiz 2026-10-29, Anfang:',
      'Zeile 1',
      'Zeile 2',
      'Tagesnotiz, Ende.',
      '',
      'Karte „Besprechungen“ dieses Tages:',
      '- ganztägig · Betriebsausflug · Graz',
      '- 09:00 · Abstimmung Muster 2028 · Besprechung · 2 Seiten',
      '- 14:00 · Abstimmung Beispiel 2027 · Besprechung',
    ].join('\n'),
  );
});

test('a day without note or entries says so', () => {
  expect(dayExtras('2026-10-29', null, [])).toBe('Zu diesem Tag gibt es keine Tagesnotiz.\n\nKarte „Besprechungen“ dieses Tages: keine Termine.');
});

test('the Sperren page has a name, a header and no note day', () => {
  expect(pageLabel('sperren', 'IB-2027-03', {})).toBe('Sperren IB, März und April 2027');
  expect(pageHeader('sperren', 'IB-2027-03', {})).toBe('Sperrenkalender IB, März und April 2027');
  expect(pageHeader('sperren', 'Lehne-2026-11', {})).toBe('Sperrenkalender Lehne, November und Dezember 2026');
  expect(noteDayOf('sperren', 'IB-2027-03', {})).toBeNull();
});
