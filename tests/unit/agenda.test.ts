import { expect, test } from 'vitest';
import { agendaInfo, fitLines, moreLabel, SEPARATOR, prioItems, terminItems, textWidth, type AgendaItem } from '../../src/pages/agenda';
import type { Termin } from '../../src/lib/termine';

const day = '2026-10-29';
const termin = (title: string, start?: string, end?: string): Termin => ({ date: day, start, end, allDay: start === undefined, title });

const items = (n: number, len = 10): AgendaItem[] =>
  Array.from({ length: n }, (_, i) => ({ text: String(i).repeat(len), tone: 'termin' as const }));
const lineText = (l: { items: AgendaItem[] }) => l.items.map((i) => i.text).join(' · ');

test('appointments: all day and 00:00 to 23:59 first with the title only, then by start', () => {
  const out = terminItems([
    termin('B', '10:00', '11:00'),
    termin('A'),
    termin('C', '08:00', '09:00'),
    termin('D', '00:00', '23:59'),
  ]);
  expect(out.map((i) => i.text)).toEqual(['A', 'D', '08:00 C', '10:00 B']);
  expect(out.every((i) => i.tone === 'termin')).toBe(true);
});

test('priorities get an arrow, done ones a check', () => {
  expect(
    prioItems([
      { text: 'X', done: false },
      { text: 'Y', done: true },
    ]),
  ).toEqual([
    { text: '▸ X', tone: 'prio' },
    { text: '✓ Y', tone: 'erledigt' },
  ]);
});

test('textWidth is 0.58 of the size per character', () => {
  expect(textWidth('abcd', 10)).toBeCloseTo(23.2, 10);
  expect(textWidth('a🙂', 10)).toBeCloseTo(11.6, 10);
});

test('fitLines puts items on a line with separators and counts the rest', () => {
  const width = textWidth(`${'0'.repeat(10)} · ${'1'.repeat(10)} +2`, 13) + 2;
  const lines = fitLines(items(4), 1, width, 13);
  expect(lines).toHaveLength(1);
  expect(lines[0].items).toHaveLength(2);
  expect(lines[0].more).toBe(2);
  expect(textWidth(`${lineText(lines[0])} +${lines[0].more}`, 13)).toBeLessThanOrEqual(width);
});

test('a single item that is too long is shortened with an ellipsis', () => {
  const lines = fitLines([{ text: 'x'.repeat(200), tone: 'termin' }], 1, 300, 13);
  expect(lines).toHaveLength(1);
  const t = lines[0].items[0].text;
  expect(t.endsWith('…')).toBe(true);
  expect(textWidth(t, 13)).toBeLessThanOrEqual(300);
  expect(lines[0].more).toBe(0);
});

test('two lines carry on where the first ends, the rest goes to the last line', () => {
  const list = items(7);
  const width = textWidth(`${'0'.repeat(10)} · ${'1'.repeat(10)}`, 13) + 2;
  const lines = fitLines(list, 2, width, 13);
  expect(lines).toHaveLength(2);
  expect(lines[0].more).toBe(0);
  expect(lines[0].items.map((i) => i.text)).toEqual([list[0].text, list[1].text]);
  expect(lines[1].items[0].text).toBe(list[2].text);
  const shown = lines[0].items.length + lines[1].items.length;
  expect(lines[1].more).toBe(7 - shown);
  expect(lines[1].more).toBeGreaterThan(0);
  expect(textWidth(`${lineText(lines[1])} +${lines[1].more}`, 13)).toBeLessThanOrEqual(width);
});

test('nothing in gives no lines', () => {
  expect(fitLines([], 2, 300, 13)).toEqual([]);
});

test('a too long first item on the second line is shortened there', () => {
  const list: AgendaItem[] = [
    { text: 'kurz', tone: 'termin' },
    { text: 'y'.repeat(200), tone: 'termin' },
  ];
  const lines = fitLines(list, 2, 300, 13);
  expect(lines).toHaveLength(2);
  expect(lines[0].items.map((i) => i.text)).toEqual(['kurz']);
  expect(lines[1].items[0].text.endsWith('…')).toBe(true);
  expect(textWidth(lines[1].items[0].text, 13)).toBeLessThanOrEqual(300);
  expect(lines[1].more).toBe(0);
});

test('a too long single item on the last line is shortened together with the rest label', () => {
  const list: AgendaItem[] = [{ text: 'y'.repeat(200), tone: 'termin' }, ...items(2)];
  const lines = fitLines(list, 1, 300, 13);
  expect(lines).toHaveLength(1);
  expect(lines[0].more).toBe(2);
  expect(lines[0].items[0].text.endsWith('…')).toBe(true);
  expect(textWidth(lines[0].items[0].text + moreLabel(2), 13)).toBeLessThanOrEqual(300);
});

test('shortening leaves no space before the ellipsis', () => {
  const lines = fitLines([{ text: 'Abstimmung mit dem Team', tone: 'termin' }], 1, textWidth('Abstimmung …', 13) + 1, 13);
  expect(lines[0].items[0].text).toBe('Abstimmung…');
});

test('an item that does not fit even as an ellipse is not drawn, so no line gets too wide', () => {
  const narrow = textWidth('…', 13) + 0.5;
  expect(fitLines(items(3), 1, 5, 13)).toEqual([]);
  // Die Ellipse passt, aber nicht mit " +2": nichts wird gezeichnet.
  expect(fitLines(items(3), 1, narrow, 13)).toEqual([]);
  // Ein einzelner Eintrag darf als Ellipse bleiben.
  expect(fitLines([{ text: 'abc', tone: 'termin' }], 1, narrow, 13)[0].items[0].text).toBe('…');
  // In einer Folgezeile fällt der Eintrag weg, die Zeile bleibt innerhalb der Breite.
  for (const l of fitLines(items(4), 2, 5, 13)) expect(textWidth(l.items.map((i) => i.text).join(SEPARATOR), 13)).toBeLessThanOrEqual(5);
});

test('the day list names how many appointments and priorities a day has, leaving out what is 0', () => {
  expect(agendaInfo(2, 1)).toBe('2 Termine, 1 Priorität');
  expect(agendaInfo(1, 3)).toBe('1 Termin, 3 Prioritäten');
  expect(agendaInfo(1, 0)).toBe('1 Termin');
  expect(agendaInfo(0, 2)).toBe('2 Prioritäten');
  expect(agendaInfo(0, 0)).toBe('');
});
