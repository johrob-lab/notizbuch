import { expect, test } from 'vitest';
import { neighborsOf } from '../../src/ui/neighbors';

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
