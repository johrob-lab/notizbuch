import { expect, test } from 'vitest';
import { parsePage } from '../../src/ink/svg';
import { copyPathFor, mergeByKind } from '../../src/sync/conflicts';
import { fixture, lineOf } from './helpers';
import { toggleTask } from '../../src/lib/dailyNote';
import { svgPage } from './syncHelpers';

// Alles hier ist erfunden.

const base = fixture('05 Daily Notes/2026-10-29.md');

// ---------- Name der Konfliktkopie ----------

test('the first copy is called (Konflikt), then the number counts up', () => {
  const path = '05 Daily Notes/2026-10-29.md';
  expect(copyPathFor(path, 1)).toBe('05 Daily Notes/2026-10-29 (Konflikt).md');
  expect(copyPathFor(path, 2)).toBe('05 Daily Notes/2026-10-29 (Konflikt 2).md');
  expect(copyPathFor(path, 3)).toBe('05 Daily Notes/2026-10-29 (Konflikt 3).md');
  expect(copyPathFor(path, 12)).toBe('05 Daily Notes/2026-10-29 (Konflikt 12).md');
});

test('the number goes in front of the extension, also for pages and odd names', () => {
  expect(copyPathFor('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg', 2)).toBe('07 Anhänge/Notizbuch/2026/2026-10-29 Tag (Konflikt 2).svg');
  expect(copyPathFor('07 Anhänge/Notizbuch/2026/ohne Endung', 2)).toBe('07 Anhänge/Notizbuch/2026/ohne Endung (Konflikt 2)');
  expect(copyPathFor('02 Projekte/v1.2/Notiz.md', 2)).toBe('02 Projekte/v1.2/Notiz (Konflikt 2).md');
});

test('a folder that already has the marker in its name does not confuse the number', () => {
  expect(copyPathFor('02 Projekte/Alt (Konflikt)/Notiz.md', 3)).toBe('02 Projekte/Alt (Konflikt)/Notiz (Konflikt 3).md');
});

// ---------- Zusammenführen je Dateiart ----------

test('md: equal texts need no merge, the text of the other side is returned as is', () => {
  expect(mergeByKind('md', base, 'gleich', 'gleich')).toBe('gleich');
  expect(mergeByKind('md', null, 'gleich', 'gleich')).toBe('gleich');
});

test('md: changes on different lines come together', () => {
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  const theirs = base.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 gemeldet%%');
  const merged = mergeByKind('md', base, ours, theirs);
  expect(merged).toContain('- [x] Liste Planobjekte');
  expect(merged).toContain('todo:AAMkTEST2 gemeldet');
});

test('md: the same line changed on both sides cannot be merged', () => {
  const ours = base.replace('Urlaube im Plan nachziehen', 'Urlaube heute nachziehen');
  const theirs = base.replace('Urlaube im Plan nachziehen', 'Urlaube morgen nachziehen');
  expect(mergeByKind('md', base, ours, theirs)).toBeNull();
});

test('md: without a base two different texts cannot be merged', () => {
  expect(mergeByKind('md', null, 'eins', 'zwei')).toBeNull();
});

test('svg: the strokes of both sides come together', () => {
  const merged = mergeByKind('svg', null, svgPage('a', 'o'), svgPage('a', 'r'));
  expect(merged).not.toBeNull();
  expect(parsePage(merged as string).strokes.map((s) => s.id).sort()).toEqual(['a', 'o', 'r']);
});

test('svg: an unreadable page cannot be merged, but equal texts never get parsed', () => {
  expect(mergeByKind('svg', null, svgPage('a'), 'kein SVG')).toBeNull();
  expect(mergeByKind('svg', null, 'kein SVG', svgPage('a'))).toBeNull();
  expect(mergeByKind('svg', null, 'kein SVG', 'kein SVG')).toBe('kein SVG');
});
