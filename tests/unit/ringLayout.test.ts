import { expect, test } from 'vitest';
import { ringLayout } from '../../src/ui/ringLayout';

test('ring items sit on their circles, the first straight above', () => {
  const r = ringLayout({ x: 500, y: 500 }, { inner: 7, outer: 9 }, { w: 1000, h: 1000 });
  expect(r.center).toEqual({ x: 500, y: 500 });
  expect(r.outer[0].x).toBeCloseTo(500); expect(r.outer[0].y).toBeCloseTo(500 - 118);
  for (const p of r.inner) expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(62);
  expect(r.inner).toHaveLength(7); expect(r.outer).toHaveLength(9);
});

test('the ring is pushed back onto the screen', () => {
  const R = 118 + 22 + 8;
  expect(ringLayout({ x: 10, y: 990 }, { inner: 7, outer: 9 }, { w: 1000, h: 1000 }).center).toEqual({ x: R, y: 1000 - R });
  expect(ringLayout({ x: 10, y: 10 }, { inner: 0, outer: 5 }, { w: 200, h: 200 }).center).toEqual({ x: 100, y: 100 });
});
