import { expect, test } from 'vitest';
import { besprechungLayout, meetingLayout, tabelleLayout } from '../../src/pages/layouts';
import { TABELLE_SPALTEN, TABELLE_ZEILEN, tabelleGeometrie, zeilenFeld } from '../../src/pages/tabelle';

const META = {
  thema: 'Abstimmung Muster 2027',
  datum: '2026-10-29',
  zeit: '08:00',
  ort: 'Musterort',
  projekt: 'Beispielprojekt A',
  seitennr: '2',
  art: 'tabelle',
};

const MARKER =
  '<g data-tabelle="1" data-spalten="23 215 269 341 395 449 509 581 713 845 941 1037 1169" data-zeilen="248 296 344 392 440 488 536 584 632 680 728 776 824 872 920 968 1016 1064 1112 1160 1208 1256 1304 1352 1400 1448 1496 1544" data-kopfzeile="212 248"/>';

test('the table has the twelve agreed columns, 191 mm wide and centred', () => {
  expect(TABELLE_SPALTEN.map((s) => s.titel)).toEqual(['Schritt', 'Monat', 'Std', '×', '×', 'Anz.', 'wer', 'Fahrzeuge', 'Ressourcen', 'Mat. €', 'Fremd €', 'Bemerkung']);
  expect(TABELLE_SPALTEN.map((s) => s.mm)).toEqual([32, 9, 12, 9, 9, 10, 12, 22, 22, 16, 16, 22]);
  expect(tabelleGeometrie().spalten).toEqual([23, 215, 269, 341, 395, 449, 509, 581, 713, 845, 941, 1037, 1169]);
});

test('there are 27 rows of 8 mm from 248 to 1544 under the column heads', () => {
  const g = tabelleGeometrie();
  expect(g.zeilen).toHaveLength(28);
  expect(g.zeilen[0]).toBe(248);
  expect(g.zeilen[27]).toBe(1544);
  for (let i = 1; i < g.zeilen.length; i++) expect(g.zeilen[i] - g.zeilen[i - 1]).toBe(48);
  expect(g.kopfzeile).toEqual([212, 248]);
  expect(TABELLE_ZEILEN).toBe(27);
});

test('every row is a blank field across the page', () => {
  const l = tabelleLayout(META);
  expect(l.fields).toHaveLength(27);
  for (let i = 1; i <= 27; i++) {
    const f = l.fields[i - 1];
    expect(f.id).toBe(zeilenFeld(i));
    expect(f.rect).toEqual([0, 248 + 48 * (i - 1), 1192, 48]);
    expect(f.paper).toBe('blanko');
    expect(f.label).toBe(`Zeile ${i}`);
    expect(f.datum).toBe('2026-10-29');
  }
  expect(zeilenFeld(1)).toBe('zeile-01');
  expect(zeilenFeld(27)).toBe('zeile-27');
  expect(l.kind).toBe('besprechung');
  expect(l.key).toBe(besprechungLayout(META).key);
  expect(l.cards).toEqual([]);
});

test('the background carries the geometry for the evening script', () => {
  const bg = tabelleLayout(META).background();
  expect(bg.split(MARKER)).toHaveLength(2);
});

test('the background prints the column heads, the row numbers and the meeting head', () => {
  const bg = tabelleLayout(META).background();
  for (const s of TABELLE_SPALTEN) expect(bg).toContain(`>${s.titel}</text>`);
  for (let i = 1; i <= 27; i++) expect(bg).toContain(`>${i}</text>`);
  expect(bg).toContain('>Abstimmung Muster 2027</text>');
  expect(bg).toContain('>Seite 2</text>');
  expect(bg).toContain('Tabelle Arbeitsvorbereitung · Do 29.10.2026');
});

test('meetingLayout takes the table only for art tabelle', () => {
  expect(meetingLayout(META).fields).toHaveLength(27);
  const notes = besprechungLayout({ ...META, art: '' }).background();
  expect(meetingLayout({ ...META, art: '' }).background()).toBe(notes);
  expect(meetingLayout({ ...META, art: 'Tabelle' }).background()).toBe(notes);
});
