import { expect, test } from 'vitest';
import {
  DEFAULT_FUELLER,
  doubled,
  nibFactorR,
  pressureFactor,
  STABIL_SIGMA,
  TAPER_LEN,
  TAPER_TIP,
  type FuellerSettings,
} from '../../src/ink/pens';
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

test('settled', () => {
  const b = new StrokeBuilder({ color: 'schwarz', widthMm: 0.2, sigma: 1.6, t: 1, minDist: 0.6 }); // K = 4
  for (let i = 0; i < 10; i++) b.add(i * 3, 0, 0.5);
  expect(b.settled()).toBe(5);
  const before = b.points().slice(0, b.settled()).map((p) => ({ ...p }));
  for (let i = 10; i < 20; i++) b.add(i * 3, i % 2, 0.5);
  expect(b.points().slice(0, before.length)).toEqual(before);
  expect(b.meanW()).toBeCloseTo(b.stroke().w, 9);
  const b0 = new StrokeBuilder({ color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.6 });
  b0.add(0, 0, 0.5);
  b0.add(5, 0, 0.5);
  expect(b0.settled()).toBe(2);
});

// ---------- Stifte (Paket 3) ----------

/** 40 Punkte alle 2 Einheiten auf einer Geraden mit der Richtung (dx, dy), ohne Glättung. */
function penLine(pen: 'kugel' | 'fineliner' | 'fueller' | 'bleistift', dir: [number, number], pressure: number | ((i: number) => number), tilt: [number, number] = [40, 40], color: InkColor = 'schwarz') {
  const b = new StrokeBuilder({ pen, color, widthMm: 0.2, sigma: 0, t: 1, minDist: 0.5 });
  const len = Math.hypot(dir[0], dir[1]);
  for (let i = 0; i < 40; i++) {
    const p = typeof pressure === 'function' ? pressure(i) : pressure;
    b.add((dir[0] / len) * 2 * i, (dir[1] / len) * 2 * i, p, tilt[0], tilt[1]);
  }
  return b.stroke();
}

test('a builder without a pen is a ballpoint and draws as before', () => {
  const b = builder();
  b.add(0, 0, 0.5);
  b.add(10, 0, 0.5);
  expect(b.stroke().tool).toBe('kugel');
  expect(b.stroke().w).toBeCloseTo(0.2 * 6 * 1.0, 5);
});

test('the fineliner draws 1.25 times the nominal width whatever the pressure', () => {
  const s = penLine('fineliner', [1, 0], (i) => (i % 2 ? 0.9 : 0.1));
  expect(s.tool).toBe('fineliner');
  for (const p of s.pts) expect(p.w).toBeCloseTo(1.5, 9);
});

test('the fountain pen width follows the pressure', () => {
  // Startwert der Druckempfindlichkeit 25 %: leicht 0,8-fach, fest 1,2-fach.
  const lo = penLine('fueller', [1, 1], 0.1).pts;
  const hi = penLine('fueller', [1, 1], 0.8).pts;
  expect(hi[hi.length - 1].w / lo[lo.length - 1].w).toBeCloseTo(1.2 / 0.8, 9);
});

test('without tilt the fountain pen uses the right hand hold', () => {
  const a = penLine('fueller', [1, 0.3], 0.5, [0, 0]).pts;
  const b = penLine('fueller', [1, 0.3], 0.5, [40, 40]).pts;
  expect(a.map((p) => p.w)).toEqual(b.map((p) => p.w));
});

test('a pencil stroke is grey and between 0.6 and 1.4 times the nominal width', () => {
  const lo = penLine('bleistift', [1, 0], 0.1, [0, 0], 'blau');
  const hi = penLine('bleistift', [1, 0], 0.8, [0, 0], 'blau');
  expect(lo.color).toBe('grau');
  expect(lo.tool).toBe('bleistift');
  expect(lo.pts[lo.pts.length - 1].w).toBeCloseTo(0.72, 9);
  expect(hi.pts[hi.pts.length - 1].w).toBeCloseTo(1.68, 9);
});

test('odd input never gives NaN widths', () => {
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.5 });
  b.add(0, 0, 0, NaN, NaN);
  b.add(0, 0, 0, NaN, NaN);
  b.add(5, 0, NaN, NaN, 3);
  b.add(5, 0, 0, 0, 0);
  b.add(9, 4, 0, 0, 0);
  for (const p of b.stroke().pts) {
    expect(Number.isFinite(p.w)).toBe(true);
    expect(p.w).toBeGreaterThan(0);
  }
});

// ---------- Füllfeder wie GoodNotes (Paket 3b) ----------

/** Nennbreite 0,2 mm in Seiteneinheiten. */
const NOM = 1.2;

/**
 * Füllfeder wie am iPad stark gezoomt: Ein Bildschirmpunkt ist 0,1 Seiteneinheiten, der Mindestabstand 0,05 lässt dichte
 * Punkte durch. Ohne Glättung, damit die Punkte genau dort liegen, wo der Stift war. Ohne Angabe die Startwerte der Regler.
 */
function fueller(settings: Partial<FuellerSettings> = {}): StrokeBuilder {
  return new StrokeBuilder({
    pen: 'fueller',
    color: 'schwarz',
    widthMm: 0.2,
    sigma: 0,
    t: 1,
    minDist: 0.05,
    pxUnit: 0.1,
    fueller: { ...DEFAULT_FUELLER, ...settings },
  });
}

type XY = { x: number; y: number };

/** Zahlen von 0 bis 1, die für denselben Startwert (nicht 0) immer gleich sind. */
function random(seed: number): () => number {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
}

/** Punkte alle `step` Einheiten von `from` aus in Richtung `dir`, `len` Einheiten weit. `from` selbst ist nicht dabei. */
function straight(from: XY, dir: [number, number], len: number, step: number): XY[] {
  const l = Math.hypot(dir[0], dir[1]);
  return Array.from({ length: Math.round(len / step) }, (_, i) => ({
    x: from.x + (dir[0] / l) * step * (i + 1),
    y: from.y + (dir[1] / l) * step * (i + 1),
  }));
}

/** `n` Punkte zufällig im Umkreis `r` um `c`: ein Stift, der dort steht und zittert. */
function around(c: XY, r: number, n: number, rnd: () => number): XY[] {
  return Array.from({ length: n }, () => {
    const a = 2 * Math.PI * rnd();
    const d = r * Math.sqrt(rnd());
    return { x: c.x + d * Math.cos(a), y: c.y + d * Math.sin(a) };
  });
}

/** Gibt die Punkte mit gleichem Druck und gleicher Neigung in den Strich (Neigung 40, 40: der Stift zeigt nach rechts unten). */
function feed(b: StrokeBuilder, pts: XY[], pressure = 0.45, tilt: [number, number] = [40, 40]): void {
  for (const p of pts) b.add(p.x, p.y, pressure, tilt[0], tilt[1]);
}

const widths = (pts: readonly { w: number }[]): number[] => pts.map((p) => p.w);

test('a resting, jittering pen does not grow a blob', () => {
  /**
   * Der Stift zieht 20 Einheiten in Richtung `dir`, bleibt am Ende stehen und zittert: 200 Punkte im Umkreis von 0,3 Einheiten
   * (3 Bildschirmpunkte). Die Breite in der Bewegung davor und die Breiten im Stand, beim Schreiben (points und stroke): Die
   * Verjüngung am Ende kommt erst beim Abheben dazu.
   */
  const rest = (dir: [number, number], seed: number) => {
    const b = fueller();
    const start = { x: 100, y: 100 };
    const line = straight(start, dir, 20, 0.1);
    feed(b, [start, ...line]);
    const moving = b.points()[b.points().length - 1].w;
    const n = b.points().length;
    feed(b, around(line[line.length - 1], 0.3, 200, random(seed)));
    return { moving, resting: widths(b.points().slice(n)), stroked: widths(b.stroke().pts.slice(n)) };
  };
  // Entlang der Feder (nach rechts unten).
  const { moving, resting, stroked } = rest([1, 1], 4711);
  expect(resting.length).toBeGreaterThan(100);
  expect(Math.max(...resting)).toBeLessThanOrEqual(1.05 * Math.min(...resting));
  // Kein Klecks: Im Stand wird die Linie auch nicht breiter als in der Bewegung davor.
  expect(Math.max(...resting)).toBeLessThanOrEqual(1.05 * moving);
  expect(stroked).toEqual(resting);
  // Quer zur Feder (nach rechts oben) ist die Breite am empfindlichsten: Nach der geraden Bewegung ist das Seil der Richtung
  // straff, das Zittern zieht den Anker noch um höchstens seine eigene Breite nach und dreht die Richtung dabei ein wenig.
  // Über 200 Startwerte gemessen: höchstens 4,0 % breiter als in der Bewegung, Spanne im Stand höchstens 3,6 %.
  for (let seed = 1; seed <= 200; seed++) {
    const across = rest([1, -1], seed);
    const widest = Math.max(...across.resting);
    expect(across.resting.length, `Startwert ${seed}`).toBeGreaterThan(100);
    expect(widest, `Startwert ${seed}`).toBeLessThanOrEqual(1.05 * across.moving);
    expect(widest, `Startwert ${seed}`).toBeLessThanOrEqual(1.05 * Math.min(...across.resting));
  }
});

test('jitter at the start does not eat the taper', () => {
  const start = { x: 100, y: 100 };
  const line = straight(start, [1, 1], 20, 0.1);
  const at = line[44]; // 4,5 Einheiten vom Start, mitten in der Verjüngung am Anfang
  const widthAt = (b: StrokeBuilder): number => b.points().find((p) => p.x === at.x && p.y === at.y)!.w;
  const calm = fueller();
  feed(calm, [start, ...line]);
  // Der Stift setzt am Startpunkt auf, zittert dort 200 Punkte lang im Umkreis von 0,3 Einheiten und zieht dann los.
  const shaky = fueller();
  feed(shaky, [start, ...around(start, 0.3, 200, random(42)), ...line]);
  expect(shaky.points().length).toBeGreaterThan(calm.points().length + 100);
  const full = calm.points()[calm.points().length - 1].w;
  expect(widthAt(calm)).toBeLessThan(0.85 * full); // dort wirkt die Verjüngung noch
  expect(Math.abs(widthAt(shaky) / widthAt(calm) - 1)).toBeLessThanOrEqual(0.03);
});

test('a slow, jittery line keeps a smooth edge', () => {
  // Nach rechts unten, Punkte alle 0,15 Einheiten, quer dazu bis zu 0,08 Einheiten Zittern, 60 Einheiten lang.
  const rnd = random(2026);
  const dir = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
  const pts = Array.from({ length: 401 }, (_, i) => {
    const q = (2 * rnd() - 1) * 0.08;
    return { x: 100 + dir.x * 0.15 * i - dir.y * q, y: 100 + dir.y * 0.15 * i + dir.x * q };
  });
  const b = fueller();
  feed(b, pts);
  const along = (p: XY): number => (p.x - 100) * dir.x + (p.y - 100) * dir.y;
  const done = b.finish().pts;
  let pairs = 0;
  for (let i = 1; i < done.length; i++) {
    // Nur außerhalb der Verjüngungen (je 9 Einheiten an jedem Ende, mit etwas Rand).
    if (along(done[i - 1]) < 10 || along(done[i]) > 50) continue;
    pairs++;
    expect(Math.abs(done[i].w / done[i - 1].w - 1), `Punkt ${i}`).toBeLessThanOrEqual(0.03);
  }
  expect(pairs).toBeGreaterThan(200);
});

test('the fountain pen is thick along the pen and thin across it', () => {
  // Neigung (40, 40): Der Stift zeigt nach rechts unten. Rundung 0 ist die ganz flache Feder, Druck 0,45 der mittlere Druck.
  const middle = (dir: [number, number]): number => {
    const b = fueller({ rundung: 0 });
    const start = { x: 100, y: 100 };
    feed(b, [start, ...straight(start, dir, 60, 0.15)]);
    const pts = b.finish().pts;
    return pts[Math.floor(pts.length / 2)].w;
  };
  expect(Math.abs(middle([1, 1]) / (1.7 * NOM) - 1)).toBeLessThanOrEqual(0.05);
  expect(Math.abs(middle([1, -1]) / (0.3 * NOM) - 1)).toBeLessThanOrEqual(0.05);
});

test('both ends taper when the stroke is finished', () => {
  const start = { x: 100, y: 100 };
  const pts = [start, ...straight(start, [1, 1], 30, 0.15)];
  // Die Grundbreite je Punkt: derselbe Strich ohne Verjüngung (Schärfe 0).
  const blunt = fueller({ schaerfe: 0 });
  feed(blunt, pts);
  const base = widths(blunt.finish().pts);
  const b = fueller(); // Schärfe 1
  feed(b, pts);
  const live = widths(b.points());
  const done = widths(b.finish().pts);
  const last = done.length - 1;
  const mid = Math.floor(last / 2);
  // Entlang der Feder bei Rundung 33 %, auch vor der ersten Richtung: Diese Punkte bekommen den Faktor der ersten Richtung.
  expect(base[0]).toBeCloseTo(1.469 * NOM, 9);
  expect(base[mid]).toBeCloseTo(1.469 * NOM, 9);
  expect(done[0]).toBeCloseTo(0.15 * base[0], 9);
  expect(done[last]).toBeCloseTo(0.15 * base[last], 9);
  expect(done[mid]).toBeCloseTo(base[mid], 9);
  // Beim Schreiben läuft nur der Anfang spitz zu, das Ende hat noch die volle Breite.
  expect(live).toHaveLength(done.length);
  expect(live[0]).toBeCloseTo(0.15 * base[0], 9);
  expect(live[last]).toBeCloseTo(base[last], 9);
});

test('a short stroke tapers on half its length', () => {
  // 6 Einheiten (1 mm): An jedem Ende ist die Verjüngung nur 3 Einheiten lang, die Mitte hat die volle Breite.
  const start = { x: 100, y: 100 };
  const pts = [start, ...straight(start, [1, 0], 6, 0.25)];
  const blunt = fueller({ schaerfe: 0 });
  feed(blunt, pts);
  const base = widths(blunt.finish().pts);
  const b = fueller();
  feed(b, pts);
  const done = b.finish().pts;
  const last = done.length - 1;
  const mid = done.findIndex((p) => p.x === 103); // Weg 3
  expect(mid).toBe(12);
  expect(done[mid].w).toBeCloseTo(base[mid], 9);
  expect(done[0].w).toBeCloseTo(0.15 * base[0], 9);
  expect(done[last].w).toBeCloseTo(0.15 * base[last], 9);
  // Dazwischen wächst die Breite weich: auf halbem Weg zur Mitte (Weg 1,5) ein Viertel der Verjüngung.
  const quarter = done.findIndex((p) => p.x === 101.5);
  expect(done[quarter].w).toBeCloseTo((1 - 0.85 * 0.25) * base[quarter], 9);
});

test('a tap with the fountain pen keeps a round dot', () => {
  const b = fueller();
  b.add(100, 100, 0.45, 40, 40);
  expect(b.add(100.01, 100, 0.45, 40, 40)).toBe(false); // näher als der Mindestabstand
  const s = b.finish();
  // Ohne Weg gibt es keine Richtung (Federfaktor 1) und keine Verjüngung: die volle Grundbreite.
  const base = NOM * pressureFactor(DEFAULT_FUELLER.druck, 0.45);
  expect(s.pts).toHaveLength(1);
  expect(s.pts[0].w).toBeCloseTo(base, 9);
  expect(s.w).toBeCloseTo(base, 9);
});

test('extreme settings never give NaN or a width below the floor', () => {
  for (let m = 0; m < 16; m++) {
    const o: FuellerSettings = { schaerfe: m & 1, druck: (m >> 1) & 1, rundung: (m >> 2) & 1, stabil: (m >> 3) & 1 };
    for (const tilt of [0, Number.NaN]) {
      const make = () =>
        new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: STABIL_SIGMA * o.stabil, t: 1, minDist: 0.05, pxUnit: 0.1, fueller: o });
      const tap = make();
      tap.add(50, 50, 0, tilt, tilt);
      const short = make();
      short.add(50, 60, Number.NaN, tilt, tilt);
      short.add(50.1, 60, 1, tilt, tilt);
      const wave = make();
      // Eine Welle, der Druck wechselt zwischen 0, NaN und 1.
      for (let i = 0; i <= 200; i++) wave.add(100 + i * 0.15, 100 + 5 * Math.sin(i / 15), [0, Number.NaN, 1][i % 3], tilt, tilt);
      for (const [name, b] of [['tap', tap], ['short', short], ['wave', wave]] as const) {
        for (const s of [b.stroke(), b.finish()]) {
          const label = `${name} ${JSON.stringify(o)} Neigung ${tilt}`;
          expect(Number.isFinite(s.w), label).toBe(true);
          expect(widths(s.pts).filter((w) => !(Number.isFinite(w) && w >= 0.12)), label).toEqual([]);
        }
      }
    }
  }
});

test('other pens are unchanged', () => {
  // Die Einstellungen der Füllfeder ändern bei den anderen Stiften nichts, und finish() ist dort gleich stroke().
  const extreme: FuellerSettings = { schaerfe: 1, druck: 1, rundung: 0, stabil: 1 };
  for (const pen of ['kugel', 'fineliner', 'bleistift'] as const) {
    const plain = new StrokeBuilder({ pen, color: 'blau', widthMm: 0.2, sigma: 1.6, t: 1, minDist: 0.6 });
    const set = new StrokeBuilder({ pen, color: 'blau', widthMm: 0.2, sigma: 1.6, t: 1, minDist: 0.6, fueller: extreme, pxUnit: 0.1 });
    jitterPoints(40).forEach((p, i) => {
      plain.add(p.x, p.y, [0.2, 0.5, 0.9][i % 3], 40, 40);
      set.add(p.x, p.y, [0.2, 0.5, 0.9][i % 3], 40, 40);
    });
    const s = plain.stroke();
    expect(plain.finish(), pen).toEqual(s);
    expect({ ...set.stroke(), id: s.id }, pen).toEqual(s);
    expect({ ...set.finish(), id: s.id }, pen).toEqual(s);
  }
  // Die Breiten wie in den Tests oben: Kugelschreiber 1,2 × (0,7 + 0,6 × geglätteter Druck), Fineliner 1,25-fach.
  const ball = builder(1.6);
  [0.2, 1.0, 1.0].forEach((p, i) => ball.add(i * 10, 0, p));
  widths(ball.finish().pts).forEach((w, i) => expect(w).toBeCloseTo([0.984, 1.1568, 1.27776][i], 9));
  expect(ball.finish().w).toBeCloseTo(1.13952, 9);
  const liner = new StrokeBuilder({ pen: 'fineliner', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.5 });
  for (let i = 0; i < 40; i++) liner.add(2 * i, 0, i % 2 ? 0.9 : 0.1);
  for (const w of widths(liner.finish().pts)) expect(w).toBeCloseTo(1.5, 9);
});

// ---------- Nachbesserung 1: Seil, erste Richtung, Tipp ----------

/**
 * Weg ab dem nahen Ende, aus der Verjüngung zurückgerechnet: `t` ist Breite durch Grundbreite (Schärfe 1). Ab `TAPER_LEN`
 * ist die Verjüngung 1, dann kommt `TAPER_LEN` heraus (der Weg ist mindestens so lang).
 */
const wayFromTaper = (t: number): number => TAPER_LEN * (1 - Math.sqrt((1 - Math.min(t, 1)) / (1 - TAPER_TIP)));

test('the rope keeps jitter at the start out of the way, wherever the first point lies', () => {
  // Rundung 100 % und gleicher Druck: Die Breite hängt nur noch vom Weg ab, so lässt er sich aus ihr zurückrechnen.
  const start = { x: 100, y: 100 };
  const line = straight(start, [1, 1], 20, 0.1);
  const at = line[44]; // 4,5 Einheiten vom Startpunkt
  const base = NOM * pressureFactor(DEFAULT_FUELLER.druck, 0.45);
  const wayAt = (b: StrokeBuilder): number => wayFromTaper(b.points().find((p) => p.x === at.x && p.y === at.y)!.w / base);
  const calm = fueller({ rundung: 1 });
  feed(calm, [start, ...line]);
  expect(wayAt(calm)).toBeCloseTo(4.5, 9);
  let worst = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // Schon der erste Punkt liegt irgendwo im Zittern: Umkreis 0,3, das Seil ist 4 Bildschirmpunkte (0,4 Einheiten) lang.
    const shaky = fueller({ rundung: 1 });
    feed(shaky, [...around(start, 0.3, 200, random(seed)), ...line]);
    worst = Math.max(worst, Math.abs(wayAt(shaky) - 4.5));
  }
  expect(worst).toBeLessThanOrEqual(0.3);
});

test('a pen resting before it lifts keeps the taper at the end', () => {
  const start = { x: 100, y: 100 };
  const line = straight(start, [1, 1], 30, 0.1);
  const end = line[line.length - 1]; // Weg 30, hier hebt der Stift ab oder bleibt erst noch stehen
  const before = line[line.length - 46]; // 4,5 Einheiten vor dem Ende
  const widthAt = (s: Stroke, p: XY): number => s.pts.find((q) => q.x === p.x && q.y === p.y)!.w;
  const calm = fueller();
  feed(calm, [start, ...line]);
  const plain = calm.finish();
  const base = widthAt(plain, end) / TAPER_TIP; // ohne Ruhe ist der letzte Punkt die Spitze
  let extra = 0;
  let wider = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // Der Stift bleibt am Ende stehen und zittert (Umkreis 0,3), dann hebt er ab.
    const resting = fueller();
    feed(resting, [start, ...line, ...around(end, 0.3, 200, random(seed))]);
    const s = resting.finish();
    extra = Math.max(extra, wayFromTaper(widthAt(s, end) / base)); // Weg, den das Zittern dazugezählt hat
    wider = Math.max(wider, widthAt(s, before) / widthAt(plain, before) - 1);
  }
  expect(extra).toBeLessThanOrEqual(0.6);
  expect(wider).toBeLessThanOrEqual(0.08);
});

test('no knob where the first direction comes', () => {
  // Bis zur ersten Richtung (3 Einheiten) rechnete die Feder rund: Quer zur Feder wuchs die Breite erst und fiel dann.
  for (const dir of [
    [1, -1],
    [1, 1],
  ] as [number, number][]) {
    const b = fueller();
    const start = { x: 100, y: 100 };
    feed(b, [start, ...straight(start, dir, 30, 0.1)]);
    for (const [name, pts] of [
      ['points', b.points()],
      ['finish', b.finish().pts],
    ] as const) {
      const w = widths(pts.slice(0, Math.floor(pts.length / 2) + 1)); // vom Anfang bis zur Mitte
      const drops = w.flatMap((v, i) => (i && v < w[i - 1] - 1e-12 ? [`Punkt ${i}: ${w[i - 1]} -> ${v}`] : []));
      expect(drops, `${name} in Richtung ${dir}`).toEqual([]);
    }
  }
});

test('the fountain pen settles no point before its first direction', () => {
  const pf = pressureFactor(DEFAULT_FUELLER.druck, 0.45);
  for (const sigma of [0, 1.6]) {
    const K = sigma ? Math.ceil(2.5 * sigma) : 0;
    const make = (pen: 'fueller' | 'kugel') => new StrokeBuilder({ pen, color: 'schwarz', widthMm: 0.2, sigma, t: 1, minDist: 0.05, pxUnit: 0.1 });
    const pen = make('fueller');
    const ball = make('kugel');
    let early: Stroke | null = null;
    for (let i = 0; i <= 20; i++) {
      pen.add(100 + 0.5 * i, 100, 0.45, 40, 40);
      ball.add(100 + 0.5 * i, 100, 0.45, 40, 40);
      const n = i + 1;
      const usual = K ? Math.max(0, n - 1 - K) : n;
      // Die erste Richtung steht bei 3 Einheiten fest (Punkt 6), vorher kann sich jede Breite noch ändern.
      expect(pen.settled(), `Füllfeder, sigma ${sigma}, ${n} Punkte`).toBe(i < 6 ? 0 : usual);
      expect(ball.settled(), `Kugelschreiber, sigma ${sigma}, ${n} Punkte`).toBe(usual);
      if (i === 5) early = pen.stroke();
    }
    // Eine Momentaufnahme von vorher bleibt, wie sie war (Federfaktor 1), obwohl die Punkte seither nachgerechnet sind.
    expect(early!.pts[0].w).toBeCloseTo(TAPER_TIP * NOM * pf, 9);
    // Jetzt mit dem Federfaktor der ersten Richtung: waagrecht, der Stift zeigt nach rechts unten.
    const nib = nibFactorR(DEFAULT_FUELLER.rundung, doubled(0), doubled(Math.PI / 4));
    expect(pen.points()[0].w).toBeCloseTo(TAPER_TIP * NOM * pf * nib, 9);
    expect(pen.meanW()).toBeCloseTo(pen.stroke().w, 9);
  }
});

test('the width changes smoothly around a circle', () => {
  // Kreis mit Radius 6 Einheiten (1 mm), Punkte alle 0,5 Einheiten, zwei Umläufe, gleicher Druck. Schärfe 0: Die Breite ist
  // die Grundbreite. Mit der Richtung in Stufen (alle 3 Einheiten neu) sprang sie von Punkt zu Punkt um bis zu 55 % (Rundung 0)
  // und 37 % (Startwerte) der Nennbreite, mit der Richtung am Seil um 7,6 % und 5,1 %.
  for (const [settings, limit] of [
    [{ rundung: 0 }, 0.11],
    [{}, 0.08],
  ] as const) {
    const b = fueller({ ...settings, schaerfe: 0 });
    const n = Math.round((2 * 2 * Math.PI * 6) / 0.5);
    for (let i = 0; i <= n; i++) b.add(100 + 6 * Math.cos((i * 0.5) / 6), 100 + 6 * Math.sin((i * 0.5) / 6), 0.45, 40, 40);
    for (const [name, pts] of [
      ['points', b.points()],
      ['finish', b.finish().pts],
    ] as const) {
      const w = widths(pts);
      const step = Math.max(...w.slice(1).map((v, i) => Math.abs(v - w[i]))) / NOM;
      const label = `${name} ${JSON.stringify(settings)}`;
      expect(step, label).toBeLessThanOrEqual(limit);
      // Stetig heißt nicht flach: Bei Rundung 0 wechselt die Linie weiter zwischen dünn und dick (gemessen 0,61 bis 1,62).
      if ('rundung' in settings) {
        expect(Math.min(...w) / NOM, label).toBeLessThanOrEqual(0.7);
        expect(Math.max(...w) / NOM, label).toBeGreaterThanOrEqual(1.5);
      }
    }
  }
});

test('a tap that slides a little still keeps a round dot', () => {
  const base = NOM * pressureFactor(DEFAULT_FUELLER.druck, 0.5); // etwa 1,23
  const b = fueller();
  b.add(100, 100, 0.5, 40, 40);
  expect(b.add(100.06, 100, 0.5, 40, 40)).toBe(true); // weiter als der Mindestabstand, aber im Seil (0,4)
  const s = b.finish();
  expect(base).toBeCloseTo(1.23, 2);
  expect(s.pts).toHaveLength(2);
  for (const p of s.pts) expect(p.w).toBeCloseTo(base, 9);
  // Kam der Stift weiter als das Seil vom Aufsetzpunkt weg, laufen die Enden wieder spitz zu.
  const dash = fueller();
  dash.add(100, 100, 0.5, 40, 40);
  dash.add(100.5, 100, 0.5, 40, 40);
  for (const p of dash.finish().pts) expect(p.w).toBeCloseTo(TAPER_TIP * base, 9);
});
