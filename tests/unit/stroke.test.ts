import { expect, test } from 'vitest';
import {
  DEFAULT_FUELLER,
  DIR_MIN,
  DIR_MIN_PX,
  doubled,
  MIN_DIST_PX,
  nibFactorR,
  pressureFactor,
  speedBlend,
  speedFactor,
  stabilSigmaPx,
  START_WAIT,
  TAPER_FAST,
  TAPER_LEN,
  TAPER_SLOW,
  TAPER_TIP,
  taperFactor,
  V_SLOW,
  type FuellerSettings,
} from '../../src/ink/pens';
import { fmtNum, hitStroke, parsePathD, pathD, StrokeBuilder } from '../../src/ink/stroke';
import { SMOOTHING, type InkColor, type Pt, type Stroke } from '../../src/ink/types';

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

/** Seiteneinheiten je Bildschirmpunkt bei `fueller()`: stark gezoomt. */
const ZOOMED = 0.1;

/** So lang ist bei `fueller()` eine Spitze ohne Zeiten: `TAPER_LEN` Bildschirmpunkte, also 0,9 Einheiten. */
const ZOOMED_TAPER = TAPER_LEN * ZOOMED;

/**
 * Füllfeder wie am iPad stark gezoomt: Ein Bildschirmpunkt ist 0,1 Seiteneinheiten, der Mindestabstand 0,05 lässt dichte
 * Punkte durch. Ohne Angabe die Startwerte der Regler. Die Füllfeder glättet ihre Orte immer nach der Strecke (bei 14 % mit
 * σ = 2,97 Bildschirmpunkten, hier 0,3 Einheiten): Auf einer Geraden mit gleichen Abständen bleiben die Punkte bis auf
 * Rundungsfehler dort, wo der Stift war, neben Zittern nicht. Die Spitzen zählen auf dem Glas: ohne Zeiten 9 Bildschirmpunkte,
 * hier 0,9 Einheiten (`ZOOMED_TAPER`).
 */
function fueller(settings: Partial<FuellerSettings> = {}): StrokeBuilder {
  return new StrokeBuilder({
    pen: 'fueller',
    color: 'schwarz',
    widthMm: 0.2,
    sigma: 0, // gilt nur für die anderen Stifte
    t: 1,
    minDist: 0.05,
    pxUnit: ZOOMED,
    fueller: { ...DEFAULT_FUELLER, ...settings },
  });
}

type XY = { x: number; y: number };

/** Nummer des Punkts an der Stelle `at`, auf Rundungsfehler der Glättung genau. -1, wenn keiner dort liegt. */
const indexAt = (pts: readonly XY[], at: XY): number => pts.findIndex((p) => Math.hypot(p.x - at.x, p.y - at.y) <= 1e-9);

/** Der Punkt an der Stelle `at`, auf Rundungsfehler der Glättung genau. Liegt dort keiner, scheitert der Test mit dieser Stelle. */
const pointAt = (pts: readonly Pt[], at: XY): Pt => {
  const i = indexAt(pts, at);
  expect(i, `kein Punkt an der Stelle (${at.x}, ${at.y})`).toBeGreaterThanOrEqual(0);
  return pts[i];
};

/**
 * Der Punkt, der aus `line[k]` wurde, wenn die Gerade `line` (ab mindestens 45 Punkten) den Strich `pts` beendet: Ihre Punkte zählen vom
 * Ende. Nach dem Ort lässt er sich nahe am Anfang nicht suchen: Dort wird das Fenster der Glättung kleiner, und Zittern davor verschiebt
 * ihn. Ob die Nummer vom Ende passt, prüft der Ort von `line[44]`, wo die Glättung die Gerade nicht mehr verschiebt.
 */
const onLine = (pts: readonly Pt[], line: readonly XY[], k: number): Pt => {
  const fromEnd = (i: number): Pt => pts[pts.length - (line.length - i)];
  expect(fromEnd(44), 'die Nummer vom Ende passt zum Ort').toBe(pointAt(pts, line[44]));
  return fromEnd(k);
};

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
  // `line[3]`: 0,4 Einheiten vom Start, mitten in der Verjüngung am Anfang (0,9 Einheiten).
  const widthAt = (b: StrokeBuilder): number => onLine(b.points(), line, 3).w;
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
    // Nur außerhalb der Verjüngungen (je 0,9 Einheiten an jedem Ende, mit viel Rand).
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

test('a short stroke tapers from both ends at once', () => {
  // 6 Einheiten (1 mm) in normaler Größe, ohne Zeiten: Beide Spitzen sind 9 Einheiten lang, länger als der Strich. Sie wirken
  // zugleich, ihr Produkt nie unter dem Boden (P3c-R6). Bis Paket 3c wurden sie auf die halbe Länge gekürzt, und die Mitte bekam
  // beim Abheben ihre volle Breite: breiter als beim Schreiben.
  const make = (schaerfe: number) =>
    new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.01, pxUnit: 1, fueller: { ...DEFAULT_FUELLER, schaerfe } });
  const start = { x: 100, y: 100 };
  const pts = [start, ...straight(start, [1, 0], 6, 0.25)];
  const blunt = make(0);
  feed(blunt, pts);
  const base = widths(blunt.finish().pts);
  const b = make(1);
  feed(b, pts);
  const live = widths(b.points());
  const done = widths(b.finish().pts);
  expect(done).toHaveLength(25);
  done.forEach((w, i) => {
    const way = 0.25 * i;
    const both = taperFactor(1, way, TAPER_LEN) * taperFactor(1, 6 - way, TAPER_LEN);
    expect(w, `Punkt ${i}`).toBeCloseTo(Math.max(0.1 * NOM, both * base[i]), 9);
    expect(w, `Punkt ${i}`).toBeLessThanOrEqual(live[i]);
  });
  // In der Mitte (Weg 3) wirken beide Spitzen je mit 1 − 0,85 × (2/3)², zusammen 0,39.
  expect(done[12] / base[12]).toBeCloseTo((1 - 0.85 * (2 / 3) ** 2) ** 2, 9);
  expect(done[0] / base[0]).toBeCloseTo(TAPER_TIP * (1 - 0.85 * (1 / 3) ** 2), 9);
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
      // `sigma` gilt nur für die anderen Stifte: Die Füllfeder glättet mit ihrer Strich-Stabilisierung `o.stabil`.
      const make = () => new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.05, pxUnit: 0.1, fueller: o });
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
 * Weg ab dem nahen Ende, aus der Verjüngung zurückgerechnet: `t` ist Breite durch Grundbreite (Schärfe 1), die Verjüngung bei
 * `fueller()` `ZOOMED_TAPER` lang. Ab dort ist sie 1, dann kommt `ZOOMED_TAPER` heraus (der Weg ist mindestens so lang).
 */
const wayFromTaper = (t: number): number => ZOOMED_TAPER * (1 - Math.sqrt((1 - Math.min(t, 1)) / (1 - TAPER_TIP)));

test('the rope keeps jitter at the start out of the way, wherever the first point lies', () => {
  // Rundung 100 % und gleicher Druck: Die Breite hängt nur noch vom Weg ab, so lässt er sich aus ihr zurückrechnen.
  const start = { x: 100, y: 100 };
  const line = straight(start, [1, 1], 20, 0.1);
  const base = NOM * pressureFactor(DEFAULT_FUELLER.druck, 0.45);
  // Am Punkt `line[3]`, 0,4 Einheiten vom Startpunkt, in der Verjüngung (0,9 Einheiten).
  const wayAt = (b: StrokeBuilder): number => wayFromTaper(onLine(b.points(), line, 3).w / base);
  const calm = fueller({ rundung: 1 });
  feed(calm, [start, ...line]);
  expect(wayAt(calm)).toBeCloseTo(0.4, 9);
  let worst = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // Schon der erste Punkt liegt irgendwo im Zittern: Umkreis 0,3, das Seil ist 4 Bildschirmpunkte (0,4 Einheiten) lang.
    const shaky = fueller({ rundung: 1 });
    feed(shaky, [...around(start, 0.3, 200, random(seed)), ...line]);
    worst = Math.max(worst, Math.abs(wayAt(shaky) - 0.4));
  }
  expect(worst).toBeLessThanOrEqual(0.3);
});

test('a pen resting before it lifts keeps the taper at the end', () => {
  const start = { x: 100, y: 100 };
  const line = straight(start, [1, 1], 30, 0.1);
  const end = line[line.length - 1]; // Weg 30, hier hebt der Stift ab oder bleibt erst noch stehen
  // Den Endpunkt nach seiner Nummer: Zittert der Stift danach noch, verschiebt das den geglätteten Ort. Start und Gerade fallen
  // nicht unter den Mindestabstand, der Endpunkt ist also Punkt Nummer `line.length`.
  const atEnd = (s: Stroke): number => s.pts[line.length].w;
  const calm = fueller();
  feed(calm, [start, ...line]);
  const plain = calm.finish();
  expect(indexAt(plain.pts, end)).toBe(line.length);
  const base = atEnd(plain) / TAPER_TIP; // ohne Ruhe ist der letzte Punkt die Spitze
  // Gemessen wird der Weg, den das Zittern dazuzählt. Er schiebt die Verjüngung am Ende in die Punkte der Ruhe. Seit die Spitzen
  // auf dem Glas zählen (hier 0,9 Einheiten statt 9), ist dieser Weg so lang wie ein guter Teil der Spitze: Ein Vergleich der
  // Breite mitten in der Spitze wie bis Paket 3c sagt darum nichts mehr über das Seil, nur noch der Weg selbst.
  let extra = 0;
  for (let seed = 1; seed <= 100; seed++) {
    // Der Stift bleibt am Ende stehen und zittert (Umkreis 0,3), dann hebt er ab.
    const resting = fueller();
    feed(resting, [start, ...line, ...around(end, 0.3, 200, random(seed))]);
    extra = Math.max(extra, wayFromTaper(atEnd(resting.finish()) / base)); // Weg, den das Zittern dazugezählt hat
  }
  expect(extra).toBeLessThanOrEqual(0.6);
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
      // Die Füllfeder glättet nach der Strecke, mit `sigma` oder ohne: Fest sind die Punkte mehr als 2,5 σ (0,74 Einheiten) vor
      // dem letzten, bei Punkten alle 0,5 Einheiten alle bis auf die letzten zwei. Aber erst, wenn die erste Richtung feststeht
      // (bei 3 Einheiten, Punkt 6): Vorher kann sich jede Breite noch ändern.
      expect(pen.settled(), `Füllfeder, sigma ${sigma}, ${n} Punkte`).toBe(i < 6 ? 0 : n - 2);
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
  // Kam der Stift weiter als das Seil vom Aufsetzpunkt weg, laufen die Enden wieder spitz zu. Der Strich (Weg 0,5) ist kürzer als
  // die Spitzen (0,9): An jedem Punkt wirkt die eine Spitze ganz und die andere mit dem Weg 0,5.
  const dash = fueller();
  dash.add(100, 100, 0.5, 40, 40);
  dash.add(100.5, 100, 0.5, 40, 40);
  for (const p of dash.finish().pts) expect(p.w).toBeCloseTo(TAPER_TIP * taperFactor(1, 0.5, ZOOMED_TAPER) * base, 9);
});

// ---------- Glätten nach Strecke (Paket 3c) ----------

/**
 * So weit (Seiteneinheiten) reicht die Glättung der Füllfeder bei den Startwerten zu jeder Seite, wenn ein Bildschirmpunkt `pxUnit`
 * Einheiten ist: 2,5 σ.
 */
const reachAt = (pxUnit = 1): number => 2.5 * stabilSigmaPx(DEFAULT_FUELLER.stabil) * pxUnit;

/**
 * Schreibt `pts` mit der Füllfeder (Startwerte der Regler), wenn ein Bildschirmpunkt `pxUnit` Seiteneinheiten ist, und gibt die
 * geglätteten Orte zurück. Der Mindestabstand ist so klein, dass kein Punkt wegfällt.
 */
function smoothed(pts: XY[], pxUnit = 1): XY[] {
  // `sigma` gilt nur für die anderen Stifte: Die Füllfeder glättet nach ihrer Strich-Stabilisierung.
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.01 * pxUnit, pxUnit });
  for (const p of pts) expect(b.add(p.x, p.y, 0.45, 40, 40)).toBe(true);
  return b.points().map(({ x, y }) => ({ x, y }));
}

/**
 * Eine waagrechte Gerade von x = 0 bis `len` mit Zittern quer dazu (±0,5), Punkte alle `step` Einheiten. Das Zittern hängt nur
 * vom Ort ab (ein Zufallswert je 0,2 Einheiten, fester Startwert): Bei jedem Abstand der Punkte ist es dieselbe Linie.
 */
function shakyLine(step: number, len = 60): XY[] {
  const rnd = random(777);
  const jitter = Array.from({ length: Math.round(len / 0.2) + 1 }, () => (2 * rnd() - 1) * 0.5);
  return Array.from({ length: Math.round(len / step) + 1 }, (_, i) => ({ x: i * step, y: jitter[Math.round((i * step) / 0.2)] }));
}

/** Die Strecke je Punkt ab dem ersten: die Summe der Abstände. */
function arcLengths(pts: readonly XY[]): number[] {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  return s;
}

/** Die Nummern der Punkte, die mehr als `reach` Strecke von beiden Enden weg sind. */
function middle(pts: readonly XY[], reach: number): number[] {
  const s = arcLengths(pts);
  const end = s[s.length - 1];
  return s.flatMap((v, i) => (v > reach && end - v > reach ? [i] : []));
}

const mean = (values: number[]): number => values.reduce((sum, v) => sum + v, 0) / values.length;

/** y der Linie `pts` (von links nach rechts) an der Stelle `x`, zwischen zwei Punkten gerade verbunden. */
function yAt(pts: readonly XY[], x: number): number {
  const i = Math.min(Math.max(1, pts.findIndex((p) => p.x >= x)), pts.length - 1);
  const a = pts[i - 1];
  const b = pts[i];
  return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
}

test('smoothing follows the distance, not the number of points', () => {
  // Dieselbe zittrige Gerade, einmal langsam geschrieben (Punkte alle 0,6 Einheiten), einmal schnell (alle 2). Verglichen wird an
  // denselben Stellen der Geraden, wo beide Linien das ganze Fenster haben.
  const reach = reachAt();
  const slow = smoothed(shakyLine(0.6));
  const fast = smoothed(shakyLine(2));
  const inner = slow.filter((p) => p.x > reach && p.x < 60 - reach);
  expect(inner.length).toBeGreaterThan(50);
  const apart = mean(inner.map((p) => Math.abs(p.y - yAt(fast, p.x))));
  // Gemessen 0,085. Ohne Glättung wären es 0,286, mit der Glättung nach der Zahl der Punkte (bis Paket 3b) 0,171.
  expect(apart).toBeLessThanOrEqual(0.12);
});

test('at 14 % the jitter drops by at least 60 %', () => {
  const raw = shakyLine(0.6);
  const out = smoothed(raw);
  const inner = middle(raw, reachAt());
  expect(inner.length).toBeGreaterThan(50);
  const before = mean(inner.map((i) => Math.abs(raw[i].y)));
  const after = mean(inner.map((i) => Math.abs(out[i].y)));
  expect(after).toBeLessThanOrEqual(0.4 * before); // gemessen 0,061 von 0,259
});

test('at 14 % a 1 mm circle keeps at least 85 % of its radius', () => {
  // Radius 6 Einheiten (1 mm), Punkte alle 0,5 Einheiten, ein Umlauf.
  const n = Math.round((2 * Math.PI * 6) / 0.5);
  const circle = Array.from({ length: n + 1 }, (_, i) => ({ x: 100 + 6 * Math.cos((i * 0.5) / 6), y: 100 + 6 * Math.sin((i * 0.5) / 6) }));
  const out = smoothed(circle);
  const inner = middle(circle, reachAt());
  expect(inner.length).toBeGreaterThan(30);
  expect(mean(inner.map((i) => Math.hypot(out[i].x - 100, out[i].y - 100)))).toBeGreaterThanOrEqual(5.1); // gemessen 5,37
});

test('zoomed in, the smoothing stays the same on screen', () => {
  // Dieselbe zittrige Linie in Bildschirmpunkten, Punkte alle 0,4: in normaler Größe (ein Bildschirmpunkt ist eine Seiteneinheit)
  // und stark gezoomt (ein Bildschirmpunkt ist 0,25 Einheiten, die Punkte liegen langsam geschrieben 0,1 Einheiten auseinander).
  const screen = shakyLine(0.4);
  const normal = smoothed(screen, 1);
  const zoomed = smoothed(
    screen.map((p) => ({ x: p.x * 0.25, y: p.y * 0.25 })),
    0.25,
  ).map((p) => ({ x: p.x / 0.25, y: p.y / 0.25 }));
  expect(zoomed).toHaveLength(normal.length);
  expect(mean(zoomed.map((p, i) => Math.hypot(p.x - normal[i].x, p.y - normal[i].y)))).toBeLessThanOrEqual(0.05); // gemessen 0
});

test('the ends stay where the pen was', () => {
  const raw = shakyLine(0.6);
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.01, pxUnit: 1 });
  for (const p of raw) {
    expect(b.add(p.x, p.y, 0.45, 40, 40)).toBe(true);
    // Auch beim Schreiben: Der Anfang bleibt, wo der Stift aufsetzte, und das Ende ist die Stiftspitze.
    const pts = b.points();
    expect(pts[0]).toMatchObject(raw[0]);
    expect(pts[pts.length - 1]).toMatchObject(p);
  }
  const done = b.finish().pts;
  expect(done).toHaveLength(raw.length);
  expect(done[0]).toMatchObject(raw[0]);
  expect(done[done.length - 1]).toMatchObject(raw[raw.length - 1]);
});

test('settled points are those more than 2.5 sigma before the end', () => {
  // 300 Punkte auf einer Welle mit Zittern, mal dicht, mal weit auseinander (langsam und schnell geschrieben).
  const rnd = random(31337);
  const pts: XY[] = [];
  for (let i = 0, x = 100; i < 300; i++, x += 0.3 + 1.7 * rnd()) pts.push({ x, y: 100 + 3 * Math.sin(x / 5) + (2 * rnd() - 1) * 0.3 });
  const reach = reachAt();
  // Die erste Richtung steht fest, sobald der Stift ein Seil weit vom ersten Punkt weg ist (ein Bildschirmpunkt ist hier eine Einheit).
  const rope = Math.max(DIR_MIN, DIR_MIN_PX);
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.01, pxUnit: 1 });
  const fixed: Pt[][] = [];
  pts.forEach((p, i) => {
    expect(b.add(p.x, p.y, 0.45, 40, 40)).toBe(true);
    const s = arcLengths(pts.slice(0, i + 1));
    const far = s.filter((v) => s[i] - v > reach).length;
    const dir = pts.slice(0, i + 1).some((q) => Math.hypot(q.x - pts[0].x, q.y - pts[0].y) >= rope);
    expect(b.settled(), `${i + 1} Punkte`).toBe(dir ? far : 0);
    fixed.push(b.points().slice(0, b.settled()).map((q) => ({ ...q })));
  });
  // Was nach einem Punkt fest war, ist am Ende noch genau so: Ort und Breite.
  const final = b.points();
  fixed.forEach((was, i) => expect(final.slice(0, was.length), `fest nach ${i + 1} Punkten`).toEqual(was));
  expect(fixed[fixed.length - 1].length).toBeGreaterThan(280);
});

/**
 * Die Glättung der Füllfeder auf einen Schlag, Punkt für Punkt nach der Formel: das Mittel aller Rohpunkte, deren Strecke höchstens
 * r = min(2,5 σ, s − s0, Ende − s) von der des Punkts abliegt, gewichtet mit exp(−d² / 2σ²), `d` der Unterschied der Strecke.
 */
function smoothByFormula(raw: readonly XY[], sigma: number): XY[] {
  const s = arcLengths(raw);
  const end = s[s.length - 1];
  return raw.map((_, i) => {
    const r = Math.min(2.5 * sigma, s[i] - s[0], end - s[i]);
    let sx = 0;
    let sy = 0;
    let sw = 0;
    raw.forEach((p, j) => {
      const d = s[j] - s[i];
      if (Math.abs(d) > r) return;
      const w = Math.exp(-(d * d) / (2 * sigma * sigma));
      sx += w * p.x;
      sy += w * p.y;
      sw += w;
    });
    return { x: sx / sw, y: sy / sw };
  });
}

test('after every point the smoothed places follow the formula', () => {
  // Eine Welle mit Zittern, mal dicht, mal weit auseinander, in normaler Größe und stark gezoomt (ein Bildschirmpunkt ist 0,25
  // Einheiten), mit dem Mindestabstand der App: Punkte näher als 0,6 Bildschirmpunkte am letzten behaltenen fallen weg. Nach jedem
  // Punkt muss jeder geglättete Ort der Formel für die behaltenen Rohpunkte folgen, auch die Punkte, die schon fest sind: So fällt auf,
  // wenn ein Punkt mit einem Fenster fest wird, das noch am alten Ende abgeschnitten war.
  for (const pxUnit of [1, 0.25]) {
    const rnd = random(2718);
    const pts: XY[] = [];
    for (let i = 0, x = 100; i < 200; i++, x += 0.3 + 1.7 * rnd()) {
      pts.push({ x: x * pxUnit, y: (100 + 3 * Math.sin(x / 5) + (2 * rnd() - 1) * 0.3) * pxUnit });
    }
    const sigma = stabilSigmaPx(DEFAULT_FUELLER.stabil) * pxUnit;
    const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: MIN_DIST_PX * pxUnit, pxUnit });
    const kept: XY[] = [];
    let worst = 0;
    for (const p of pts) {
      if (b.add(p.x, p.y, 0.45, 40, 40)) kept.push(p);
      const want = smoothByFormula(kept, sigma);
      expect(b.points()).toHaveLength(kept.length);
      b.points().forEach((q, i) => (worst = Math.max(worst, Math.abs(q.x - want[i].x), Math.abs(q.y - want[i].y))));
    }
    expect(kept.length, `pxUnit ${pxUnit}: ein paar Punkte fallen weg`).toBeLessThan(pts.length - 10);
    expect(worst, `pxUnit ${pxUnit}`).toBeLessThan(1e-9);
  }
});

test('other pens smooth as before', () => {
  // Kugelschreiber und Fineliner glätten weiter nach der Zahl der Punkte, mit `sigma` aus der Einstellung „Glättung“. Die
  // Erwartung (x, y, Breite) stammt aus dem Stand vor dem Glätten nach Strecke, auf sechs Stellen gerundet.
  const before = {
    kugel: [
      [0.193233, 16.679893, 0.984],
      [3.783829, 5.77647, 1.0488],
      [7.058058, 7.31572, 1.18056],
      [10.114469, 8.490125, 1.121592],
      [13.150809, 9.424186, 1.145114],
      [16.111666, 9.272528, 1.24798],
      [19.076533, 8.090089, 1.168786],
      [21.986881, 5.588516, 1.17815],
      [25.033924, 2.22518, 1.271105],
      [27.532417, 3.348443, 1.184974],
    ],
    fineliner: [
      [0.193233, 16.679893, 1.5],
      [3.73887, 5.981083, 1.5],
      [7.081614, 8.304948, 1.5],
      [10.040614, 8.749149, 1.5],
      [13.099263, 8.465621, 1.5],
      [16.100759, 7.944427, 1.5],
      [19.097428, 7.866189, 1.5],
      [21.924579, 5.477456, 1.5],
      [25.048308, 2.287589, 1.5],
      [27.532417, 3.348443, 1.5],
    ],
  };
  for (const [pen, setting] of [
    ['kugel', 'mittel'],
    ['fineliner', 'stark'],
  ] as const) {
    const b = new StrokeBuilder({ pen, color: 'schwarz', widthMm: 0.2, sigma: SMOOTHING[setting], t: 1, minDist: 0.6 });
    jitterPoints(10).forEach((p, i) => b.add(p.x, p.y, [0.2, 0.5, 0.9][i % 3], 40, 40));
    const got = b.finish().pts;
    expect(got, pen).toHaveLength(before[pen].length);
    got.forEach((p, i) => {
      const [x, y, w] = before[pen][i];
      expect(p.x, `${pen} x ${i}`).toBeCloseTo(x, 5);
      expect(p.y, `${pen} y ${i}`).toBeCloseTo(y, 5);
      expect(p.w, `${pen} Breite ${i}`).toBeCloseTo(w, 5);
    });
  }
});

// ---------- Tempo wie Tinte (Paket 3c) ----------

/**
 * Füllfeder, bei der nur das Tempo die Breite ändert: runde Spitze (Rundung 1), ohne Druckempfindlichkeit. Schärfe 1 läuft spitz
 * aus, Schärfe 0 gibt die Grundbreite je Punkt (ohne Verjüngung). Ohne `pxUnit` in normaler Größe: Ein Bildschirmpunkt ist eine
 * Seiteneinheit.
 */
function inkPen(schaerfe = 1, pxUnit = 1): StrokeBuilder {
  return new StrokeBuilder({
    pen: 'fueller',
    color: 'schwarz',
    widthMm: 0.2,
    sigma: 0,
    t: 1,
    minDist: 0.01 * pxUnit,
    pxUnit,
    fueller: { ...DEFAULT_FUELLER, schaerfe, rundung: 1, druck: 0 },
  });
}

/** Ein Punkt mit der Zeit (ms), zu der der Stift dort war. */
type Timed = XY & { t: number };

/**
 * Eine waagrechte Gerade von x = 0 bis `len`, Punkte alle `step` Einheiten, mit Zeiten: An der Stelle x zieht der Stift mit `speed(x)`
 * Bildschirmpunkten je ms. Bei `inkPen` ist x auch die Strecke ab dem Anfang in Bildschirmpunkten.
 */
function timedLine(len: number, step: number, speed: (x: number) => number): Timed[] {
  const pts: Timed[] = [{ x: 0, y: 0, t: 5000 }];
  for (let i = 1; i <= Math.round(len / step); i++) pts.push({ x: i * step, y: 0, t: pts[i - 1].t + step / speed(i * step) });
  return pts;
}

/** Die Gerade der Tempo-Tests, 120 Einheiten lang, Punkte alle 0,6: bis zur Mitte mit `first`, danach mit `second` Bildschirmpunkten je ms. */
const twoSpeeds = (first: number, second: number): Timed[] => timedLine(120, 0.6, (x) => (x <= 60 ? first : second));

/** Gibt die Punkte mit ihren Zeiten in den Strich (mittlerer Druck, ohne Neigung). */
function feedTimed(b: StrokeBuilder, pts: Timed[]): void {
  for (const p of pts) expect(b.add(p.x, p.y, 0.5, 0, 0, p.t)).toBe(true);
}

/** Die Breiten von `pts` mit Schärfe 1 beim Schreiben (`live`) und fertig (`done`), dazu die Grundbreiten (`base`, Schärfe 0, fertig). */
function tempoWidths(pts: Timed[]): { live: number[]; done: number[]; base: number[] } {
  const sharp = inkPen();
  const blunt = inkPen(0);
  feedTimed(sharp, pts);
  feedTimed(blunt, pts);
  return { live: widths(sharp.points()), done: widths(sharp.finish().pts), base: widths(blunt.finish().pts) };
}

/** Die Strecke `s` des ersten Punkts, dessen Breite `w` 90 % seiner Grundbreite erreicht. */
const reach90 = (w: number[], base: number[], s: number[]): number => s[w.findIndex((v, i) => v >= 0.9 * base[i])];

/** Wie `reach90`, aber vom Ende der Geraden `pts` aus gezählt (die Strecke bis zum Ende). */
const reach90FromEnd = (w: number[], base: number[], pts: Timed[]): number => {
  const end = pts[pts.length - 1].x;
  return reach90([...w].reverse(), [...base].reverse(), pts.map((p) => end - p.x).reverse());
};

test('a fast stroke is half as wide as a slow one', () => {
  // Dieselbe Gerade, 120 Einheiten lang, Punkte alle 0,6: einmal mit 0,1 Bildschirmpunkten je ms, einmal mit 1,2. In der Mitte
  // (Punkt 100, x = 60) wirkt keine Verjüngung, dort zählt beim Schreiben wie fertig nur die Grundbreite.
  const slow = tempoWidths(timedLine(120, 0.6, () => 0.1));
  const fast = tempoWidths(timedLine(120, 0.6, () => 1.2));
  for (const name of ['live', 'done'] as const) {
    expect(slow[name][100], name).toBeCloseTo(NOM, 9); // langsam: volle Breite
    expect(Math.abs(fast[name][100] / slow[name][100] / 0.5 - 1), name).toBeLessThanOrEqual(0.05);
  }
  // Stark gezoomt (ein Bildschirmpunkt ist 0,25 Einheiten) zählt das Tempo auf dem Bildschirm: Dieselben Geraden in
  // Bildschirmpunkten, also 30 Einheiten lang, haben in der Mitte dieselbe Grundbreite.
  const zoomed = (speed: number): number => {
    const b = inkPen(0, 0.25);
    feedTimed(b, timedLine(120, 0.6, () => speed).map((p) => ({ ...p, x: p.x * 0.25 })));
    return b.finish().pts[100].w;
  };
  expect(zoomed(0.1)).toBeCloseTo(slow.base[100], 9);
  expect(zoomed(1.2)).toBeCloseTo(fast.base[100], 9);
});

test('the speed starts with the start speed and follows the pen with 20 ms', () => {
  // Eine Gerade, bis x = 30 mit 0,3 Bildschirmpunkten je ms, danach mit 0,9, Punkte alle 0,6. Steht der Anfang fest (erste Richtung
  // nach 4 Einheiten), beginnt das geglättete Tempo mit dem Tempo beim Ansetzen, 0,3, und die Punkte davor bekommen dessen Tempofaktor
  // (P3c-R9): So hat die ganze erste Hälfte dieselbe Grundbreite. Danach folgt das Tempo dem Stift: t ms nach dem Wechsel ist es
  // 0,9 − 0,6 × exp(−t / 20), die Grundbreite also Nennbreite × speedFactor(speedBlend(dieses Tempo)).
  const pts = timedLine(60, 0.6, (x) => (x <= 30 ? 0.3 : 0.9));
  const change = pts.filter((p) => p.x <= 30).length - 1; // der letzte Punkt mit 0,3
  const { base } = tempoWidths(pts);
  pts.forEach((p, i) => {
    const vs = i <= change ? 0.3 : 0.9 - 0.6 * Math.exp(-(p.t - pts[change].t) / 20);
    expect(base[i], `Punkt ${i}`).toBeCloseTo(NOM * speedFactor(speedBlend(vs)), 9);
  });
  expect(base[0]).toBeLessThan(0.98 * NOM); // schon der erste Punkt mit dem Tempo beim Ansetzen
  expect(base[base.length - 1]).toBeLessThan(0.75 * NOM);
});

test('a fast lift gives a long tip, a slow lift a short one', () => {
  // Dieselbe Gerade: bis zur Mitte langsam (0,1 Bildschirmpunkte je ms) und am Ende schnell (1,2), oder umgekehrt. Die Spitze am
  // Ende ist schnell 22,5 Einheiten lang (90 % der Grundbreite erst 14,8 Einheiten vor dem Ende), langsam 3,6 (schon nach 2,4).
  const fromEnd = (pts: Timed[]): number => {
    const { done, base } = tempoWidths(pts);
    return reach90FromEnd(done, base, pts);
  };
  expect(fromEnd(twoSpeeds(0.1, 1.2))).toBeGreaterThan(12);
  expect(fromEnd(twoSpeeds(1.2, 0.1))).toBeLessThanOrEqual(4);
});

test('a slow start is blunt, a fast start long', () => {
  // Dieselben Geraden am Anfang: langsam angesetzt (0,1) erreicht die Breite 90 % der Grundbreite nach 2,4 Einheiten, schnell
  // angesetzt (1,2) erst nach 14,8. Das gilt schon beim Schreiben (`points`, nach der ersten Richtung), nicht erst fertig.
  for (const name of ['live', 'done'] as const) {
    const fromStart = (pts: Timed[]): number => {
      const w = tempoWidths(pts);
      return reach90(w[name], w.base, pts.map((p) => p.x));
    };
    expect(fromStart(twoSpeeds(0.1, 1.2)), name).toBeLessThanOrEqual(4);
    expect(fromStart(twoSpeeds(1.2, 0.1)), name).toBeGreaterThan(12);
  }
});

test('before the start speed is known, nothing is settled', () => {
  // Stark gezoomt (ein Bildschirmpunkt ist 0,1 Einheiten): Punkte alle 0,5 Einheiten (5 Bildschirmpunkte) mit 1,2 Bildschirmpunkten
  // je ms. Die erste Richtung kommt nach 3 Einheiten (Punkt 6). Schon vorher liegen alle Punkte bis auf die letzten zwei mehr als
  // 2,5 σ vor dem Ende, fest ist aber keiner: Bis dahin läuft der Anfang vorläufig auf 3,6 Bildschirmpunkten (0,36 Einheiten) spitz
  // zu (wie langsam). Mit der ersten Richtung steht das Tempo beim Ansetzen fest (30 Bildschirmpunkte in 25 ms), und die Punkte davor
  // bekommen die Länge für schnell, 22,5 Bildschirmpunkte (2,25 Einheiten), und den Tempofaktor für schnell.
  const make = (schaerfe: number) =>
    new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.05, pxUnit: 0.1, fueller: { ...DEFAULT_FUELLER, schaerfe, rundung: 1, druck: 0 } });
  const b = make(1);
  const blunt = make(0); // die Grundbreiten
  for (let i = 0; i <= 20; i++) {
    const t = 5000 + (5 / 1.2) * i;
    expect(b.add(100 + 0.5 * i, 100, 0.5, 0, 0, t)).toBe(true);
    blunt.add(100 + 0.5 * i, 100, 0.5, 0, 0, t);
    const n = i + 1;
    expect(b.settled(), `${n} Punkte`).toBe(i < 6 ? 0 : n - 2);
    const len = ZOOMED_TAPER * (i < 6 ? TAPER_SLOW : TAPER_FAST);
    b.points().forEach((p, j) => {
      const want = Math.max(0.1 * NOM, blunt.points()[j].w * taperFactor(1, 0.5 * j, len));
      expect(p.w, `${n} Punkte, Punkt ${j}`).toBeCloseTo(want, 9);
    });
  }
  expect(b.meanW()).toBeCloseTo(b.stroke().w, 9);
  // Alle Punkte, auch die vor dem Festlegen des Anfangs, haben die Grundbreite für schnell: halb so breit.
  for (const p of blunt.points()) expect(p.w).toBeCloseTo(0.5 * NOM, 9);
});

test('equal or decreasing times do not break the speed', () => {
  // Eine langsame Gerade (0,1 Bildschirmpunkte je ms). Darin hat jeder dritte Punkt dieselbe Zeit wie der vorige und jeder fünfte
  // eine Zeit 3 ms vor der vorigen. Solche Schritte zählen nicht für das Tempo: kein NaN, kein unendliches Tempo, die Linie bleibt
  // langsam (volle Breite, kurze Spitzen). Ebenso, wenn alle Punkte dieselbe Zeit haben oder jede Zeit vor der vorigen liegt.
  const clean = timedLine(120, 0.6, () => 0.1);
  const slow = tempoWidths(clean);
  const glitchy: Timed[] = [];
  clean.forEach((p, i) => glitchy.push({ ...p, t: i % 3 === 2 ? glitchy[i - 1].t : i % 5 === 4 ? glitchy[i - 1].t - 3 : p.t }));
  const steps = glitchy.slice(1).map((p, i) => p.t - glitchy[i].t);
  expect(steps.filter((d) => d === 0).length).toBeGreaterThan(50);
  expect(steps.filter((d) => d < 0).length).toBeGreaterThan(20);
  const same = clean.map((p) => ({ ...p, t: 5000 }));
  const backwards = clean.map((p, i) => ({ ...p, t: 5000 - i }));
  for (const [name, pts] of [
    ['glitchy', glitchy],
    ['same', same],
    ['backwards', backwards],
  ] as const) {
    const w = tempoWidths(pts);
    for (const key of ['live', 'done', 'base'] as const) {
      expect(w[key].filter((v) => !(Number.isFinite(v) && v >= 0.1 * NOM)), `${name} ${key}`).toEqual([]);
      expect(w[key], `${name} ${key}`).toEqual(slow[key]);
    }
  }
  // Zusammengefasste Ereignisse, die sich je zu zweit eine Zeit teilen: Die Strecke des Schritts ohne eigene Zeit zählt beim nächsten
  // mit. So bleibt ein schneller Strich (1,2 Bildschirmpunkte je ms) so dünn wie mit getrennten Zeiten und wird nicht halb so schnell.
  const fast = timedLine(120, 0.6, () => 1.2);
  const paired = fast.map((p, i) => ({ ...p, t: fast[i - (i % 2)].t }));
  for (const key of ['live', 'done'] as const) expect(tempoWidths(paired)[key][100], key).toBeCloseTo(tempoWidths(fast)[key][100], 9);
});

test('a fast short flick stays fine and never goes below the floor', () => {
  // Ein Schwung, 10 Einheiten lang, Punkte alle 0,5, mit 1,2 Bildschirmpunkten je ms: Beide Spitzen sind für dieses Tempo 22,5
  // Einheiten lang, länger als der Strich. Sie wirken zugleich (P3c-R6) auf der Grundbreite für schnell (halb so breit), nie unter
  // dem Boden, und fertig ist kein Punkt breiter als beim Schreiben. Bis x = 2 und ab x = 8 wäre das Produkt schmaler als der
  // Boden (an den Enden 0,5 × 0,15 × 0,74 der Nennbreite): Dort greift er.
  const pts = timedLine(10, 0.5, () => 1.2);
  const { live, done, base } = tempoWidths(pts);
  expect(done).toHaveLength(21);
  const len = TAPER_LEN * TAPER_FAST;
  done.forEach((w, i) => {
    const x = pts[i].x;
    expect(base[i], `Punkt ${i}`).toBeCloseTo(0.5 * NOM, 9);
    expect(w, `Punkt ${i}`).toBeCloseTo(Math.max(0.1 * NOM, base[i] * taperFactor(1, x, len) * taperFactor(1, 10 - x, len)), 9);
    expect(w, `Punkt ${i}`).toBeLessThanOrEqual(live[i]);
  });
  const floored = done.flatMap((w, i) => (Math.abs(w - 0.1 * NOM) < 1e-12 ? [pts[i].x] : []));
  expect(floored).toEqual([0, 0.5, 1, 1.5, 2, 8, 8.5, 9, 9.5, 10]);
  // Ganz flache Feder quer zum Strich (nach rechts oben, der Stift ohne Neigung zeigt nach rechts unten) und leichter Druck bei voller
  // Druckempfindlichkeit: Die Grundbreite wäre 0,3 × 0,2 × 0,5 = 0,03 der Nennbreite. Beim Schreiben wie fertig greift überall der
  // Boden, keine Breite fällt darunter.
  const thin = (schaerfe: number) =>
    new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.01, pxUnit: 1, fueller: { ...DEFAULT_FUELLER, schaerfe, druck: 1, rundung: 0 } });
  for (const schaerfe of [0, 1]) {
    const b = thin(schaerfe);
    for (const p of pts) expect(b.add(p.x * Math.SQRT1_2, -p.x * Math.SQRT1_2, 0.05, 0, 0, p.t)).toBe(true);
    for (const [name, got] of [
      ['live', widths(b.points())],
      ['done', widths(b.finish().pts)],
    ] as const) {
      expect(got, `Schärfe ${schaerfe} ${name}`).toHaveLength(21);
      got.forEach((w, i) => expect(w, `Schärfe ${schaerfe} ${name} ${i}`).toBeCloseTo(0.1 * NOM, 12));
    }
  }
});

test('a resting pen with times keeps the blob limits', () => {
  /**
   * Der Klecks-Test von oben mit Zeiten wie am iPad. Stark gezoomt zieht der Stift 20 Einheiten schnell (1,2 Bildschirmpunkte je ms),
   * bleibt am Ende stehen und zittert: 200 Punkte im Umkreis von 0,3 Einheiten (3 Bildschirmpunkte), 240 je Sekunde. Ihre Abstände
   * liegen meist über dem Mindestabstand, und das Zittern hat Tempo: Die meisten Schritte sind schneller als `V_SLOW`, so wird die
   * Linie im Stand schmaler als satt. Breiter als ein langsamer Strich in derselben Richtung wird sie aber nie: kein Klecks.
   */
  const rest = (dir: [number, number], seed: number, speed: number) => {
    const b = fueller();
    const start = { x: 100, y: 100 };
    const line = straight(start, dir, 20, 0.1);
    let t = 5000;
    b.add(start.x, start.y, 0.45, 40, 40, t);
    for (const p of line) b.add(p.x, p.y, 0.45, 40, 40, (t += 1 / speed)); // 0,1 Einheiten sind ein Bildschirmpunkt
    const moving = b.points()[b.points().length - 1].w;
    const n = b.points().length;
    let last = line[line.length - 1];
    let fast = 0;
    for (const p of around(last, 0.3, 200, random(seed))) {
      if (Math.hypot(p.x - last.x, p.y - last.y) / ZOOMED / (1000 / 240) > V_SLOW) fast++;
      b.add(p.x, p.y, 0.45, 40, 40, (t += 1000 / 240));
      last = p;
    }
    return { moving, fast, resting: widths(b.points().slice(n)), stroked: widths(b.stroke().pts.slice(n)) };
  };
  for (const [name, dir, seeds] of [
    ['entlang der Feder', [1, 1], 20],
    ['quer zur Feder', [1, -1], 200],
  ] as [string, [number, number], number][]) {
    for (let seed = 1; seed <= seeds; seed++) {
      const label = `${name}, Startwert ${seed}`;
      const satt = rest(dir, seed, 0.1).moving; // so breit ist ein langsamer Strich in dieser Richtung
      const { moving, fast, resting, stroked } = rest(dir, seed, 1.2);
      expect(moving, label).toBeLessThan(0.6 * satt); // schnell herangezogen: schmal
      expect(fast, label).toBeGreaterThan(150);
      expect(resting.length, label).toBeGreaterThan(100);
      expect(Math.max(...resting), label).toBeLessThanOrEqual(1.05 * satt);
      expect(Math.min(...resting), label).toBeLessThan(0.9 * satt); // das Tempo des Zitterns wirkt
      expect(stroked, label).toEqual(resting);
    }
  }
});

test('without times nothing changes', () => {
  // Eine Welle mit wechselndem Druck und etwas Zittern, Startwerte der Regler, in normaler Größe, ohne Zeiten. Die Breiten beim
  // Schreiben und fertig sind dieselben wie vor dem Tempo bis auf die ruhigere Richtung (P3c-R12: Bei 14 % ist σ = 2,97 länger als
  // DIR_LEN): aufgenommen mit dem Stand 4fec1f4, in dem nur die Glättlänge der Richtung geändert war, auf sechs Stellen gerundet.
  // In normaler Größe ändern die Spitzen auf dem Glas nichts, und der Strich ist länger als beide Spitzen zusammen.
  const before = {
    live: [
      0.226498, 0.818679, 1.328679, 1.386832, 1.644486, 1.988914, 1.741362, 1.773303, 1.983627, 1.708205, 1.705499, 1.875335, 1.5254, 1.452965,
      1.535697, 1.160875, 1.075625, 1.140975, 0.867928, 0.852977, 0.946027, 0.770575, 0.806522, 0.972542,
    ],
    done: [
      0.226498, 0.818679, 1.328679, 1.386832, 1.644486, 1.988914, 1.741362, 1.773303, 1.983627, 1.708205, 1.705499, 1.875335, 1.5254, 1.452965,
      1.535697, 1.160875, 1.075625, 1.127453, 0.802564, 0.698771, 0.652087, 0.385303, 0.260521, 0.145881,
    ],
  };
  const rnd = random(4242);
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: 0.6, pxUnit: 1 });
  for (let i = 0; i < 24; i++) {
    expect(b.add(100 + 1.1 * i, 100 + 6 * Math.sin(i / 5) + (2 * rnd() - 1) * 0.2, [0.2, 0.5, 0.9][i % 3], 40, 40)).toBe(true);
  }
  for (const [name, got] of [
    ['live', widths(b.points())],
    ['done', widths(b.finish().pts)],
  ] as const) {
    expect(got, name).toHaveLength(24);
    got.forEach((w, i) => expect(w, `${name} ${i}`).toBeCloseTo(before[name][i], 5));
  }
});

// ---------- Ausbesserungen nach der Schlussprüfung (Paket 3c) ----------

/**
 * Füllfeder mit den Startwerten der Regler bis auf `settings`. Ein Bildschirmpunkt ist `pxUnit` Seiteneinheiten, der Mindestabstand
 * `minDist` Bildschirmpunkte (ohne Angabe so klein, dass kein Punkt wegfällt).
 */
function startPen(settings: Partial<FuellerSettings> = {}, pxUnit = 1, minDist = 0.01): StrokeBuilder {
  return new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 0, t: 1, minDist: minDist * pxUnit, pxUnit, fueller: { ...DEFAULT_FUELLER, ...settings } });
}

test('a stroke that starts fast has no club head', () => {
  // Eine Gerade mit 1,2 Bildschirmpunkten je ms von Anfang an, 120 Einheiten lang, Punkte alle 0,6, Startwerte der Regler, fertig.
  // Gemessen wird die Breite selbst, das Produkt aller Faktoren, nicht im Verhältnis zur Grundbreite. Bis Paket 3c begann das Tempo
  // bei 0: Die Grundbreite war am Anfang noch satt, und nach einer kurzen Spitze kam eine Keule (bis 1,39-fach bei 14 Einheiten).
  // Jetzt beginnt das Tempo mit dem beim Ansetzen (P3c-R9): Auf den ersten 30 Einheiten ist keine Breite mehr als 2 % breiter als die
  // Mitte, und der Anfang läuft genau so lang spitz an, wie das Ende ausläuft.
  const pts = timedLine(120, 0.6, () => 1.2);
  const b = startPen();
  for (const p of pts) expect(b.add(p.x, p.y, 0.5, 40, 40, p.t)).toBe(true);
  const done = widths(b.finish().pts);
  const middle = done[100];
  const head = done.filter((_, i) => pts[i].x <= 30);
  expect(head.length).toBe(51);
  expect(Math.max(...head) / middle).toBeLessThanOrEqual(1.02);
  head.forEach((w, i) => expect(w, `Punkt ${i}`).toBeCloseTo(done[200 - i], 9));
  // Die Spitze ist die für schnell: 90 % der Mitte erst nach 15 Einheiten (bis Paket 3c nach 4,8).
  expect(pts[done.findIndex((w) => w >= 0.9 * middle)].x).toBeGreaterThan(12);
});

test('the same hand motion gives the same widths at any zoom', () => {
  // Dieselbe Bewegung auf dem Glas in normaler Größe und dreifach gezoomt (ein Bildschirmpunkt ist 1/3 Einheit, die Orte auf der Seite
  // ein Drittel so groß), Startwerte der Regler: zwei kurze schnelle Striche (18 und 36 Bildschirmpunkte mit 1,0 je ms) und eine längere
  // Gerade, die langsam ansetzt und schnell abhebt. Die Spitzen zählen auf dem Glas (P3c-R10): Jeder Punkt hat im Verhältnis zur
  // Nennbreite dieselbe Breite. Mit Spitzen in Seiteneinheiten wäre ein schneller Strich gezoomt zum Haarstrich geworden (36 Bildschirmpunkte
  // ohne die Grenze der halben Länge: in der Mitte 0,28 statt 0,85 der Nennbreite).
  for (const [name, pts] of [
    ['18 px schnell', timedLine(18, 0.7, () => 1)],
    ['36 px schnell', timedLine(36, 0.7, () => 1)],
    ['langsam an, schnell ab', timedLine(120, 0.7, (x) => (x < 60 ? 0.2 : 1))],
  ] as const) {
    const at = (pxUnit: number) => {
      const b = startPen({}, pxUnit);
      for (const p of pts) expect(b.add(p.x * pxUnit, p.y * pxUnit, 0.5, 40, 40, p.t)).toBe(true);
      return { live: widths(b.points()), done: widths(b.finish().pts) };
    };
    const normal = at(1);
    const zoomed = at(1 / 3);
    for (const key of ['live', 'done'] as const) {
      expect(zoomed[key], `${name} ${key}`).toHaveLength(normal[key].length);
      zoomed[key].forEach((w, i) => expect(w / NOM, `${name} ${key} ${i}`).toBeCloseTo(normal[key][i] / NOM, 9));
    }
  }
});

test('a short fast stroke is never wider when finished than while writing', () => {
  // Kurze Striche mit 1,2 Bildschirmpunkten je ms, Startwerte der Regler. Bis Paket 3c wurden die Spitzen beim Abheben auf die halbe
  // Strichlänge gekürzt: Die Mitte eines 12 Einheiten langen Strichs sprang dann von 0,78 beim Schreiben auf 1,44. Jetzt wirken beide
  // Spitzen zugleich (P3c-R6), fertig ist kein Punkt breiter als beim Schreiben.
  for (const len of [6, 8, 12, 20, 30]) {
    const pts = timedLine(len, 0.5, () => 1.2);
    const b = startPen();
    for (const p of pts) expect(b.add(p.x, p.y, 0.5, 40, 40, p.t)).toBe(true);
    const live = widths(b.points());
    const done = widths(b.finish().pts);
    expect(done, `${len} Einheiten`).toHaveLength(live.length);
    done.forEach((w, i) => expect(w, `${len} Einheiten, Punkt ${i}`).toBeLessThanOrEqual(live[i]));
  }
});

test('a pen that stops and rests ends with a short tip', () => {
  // Eine Gerade mit 1,2 Bildschirmpunkten je ms, mit dem Mindestabstand der App. Dann hält der Stift abrupt an und ruht 300 ms, bevor
  // er abhebt (P3c-R7). Gemessen: die Strecke vor dem Ende, ab der die Breite 90 % der Grundbreite erreicht. Hebt der Stift in der
  // Bewegung ab, ist das die lange Spitze für schnell (15 Einheiten), nach der Ruhe die kurze (3), bis Paket 3c auch dann 15.
  const line = timedLine(120, 0.75, () => 1.2);
  const end = line[line.length - 1];
  const tipAtEnd = (rest: 'keine' | 'zittern' | 'still'): number => {
    const sharp = startPen({ druck: 0, rundung: 1 }, 1, MIN_DIST_PX);
    const blunt = startPen({ druck: 0, rundung: 1, schaerfe: 0 }, 1, MIN_DIST_PX);
    for (const b of [sharp, blunt]) for (const p of line) expect(b.add(p.x, p.y, 0.5, 0, 0, p.t)).toBe(true);
    let tUp: number | undefined = end.t;
    if (rest === 'zittern') {
      // In der Ruhe schickt der Stift weiter 240 Punkte je Sekunde, mit kleinem Zittern unter dem Mindestabstand: Sie fügen keinen
      // Punkt hinzu, aber mit ihnen sinkt das Tempo, auch ohne die Zeit des Abhebens.
      const rnd = random(99);
      for (let i = 1; i <= 72; i++) {
        const a = 2 * Math.PI * rnd();
        const d = 0.25 * rnd();
        for (const b of [sharp, blunt]) expect(b.add(end.x + d * Math.cos(a), end.y + d * Math.sin(a), 0.5, 0, 0, end.t + (i * 1000) / 240)).toBe(false);
      }
      tUp = undefined;
    } else if (rest === 'still') tUp = end.t + 300; // keine Punkte in der Ruhe: Erst die Zeit des Abhebens lässt das Tempo abklingen
    return reach90FromEnd(widths(sharp.finish(tUp).pts), widths(blunt.finish(tUp).pts), line);
  };
  expect(tipAtEnd('keine')).toBeGreaterThan(12);
  expect(tipAtEnd('zittern')).toBeLessThanOrEqual(4);
  expect(tipAtEnd('still')).toBeLessThanOrEqual(4);
});

test('a dropped sample counts for the speed from the sample before it', () => {
  // Eine Gerade mit 0,14 Bildschirmpunkten je ms, knapp unter `V_SLOW`, 240 Messpunkte je Sekunde: Sie liegen 0,58 auseinander, unter
  // dem Mindestabstand der App, also fällt jeder zweite weg. Er zählt trotzdem zum Tempo, mit seinem Abstand zum vorigen Messpunkt
  // (P3c-R7). Zählte der nächste behaltene Punkt seinen Schritt vom letzten behaltenen aus, käme dasselbe Stück doppelt vor, und die
  // langsame Linie würde schmaler.
  const dt = 1000 / 240;
  const blunt = startPen({ druck: 0, rundung: 1, schaerfe: 0 }, 1, MIN_DIST_PX); // ohne Verjüngung: nur das Tempo ändert die Breite
  let kept = 0;
  for (let i = 0; i <= 400; i++) if (blunt.add(0.14 * dt * i, 0, 0.5, 0, 0, 5000 + dt * i)) kept++;
  expect(kept).toBe(201);
  for (const p of blunt.finish().pts) expect(p.w).toBeCloseTo(NOM, 9);
});

test('a start the browser stamps out of order still gets its long tip', () => {
  // Ein schneller Strich (1,2 Bildschirmpunkte je ms). Der Anfang steht erst fest, wenn die erste Richtung und ein Zeitschritt da sind,
  // der zählt; springt die Zeit zurück, wird ab dort neu gemessen (P3c-R13). Gemessen: die Strecke ab dem Anfang, nach der die Breite
  // 90 % der Grundbreite erreicht, beim Schreiben und fertig.
  const fromStart = (pts: Timed[]) => {
    const w = tempoWidths(pts);
    return { live: reach90(w.live, w.base, pts.map((p) => p.x)), done: reach90(w.done, w.base, pts.map((p) => p.x)) };
  };
  // Das Aufsetzen ist 8 ms später gestempelt als der erste Messpunkt der Bewegung. Bis Paket 3c las sich der Anfang dann als langsam:
  // 90 % schon nach 2,4 Einheiten statt nach 15.
  const late = timedLine(120, 0.6, () => 1.2);
  late[0] = { ...late[0], t: late[1].t + 8 };
  for (const [name, s] of Object.entries(fromStart(late))) expect(s, `Aufsetzen später gestempelt, ${name}`).toBeGreaterThan(12);
  // Umgekehrt ein langsamer Strich (0,1), das Aufsetzen 30 ms später gestempelt: Gemessen ab dem ersten Messpunkt der Bewegung bleibt
  // der Anfang stumpf. Zählte die Strecke ab dem Aufsetzen weiter, aber die Zeit erst ab dessen Stempel, läse er sich als schnell.
  const slow = timedLine(120, 0.6, () => 0.1);
  slow[0] = { ...slow[0], t: slow[1].t + 30 };
  for (const [name, s] of Object.entries(fromStart(slow))) expect(s, `langsam, Aufsetzen später gestempelt, ${name}`).toBeLessThanOrEqual(4);
  // Alle Messpunkte der ersten 16 ms tragen die Zeit des Aufsetzens (ein Bild mit zusammengefassten Ereignissen): Der Anfang wartet auf
  // die nächste Zeit, die zählt, und mit ihr auf die ganze Strecke bis dahin. Bis dahin ist kein Punkt fest, auch nicht nach der ersten
  // Richtung: Was fest ist, ändert sich danach nie mehr.
  const frame = timedLine(120, 0.6, () => 1.2).map((p) => ({ ...p, t: p.t < 5016 ? 5000 : p.t }));
  for (const [name, s] of Object.entries(fromStart(frame))) expect(s, `erstes Bild mit einer Zeit, ${name}`).toBeGreaterThan(12);
  const b = inkPen();
  const fixed: Pt[][] = [];
  for (const p of frame) {
    b.add(p.x, p.y, 0.5, 0, 0, p.t);
    fixed.push(b.points().slice(0, b.settled()).map((q) => ({ ...q })));
  }
  expect(fixed.findIndex((f) => f.length > 0)).toBeGreaterThan(30); // erst nach 16 ms, bei 19,2 Einheiten
  fixed.forEach((was, i) => expect(b.points().slice(0, was.length), `fest nach ${i + 1} Punkten`).toEqual(was));
});

test('before the start is known, the first direction already sets the nib factor', () => {
  // Alle Zeiten gleich, ein Strich von 30 Einheiten quer zur Feder (Startwerte der Regler): Der Anfang steht nie fest (kein Zeitschritt,
  // der zählt, und kürzer als START_WAIT × TAPER_LEN). Mit der ersten Richtung (nach 4 Einheiten) bekommen die Punkte davor trotzdem
  // ihren Federfaktor: Vom Anfang bis zur Mitte wird die Breite nirgends schmaler, beim Schreiben wie fertig, ohne Knubbel.
  const b = startPen();
  for (const p of straight({ x: 100, y: 100 }, [1, -1], 30, 0.5)) expect(b.add(p.x, p.y, 0.45, 40, 40, 5000)).toBe(true);
  expect(b.settled()).toBe(0);
  for (const [name, pts] of [
    ['points', b.points()],
    ['finish', b.finish().pts],
  ] as const) {
    const w = widths(pts.slice(0, Math.floor(pts.length / 2) + 1));
    const drops = w.flatMap((v, i) => (i && v < w[i - 1] - 1e-12 ? [`Punkt ${i}: ${w[i - 1]} -> ${v}`] : []));
    expect(drops, name).toEqual([]);
  }
});

test('if no time step ever counts, the start waits only so far', () => {
  // Alle Punkte mit derselben Zeit: Ein Zeitschritt, der zählt, kommt nie. Fest wird trotzdem etwas, sobald der Weg START_WAIT ×
  // TAPER_LEN Bildschirmpunkte lang ist (45): Dann gilt der Anfang als langsam. So bleibt die Arbeit je Stiftbewegung begrenzt.
  const b = inkPen();
  const blunt = inkPen(0);
  for (let i = 0; i <= 200; i++) {
    expect(b.add(0.6 * i, 0, 0.5, 0, 0, 5000)).toBe(true);
    blunt.add(0.6 * i, 0, 0.5, 0, 0, 5000);
    if (0.6 * i < START_WAIT * TAPER_LEN) expect(b.settled(), `${i + 1} Punkte`).toBe(0);
    else expect(b.settled(), `${i + 1} Punkte`).toBeGreaterThan(0);
  }
  const done = widths(b.finish().pts);
  expect(reach90(done, widths(blunt.finish().pts), done.map((_, i) => 0.6 * i))).toBeLessThanOrEqual(4);
  for (const p of blunt.points()) expect(p.w).toBeCloseTo(NOM, 9); // langsam: volle Breite
});

test('a point without time ends the speed for the rest of the stroke', () => {
  // Eine schnelle Gerade (1,2 Bildschirmpunkte je ms), deren Punkt bei x = 60 keine Zeit hat (P3c-R5): Bis dahin ist sie halb so breit,
  // ab ihm in voller Breite, und das Ende läuft ohne Tempo aus, auf TAPER_LEN (9) Bildschirmpunkten statt auf 22,5 für schnell. Auch
  // die Zeit des Abhebens ändert daran nichts.
  const pts = timedLine(120, 0.6, () => 1.2);
  const sharp = inkPen();
  const blunt = inkPen(0);
  for (const b of [sharp, blunt]) pts.forEach((p, i) => expect(b.add(p.x, p.y, 0.5, 0, 0, i === 100 ? undefined : p.t)).toBe(true));
  const base = widths(blunt.finish().pts);
  base.forEach((w, i) => expect(w, `Punkt ${i}`).toBeCloseTo(i < 100 ? 0.5 * NOM : NOM, 9));
  const tUp = pts[pts.length - 1].t + 300;
  widths(sharp.finish(tUp).pts).forEach((w, i) => {
    if (pts[i].x < 100) return;
    expect(w, `Punkt ${i}`).toBeCloseTo(Math.max(0.1 * NOM, base[i] * taperFactor(1, 120 - pts[i].x, TAPER_LEN)), 9);
  });
});

/** Bildschirmpunkte je mm auf dem Glas des iPads (132 je Zoll). */
const PX_PER_MM = 5.2;

/**
 * Eine waagrechte Linie, 60 mm lang mit 60 mm/s, dazu ein Zittern der Hand quer zu ihr: 10 Hz, 0,75 Bildschirmpunkte. 240 Messpunkte je
 * Sekunde, in normaler Größe (ein Bildschirmpunkt ist eine Seiteneinheit). Jeder Punkt mit seiner Zeit.
 */
function tremorLine(): Timed[] {
  const v = (60 * PX_PER_MM) / 1000; // Bildschirmpunkte je ms
  const pts: Timed[] = [];
  for (let i = 0; v * (i * 1000) / 240 <= 60 * PX_PER_MM; i++) {
    const t = (i * 1000) / 240;
    pts.push({ x: v * t, y: 0.75 * Math.sin((2 * Math.PI * 10 * t) / 1000), t: 5000 + t });
  }
  return pts;
}

/** Schreibt `pts` mit den Startwerten bis auf `settings`, mit dem Mindestabstand der App, und gibt den fertigen Strich zurück. */
function writeTremor(pts: Timed[], settings: Partial<FuellerSettings> = {}): Pt[] {
  const b = startPen(settings, 1, MIN_DIST_PX);
  for (const p of pts) expect(b.add(p.x, p.y, 0.5, 0, 0, p.t)).toBe(true);
  return b.finish().pts;
}

test('the stabilisation removes a hand tremor step by step', () => {
  // Wie viel vom Zittern in der Mitte der Linie (60 %) bleibt, als Anteil des Effektivwerts, je Stufe der Strich-Stabilisierung (P3c-R11).
  // Gemessen: 14 % 0,853, 40 % 0,546, 70 % 0,210, 100 % 0,046. Ein Zittern von 10 Hz ist bei 60 mm/s etwa 31 Bildschirmpunkte lang, viel
  // länger als σ bei 14 % (2,97): Erst die höheren Stufen nehmen es weg (das alte 100 % entspricht etwa 45 %).
  const raw = tremorLine();
  const n = raw.length;
  const inner = raw.slice(Math.floor(n * 0.2), Math.floor(n * 0.8));
  const rms = (ys: number[]) => Math.sqrt(mean(ys.map((y) => y * y)));
  let before = 1;
  for (const [stabil, measured] of [
    [0.14, 0.853],
    [0.4, 0.546],
    [0.7, 0.21],
    [1, 0.046],
  ] as const) {
    const done = writeTremor(raw, { stabil }).slice(Math.floor(n * 0.2), Math.floor(n * 0.8));
    const left = rms(done.map((p) => p.y)) / rms(inner.map((p) => p.y));
    expect(Math.abs(left - measured), `${stabil * 100} %: ${left}`).toBeLessThanOrEqual(0.03);
    expect(left, `${stabil * 100} %`).toBeLessThan(before);
    before = left;
  }
});

test('the stabilisation also calms the edges', () => {
  // Dasselbe Zittern mit den Startwerten der Regler: Die Breite der Feder hängt an der Richtung des Strichs, und die kommt aus den
  // Rohpunkten, zittert also mit. Schwankung der Breite in der Mitte (40 %): Standardabweichung durch Mittel. Bis Paket 3c wurde die
  // Richtung immer über DIR_LEN geglättet: 4,03 %, bei jeder Stufe. Jetzt über max(DIR_LEN, σ) (P3c-R12): gemessen bei 14 % 3,73 %,
  // bei 40 % 2,86 %, bei 100 % 1,66 %.
  const before = 0.0403;
  const raw = tremorLine();
  const spread = (stabil: number): number => {
    const done = writeTremor(raw, { stabil });
    const w = widths(done.slice(Math.floor(done.length * 0.3), Math.floor(done.length * 0.7)));
    const m = mean(w);
    return Math.sqrt(mean(w.map((v) => (v - m) ** 2))) / m;
  };
  const values = [0, 0.14, 0.4, 1].map(spread);
  expect(values[0]).toBeCloseTo(before, 3); // bei 0 % ist σ kürzer als DIR_LEN: wie vorher
  expect(values[1]).toBeLessThanOrEqual(0.95 * before);
  expect(values[2]).toBeLessThanOrEqual(0.75 * before);
  expect(values[3]).toBeLessThanOrEqual(0.5 * before);
});
