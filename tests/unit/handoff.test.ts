import { expect, test } from 'vitest';
import { offerHandoff, takeHandoff, type Handoff } from '../../src/ui/handoff';

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
