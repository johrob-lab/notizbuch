import { expect, test } from 'vitest';
import { agendaInfo, fitLines, geburtstagItem, moreLabel, SEPARATOR, prioItems, terminItems, textWidth, withHead, type AgendaItem } from '../../src/pages/agenda';
import type { Geburtstag } from '../../src/lib/geburtstage';
import type { Termin } from '../../src/lib/termine';
import { wocheLayout } from '../../src/pages/layouts';

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

test('textWidth is 0.58 of the size per ordinary character', () => {
  expect(textWidth('abcd', 10)).toBeCloseTo(23.2, 10);
});

test('textWidth counts per character: capitals, wide, narrow and emoji', () => {
  expect(textWidth('A', 10)).toBeCloseTo(7.2, 10);
  expect(textWidth('Mw', 10)).toBeCloseTo(18, 10);
  expect(textWidth(' i.|', 10)).toBeCloseTo(12.8, 10);
  expect(textWidth('a🙂', 10)).toBeCloseTo(16.8, 10);
});

test('a title in capitals is estimated wider than the same title in lowercase', () => {
  const title = 'Koordinationsbesprechung Brücke';
  expect(textWidth(title.toUpperCase(), 13)).toBeGreaterThan(textWidth(title.toLowerCase(), 13) * 1.2);
});

test('a title in capitals with " +2" fits the week area when fitLines says it fits', () => {
  const [, , w] = wocheLayout('2026-W44').fields.find((f) => f.id.startsWith('tag-'))!.rect;
  const area = w - 190 - 14; // wie in agendaMarks, ohne Feiertag
  const title = 'BKM KAB FEBRUAR 2027';
  const lines = fitLines([{ text: title, tone: 'termin' }, ...items(3)], 1, area, 13);
  expect(lines[0].items[0].text).toBe(title);
  expect(textWidth(title + moreLabel(lines[0].more), 13)).toBeLessThanOrEqual(area);
  expect(lines[0].more).toBeGreaterThan(0);
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

const geb = (name: string, art: 'Geburtstag' | 'Jahrestag' = 'Geburtstag'): Geburtstag => ({ date: '2026-10-28', name, art });
const t = (title: string): Termin => ({ date: '2026-10-28', allDay: true, title });
const p = (text: string) => ({ text, done: false });

test('all birthdays of a day stand in one entry behind one cake, anniversaries behind one heart', () => {
  const g = (name: string, art: 'Geburtstag' | 'Jahrestag' = 'Geburtstag') => ({ date: '2026-10-29', name, art });
  expect(geburtstagItem([])).toBeUndefined();
  expect(geburtstagItem([g('Max Beispiel')])).toEqual({ text: '🎂 Max Beispiel', tone: 'geburtstag' });
  expect(geburtstagItem([g('Max Beispiel'), g('Paul Beispiel')], 11)).toEqual({ text: '🎂 Max Beispiel, Paul Beispiel', tone: 'geburtstag', size: 11 });
  expect(geburtstagItem([g('Anna und Ben Beispiel', 'Jahrestag'), g('Max Beispiel')])?.text).toBe('🎂 Max Beispiel ♥ Anna und Ben Beispiel');
  expect(geburtstagItem([g('Anna und Ben Beispiel', 'Jahrestag')])?.text).toBe('♥ Anna und Ben Beispiel');
});

test('fitLines takes a width per line, the last one repeats', () => {
  const items = ['Eins', 'Zwei', 'Drei'].map((text) => ({ text, tone: 'termin' as const }));
  const lines = fitLines(items, 3, [textWidth('Eins', 13) + 1, 1000], 13);
  expect(lines.map((l) => l.items.map((i) => i.text))).toEqual([['Eins'], ['Zwei', 'Drei']]);
});

test('an entry with its own size is measured with that size', () => {
  const head = { text: '🎂 Max Beispiel', tone: 'geburtstag' as const, size: 11 };
  const termin = { text: '08:00 Schulung', tone: 'termin' as const };
  const exact = textWidth(head.text, 11) + textWidth(SEPARATOR, 13) + textWidth(termin.text, 13);
  expect(fitLines([head, termin], 1, exact, 13)[0].items).toHaveLength(2);
  expect(fitLines([head, termin], 1, exact - 1, 13)[0].more).toBe(1);
});

test('with appointments the birthdays get at most 40 % of line 1 and the first appointment stands next to them', () => {
  const head = { text: '🎂 Max Beispiel, Paul Beispiel, Erika Muster, Hans Beispiel', tone: 'geburtstag' as const, size: 11 };
  const rest = ['08:00 Schulung Beispiel mit sehr langem Titel', '10:00 Abnahme Brücke'].map((text) => ({ text, tone: 'termin' as const }));
  const [line] = withHead(head, rest, 1, 300, 13);
  expect(line.items[0].text.endsWith('…')).toBe(true);
  expect(textWidth(line.items[0].text, 11)).toBeLessThanOrEqual(0.4 * 300);
  expect(line.items[1].tone).toBe('termin');
  expect(line.items[1].text.startsWith('08:00')).toBe(true);
  expect(line.more).toBe(1);
});

test('without appointments the birthdays may use the whole width, without birthdays withHead is fitLines', () => {
  const head = { text: '🎂 Max Beispiel, Paul Beispiel, Erika Muster', tone: 'geburtstag' as const, size: 11 };
  expect(textWidth(head.text, 11)).toBeGreaterThan(0.4 * 300);
  expect(withHead(head, [], 2, 300, 13)).toEqual([{ items: [head], more: 0 }]);
  const rest = ['08:00 Schulung', '10:00 Abnahme'].map((text) => ({ text, tone: 'termin' as const }));
  expect(withHead(undefined, rest, 2, 300, 13)).toEqual(fitLines(rest, 2, 300, 13));
});

test('with two lines the appointments continue in line 2 in full width', () => {
  const head = { text: '🎂 Max Beispiel, Paul Beispiel, Erika Muster, Hans Beispiel', tone: 'geburtstag' as const, size: 11 };
  const rest = ['08:00 Schulung Beispiel mit sehr langem Titel', '10:00 Abnahme Brücke', '12:00 Mittag'].map((text) => ({ text, tone: 'termin' as const }));
  const lines = withHead(head, rest, 2, 300, 13);
  expect(lines).toHaveLength(2);
  expect(lines[0].items[1].text.startsWith('08:00')).toBe(true);
  expect(lines[0].more).toBe(0);
  expect(lines[1].items.map((i) => i.text)).toEqual(['10:00 Abnahme Brücke', '12:00 Mittag']);
  expect(textWidth(lines[1].items.map((i) => i.text).join(SEPARATOR), 13)).toBeLessThanOrEqual(300);
});

test('only an anniversary and appointments: the entry starts with a heart and takes at most 40 %', () => {
  const head = geburtstagItem([{ date: '2026-10-29', name: 'Anna und Ben Beispiel mit einem sehr langen Namen und noch mehr', art: 'Jahrestag' }], 11)!;
  const rest = [{ text: '08:00 Schulung', tone: 'termin' as const }];
  const [line] = withHead(head, rest, 1, 300, 13);
  expect(line.items[0].text.startsWith('♥')).toBe(true);
  expect(textWidth(line.items[0].text, 11)).toBeLessThanOrEqual(0.4 * 300);
  expect(line.items[1].text).toBe('08:00 Schulung');
});

test('when line 1 next to the birthdays has no room for an ellipse the appointments start in line 2', () => {
  const head = { text: 'a', tone: 'geburtstag' as const, size: 9 };
  const rest = [{ text: '08:00 Schulung', tone: 'termin' as const }];
  const lines = withHead(head, rest, 2, 14, 10.5);
  expect(lines[0]).toEqual({ items: [head], more: 0 });
  expect(lines[1].items[0].tone).toBe('termin');
  // Mit nur einer Zeile zählt `more` den Rest.
  expect(withHead(head, rest, 1, 14, 10.5)).toEqual([{ items: [head], more: 1 }]);
});

test('the day list names birthdays, anniversaries, appointments and priorities, leaving out what is 0', () => {
  expect(agendaInfo({ geburtstage: [geb('A'), geb('B', 'Jahrestag')], termine: [t('x'), t('y')], prioritaeten: [p('z')] })).toBe('1 Geburtstag, 1 Jahrestag, 2 Termine, 1 Priorität');
  expect(agendaInfo({ geburtstage: [geb('A'), geb('B'), geb('C', 'Jahrestag'), geb('D', 'Jahrestag')], termine: [], prioritaeten: [] })).toBe('2 Geburtstage, 2 Jahrestage');
  expect(agendaInfo({ termine: [t('x')], prioritaeten: [p('y'), p('z'), p('w')] })).toBe('1 Termin, 3 Prioritäten');
  expect(agendaInfo({ termine: [t('x')], prioritaeten: [] })).toBe('1 Termin');
  expect(agendaInfo({ termine: [], prioritaeten: [p('y'), p('z')] })).toBe('2 Prioritäten');
  expect(agendaInfo({ geburtstage: [], termine: [], prioritaeten: [] })).toBe('');
});
