import { expect, test } from 'vitest';
import { fmtNum, hitStroke, parsePathD, pathD, StrokeBuilder } from '../../src/ink/stroke';
import { SMOOTHING, type InkColor, type Stroke } from '../../src/ink/types';

function builder(sigma = 1.6) {
  return new StrokeBuilder({ color: 'schwarz', widthMm: 0.2, sigma, t: 1, minDist: 0.6 });
}

/** Ein gerader Strich mit zwei Punkten und der Breite 1.2 (0.2 mm). */
function line(x1: number, y1: number, x2: number, y2: number): Stroke {
  return {
    id: 'l1',
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t: 1,
    w: 1.2,
    pts: [
      { x: x1, y: y1, w: 1.2 },
      { x: x2, y: y2, w: 1.2 },
    ],
  };
}

/** Erfundene, aber immer gleiche Rohpunkte mit Zittern. Je zwei Punkte sind weit genug auseinander (über 0.6). */
function jitterPoints(n: number): { x: number; y: number }[] {
  let seed = 12345;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: n }, (_, i) => ({ x: i * 3 + next() * 2, y: next() * 20 }));
}

/** Die Glättung auf einen Schlag gerechnet, so wie `smoothTail` sie Punkt für Punkt rechnet. */
function referenceSmooth(raw: { x: number; y: number }[], sigma: number): { x: number; y: number }[] {
  if (!sigma) return raw.map(({ x, y }) => ({ x, y }));
  const K = Math.ceil(2.5 * sigma);
  return raw.map((_, i) => {
    const r = Math.min(K, i, raw.length - 1 - i);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    for (let j = -r; j <= r; j++) {
      const w = Math.exp(-(j * j) / (2 * sigma * sigma));
      sx += w * raw[i + j].x;
      sy += w * raw[i + j].y;
      sw += w;
    }
    return { x: sx / sw, y: sy / sw };
  });
}

// ---------- Tests aus dem Brief ----------

test('tip is not smoothed', () => {
  const b = new StrokeBuilder({ color: 'schwarz', widthMm: 0.2, sigma: 1.6, t: 1, minDist: 0.6 });
  for (const [x, y] of [
    [0, 0],
    [5, 1],
    [10, -1],
    [15, 1],
    [20, 0],
  ]) {
    b.add(x, y, 0.5);
    const p = b.stroke().pts.at(-1)!;
    expect([p.x, p.y]).toEqual([x, y]);
  }
});

test('jitter reduced', () => {
  const b = new StrokeBuilder({ color: 'schwarz', widthMm: 0.2, sigma: 1.6, t: 1, minDist: 0.6 });
  for (let i = 0; i < 40; i++) b.add(i * 2, i % 2 ? 1 : -1, 0.5);
  const inner = b.stroke().pts.slice(5, -5);
  expect(inner.reduce((s, p) => s + Math.abs(p.y), 0) / inner.length).toBeLessThan(0.5);
});

test('min distance skips', () => {
  const b = builder();
  expect(b.add(1, 1, 0.5)).toBe(true);
  expect(b.add(1.2, 1, 0.5)).toBe(false);
});

test('width from pressure', () => {
  const b = builder();
  b.add(0, 0, 0.5);
  b.add(10, 0, 0.5);
  expect(b.stroke().w).toBeCloseTo(0.2 * 6 * 1.0, 5);
});

test('pathD roundtrip', () => {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 5 },
    { x: 20, y: 0 },
    { x: 30, y: 7 },
    { x: 40, y: 2 },
    { x: 50, y: 9 },
  ];
  parsePathD(pathD(pts)).forEach((q, i) => {
    expect(q.x).toBeCloseTo(pts[i].x, 1);
    expect(q.y).toBeCloseTo(pts[i].y, 1);
  });
  expect(pathD([{ x: 5, y: 5 }])).toBe('M 5 5 L 5 5');
});

test('hit test', () => {
  const s = line(0, 0, 100, 0);
  expect(hitStroke(s, 50, 3, 5)).toBe(true);
  expect(hitStroke(s, 50, 20, 5)).toBe(false);
});

// ---------- Strich bauen ----------

test('the first point counts, a point under the minimum distance to the last kept point does not', () => {
  const b = builder();
  expect(b.add(0, 0, 0.5)).toBe(true);
  expect(b.add(0.5, 0, 0.5)).toBe(false); // unter 0.6
  // Der Abstand gilt zum letzten behaltenen Punkt (0), nicht zum verworfenen Vorgänger (0.5).
  expect(b.add(1.0, 0, 0.5)).toBe(true);
  expect(b.add(1.5, 0, 0.5)).toBe(false); // nur 0.5 vom letzten behaltenen Punkt (1.0)
  expect(b.add(1.7, 0, 0.5)).toBe(true);
  expect(b.stroke().pts).toHaveLength(3);
});

test('a dropped point does not touch the pressure or the width', () => {
  const b = builder(0);
  b.add(0, 0, 0.2);
  b.add(0.1, 0, 1.0); // verworfen
  b.add(10, 0, 0.2);
  // ps: 0.2, dann 0.7 * 0.2 + 0.3 * 0.2 = 0.2 (der verworfene Druck 1.0 fließt nicht ein)
  const widths = b.stroke().pts.map((p) => p.w);
  expect(widths[0]).toBeCloseTo(1.2 * (0.7 + 0.6 * 0.2), 9);
  expect(widths[1]).toBeCloseTo(1.2 * (0.7 + 0.6 * 0.2), 9);
});

test('start point is not smoothed either', () => {
  const raw = jitterPoints(30);
  const b = builder();
  raw.forEach((p) => b.add(p.x, p.y, 0.5));
  expect(b.stroke().pts[0]).toMatchObject({ x: raw[0].x, y: raw[0].y });
});

test('the smoothing window shrinks towards the tip', () => {
  const b = builder(1.6); // K = 4, aber bei drei Punkten bleibt für den mittleren nur r = 1
  b.add(0, 0, 0.5);
  b.add(10, 10, 0.5);
  b.add(20, 0, 0.5);
  const k = Math.exp(-1 / (2 * 1.6 * 1.6));
  const mid = b.stroke().pts[1];
  expect(mid.x).toBeCloseTo(10, 9);
  expect(mid.y).toBeCloseTo(10 / (1 + 2 * k), 9);
});

test('smoothing gives the same points as the batch reference for every setting', () => {
  const raw = jitterPoints(60);
  for (const sigma of Object.values(SMOOTHING)) {
    const b = builder(sigma);
    for (const p of raw) expect(b.add(p.x, p.y, 0.5)).toBe(true);
    const got = b.stroke().pts;
    const want = referenceSmooth(raw, sigma);
    expect(got, `sigma ${sigma}`).toHaveLength(raw.length);
    got.forEach((p, i) => {
      expect(p.x, `sigma ${sigma} x ${i}`).toBeCloseTo(want[i].x, 9);
      expect(p.y, `sigma ${sigma} y ${i}`).toBeCloseTo(want[i].y, 9);
    });
  }
});

test('a new point only recomputes the last K + 1 points', () => {
  const K = 4; // ceil(2.5 * 1.6)
  const raw = jitterPoints(30);
  const b = builder(1.6);
  raw.slice(0, 20).forEach((p) => b.add(p.x, p.y, 0.5));
  const before = b.stroke().pts;
  b.add(raw[20].x, raw[20].y, 0.5);
  const after = b.stroke().pts;
  // Die Punkte weiter vorn sind unverändert, auch als Objekt: sie wurden nicht neu berechnet.
  for (let i = 0; i < before.length - K; i++) expect(after[i]).toBe(before[i]);
  expect(after[before.length - K]).not.toBe(before[before.length - K]);
});

test('sigma 0 keeps the raw points', () => {
  const raw = jitterPoints(25);
  const b = builder(0);
  raw.forEach((p) => b.add(p.x, p.y, 0.5));
  expect(b.stroke().pts.map(({ x, y }) => ({ x, y }))).toEqual(raw);
});

test('pressure is smoothed, each point keeps its width and the stroke width is the mean', () => {
  const b = builder(1.6);
  [0.2, 1.0, 1.0].forEach((p, i) => b.add(i * 10, 0, p));
  // ps: 0.2, 0.7 * 0.2 + 0.3 * 1 = 0.44, 0.7 * 0.44 + 0.3 * 1 = 0.608; Breite = 1.2 * (0.7 + 0.6 * ps)
  const widths = [0.984, 1.1568, 1.27776];
  const s = b.stroke();
  s.pts.forEach((p, i) => expect(p.w).toBeCloseTo(widths[i], 9));
  expect(s.w).toBeCloseTo(1.13952, 9);
});

test('a missing or zero pressure counts as 0.5', () => {
  const b = builder();
  b.add(0, 0, 0);
  b.add(10, 0, Number.NaN);
  const s = b.stroke();
  expect(s.w).toBeCloseTo(0.2 * 6 * (0.7 + 0.6 * 0.5), 9);
  expect(s.pts.every((p) => Number.isFinite(p.w))).toBe(true);
});

test('the width follows the chosen millimetres', () => {
  const b = new StrokeBuilder({ color: 'schwarz', widthMm: 0.4, sigma: 0, t: 1, minDist: 0.6 });
  b.add(0, 0, 0.5);
  expect(b.stroke().w).toBeCloseTo(0.4 * 6, 9);
});

test('stroke carries tool, color, width, start time and a readable id', () => {
  const b = new StrokeBuilder({ color: 'rot', widthMm: 0.4, sigma: 0, t: 1793251082972, minDist: 0.6 });
  b.add(1, 1, 0.5);
  const s = b.stroke();
  expect(s).toMatchObject({ tool: 'kugel', color: 'rot', widthMm: 0.4, t: 1793251082972 });
  expect(s.id).toMatch(/^s1793251082972[0-9a-z]{4}$/);
  expect(b.stroke().id).toBe(s.id);
});

test('the builder keeps the options it got and ignores later changes to that object', () => {
  const options = { color: 'rot' as InkColor, widthMm: 0.4, sigma: 0, t: 7, minDist: 0.6 };
  const b = new StrokeBuilder(options);
  options.color = 'blau';
  options.widthMm = 0.1;
  options.minDist = 100;
  expect(b.add(0, 0, 0.5)).toBe(true);
  expect(b.add(1, 0, 0.5)).toBe(true); // mit minDist 100 würde der Punkt verworfen
  expect(b.stroke()).toMatchObject({ color: 'rot', widthMm: 0.4, t: 7 });
});

test('stroke() returns a snapshot that later points do not change', () => {
  const b = builder();
  b.add(0, 0, 0.5);
  const first = b.stroke();
  b.add(10, 0, 0.5);
  expect(first.pts).toHaveLength(1);
  expect(b.stroke().pts).toHaveLength(2);
});

test('an empty builder gives a stroke without points and the nominal width', () => {
  const s = builder().stroke();
  expect(s.pts).toEqual([]);
  expect(s.w).toBeCloseTo(0.2 * 6, 9);
});

// ---------- Pfad ----------

test('numbers have one decimal, no trailing zero and never a minus zero', () => {
  expect(fmtNum(5)).toBe('5');
  expect(fmtNum(5.0)).toBe('5');
  expect(fmtNum(10.5)).toBe('10.5');
  expect(fmtNum(1.26)).toBe('1.3');
  expect(fmtNum(3.04)).toBe('3');
  expect(fmtNum(-12.34)).toBe('-12.3');
  expect(fmtNum(-0.04)).toBe('0');
  expect(fmtNum(-0)).toBe('0');
  expect(fmtNum(Number.NaN)).toBe('0');
  expect(fmtNum(Number.POSITIVE_INFINITY)).toBe('0');
  expect(pathD([{ x: -0.04, y: 0.04 }, { x: 10.04, y: 10.06 }])).toBe('M 0 0 L 10 10.1');
  expect(pathD([{ x: -0.01, y: -0.02 }])).toBe('M 0 0 L 0 0');
});

test('path syntax: M, then Q with the control point and the middle to the next point, then L', () => {
  const p = (x: number, y: number) => ({ x, y });
  expect(pathD([])).toBe('');
  expect(pathD([p(5, 5)])).toBe('M 5 5 L 5 5');
  expect(pathD([p(0, 0), p(10.5, 20)])).toBe('M 0 0 L 10.5 20');
  expect(pathD([p(0, 0), p(10, 5), p(20, 0)])).toBe('M 0 0 Q 10 5 15 2.5 L 20 0');
  expect(pathD([p(0, 0), p(10, 5), p(20, 0), p(30, 7)])).toBe('M 0 0 Q 10 5 15 2.5 Q 20 0 25 3.5 L 30 7');
});

test('parsePathD gives back the M point, every Q control point and the L point', () => {
  expect(parsePathD('M 0 0 Q 10 5 15 2.5 Q 20 0 25 3.5 L 30 7')).toEqual([
    { x: 0, y: 0 },
    { x: 10, y: 5 },
    { x: 20, y: 0 },
    { x: 30, y: 7 },
  ]);
  expect(parsePathD('M 0 0 L 10.5 20')).toEqual([
    { x: 0, y: 0 },
    { x: 10.5, y: 20 },
  ]);
  expect(parsePathD('M 5 5 L 5 5')).toEqual([
    { x: 5, y: 5 },
    { x: 5, y: 5 },
  ]);
  expect(parsePathD('M -1.5 -0.5   L 2 3')).toEqual([
    { x: -1.5, y: -0.5 },
    { x: 2, y: 3 },
  ]);
});

test('parsePathD gives no points for anything it cannot read', () => {
  expect(parsePathD('')).toEqual([]);
  expect(parsePathD('   ')).toEqual([]);
  expect(parsePathD('M 1')).toEqual([]);
  expect(parsePathD('M 1 2 Q 3 4')).toEqual([]);
  expect(parsePathD('M 1 x')).toEqual([]);
  expect(parsePathD('M 1 2 C 1 2 3 4 5 6')).toEqual([]);
  expect(parsePathD('1 2 3 4')).toEqual([]);
  expect(parsePathD('M 1 2 L NaN 3')).toEqual([]);
});

// ---------- Trefferprüfung ----------

test('hit test counts half the line width and reaches past the ends', () => {
  const s = line(0, 0, 100, 0); // Breite 1.2, also zählt 5 + 0.6
  expect(hitStroke(s, 50, 5.5, 5)).toBe(true);
  expect(hitStroke(s, 50, 5.7, 5)).toBe(false);
  expect(hitStroke(s, 104, 0, 5)).toBe(true);
  expect(hitStroke(s, 106, 0, 5)).toBe(false);
});

test('hit test works for a dot and for a stroke without points', () => {
  const dot: Stroke = { ...line(0, 0, 0, 0), pts: [{ x: 10, y: 10, w: 1.2 }] };
  expect(hitStroke(dot, 13, 14, 5)).toBe(true); // Abstand 5
  expect(hitStroke(dot, 16, 10, 5)).toBe(false); // Abstand 6
  expect(hitStroke({ ...dot, pts: [] }, 10, 10, 5)).toBe(false);
});

test('hit test follows the bends of a stroke', () => {
  const s: Stroke = {
    ...line(0, 0, 0, 0),
    pts: [
      { x: 0, y: 0, w: 1.2 },
      { x: 100, y: 0, w: 1.2 },
      { x: 100, y: 100, w: 1.2 },
    ],
  };
  expect(hitStroke(s, 100, 50, 3)).toBe(true); // auf dem zweiten Stück
  expect(hitStroke(s, 50, 50, 3)).toBe(false); // in der Mitte der Ecke, weit weg
});
