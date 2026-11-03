import { expect, test } from 'vitest';
import type { Pt2 } from '../../src/ink/gestures';
import { outlineD, outlineOf, outlinePolygons } from '../../src/ink/outline';
import type { Pt, Stroke } from '../../src/ink/types';

// Der Umriss eines Strichs mit Breite je Punkt: reine Rechnung, Orte in Seiteneinheiten. Alles hier ist erfunden.

/** Abstand der Punkte, wenn ein Linienzug dicht abgetastet wird. */
const STEP = 0.9;

/** Fläche eines Vielecks mit Vorzeichen (Gaußsche Trapezformel). Das Vorzeichen sagt, wie herum es läuft. */
function area(poly: Pt2[]): number {
  let sum = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** Wie oft alle Vielecke zusammen um `p` herumlaufen, mit Vorzeichen. */
function winding(polys: Pt2[][], p: Pt2): number {
  let n = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      const side = (b.x - a.x) * (p.y - a.y) - (p.x - a.x) * (b.y - a.y);
      if (a.y <= p.y && b.y > p.y && side > 0) n++;
      if (a.y > p.y && b.y <= p.y && side < 0) n--;
    }
  }
  return n;
}

/** Wahr, wenn `p` in der Füllung liegt: `fill` mit der Regel nonzero über alle Vielecke. */
const inside = (polys: Pt2[][], p: Pt2): boolean => winding(polys, p) !== 0;

/** Ein Linienzug dicht abgetastet: Die Ecken bleiben, dazwischen liegen die Punkte höchstens 0,9 auseinander. */
function sample(corners: Pt2[], w: (i: number) => number): Pt[] {
  const xy: Pt2[] = [corners[0]];
  for (let k = 1; k < corners.length; k++) {
    const a = corners[k - 1];
    const b = corners[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / STEP));
    for (let j = 1; j <= n; j++) xy.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  return xy.map((p, i) => ({ x: p.x, y: p.y, w: w(i) }));
}

/** Ecken entlang der Kurve `f` von t = 0 bis `end`, etwa 0,9 auseinander (gemessen in kleinen Schritten entlang der Kurve). */
function curve(f: (t: number) => Pt2, end: number): Pt2[] {
  const steps = 20000;
  const corners = [f(0)];
  let prev = corners[0];
  let len = 0;
  for (let i = 1; i <= steps; i++) {
    const p = f((end * i) / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
    if (len >= STEP || i === steps) {
      corners.push(p);
      len = 0;
    }
  }
  return corners;
}

/** Zickzack ab `start` mit `legs` Stücken der Länge `len`, jedes um `turnDeg` Grad gegen das vorige gedreht. */
function zigzag(start: Pt2, legs: number, len: number, turnDeg: number): Pt2[] {
  const tilt = ((180 - turnDeg) / 2) * (Math.PI / 180);
  const corners = [start];
  for (let k = 0; k < legs; k++) {
    const last = corners[corners.length - 1];
    const dir = k % 2 ? Math.PI - tilt : tilt;
    corners.push({ x: last.x + len * Math.cos(dir), y: last.y + len * Math.sin(dir) });
  }
  return corners;
}

/**
 * Ecken eines Wegs aus Stücken `[Länge, Drehung in Grad]`, ab (0, 0) nach rechts: Jedes Stück dreht sich gleichmäßig
 * um seinen Winkel (links herum positiv, 0 ist gerade), die Ecken liegen etwa 0,9 auseinander.
 */
function path(parts: [number, number][]): Pt2[] {
  let x = 0;
  let y = 0;
  let a = 0;
  const corners = [{ x, y }];
  for (const [len, deg] of parts) {
    const n = Math.max(1, Math.round(len / STEP));
    const turn = (deg * Math.PI) / 180 / n;
    for (let i = 0; i < n; i++) {
      a += turn / 2;
      x += (len / n) * Math.cos(a);
      y += (len / n) * Math.sin(a);
      a += turn / 2;
      corners.push({ x, y });
    }
  }
  return corners;
}

/** Abstand von `p` zur Strecke von `a` nach `b`. */
function segDist(p: Pt2, a: Pt2, b: Pt2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy)));
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

const fixed = (w: number) => () => w;
/** Breite wechselnd von Punkt zu Punkt zwischen 0,5 und 8. */
const alternating = (i: number) => (i % 2 ? 8 : 0.5);

test('an empty stroke has no outline', () => {
  expect(outlinePolygons([])).toEqual([]);
  expect(outlineD([])).toBe('');
});

test('a single point becomes a circle with 12 corners at half its width', () => {
  const polys = outlinePolygons([{ x: 10, y: 10, w: 4 }]);
  expect(polys).toHaveLength(1);
  expect(polys[0]).toHaveLength(12);
  for (const c of polys[0]) expect(Math.abs(Math.hypot(c.x - 10, c.y - 10) - 2)).toBeLessThanOrEqual(1e-9);
});

test('minW makes a thinner point as wide as minW', () => {
  const polys = outlinePolygons([{ x: 10, y: 10, w: 0.5 }], 4);
  for (const c of polys[0]) expect(Math.abs(Math.hypot(c.x - 10, c.y - 10) - 2)).toBeLessThanOrEqual(1e-9);
});

test('a straight stroke becomes one rounded band', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 50, y: 0 };
  const polys = outlinePolygons(sample([a, b], fixed(4)));
  expect(polys).toHaveLength(1);
  for (const c of polys[0]) expect(segDist(c, a, b)).toBeLessThanOrEqual(2 + 1e-6);
  const expected = 50 * 4 + Math.PI * 4;
  expect(Math.abs(area(polys[0]))).toBeGreaterThanOrEqual(expected * 0.97);
  expect(Math.abs(area(polys[0]))).toBeLessThanOrEqual(expected * 1.03);
});

test('a sharp turn splits the outline at the corner', () => {
  const pts = sample(
    [
      { x: 0, y: 0 },
      { x: 20, y: 20 },
      { x: 40, y: 0 },
    ],
    fixed(4),
  );
  expect(outlinePolygons(pts)).toHaveLength(2);
});

test('all parts turn the same way', () => {
  const o = { x: 100, y: 100 };
  const shapes = [
    zigzag(o, 6, 20, 120),
    [o, { x: 140, y: 100 }],
    [o, { x: 60, y: 100 }],
    [o, { x: 100, y: 140 }],
    [o, { x: 100, y: 60 }],
  ];
  const areas = shapes.flatMap((corners) => outlinePolygons(sample(corners, fixed(4))).map(area));
  expect(areas.length).toBeGreaterThan(shapes.length);
  expect(areas.every((a) => a < 0) || areas.every((a) => a > 0)).toBe(true);
});

test('every point of the centre line lies inside the outline, also in tight curves and sharp turns', () => {
  const shapes: Record<string, Pt[]> = {
    circle: sample(
      curve((t) => ({ x: 50 + 2 * Math.cos(t), y: 50 + 2 * Math.sin(t) }), 2 * Math.PI),
      fixed(6),
    ),
    spiral: sample(
      curve((t) => ({ x: 50 + (1 + 0.5 * t) * Math.cos(t), y: 50 + (1 + 0.5 * t) * Math.sin(t) }), 8 * Math.PI),
      fixed(5),
    ),
    zigzag: sample(zigzag({ x: 0, y: 0 }, 6, 20, 170), fixed(4)),
    alternating: sample(
      curve((t) => ({ x: t, y: 6 * Math.sin(t / 3) }), 60),
      alternating,
    ),
    // Enge Kehre nach rechts, gleich danach eine nach links, überall gleich breit: Die Innenseite der einen Kehre reicht
    // über die Mittellinie der anderen hinaus.
    sCurve: sample(
      path([
        [5, 0],
        [Math.PI, -180],
        [1, 0],
        [1.2 * Math.PI, 180],
        [5, 0],
      ]),
      fixed(8),
    ),
    spiralAlternating: sample(
      curve((t) => ({ x: 50 + (1 + 0.5 * t) * Math.cos(t), y: 50 + (1 + 0.5 * t) * Math.sin(t) }), 8 * Math.PI),
      alternating,
    ),
    // Die dünnste Linie der Füllfeder (fein, 0,15): Der halbe Strich ist schmaler als SIMPLIFY.
    thinCircle: sample(
      curve((t) => ({ x: 50 + 5 * Math.cos(t), y: 50 + 5 * Math.sin(t) }), 2 * Math.PI),
      fixed(0.15),
    ),
  };
  for (const [name, pts] of Object.entries(shapes)) {
    const polys = outlinePolygons(pts);
    const outside = pts.filter((p) => !inside(polys, p));
    expect(outside, name).toEqual([]);
  }
});

test('outlineD writes only M, L and Z with at most one decimal', () => {
  const pts = sample(zigzag({ x: -3.14159, y: 2.71828 }, 4, 12.345, 100), (i) => 1.234 + (i % 3));
  const d = outlineD(pts);
  expect(d).toMatch(/^M( -?\d+(\.\d)?){2}( L( -?\d+(\.\d)?){2})* Z( M( -?\d+(\.\d)?){2}( L( -?\d+(\.\d)?){2})* Z)*$/);
  expect(outlineD([{ x: 1.25, y: -7.75, w: 3.3 }])).toMatch(/^M( -?\d+(\.\d)?){2}( L( -?\d+(\.\d)?){2}){11} Z$/);
});

test('the outline of a stroke is worked out once and follows its points', () => {
  const s: Stroke = {
    id: 'f1',
    tool: 'fueller',
    color: 'blau',
    widthMm: 0.4,
    t: 1,
    w: 2.4,
    pts: sample(
      [
        { x: 10, y: 10 },
        { x: 30, y: 15 },
      ],
      fixed(2.4),
    ),
  };
  expect(outlineOf(s)).toBe(outlineOf(s));
  expect(outlineOf(s)).toEqual(outlinePolygons(s.pts));
});

/** Wie bei der Füllfeder: ein breiter Abstrich (3) nach rechts unten, dann ein haarfeiner Aufstrich (0,15) nach rechts oben. */
const downUp = (): { s: Stroke; up: Pt[] } => {
  const down = sample(
    [
      { x: 10, y: 10 },
      { x: 40, y: 40 },
    ],
    fixed(3),
  );
  const up = sample(
    [
      { x: 40, y: 40 },
      { x: 70, y: 10 },
    ],
    fixed(0.15),
  ).slice(1);
  return { s: { id: 'f2', tool: 'fueller', color: 'schwarz', widthMm: 0.1, t: 1, w: 1, pts: [...down, ...up] }, up };
};

/** Ein Bildpunkt bei ganzer Seite im Hochformat am iPad, in Seiteneinheiten. */
const PX = 0.74;

test('with a minimum width no part of the outline is thinner, and it has no hole', () => {
  const { s, up } = downUp();
  const polys = outlineOf(s, PX);
  // Quer zum Aufstrich reicht die Form überall fast einen halben Bildpunkt weit, ohne Mindestbreite nur 0,075.
  const n = { x: Math.SQRT1_2, y: Math.SQRT1_2 }; // senkrecht zum Aufstrich
  const reach = 0.9 * (PX / 2);
  const missing = up
    .slice(5, -5)
    .flatMap((p) => [1, -1].map((side) => ({ x: p.x + side * reach * n.x, y: p.y + side * reach * n.y })))
    .filter((q) => !inside(polys, q));
  expect(missing).toEqual([]);
  expect(s.pts.filter((p) => !inside(polys, p))).toEqual([]);
});

test('the outline with a minimum width is worked out again only when the minimum changes', () => {
  const { s } = downUp();
  const polys = outlineOf(s, PX);
  expect(polys).toEqual(outlinePolygons(s.pts, PX));
  expect(outlineOf(s, PX)).toBe(polys); // dieselbe Mindestbreite: nichts neu gerechnet
  expect(outlineOf(s, 1.5)).toEqual(outlinePolygons(s.pts, 1.5)); // nach dem Zoomen ein anderer Bildpunkt
  expect(outlineOf(s)).toEqual(outlinePolygons(s.pts)); // ohne Mindestbreite die echten Breiten
  // Ein Strich, der nirgends dünner als die Mindestbreite ist, behält seinen einen Umriss.
  const wide: Stroke = { ...s, id: 'f3', pts: s.pts.map((p) => ({ ...p, w: 3 })) };
  expect(outlineOf(wide, PX)).toBe(outlineOf(wide));
});
