import { expect, test } from 'vitest';
import { isScribble, scribbleTargets } from '../../src/ink/scribble';
import type { Stroke } from '../../src/ink/types';

// Kritzeln zum Löschen: reine Rechnung mit erfundenen Strichen, Orte in Seiteneinheiten (6 je Millimeter).

/** Zickzack: n Mal hin und her, `w` breit, über `h` nach unten verteilt. */
const zig = (n: number, w: number, h: number, x0 = 0, y0 = 0) =>
  Array.from({ length: n * 2 + 1 }, (_, i) => ({ x: x0 + (i % 2 ? w : 0), y: y0 + (i * h) / (n * 2) }));

/** „m“ in Schreibschrift: k Bögen nebeneinander, je 30 breit und 25 hoch, ein durchgehender Strich. */
function mmm(k: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let a = 0; a < k; a++) for (let i = 0; i <= 12; i++) pts.push({ x: a * 30 + (30 * i) / 12, y: 25 - 25 * Math.sin((Math.PI * i) / 12) });
  return pts;
}

/** „w“ in Schreibschrift: k Täler nebeneinander. */
function www(k: number): { x: number; y: number }[] {
  return mmm(k).map((p) => ({ x: p.x, y: 25 - p.y }));
}

function strokeFrom(pts: [number, number][], id: string): Stroke {
  return { id, tool: 'kugel', color: 'schwarz', widthMm: 0.2, t: 1, w: 1.2, pts: pts.map(([x, y]) => ({ x, y, w: 1.2 })) };
}

test('scribble recognized', () => {
  expect(isScribble(zig(4, 60, 30), 800)).toBe(true);
  expect(isScribble(zig(4, 60, 20).map((p) => ({ x: p.y, y: p.x })), 800)).toBe(true); // senkrecht gekritzelt
});

test('not a scribble', () => {
  expect(isScribble(zig(1, 60, 30), 400)).toBe(false); // ein Haken
  expect(isScribble(zig(4, 10, 5), 800)).toBe(false); // zu klein
  expect(isScribble(zig(4, 60, 30), 4000)).toBe(false); // zu langsam
  expect(isScribble(mmm(3), 900)).toBe(false);
  expect(isScribble(www(3), 900)).toBe(false);
});

test('targets only covered strokes', () => {
  const word = strokeFrom([[10, 10], [50, 12]], 'w');
  const neighbour = strokeFrom([[10, 10], [200, 10]], 'n');
  const s = strokeFrom(zig(4, 60, 20).map((p) => [p.x, p.y]), 'z');
  expect(scribbleTargets(s, [word, neighbour])).toEqual(['w']);
});

test('a stroke inside the box that the scribble never touches stays', () => {
  const s = strokeFrom(zig(4, 60, 40).map((p) => [p.x, p.y]), 'z');
  // ein kurzer Strich in einer Lücke des Zickzacks, weit weg von jeder Linie
  const gap = strokeFrom([[29, 5], [31, 5]], 'g');
  expect(scribbleTargets(s, [gap])).toEqual([]);
});

// ---------- Schlussprüfung: eigene Zeichnungen bleiben ----------

/** Hin und her, mit Punkten alle 2 Einheiten auf jeder Strecke (wie ein echter Stift). */
function dense(corners: [number, number][]): [number, number][] {
  const pts: [number, number][] = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const [ax, ay] = corners[i - 1];
    const [bx, by] = corners[i];
    const k = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 2));
    for (let j = 1; j <= k; j++) pts.push([ax + ((bx - ax) * j) / k, ay + ((by - ay) * j) / k]);
  }
  return pts;
}

/** Waagrechte Schraffur in einem Kreis um (cx, cy) mit Radius r: von Rand zu Rand, n Linien, ein Strich. */
function hatchCircle(cx: number, cy: number, r: number, n: number): [number, number][] {
  const corners: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const y = cy - r + ((i + 0.5) * 2 * r) / n;
    const half = Math.sqrt(r * r - (y - cy) ** 2);
    const [a, b] = i % 2 ? [cx + half, cx - half] : [cx - half, cx + half];
    corners.push([a, y], [b, y]);
  }
  return dense(corners);
}

const circle = (cx: number, cy: number, r: number, id: string): Stroke =>
  strokeFrom(Array.from({ length: 73 }, (_, i) => [cx + r * Math.cos((i * Math.PI) / 36), cy + r * Math.sin((i * Math.PI) / 36)] as [number, number]), id);

test('hatching inside a drawn circle keeps the circle', () => {
  const hatch = strokeFrom(hatchCircle(100, 100, 40, 8), 'h');
  expect(isScribble(hatch.pts, 900)).toBe(true);
  expect(scribbleTargets(hatch, [circle(100, 100, 40, 'c')])).toEqual([]);
});

test('filling a drawn checkbox keeps the box', () => {
  const box = strokeFrom(dense([[0, 0], [30, 0], [30, 30], [0, 30], [0, 0]]), 'b');
  const fill: [number, number][] = [];
  for (let i = 0; i < 8; i++) fill.push(i % 2 ? [28, 3 + i * 3.4] : [2, 3 + i * 3.4], i % 2 ? [2, 3 + i * 3.4] : [28, 3 + i * 3.4]);
  const s = strokeFrom(dense(fill), 'f');
  expect(scribbleTargets(s, [box])).toEqual([]);
});

test('going over an underline again is not a scribble', () => {
  const corners: [number, number][] = [];
  for (let i = 0; i < 7; i++) corners.push([i % 2 ? 0 : 120, 50 + (i % 3) * 0.5]);
  expect(isScribble(dense(corners).map(([x, y]) => ({ x, y })), 900)).toBe(false);
});

test('a word under a dense scribble is still erased', () => {
  const word = strokeFrom(dense([[200, 1000], [230, 1004], [260, 1000]]), 'w');
  const corners: [number, number][] = Array.from({ length: 9 }, (_, i) => [190 + (i % 2 ? 80 : 0), 990 + (i * 20) / 8]);
  expect(scribbleTargets(strokeFrom(dense(corners), 'z'), [word])).toEqual(['w']);
});
