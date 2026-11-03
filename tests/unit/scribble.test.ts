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
