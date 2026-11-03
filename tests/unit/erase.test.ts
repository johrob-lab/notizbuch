import { expect, test } from 'vitest';
import { boundsOf, emptyBox, growBox, lineWidth } from '../../src/ink/bounds';
import { cutStroke, densify, ERASER_PX, hitIndexes, pointsAlong, takeOut, takeOutIds } from '../../src/ink/erase';
import { History } from '../../src/ink/history';
import { MM, type Stroke } from '../../src/ink/types';

// Rahmen, Radierer und Treffer: reine Rechnung mit Strichen. Orte in Seiteneinheiten. Alles hier ist erfunden.

function line(id: string, [x0, y0]: [number, number], [x1, y1]: [number, number], w = 1.2): Stroke {
  return {
    id,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t: 1,
    w,
    pts: [
      { x: x0, y: y0, w },
      { x: x1, y: y1, w },
    ],
  };
}

const ids = (strokes: Stroke[]): string[] => strokes.map((s) => s.id);

// ---------- Rahmen ----------

test('the box of a stroke holds all its points, and the widest point is remembered', () => {
  const s: Stroke = {
    ...line('a', [0, 0], [0, 0]),
    pts: [
      { x: 10, y: 20, w: 1 },
      { x: 30, y: 5, w: 3 },
      { x: 25, y: 40, w: 2 },
    ],
  };
  expect(boundsOf(s)).toEqual({ box: [10, 5, 30, 40], maxW: 3 });
});

test('the box is worked out once per stroke', () => {
  const s = line('a', [0, 0], [10, 10]);
  expect(boundsOf(s)).toBe(boundsOf(s));
});

test('a box grows only where a point lies outside it', () => {
  const box = emptyBox();
  growBox(box, { x: 5, y: 5 });
  expect(box).toEqual([5, 5, 5, 5]);
  growBox(box, { x: 2, y: 9 });
  expect(box).toEqual([2, 5, 5, 9]);
  growBox(box, { x: 3, y: 6 });
  expect(box).toEqual([2, 5, 5, 9]);
});

test('a stroke is drawn with its width, from its nominal width when it has none, and never thinner than one pixel', () => {
  expect(lineWidth(line('a', [0, 0], [1, 1], 1.2), 0.5)).toBe(1.2);
  expect(lineWidth({ ...line('a', [0, 0], [1, 1]), w: 0, widthMm: 0.2 }, 0.5)).toBeCloseTo(0.2 * MM, 5);
  expect(lineWidth(line('a', [0, 0], [1, 1], 0.2), 0.5)).toBe(0.5);
});

// ---------- Weg des Radierers ----------

test('a path is checked every 5 units and ends exactly at its end', () => {
  expect(pointsAlong({ x: 0, y: 0 }, { x: 20, y: 0 })).toEqual([
    { x: 5, y: 0 },
    { x: 10, y: 0 },
    { x: 15, y: 0 },
    { x: 20, y: 0 },
  ]);
});

test('the steps are even and at most 5 units long', () => {
  expect(pointsAlong({ x: 0, y: 0 }, { x: 12, y: 0 })).toEqual([
    { x: 4, y: 0 },
    { x: 8, y: 0 },
    { x: 12, y: 0 },
  ]);
  const diagonal = pointsAlong({ x: 0, y: 0 }, { x: 30, y: 40 }); // 50 lang, also 10 Schritte
  expect(diagonal).toHaveLength(10);
  expect(diagonal[0]).toEqual({ x: 3, y: 4 });
  expect(diagonal[9]).toEqual({ x: 30, y: 40 });
});

test('a path shorter than one step still checks its end, and a path of no length checks its point', () => {
  expect(pointsAlong({ x: 0, y: 0 }, { x: 1, y: 0 })).toEqual([{ x: 1, y: 0 }]);
  expect(pointsAlong({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([{ x: 3, y: 3 }]);
});

test('the distance between checks can be chosen', () => {
  expect(pointsAlong({ x: 0, y: 0 }, { x: 10, y: 0 }, 2)).toHaveLength(5);
});

// ---------- Treffer ----------

test('strokes within the radius are hit, the highest place first, and far ones are not', () => {
  const strokes = [
    line('far', [0, 300], [100, 300]),
    line('upper', [0, 50], [100, 50]),
    line('lower', [0, 60], [100, 60]),
    line('also-far', [400, 55], [500, 55]),
  ];
  expect(hitIndexes(strokes, { x: 50, y: 55 }, 10, 0)).toEqual([2, 1]);
});

test('the radius and half the width of the stroke decide', () => {
  const strokes = [line('a', [0, 50], [100, 50], 1.2)]; // trifft bis 10 + 0,6
  expect(hitIndexes(strokes, { x: 50, y: 60.5 }, 10, 0)).toEqual([0]);
  expect(hitIndexes(strokes, { x: 50, y: 60.7 }, 10, 0)).toEqual([]);
});

test('the width the stroke is drawn with counts, not only its own', () => {
  const thin = [line('a', [0, 50], [100, 50], 0.2)]; // gezeichnet mindestens 1 breit
  expect(hitIndexes(thin, { x: 50, y: 60.45 }, 10, 0)).toEqual([]);
  expect(hitIndexes(thin, { x: 50, y: 60.45 }, 10, 1)).toEqual([0]);
});

test('a stroke of a single point is a dot', () => {
  const dot: Stroke = { ...line('dot', [0, 0], [0, 0]), pts: [{ x: 20, y: 20, w: 1.2 }] };
  expect(hitIndexes([dot], { x: 25, y: 20 }, 10, 0)).toEqual([0]);
  expect(hitIndexes([dot], { x: 40, y: 20 }, 10, 0)).toEqual([]);
});

test('no strokes, no hits', () => {
  expect(hitIndexes([], { x: 0, y: 0 }, 10, 0)).toEqual([]);
});

// ---------- Herausnehmen ----------

test('taking strokes out says where each one stood, so undo can put it back', () => {
  const strokes = ['a', 'b', 'c', 'd', 'e'].map((id) => line(id, [0, 0], [1, 1]));
  const removed = takeOut(strokes, [3, 1]);
  expect(ids(strokes)).toEqual(['a', 'c', 'e']);
  expect(removed.map((r) => [r.stroke.id, r.index])).toEqual([
    ['d', 3],
    ['b', 1],
  ]);

  const history = new History();
  history.push({ type: 'erase', removed });
  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('taking out nothing changes nothing', () => {
  const strokes = [line('a', [0, 0], [1, 1])];
  expect(takeOut(strokes, [])).toEqual([]);
  expect(ids(strokes)).toEqual(['a']);
});

test('strokes are also taken out by id, for a page that was replaced while erasing', () => {
  const strokes = ['a', 'b', 'c', 'd', 'e'].map((id) => line(id, [0, 0], [1, 1]));
  const [, b, , d] = strokes;
  const removed = takeOutIds(strokes, new Set(['b', 'd', 'unknown']));
  expect(ids(strokes)).toEqual(['a', 'c', 'e']);
  expect(removed.map((r) => [r.stroke.id, r.index])).toEqual([
    ['d', 3],
    ['b', 1],
  ]);
  // Es sind die Striche der Liste selbst, damit Rückgängig genau sie zurückbringt.
  expect(removed[0].stroke).toBe(d);
  expect(removed[1].stroke).toBe(b);

  const history = new History();
  history.push({ type: 'erase', removed });
  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'b', 'c', 'd', 'e']);
  history.redo(strokes);
  expect(ids(strokes)).toEqual(['a', 'c', 'e']);
});

test('ids that are not on the page take nothing out', () => {
  const strokes = [line('a', [0, 0], [1, 1])];
  expect(takeOutIds(strokes, new Set(['x']))).toEqual([]);
  expect(takeOutIds(strokes, new Set())).toEqual([]);
  expect(ids(strokes)).toEqual(['a']);
});

// ---------- Teil-Radieren ----------

const straight = (id = 'a'): Stroke => line(id, [0, 0], [100, 0]);
let next = 0;
const freshId = () => `n${++next}`;

test('cut through the middle gives two pieces', () => {
  const parts = cutStroke(straight(), { x: 50, y: 0 }, 5, freshId)!;
  expect(parts).toHaveLength(2);
  expect(Math.max(...parts[0].pts.map((p) => p.x))).toBeLessThan(45);
  expect(Math.min(...parts[1].pts.map((p) => p.x))).toBeGreaterThan(55);
  expect(parts.every((p) => p.id !== 'a' && p.color === 'schwarz' && p.w === 1.2 && p.t === 1 && p.widthMm === 0.2)).toBe(true);
  expect(new Set(parts.map((p) => p.id)).size).toBe(2);
});

test('miss returns null, end cut gives one piece, dot disappears', () => {
  expect(cutStroke(straight(), { x: 50, y: 30 }, 5, freshId)).toBeNull();
  expect(cutStroke(straight(), { x: 100, y: 0 }, 5, freshId)).toHaveLength(1);
  expect(cutStroke({ ...straight(), pts: [{ x: 10, y: 10, w: 1.2 }] }, { x: 10, y: 10 }, 5, freshId)).toEqual([]);
});

test('densify', () => {
  expect(densify([{ x: 0, y: 0, w: 1 }, { x: 10, y: 0, w: 3 }], 2.5).map((p) => [p.x, p.w])).toEqual([
    [0, 1],
    [2.5, 1.5],
    [5, 2],
    [7.5, 2.5],
    [10, 3],
  ]);
});

test('eraser sizes', () => {
  expect(ERASER_PX).toEqual({ klein: 5, mittel: 10, gross: 22 });
});

test('undo after partial erase restores the original', () => {
  const strokes = [straight('a'), straight('b')];
  const h = new History();
  const before = strokes.slice();
  strokes.splice(0, 1, ...cutStroke(strokes[0], { x: 50, y: 0 }, 5, freshId)!);
  h.push({ type: 'swap', before, after: strokes.slice() });
  h.undo(strokes);
  expect(strokes.map((s) => s.id)).toEqual(['a', 'b']);
  h.redo(strokes);
  expect(strokes).toHaveLength(3);
});

test('cut densifies only near the cut', () => {
  const long = line('L', [0, 0], [1000, 0]);
  const parts = cutStroke(long, { x: 500, y: 0 }, 0.6, freshId)!;
  expect(parts).toHaveLength(2);
  expect(parts[0].pts.length + parts[1].pts.length).toBeLessThan(20);
  expect(parts[0].pts[0]).toEqual({ x: 0, y: 0, w: 1.2 });
  expect(parts[1].pts.at(-1)).toEqual({ x: 1000, y: 0, w: 1.2 });
});

test('grazing the stroke without removing a point changes nothing', () => {
  expect(cutStroke(straight(), { x: 51.25, y: 5.5 }, 5, freshId)).toBeNull();
});

// ---------- Radieren nach der Breite an jeder Stelle (Füllfeder, Bleistift) ----------

/** Gerade von (0, 0) nach (100, 0) mit 11 Punkten, die Breite steigt gleichmäßig von 1 auf 12. */
function ramp(tool: 'fueller' | 'bleistift' = 'fueller'): Stroke {
  const pts = Array.from({ length: 11 }, (_, i) => ({ x: i * 10, y: 0, w: 1 + i * 1.1 }));
  return { id: 'r', tool, color: tool === 'bleistift' ? 'grau' : 'schwarz', widthMm: 0.4, t: 1, w: 6.5, pts };
}

test('the eraser hits a fountain pen stroke where it is wide and misses it where it is thin', () => {
  const s = ramp();
  expect(hitIndexes([s], { x: 95, y: 5 }, 1, 0.5)).toEqual([0]);
  expect(hitIndexes([s], { x: 5, y: 5 }, 1, 0.5)).toEqual([]);
});

test('cutting a fountain pen stroke keeps the tool, the colour and the width of every point', () => {
  const s = ramp();
  const pieces = cutStroke(s, { x: 50, y: 0 }, 2, () => 'n' + Math.random());
  expect(pieces).not.toBeNull();
  expect(pieces!.length).toBe(2);
  for (const p of pieces!) {
    expect(p.tool).toBe('fueller');
    expect(p.color).toBe('schwarz');
    expect(p.w).toBeCloseTo(p.pts.reduce((a, q) => a + q.w, 0) / p.pts.length, 9);
    // Original-Punkte behalten ihre Breite
    for (const q of p.pts) {
      const orig = s.pts.find((o) => o.x === q.x);
      if (orig) expect(q.w).toBe(orig.w);
    }
  }
  expect(pieces![0].pts[0].w).toBe(1);
  expect(pieces![1].pts[pieces![1].pts.length - 1].w).toBeCloseTo(12, 9);
});

test('cutting a pencil stroke keeps it grey', () => {
  const pieces = cutStroke(ramp('bleistift'), { x: 50, y: 0 }, 2, () => 'x');
  expect(pieces!.length).toBe(2);
  for (const p of pieces!) {
    expect(p.tool).toBe('bleistift');
    expect(p.color).toBe('grau');
  }
});
