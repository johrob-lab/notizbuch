import { expect, test } from 'vitest';
import { neighborsOf, withMarks } from '../../src/ui/neighbors';

test('a day has the day before above and the day after below', () => {
  const n = neighborsOf({ view: 'tag', key: '2026-10-29' });
  expect(n.above?.route).toEqual({ view: 'tag', key: '2026-10-28' });
  expect(n.above?.path).toBe('07 Anhänge/Notizbuch/2026/2026-10-28 Tag.svg');
  expect(n.above?.layout.key).toBe('2026-10-28');
  expect(n.below?.route).toEqual({ view: 'tag', key: '2026-10-30' });
});

test('weeks and months chain across the year', () => {
  expect(neighborsOf({ view: 'woche', key: '2026-W53' }).below?.route).toEqual({ view: 'woche', key: '2027-W01' });
  expect(neighborsOf({ view: 'monat', key: '2026-01' }).above?.path).toBe('07 Anhänge/Notizbuch/2025/2025-12 Monat.svg');
});

test('the end of the calendar, meetings and settings have no neighbours', () => {
  expect(neighborsOf({ view: 'tag', key: '9998-12-31' }).below).toBeNull();
  expect(neighborsOf({ view: 'tag', key: '1000-01-01' }).above).toBeNull();
  expect(neighborsOf({ view: 'besprechung', key: 'x', n: 1 })).toEqual({ above: null, below: null });
  expect(neighborsOf({ view: 'einstellungen', key: '' })).toEqual({ above: null, below: null });
});

test('withMarks gives each neighbour the marks of its own layout and keeps everything else', () => {
  const plain = neighborsOf({ view: 'tag', key: '2026-10-29' });
  const marked = withMarks(plain, (layout) => `<text>${layout.key}</text>`);
  expect(marked.above).toEqual({ ...plain.above, marks: '<text>2026-10-28</text>' });
  expect(marked.below).toEqual({ ...plain.below, marks: '<text>2026-10-30</text>' });
  // `neighborsOf` selbst bleibt ohne `marks`, und ein fehlender Nachbar bleibt weg.
  expect(plain.above?.marks).toBeUndefined();
  expect(withMarks(neighborsOf({ view: 'tag', key: '1000-01-01' }), () => 'x').above).toBeNull();
  expect(withMarks(neighborsOf({ view: 'besprechung', key: 'x', n: 1 }), () => 'x')).toEqual({ above: null, below: null });
});
