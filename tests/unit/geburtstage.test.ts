import { expect, test } from 'vitest';
import { GEBURTSTAGE_PATH } from '../../src/lib/filenames';
import { geburtstageAm, parseGeburtstage } from '../../src/lib/geburtstage';
import { assertAllowedPath } from '../../src/sync/paths';

test('reads date, name, kind and source', () => {
  const md = '# Geburtstage\n- 2026-11-15 | Max Beispiel | Geburtstag | Google\n- 2026-12-02 | Anna und Ben Beispiel | Jahrestag | Outlook\n';
  expect(parseGeburtstage(md)).toEqual([
    { date: '2026-11-15', name: 'Max Beispiel', art: 'Geburtstag', source: 'Google' },
    { date: '2026-12-02', name: 'Anna und Ben Beispiel', art: 'Jahrestag', source: 'Outlook' },
  ]);
});

test('the kind is Jahrestag only when it says so, kind and source may be missing', () => {
  const md = ['- 2026-11-15 | A | jahrestag ', '- 2026-11-16 | B', '- 2026-11-17 | C |  | Google', '- 2026-11-18 | D | Namenstag | Google'].join('\n');
  expect(parseGeburtstage(md).map((g) => [g.name, g.art, g.source])).toEqual([
    ['A', 'Jahrestag', undefined],
    ['B', 'Geburtstag', undefined],
    ['C', 'Geburtstag', 'Google'],
    ['D', 'Geburtstag', 'Google'],
  ]);
});

test('skips everything that is not a birthday line', () => {
  const md = [
    '# Geburtstage',
    '',
    'Text',
    '- 2026-02-30 | Kein Tag | Geburtstag | Google',
    '- 2026-11-15 |  | Geburtstag | Google',
    '- 2026-11-15 | A | Geburtstag | Google | zu viel',
    '2026-11-15 | Ohne Strich vorn | Geburtstag | Google',
    '- 15.11.2026 | Falsches Datum | Geburtstag | Google',
    '- 2026-11-15 | Bleibt | Geburtstag | Google',
  ].join('\n');
  expect(parseGeburtstage(md).map((g) => g.name)).toEqual(['Bleibt']);
});

test('a byte order mark, CRLF and decomposed umlauts do not matter', () => {
  const md = '\uFEFF- 2026-11-15 | Jo\u0308rg Beispiel | Geburtstag | Google\r\n- 2026-11-16 | Erika Muster | Jahrestag | Outlook\r\n';
  expect(parseGeburtstage(md)).toEqual([
    { date: '2026-11-15', name: 'Jörg Beispiel', art: 'Geburtstag', source: 'Google' },
    { date: '2026-11-16', name: 'Erika Muster', art: 'Jahrestag', source: 'Outlook' },
  ]);
});

test('the same person on the same day counts once, the first line wins', () => {
  const md = [
    '- 2026-11-15 | Max Beispiel | Geburtstag | Google',
    '- 2026-11-15 | max  beispiel | Geburtstag | Outlook',
    '- 2026-11-15 | Erika Muster | Geburtstag | Outlook',
    '- 2026-11-16 | Max Beispiel | Geburtstag | Outlook',
    '- 2026-11-17 | Jörg Beispiel | Geburtstag | Google',
    '- 2026-11-17 | JÖRG BEISPIEL | Geburtstag | Outlook',
  ].join('\n');
  expect(parseGeburtstage(md).map((g) => `${g.date} ${g.name} ${g.source}`)).toEqual([
    '2026-11-15 Max Beispiel Google',
    '2026-11-15 Erika Muster Outlook',
    '2026-11-16 Max Beispiel Outlook',
    '2026-11-17 Jörg Beispiel Google',
  ]);
});

test('geburtstageAm keeps the order of the file and leaves the list alone', () => {
  const list = parseGeburtstage('- 2026-11-15 | B | Geburtstag\n- 2026-11-16 | X | Geburtstag\n- 2026-11-15 | A | Jahrestag\n');
  const before = [...list];
  expect(geburtstageAm(list, '2026-11-15').map((g) => g.name)).toEqual(['B', 'A']);
  expect(geburtstageAm(list, '2026-11-17')).toEqual([]);
  expect(list).toEqual(before);
});

test('the app may read Geburtstage.md but never write it', () => {
  expect(GEBURTSTAGE_PATH).toBe('04 Ressourcen/Kalender/Geburtstage.md');
  expect(() => assertAllowedPath(GEBURTSTAGE_PATH, 'read')).not.toThrow();
  expect(() => assertAllowedPath(GEBURTSTAGE_PATH, 'write')).toThrow();
});
