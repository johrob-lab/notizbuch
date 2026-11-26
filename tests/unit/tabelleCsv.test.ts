import { expect, test } from 'vitest';
import type { Page } from '../../src/ink/types';
import { csvDateiname, neuesterStrich, standHinweis } from '../../src/lib/tabelleCsv';

const STORE = JSON.stringify({ format: 1, verarbeitet: '2026-11-17 19:02', seiten: { '2': { stand: 2000 } } });
const HINWEIS = 'Stand der CSV: 17.11., 19:02. Neuere Striche kommen mit der nächsten Abendroutine dazu.';

test('the file is named after the meeting', () => {
  expect(csvDateiname('2026-10-29 0800 Abstimmung Muster 2027')).toBe('2026-10-29 0800 Abstimmung Muster 2027 Tabelle.csv');
});

test('no hint while the page has nothing newer than the CSV', () => {
  expect(standHinweis(STORE, 2, 2000)).toBeNull();
  expect(standHinweis(STORE, 3, 0)).toBeNull();
});

test('a page with newer strokes gets the time of the CSV', () => {
  expect(standHinweis(STORE, 2, 2001)).toBe(HINWEIS);
  expect(standHinweis(STORE, 3, 5)).toBe(HINWEIS);
});

test('a Sperren page reads its entry by the first month', () => {
  const store = JSON.stringify({ format: 1, verarbeitet: '2026-11-17 19:02', seiten: { '03': { stand: 5 } } });
  expect(standHinweis(store, '03', 9)).toBe(HINWEIS);
  expect(standHinweis(store, '03', 5)).toBeNull();
});

test('a missing or broken store gives no hint', () => {
  expect(standHinweis(null, 2, 9)).toBeNull();
  expect(standHinweis('{', 2, 9)).toBeNull();
  expect(standHinweis('{"format":1,"seiten":{}}', 2, 9)).toBeNull();
});

test('the newest stroke is the latest t', () => {
  const page = (ts: number[]) => ({ strokes: ts.map((t) => ({ t })) }) as unknown as Page;
  expect(neuesterStrich(page([5, 9]))).toBe(9);
  expect(neuesterStrich(page([]))).toBe(0);
});
