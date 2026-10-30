import { expect, test } from 'vitest';
import { boundsOf, emptyBox, growBox, lineWidth } from '../../src/ink/bounds';
import { hitIndexes, pointsAlong, takeOut, takeOutIds } from '../../src/ink/erase';
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
