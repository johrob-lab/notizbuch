import { expect, test } from 'vitest';
import { ringLayout, type Pt } from '../../src/ui/ringLayout';

const C = { x: 500, y: 500 };
const AREA = { w: 1000, h: 1000 };

/** Kleiner als 0, wenn `b` auf dem Bildschirm (y nach unten) gegen den Uhrzeigersinn auf `a` folgt, gesehen von der Mitte C. */
const turn = (a: Pt, b: Pt) => (a.x - C.x) * (b.y - C.y) - (a.y - C.y) * (b.x - C.x);

test('ring items sit on their circles: the first inner one straight above, the outer one asked for straight below', () => {
  const r = ringLayout(C, { inner: 7, outer: 9 }, AREA, 5);
  expect(r.center).toEqual(C);
  expect(r.inner[0].x).toBeCloseTo(500); expect(r.inner[0].y).toBeCloseTo(500 - 62);
  expect(r.outer[5].x).toBeCloseTo(500); expect(r.outer[5].y).toBeCloseTo(500 + 118);
  for (const p of r.inner) expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(62);
  for (const p of r.outer) expect(Math.hypot(p.x - 500, p.y - 500)).toBeCloseTo(118);
  expect(r.inner).toHaveLength(7); expect(r.outer).toHaveLength(9);
});

test('without an item asked for below, the first outer one sits straight above too', () => {
  const r = ringLayout(C, { inner: 7, outer: 9 }, AREA);
  expect(r.outer[0].x).toBeCloseTo(500); expect(r.outer[0].y).toBeCloseTo(500 - 118);
});

test('the ring runs counter-clockwise: with 9 outer buttons Heute sits straight below, ‹ Heute › read from left to right', () => {
  const r = ringLayout(C, { inner: 7, outer: 9 }, AREA, 5);
  for (const circle of [r.inner, r.outer]) {
    for (let i = 1; i < circle.length; i++) expect(turn(circle[i - 1], circle[i])).toBeLessThan(0);
  }
  const [back, today, forward] = [r.outer[4], r.outer[5], r.outer[6]];
  expect(today.x).toBeCloseTo(500); expect(today.y).toBeCloseTo(618);
  expect(back.x).toBeLessThan(today.x);
  expect(today.x).toBeLessThan(forward.x);
  expect(back.y).toBeGreaterThan(500);
  expect(back.y).toBeCloseTo(forward.y);
});

test('without writing (5 outer buttons) Heute sits straight below too, ‹ to its left and › to its right', () => {
  const r = ringLayout(C, { inner: 0, outer: 5 }, AREA, 1);
  expect(r.inner).toEqual([]);
  for (let i = 1; i < r.outer.length; i++) expect(turn(r.outer[i - 1], r.outer[i])).toBeLessThan(0);
  const [back, today, forward, fit, exit] = r.outer;
  expect(today.x).toBeCloseTo(500); expect(today.y).toBeCloseTo(618);
  expect(back.x).toBeLessThan(today.x);
  expect(today.x).toBeLessThan(forward.x);
  expect(back.y).toBeGreaterThan(500);
  expect(back.y).toBeCloseTo(forward.y);
  // Ganze Seite und Vollbild aus liegen oben, rechts und links.
  expect(fit.y).toBeLessThan(500); expect(fit.x).toBeGreaterThan(500);
  expect(exit.y).toBeLessThan(500); expect(exit.x).toBeLessThan(500);
});

test('the ring is pushed back onto the screen', () => {
  const R = 118 + 22 + 8;
  expect(ringLayout({ x: 10, y: 990 }, { inner: 7, outer: 9 }, { w: 1000, h: 1000 }).center).toEqual({ x: R, y: 1000 - R });
  expect(ringLayout({ x: 10, y: 10 }, { inner: 0, outer: 5 }, { w: 200, h: 200 }).center).toEqual({ x: 100, y: 100 });
});
