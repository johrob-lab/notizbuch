import { expect, test } from 'vitest';
import type { Stroke } from '../../src/ink/types';
import { offerHandoff, takeHandoff, updateHandoff, type Handoff } from '../../src/ui/handoff';

const h = (path: string, at: number): Handoff => ({
  path,
  view: { s: 1, x: 0, y: 0 },
  page: { strokes: [], background: '' },
  read: true,
  from: { side: 'above', page: { strokes: [], background: '' }, read: true },
  at,
});

test('a handoff is taken once, by its own page, while it is fresh', () => {
  offerHandoff(h('a.svg', 1000));
  expect(takeHandoff('a.svg', 2000)?.path).toBe('a.svg');
  expect(takeHandoff('a.svg', 2000)).toBeNull();
});

test('another page or a late page does not get it, and it is gone afterwards', () => {
  offerHandoff(h('a.svg', 1000));
  expect(takeHandoff('b.svg', 1500)).toBeNull();
  expect(takeHandoff('a.svg', 1500)).toBeNull();
  offerHandoff(h('a.svg', 1000));
  expect(takeHandoff('a.svg', 3001)).toBeNull();
});

test('the newest handoff wins and paths are compared in NFC', () => {
  offerHandoff(h('a.svg', 1000));
  offerHandoff(h('Jänner.svg', 1100)); // a plus Trema (NFD), so liefern manche Eingaben es
  expect(takeHandoff('Jänner.svg', 1200)?.at).toBe(1100);
});

test('a handoff says whether each of its pages was read', () => {
  // Die Vorschau der neuen Seite war gelesen, die verlassene Seite hatte ihre Datei noch nicht.
  offerHandoff({ ...h('a.svg', 1000), from: { side: 'below', page: { strokes: [], background: '' }, read: false } });
  const taken = takeHandoff('a.svg', 1000);
  expect(taken?.read).toBe(true);
  expect(taken?.from).toEqual({ side: 'below', page: { strokes: [], background: '' }, read: false });
});

/** Ein erfundener Strich, wie er beim Abbau der verlassenen Seite noch fertig wird. */
const late: Stroke = { id: 'spaet', tool: 'kugel', color: 'schwarz', widthMm: 0.2, t: 1000, w: 1.2, pts: [{ x: 300, y: 1390, w: 1.2 }] };

test('the page that offered a handoff brings its newest state into it until it is taken', () => {
  const offered = h('a.svg', 1000);
  offerHandoff(offered);
  // Beim Abbau ist ein Strich fertig geworden, und die Sitzung hatte inzwischen gelesen.
  const leaving = { side: 'above' as const, page: { strokes: [late], background: '<svg/>' }, read: true };
  updateHandoff(offered, leaving);
  const taken = takeHandoff('a.svg', 1500);
  expect(taken?.from).toEqual(leaving);
  // Alles andere bleibt, auch die Zeit des Anbietens.
  expect({ ...taken, from: offered.from }).toEqual(offered);
  // Genommen ist sie weg: Ein spätes Ändern legt keine wieder bereit.
  updateHandoff(offered, leaving);
  expect(takeHandoff('a.svg', 1500)).toBeNull();
});

test('a handoff that a newer one replaced is not changed', () => {
  const first = h('a.svg', 1000);
  offerHandoff(first);
  const second = h('b.svg', 1100);
  offerHandoff(second);
  updateHandoff(first, { side: 'below', page: { strokes: [late], background: '' }, read: true });
  expect(takeHandoff('b.svg', 1200)).toBe(second);
});
