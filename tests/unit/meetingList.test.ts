import { expect, test } from 'vitest';
import { meetingLabel, meetingMonths, meetingsInPaths } from '../../src/lib/meetingList';

const DIR = '07 Anhänge/Notizbuch';

test('meetings come from the year folders only', () => {
  const paths = [
    `${DIR}/2026/2026-11-17 0900 Abstimmung Muster 2028 S1.svg`,
    `${DIR}/2026/2026-11-17 0900 Abstimmung Muster 2028 S2.svg`,
    `${DIR}/2026/2026-11-17 Tag.svg`,
    `${DIR}/2026/2026 KW47 Woche.svg`,
    `${DIR}/2026/2026-11 Monat.svg`,
    `${DIR}/2026/2026-11-17 0900 Abstimmung Muster 2028 S1 (Konflikt).svg`,
    `${DIR}/2026/2026-11-17 0900 Abstimmung Muster 2028 Tabelle.csv`,
    `${DIR}/2025/2025-03-04 1400 Baustelle Beispiel S3.svg`,
    `${DIR}/2026/alt/2026-01-02 0800 Unterordner S1.svg`,
    '05 Daily Notes/2026-11-17.md',
  ];
  expect(meetingsInPaths(paths)).toEqual([
    { base: '2025-03-04 1400 Baustelle Beispiel', pages: [3] },
    { base: '2026-11-17 0900 Abstimmung Muster 2028', pages: [1, 2] },
  ]);
});

test('a name with a decomposed umlaut is the same meeting', () => {
  const nfc = '2026-11-17 0900 Äpfel Beispiel'.normalize('NFC');
  const nfd = '2026-11-17 0900 Äpfel Beispiel'.normalize('NFD');
  const result = meetingsInPaths([`${DIR}/2026/${nfc} S1.svg`, `${DIR}/2026/${nfd} S2.svg`]);
  expect(result).toEqual([{ base: nfc, pages: [1, 2] }]);
  expect(result[0].base).toBe(result[0].base.normalize('NFC'));
});

test('the newest meeting comes first, months newest first', () => {
  const months = meetingMonths([
    { base: '2026-10-29 0800 Abstimmung Beispiel 2027', pages: [1] },
    { base: '2026-11-17 1400 Nachbesprechung Muster', pages: [1] },
    { base: '2026-11-17 0900 Abstimmung Muster 2028', pages: [1, 2] },
    { base: '2026-11-17 0900 Abstimmung Anders', pages: [2, 3] },
    { base: 'kaputt', pages: [1] },
  ]);
  expect(months.map((m) => [m.month, m.title])).toEqual([
    ['2026-11', 'November 2026'],
    ['2026-10', 'Oktober 2026'],
  ]);
  expect(months[0].entries.map((e) => e.thema)).toEqual(['Nachbesprechung Muster', 'Abstimmung Anders', 'Abstimmung Muster 2028']);
  expect(months[1].entries.map((e) => e.thema)).toEqual(['Abstimmung Beispiel 2027']);
  expect(months[0].entries[1]).toEqual({ base: '2026-11-17 0900 Abstimmung Anders', datum: '2026-11-17', zeit: '09:00', thema: 'Abstimmung Anders', pages: [2, 3] });
  expect(months[0].entries[0].zeit).toBe('14:00');
});

test('an entry reads like the plan says', () => {
  const e = { base: '2026-11-17 0900 Abstimmung Muster 2028', datum: '2026-11-17', zeit: '09:00', thema: 'Abstimmung Muster 2028', pages: [1, 2] };
  expect(meetingLabel(e)).toBe('Di 17.11. · 09:00 · Abstimmung Muster 2028 · 2 Seiten');
  expect(meetingLabel({ ...e, pages: [1] })).toBe('Di 17.11. · 09:00 · Abstimmung Muster 2028');
  expect(meetingLabel({ ...e, pages: [2, 3] })).toBe('Di 17.11. · 09:00 · Abstimmung Muster 2028 · 2 Seiten');
});
