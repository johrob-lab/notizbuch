import { expect, test } from 'vitest';
import type { Pt2 } from '../../src/ink/gestures';
import { outlineD, outlineDOf, outlineOf, outlinePolygons, SIMPLIFY, traceCurve } from '../../src/ink/outline';
import { FUELLER_FLOOR } from '../../src/ink/pens';
import { fmtCoord } from '../../src/ink/stroke';
import { MM, WIDTH_MM, type Pt, type Stroke } from '../../src/ink/types';

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

/** Ein Linienzug dicht abgetastet: Die Ecken bleiben, dazwischen liegen die Punkte höchstens `step` (0,9) auseinander. */
function sample(corners: Pt2[], w: (i: number) => number, step = STEP): Pt[] {
  const xy: Pt2[] = [corners[0]];
  for (let k = 1; k < corners.length; k++) {
    const a = corners[k - 1];
    const b = corners[k];
    const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
    for (let j = 1; j <= n; j++) xy.push({ x: a.x + ((b.x - a.x) * j) / n, y: a.y + ((b.y - a.y) * j) / n });
  }
  return xy.map((p, i) => ({ x: p.x, y: p.y, w: w(i) }));
}

/** Ecken entlang der Kurve `f` von t = 0 bis `end`, etwa `step` (0,9) auseinander (gemessen in kleinen Schritten entlang der Kurve). */
function curve(f: (t: number) => Pt2, end: number, step = STEP): Pt2[] {
  const steps = 20000;
  const corners = [f(0)];
  let prev = corners[0];
  let len = 0;
  for (let i = 1; i <= steps; i++) {
    const p = f((end * i) / steps);
    len += Math.hypot(p.x - prev.x, p.y - prev.y);
    prev = p;
    if (len >= step || i === steps) {
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

/** Abstand von `p` zur Strecke von `a` nach `b` (bei gleichen Enden zum Punkt). */
function segDist(p: Pt2, a: Pt2, b: Pt2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
  return Math.hypot(a.x + t * vx - p.x, a.y + t * vy - p.y);
}

/** Abstand von `p` zum Linienzug `line` (offen, ein einzelner Punkt ist der Punkt). */
function lineDist(p: Pt2, line: Pt2[]): number {
  let best = Math.hypot(p.x - line[0].x, p.y - line[0].y);
  for (let i = 1; i < line.length; i++) best = Math.min(best, segDist(p, line[i - 1], line[i]));
  return best;
}

/** Ein Stück der Kurve: die quadratische Bézier-Kurve von `from` mit dem Kontrollpunkt `ctrl` nach `to`. */
type Piece = { from: Pt2; ctrl: Pt2; to: Pt2 };

/** Die Stücke, die `traceCurve` für ein Vieleck zeichnet, so mitgeschrieben, wie eine Zeichenfläche sie bekäme. */
function piecesOf(poly: Pt2[]): Piece[] {
  const pieces: Piece[] = [];
  let pen: Pt2 = { x: NaN, y: NaN };
  traceCurve(
    {
      moveTo: (x, y) => {
        pen = { x, y };
      },
      quadraticCurveTo: (cx, cy, x, y) => {
        pieces.push({ from: pen, ctrl: { x: cx, y: cy }, to: { x, y } });
        pen = { x, y };
      },
      closePath: () => {},
    },
    poly,
  );
  return pieces;
}

/** Der Punkt eines Stücks bei `t` (0 bis 1). */
function onPiece({ from, ctrl, to }: Piece, t: number): Pt2 {
  const u = 1 - t;
  return { x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x, y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y };
}

/** Stücke als dichter Linienzug: je Stück 32 Punkte bis zu seinem Ende. Der Anfang des ersten fehlt, er ist das Ende des vorigen. */
const traced = (pieces: Piece[]): Pt2[] => pieces.flatMap((p) => Array.from({ length: 32 }, (_, k) => onPiece(p, (k + 1) / 32)));

/** Die Kurve des ganzen Umrisses, je Vieleck ein dichter, geschlossener Linienzug. */
const curvesOf = (pts: readonly Pt[]): Pt2[][] => outlinePolygons(pts).map((poly) => traced(piecesOf(poly)));

const fixed = (w: number) => () => w;
/** Breite wechselnd von Punkt zu Punkt zwischen 0,5 und 8. */
const alternating = (i: number) => (i % 2 ? 8 : 0.5);
/** Die dünnste Linie der Füllfeder: fein und am Boden (`FUELLER_FLOOR`). */
const FLOOR_W = WIDTH_MM.fein * MM * FUELLER_FLOOR;
/** Abstand der Punkte, gezoomt geschrieben (Zoom 6): Stiftpunkte liegen mindestens 0,6 Bildschirmpunkte auseinander (`MIN_DIST_PX`). */
const ZOOMED_STEP = 0.1;

/** Striche, an denen ein Umriss leicht ein Loch bekäme: enge Kurven, scharfe Knicke, springende und sehr kleine Breiten. */
function hardShapes(): Record<string, Pt[]> {
  return {
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
    // Die dünnste Linie der Füllfeder (fein am Boden, 0,06): Der halbe Strich ist schmaler als zweimal SIMPLIFY, die Vereinfachung
    // ist also durch seinen Abstand zur Mittellinie begrenzt (höchstens die Hälfte davon, `simplified`). Ein Loch gäbe es hier aber
    // auch ohne diese Grenze nicht: Die Seiten liegen 0,03 neben der Mittellinie, weiter als SIMPLIFY. Die Grenze bewacht `thinArc`.
    thinCircle: sample(
      curve((t) => ({ x: 50 + 5 * Math.cos(t), y: 50 + 5 * Math.sin(t) }), 2 * Math.PI),
      fixed(FLOOR_W),
    ),
    // Grenzfall unter dem Boden: So dünn (0,03) schreibt die Füllfeder nie, ihre dünnste Linie ist 0,06. Ein flacher Bogen, gezoomt
    // geschrieben (Radius 20, 1,7 lang, Punkte 0,1 auseinander), mit halbem Strich 0,015, schmaler als SIMPLIFY. Seine Seiten weichen
    // höchstens 0,018 von der Sehne zwischen ihren Enden ab, weniger als SIMPLIFY: Ohne die Grenze der Vereinfachung bei der Hälfte
    // des kleinsten Abstands zur Mittellinie (`simplified`) würde jede Seite diese eine Sehne, und die läge in der Mitte jenseits der
    // Mittellinie. Ohne die Grenze gemessen 8 Punkte der Mittellinie außerhalb des Umrisses und 8 außerhalb der Kurve.
    thinArc: Array.from({ length: 18 }, (_, i) => {
      const a = (i * ZOOMED_STEP) / 20;
      return { x: 50 + 20 * Math.cos(a), y: 50 + 20 * Math.sin(a), w: 0.03 };
    }),
  };
}

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
  for (const [name, pts] of Object.entries(hardShapes())) {
    const polys = outlinePolygons(pts);
    const outside = pts.filter((p) => !inside(polys, p));
    expect(outside, name).toEqual([]);
  }
});

test('outlineD writes only M, Q and Z with at most two decimals', () => {
  const pts = sample(zigzag({ x: -3.14159, y: 2.71828 }, 4, 12.345, 100), (i) => 1.234 + (i % 3));
  const d = outlineD(pts);
  expect(d).toMatch(/^M( -?\d+(\.\d{1,2})?){2}( Q( -?\d+(\.\d{1,2})?){4})* Z( M( -?\d+(\.\d{1,2})?){2}( Q( -?\d+(\.\d{1,2})?){4})* Z)*$/);
  // Die zweite Nachkommastelle steht auch da: Gezoomt geschrieben liegen die Punkte nur etwa 0,1 Einheiten auseinander.
  expect(d).toMatch(/\.\d\d\b/);
  expect(outlineD([{ x: 1.25, y: -7.75, w: 3.3 }])).toMatch(/^M( -?\d+(\.\d{1,2})?){2}( Q( -?\d+(\.\d{1,2})?){4}){12} Z$/);
});

test('the outline path uses only M, Q and Z', () => {
  // Ein Strich mit einem Knick (zwei Vielecke) und ein Tipp (ein Vieleck mit 12 Ecken), mit Zahlen, die gerundet werden.
  const shapes = [sample(zigzag({ x: -3.14159, y: 2.71828 }, 2, 12.345, 100), fixed(2.2)), [{ x: 1.25, y: -7.75, w: 3.3 }]];
  for (const pts of shapes) {
    const polys = outlinePolygons(pts);
    const d = outlineD(pts);
    // Nur diese Befehle, alle groß geschrieben (also mit absoluten Zahlen), je Vieleck ein M und ein Z.
    const commands = d.match(/[A-Za-z]/g) ?? [];
    expect(new Set(commands)).toEqual(new Set(['M', 'Q', 'Z']));
    expect(commands.filter((c) => c === 'M')).toHaveLength(polys.length);
    expect(commands.filter((c) => c === 'Z')).toHaveLength(polys.length);
    // Je Vieleck: Start in der Mitte der Seite vom letzten zum ersten Eckpunkt, dann je Eckpunkt ein Q mit dem Eckpunkt als
    // Kontrollpunkt bis zur Mitte der nächsten Seite. Alle Zahlen mit `fmtCoord`.
    const mid = (a: Pt2, b: Pt2) => [fmtCoord((a.x + b.x) / 2), fmtCoord((a.y + b.y) / 2)];
    const expected = polys.flatMap((poly) => [
      'M',
      ...mid(poly[poly.length - 1], poly[0]),
      ...poly.flatMap((v, i) => ['Q', fmtCoord(v.x), fmtCoord(v.y), ...mid(v, poly[(i + 1) % poly.length])]),
      'Z',
    ]);
    expect(d.split(' ')).toEqual(expected);
  }
  expect(outlinePolygons(shapes[0])).toHaveLength(2);
});

test('the curve of a polygon with fewer than three corners is drawn without error, an empty one not at all', () => {
  // `outlinePolygons` baut solche Vielecke nicht. `traceCurve` zeichnet sie trotzdem ohne Fehler und nach derselben Regel wie jedes
  // andere: ein M in der Mitte der Seite vom letzten zum ersten Eckpunkt, je Eckpunkt ein Q, ein Z. Ein leeres zeichnet es gar nicht.
  const calls = (poly: Pt2[]): (string | number)[] => {
    const out: (string | number)[] = [];
    traceCurve(
      {
        moveTo: (x, y) => {
          out.push('M', x, y);
        },
        quadraticCurveTo: (cx, cy, x, y) => {
          out.push('Q', cx, cy, x, y);
        },
        closePath: () => {
          out.push('Z');
        },
      },
      poly,
    );
    return out;
  };
  expect(calls([])).toEqual([]);
  // Eine Ecke: Anfang, Kontrollpunkt und Ende liegen auf ihr.
  expect(calls([{ x: 1, y: 2 }])).toEqual(['M', 1, 2, 'Q', 1, 2, 1, 2, 'Z']);
  // Zwei Ecken: Anfang in der Mitte zwischen ihnen, je Ecke ein Stück zurück zu dieser Mitte.
  expect(
    calls([
      { x: 0, y: 0 },
      { x: 4, y: 2 },
    ]),
  ).toEqual(['M', 2, 1, 'Q', 0, 0, 2, 1, 'Q', 4, 2, 2, 1, 'Z']);
});

test('the curve covers taps, knicks and thin strokes', () => {
  const shapes: Record<string, Pt[]> = {
    tap: [{ x: 10, y: 10, w: 1.2 }],
    thinTap: [{ x: 10, y: 10, w: FLOOR_W }],
    // Knicke um 120 Grad, gezoomt geschrieben.
    knick: sample(zigzag({ x: 0, y: 0 }, 3, 3, 120), fixed(1.2), ZOOMED_STEP),
    // Die dünnste Linie der Füllfeder mit Knicken um 150 Grad und in einer kleinen Schleife, gezoomt geschrieben.
    thinKnick: sample(zigzag({ x: 0, y: 0 }, 3, 1, 150), fixed(FLOOR_W), ZOOMED_STEP),
    thinLoop: sample(
      curve((t) => ({ x: 50 + 0.5 * Math.cos(t), y: 50 + 0.5 * Math.sin(t) }), 2 * Math.PI, ZOOMED_STEP),
      fixed(FLOOR_W),
    ),
    // Ein sehr kurzer Strich: zwei Punkte, nur 0,05 auseinander.
    short: [
      { x: 10, y: 10, w: 1.2 },
      { x: 10.05, y: 10, w: 1.2 },
    ],
    // Eine kleine Schleife, gezoomt geschrieben, deren halbe Breite (0,6) größer ist als ihr Radius (0,5): Die Innenseite rückt an
    // die Mittellinie heran.
    wideLoop: sample(
      curve((t) => ({ x: 50 + 0.5 * Math.cos(t), y: 50 + 0.5 * Math.sin(t) }), 2 * Math.PI, ZOOMED_STEP),
      fixed(1.2),
    ),
    // Gezoomt geschrieben, die Breite wächst von der dünnsten Linie auf 1,2 und fällt wieder: beide Enden verjüngt.
    tapered: Array.from({ length: 31 }, (_, i) => ({
      x: i * ZOOMED_STEP,
      y: 0,
      w: FLOOR_W + (1.2 - FLOOR_W) * Math.sin((Math.PI * i) / 30),
    })),
  };
  expect(outlinePolygons(shapes.knick)).toHaveLength(3);
  expect(outlinePolygons(shapes.thinKnick)).toHaveLength(3);
  for (const [name, pts] of Object.entries(shapes)) {
    const curves = curvesOf(pts);
    // Ohne Loch: Jeder Punkt der Mittellinie liegt in der Füllung der Kurven (Regel nonzero).
    expect(pts.filter((p) => !inside(curves, p)), name).toEqual([]);
    // Ohne Ausreißer: Die Kurve reicht nirgends weiter von der Mittellinie weg als die halbe Breite und SIMPLIFY (gemessen höchstens
    // 0,01 mehr als die halbe Breite, in der kleinen Schleife).
    const reach = Math.max(...pts.map((p) => p.w)) / 2 + SIMPLIFY;
    expect(curves.flat().filter((q) => lineDist(q, pts) > reach), name).toEqual([]);
  }
  // Auch an den Strichen, an denen schon der Umriss leicht ein Loch bekäme, hat die Kurve keins.
  for (const [name, pts] of Object.entries(hardShapes())) {
    const curves = curvesOf(pts);
    expect(pts.filter((p) => !inside(curves, p)), name).toEqual([]);
  }
});

/** So weit (Seiteneinheiten) darf die Kurve höchstens neben den gerechneten Randpunkten liegen: bei Zoom 6 etwa 0,1 Bildschirmpunkte. */
const EDGE_DEV = 0.02;

/**
 * Die gerechneten Randpunkte eines Strichs mit überall der halben Breite `r`, links (1) oder rechts (-1): je Punkt um `r` quer zur
 * Richtung, die Richtung aus den Stücken davor und danach zusammen, an den Enden die des einen Stücks. So rechnet der Umriss sie,
 * bevor er seine Seiten vereinfacht (nur in engen Kurven rücken sie dort näher an die Mittellinie).
 */
function edgePoints(pts: Pt2[], r: number, side: number): Pt2[] {
  const unit = (x: number, y: number) => ({ x: x / Math.hypot(x, y), y: y / Math.hypot(x, y) });
  return pts.map((p, i) => {
    const before = i > 0 ? unit(p.x - pts[i - 1].x, p.y - pts[i - 1].y) : { x: 0, y: 0 };
    const after = i < pts.length - 1 ? unit(pts[i + 1].x - p.x, pts[i + 1].y - p.y) : { x: 0, y: 0 };
    const d = unit(before.x + after.x, before.y + after.y);
    return { x: p.x - side * d.y * r, y: p.y + side * d.x * r };
  });
}

test('zoomed in the edge has no visible corners', () => {
  // Ein Bogen mit Radius 2 um (50, 50) über drei Viertel eines Kreises, gezoomt geschrieben (Punkte 0,1 auseinander), überall 1,2
  // breit, ungerundet. Die Randpunkte liegen auf Kreisen mit Radius 1,4 und 2,6.
  const c = { x: 50, y: 50 };
  const [R, r] = [2, 0.6];
  const n = Math.round((1.5 * Math.PI * R) / ZOOMED_STEP);
  const pts: Pt[] = Array.from({ length: n + 1 }, (_, i) => {
    const a = -0.75 * Math.PI + (1.5 * Math.PI * i) / n;
    return { x: c.x + R * Math.cos(a), y: c.y + R * Math.sin(a), w: 2 * r };
  });
  const polys = outlinePolygons(pts);
  expect(polys).toHaveLength(1);
  const poly = polys[0];
  const pieces = piecesOf(poly);
  expect(pieces).toHaveLength(poly.length);
  // Gemessen wird an den Seiten. Die runden Enden prüft `the curve covers taps, knicks and thin strokes`. Ein Stück gehört zu einer
  // Seite, wenn sein Eckpunkt und beide Nachbarn auf ihr liegen, also so weit vom Mittelpunkt wie ihre Randpunkte.
  const angle = (p: Pt2) => Math.atan2(p.y - c.y, p.x - c.x);
  let deviation = 0;
  for (const side of [1, -1]) {
    const edge = edgePoints(pts, r, side);
    const radius = Math.hypot(edge[n >> 1].x - c.x, edge[n >> 1].y - c.y);
    const onSide = (i: number) => Math.abs(Math.hypot(poly[i].x - c.x, poly[i].y - c.y) - radius) < 1e-3;
    const mine = pieces.filter((_, i) => onSide((i + poly.length - 1) % poly.length) && onSide(i) && onSide((i + 1) % poly.length));
    // Die Kurve liegt nahe an den Randpunkten ...
    const drawn = [mine[0].from, ...traced(mine)];
    for (const q of drawn) deviation = Math.max(deviation, lineDist(q, edge));
    // ... und die Randpunkte nahe an der Kurve, soweit sie neben diesen Stücken liegen. Das ist fast der ganze Bogen.
    const [lo, hi] = [Math.min(...drawn.map(angle)), Math.max(...drawn.map(angle))];
    expect(hi - lo, `Seite ${side}`).toBeGreaterThan(1.2 * Math.PI);
    for (const p of edge.filter((e) => angle(e) >= lo && angle(e) <= hi)) deviation = Math.max(deviation, lineDist(p, drawn));
  }
  // Gemessen 0,016. Mit SIMPLIFY 0,02 wären es hier 0,0204, an anderen Bögen bis 0,022.
  expect(deviation).toBeLessThanOrEqual(EDGE_DEV);
  // Die Richtung der Kurve springt nirgends: Wo ein Stück ins nächste übergeht (auch das letzte ins erste), läuft die Kurve hinein
  // wie hinaus in dieselbe Richtung.
  let jump = 0;
  pieces.forEach((p, i) => {
    const next = pieces[(i + 1) % pieces.length];
    expect(next.from).toEqual(p.to);
    const [ix, iy, ox, oy] = [p.to.x - p.ctrl.x, p.to.y - p.ctrl.y, next.ctrl.x - next.from.x, next.ctrl.y - next.from.y];
    jump = Math.max(jump, Math.abs(Math.atan2(ix * oy - iy * ox, ix * ox + iy * oy)));
  });
  expect(jump).toBeLessThan(1e-9);
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

test('the outline path of a stroke for the file is written once and follows its points', () => {
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
  const d = outlineDOf(s);
  expect(d).toBe(outlineD(s.pts));
  // Gemerkt: Ein fertiger Strich ändert sich nie. Bekäme er doch andere Punkte (das tut die App nie), käme sein erster Pfad zurück.
  s.pts = s.pts.map((p) => ({ ...p, y: p.y + 5 }));
  expect(outlineDOf(s)).toBe(d);
  // Ein anderer Strich, zum Beispiel ein Stück beim Teil-Radieren, ist ein neues Objekt und bekommt seinen eigenen Pfad.
  const other: Stroke = { ...s, id: 'f4' };
  expect(outlineDOf(other)).toBe(outlineD(other.pts));
  expect(outlineDOf(other)).not.toBe(d);
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
