import { expect, test } from 'vitest';
import { parseTermine, termineAm, type Termin } from '../../src/lib/termine';
import { fixture } from './helpers';

const TERMINE_MD = '04 Ressourcen/Kalender/Termine.md';

const titles = (list: Termin[]) => list.map((t) => t.title);

test('parses the three formats', () => {
  const t = parseTermine(fixture(TERMINE_MD));
  expect(t).toHaveLength(3);
  expect(t[0]).toEqual({ date: '2026-10-29', start: '08:00', end: '14:00', allDay: false, title: 'Abstimmung Beispiel 2027', place: 'Musterstadt', source: 'Outlook' });
  expect(t[1]).toMatchObject({ allDay: true, place: undefined });
});

test('parses every field of the all day line and of the last line', () => {
  const t = parseTermine(fixture(TERMINE_MD));
  expect(t[1]).toEqual({ date: '2026-10-30', start: undefined, end: undefined, allDay: true, title: 'Schulung Beispiel', place: undefined, source: 'Outlook' });
  expect(t[2]).toEqual({ date: '2026-11-02', start: '09:30', end: '10:00', allDay: false, title: 'Zahnarzt', place: 'Beispielhausen', source: 'Google' });
});

test('every Termin has all keys, with undefined where a value is missing', () => {
  const keys = ['allDay', 'date', 'end', 'place', 'source', 'start', 'title'];
  const [timed, allDay] = parseTermine('- 2026-10-29 08:00 bis 09:00 | A\n- 2026-10-30 ganztägig | B | Probedorf | Outlook\n');
  expect(Object.keys(timed).sort()).toEqual(keys);
  expect(Object.keys(allDay).sort()).toEqual(keys);
  expect(timed.place).toBeUndefined();
  expect(timed.source).toBeUndefined();
  expect(allDay.start).toBeUndefined();
  expect(allDay.end).toBeUndefined();
});

test('Ort and Quelle are optional: a missing or empty part becomes undefined', () => {
  const md = [
    '- 2026-10-29 ganztägig | Nur Titel',
    '- 2026-10-29 ganztägig | Mit Ort | Probedorf',
    '- 2026-10-29 ganztägig | Ort leer | | Google',
    '- 2026-10-29 ganztägig | Quelle leer | Probedorf |',
    '- 2026-10-29 ganztägig | Beide leer |   |   ',
    '- 2026-10-29 08:00 bis 09:00 | Mit Zeit, nur Titel',
    '- 2026-10-29 08:00 bis 09:00 | Mit Zeit, Ort leer |  | Outlook',
  ].join('\n');
  expect(parseTermine(md).map((t) => [t.title, t.place, t.source])).toEqual([
    ['Nur Titel', undefined, undefined],
    ['Mit Ort', 'Probedorf', undefined],
    ['Ort leer', undefined, 'Google'],
    ['Quelle leer', 'Probedorf', undefined],
    ['Beide leer', undefined, undefined],
    ['Mit Zeit, nur Titel', undefined, undefined],
    ['Mit Zeit, Ort leer', undefined, 'Outlook'],
  ]);
});

test('trims every part', () => {
  const [t] = parseTermine('- 2026-10-29 08:00 bis 09:00 |   Titel  mit  Lücke  |\tProbedorf  |  Outlook   \n');
  expect(t).toMatchObject({ title: 'Titel  mit  Lücke', place: 'Probedorf', source: 'Outlook' });
});

test('skips malformed lines', () => {
  expect(parseTermine('# Termine\n- morgen irgendwas\n- 2026-13-45 08:00 | x\n')).toEqual([]);
});

test('skips lines without a title', () => {
  const md = [
    '- 2026-10-29 ganztägig',
    '- 2026-10-29 ganztägig |',
    '- 2026-10-29 ganztägig |    | Probedorf | Outlook',
    '- 2026-10-29 08:00 bis 09:00 |',
    '- 2026-10-29 08:00 bis 09:00 |  | Probedorf',
    '- 2026-10-29 08:00 bis 09:00 | Mit Titel',
  ].join('\n');
  expect(titles(parseTermine(md))).toEqual(['Mit Titel']);
});

test('skips dates that do not exist or are not written YYYY-MM-DD', () => {
  const md = [
    '- 2026-13-45 08:00 bis 09:00 | Monat 13',
    '- 2026-02-30 ganztägig | 30. Februar',
    '- 2027-02-29 ganztägig | Kein Schaltjahr',
    '- 2026-00-10 ganztägig | Monat 0',
    '- 2026-10-32 ganztägig | Tag 32',
    '- 2026-1-5 ganztägig | Ohne Nullen',
    '- 29.10.2026 ganztägig | Deutsche Schreibweise',
    '- 2028-02-29 ganztägig | Schaltjahr',
    '- 2026-10-31 ganztägig | Monatsende',
  ].join('\n');
  expect(titles(parseTermine(md))).toEqual(['Schaltjahr', 'Monatsende']);
});

test('skips times that are not clock times', () => {
  const md = [
    '- 2026-10-29 24:00 bis 25:00 | Stunde 24',
    '- 2026-10-29 08:60 bis 09:00 | Minute 60 im Beginn',
    '- 2026-10-29 08:00 bis 09:60 | Minute 60 im Ende',
    '- 2026-10-29 08:00 bis 24:00 | Ende 24:00',
    '- 2026-10-29 29:00 bis 30:00 | Stunde 29',
    '- 2026-10-29 8:00 bis 9:00 | Einstellige Stunde',
    '- 2026-10-29 0800 bis 0900 | Ohne Doppelpunkt',
    '- 2026-10-29 00:00 bis 23:59 | Ganzer Tag',
    '- 2026-10-29 09:05 bis 19:59 | Mitte',
  ].join('\n');
  const t = parseTermine(md);
  expect(titles(t)).toEqual(['Ganzer Tag', 'Mitte']);
  expect(t[0]).toMatchObject({ start: '00:00', end: '23:59' });
});

test('accepts exactly the clock times 00:00 to 23:59, as start and as end', () => {
  const problems: string[] = [];
  for (let h = 0; h < 100; h++) {
    for (let m = 0; m < 100; m++) {
      const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      const valid = h <= 23 && m <= 59;
      const asStart = parseTermine(`- 2026-10-29 ${time} bis 12:00 | t`).length === 1;
      const asEnd = parseTermine(`- 2026-10-29 12:00 bis ${time} | t`).length === 1;
      if (asStart !== valid || asEnd !== valid) problems.push(time);
    }
  }
  expect(problems).toEqual([]);
});

test('skips lines with more than four parts', () => {
  const md = [
    '- 2026-10-29 ganztägig | Titel | mit | Strich | Outlook',
    '- 2026-10-29 ganztägig | Genau vier | Probedorf | Outlook',
  ].join('\n');
  expect(titles(parseTermine(md))).toEqual(['Genau vier']);
});

test('ignores everything that is not an appointment line', () => {
  const md = [
    '---',
    'tags: [kalender]',
    '---',
    '# Termine',
    '',
    'Wird jeden Morgen neu geschrieben.',
    '## Diese Woche',
    '* 2026-10-29 ganztägig | Anderes Aufzählungszeichen',
    '2026-10-29 ganztägig | Ohne Aufzählungszeichen',
    '- 2026-10-29 | Ohne Zeit',
    '- 2026-10-29 08:00 | Nur Beginn',
    '- 2026-10-29 08:00 bis | Ohne Ende',
    '- 2026-10-29 ganztaegig | Falsch geschrieben',
    '- 2026-10-29 ganztägig Titel ohne Strich',
    '- 2026-10-29 ganztägig | Echter Termin',
    '',
  ].join('\n');
  expect(titles(parseTermine(md))).toEqual(['Echter Termin']);
});

test('empty text and a missing final newline', () => {
  expect(parseTermine('')).toEqual([]);
  expect(titles(parseTermine('- 2026-10-29 ganztägig | Ohne Zeilenende'))).toEqual(['Ohne Zeilenende']);
});

test('reads CRLF files like LF files', () => {
  const lf = fixture(TERMINE_MD).replace(/\r\n/g, '\n');
  const crlf = lf.replace(/\n/g, '\r\n');
  expect(crlf).toContain('\r\n');
  expect(parseTermine(crlf)).toHaveLength(3);
  expect(parseTermine(crlf)).toEqual(parseTermine(lf));
  // Das Zeilenende bleibt nicht im letzten Feld hängen, auch nicht, wenn das Feld leer ist.
  const [onlyTitle, emptySource] = parseTermine('- 2026-10-29 ganztägig | A\r\n- 2026-10-29 ganztägig | B | Probedorf |\r\n');
  expect(onlyTitle.title).toBe('A');
  expect(emptySource.source).toBeUndefined();
});

test('sorts a day', () => {
  const list = parseTermine('- 2026-10-30 10:00 bis 11:00 | B\n- 2026-10-30 ganztägig | A\n- 2026-10-30 08:00 bis 09:00 | C\n');
  expect(termineAm(list, '2026-10-30').map(x => x.title)).toEqual(['A', 'C', 'B']);
});

test('termineAm returns only the given day', () => {
  const list = parseTermine([
    '- 2026-10-29 09:00 bis 10:00 | Heute früh',
    '- 2026-10-30 ganztägig | Morgen',
    '- 2026-10-29 ganztägig | Heute ganztägig',
    '- 2026-10-31 08:00 bis 09:00 | Übermorgen',
  ].join('\n'));
  expect(titles(termineAm(list, '2026-10-29'))).toEqual(['Heute ganztägig', 'Heute früh']);
  expect(titles(termineAm(list, '2026-10-31'))).toEqual(['Übermorgen']);
  expect(termineAm(list, '2026-11-01')).toEqual([]);
  expect(termineAm([], '2026-10-29')).toEqual([]);
});

test('termineAm keeps file order for equal keys', () => {
  const list = parseTermine([
    '- 2026-10-30 ganztägig | Z',
    '- 2026-10-30 09:00 bis 10:00 | Y',
    '- 2026-10-30 ganztägig | A',
    '- 2026-10-30 10:00 bis 11:00 | V',
    '- 2026-10-30 09:00 bis 09:30 | X',
    '- 2026-10-30 08:00 bis 08:30 | W',
    '- 2026-10-30 00:00 bis 01:00 | Mitternacht',
  ].join('\n'));
  // Ganztägige zuerst (Z vor A, wie in der Datei), dann nach Beginn, gleicher Beginn wie in der Datei (Y vor X).
  expect(titles(termineAm(list, '2026-10-30'))).toEqual(['Z', 'A', 'Mitternacht', 'W', 'Y', 'X', 'V']);
});

test('termineAm does not change the list it gets', () => {
  const list = parseTermine('- 2026-10-30 10:00 bis 11:00 | B\n- 2026-10-30 ganztägig | A\n');
  const result = termineAm(list, '2026-10-30');
  expect(titles(result)).toEqual(['A', 'B']);
  expect(titles(list)).toEqual(['B', 'A']);
  expect(result).not.toBe(list);
});

test('a byte order mark at the start of the file does not hide the first line', () => {
  const lines = '- 2026-10-29 08:00 bis 14:00 | Abstimmung Beispiel 2027 | Musterstadt | Outlook\n- 2026-10-30 ganztägig | Schulung Beispiel\n';
  expect(parseTermine(`\uFEFF${lines}`)).toEqual(parseTermine(lines));
  expect(titles(parseTermine(`\uFEFF${lines}`))).toEqual(['Abstimmung Beispiel 2027', 'Schulung Beispiel']);
  // Auch mit Windows-Zeilenenden, und vor einer Überschrift schadet es nicht.
  expect(titles(parseTermine(`\uFEFF${lines.replace(/\n/g, '\r\n')}`))).toEqual(['Abstimmung Beispiel 2027', 'Schulung Beispiel']);
  expect(titles(parseTermine(`\uFEFF# Termine\n${lines}`))).toEqual(['Abstimmung Beispiel 2027', 'Schulung Beispiel']);
});

test('only a byte order mark at the very start is ignored', () => {
  expect(parseTermine('# Termine\n\uFEFF- 2026-10-29 08:00 bis 14:00 | Mitten drin\n')).toEqual([]);
  expect(parseTermine('\uFEFF\uFEFF- 2026-10-29 08:00 bis 14:00 | Zwei\n')).toEqual([]);
});
