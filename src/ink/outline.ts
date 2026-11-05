import type { Pt2 } from './gestures';
import { fmtCoord } from './stroke';
import type { Pt, Stroke } from './types';

// Der Umriss eines Strichs mit Breite je Punkt (Füllfeder und Bleistift): Vielecke, deren Vereinigung den Strich
// samt runden Enden bedeckt. Reine Rechnung in Seiteneinheiten, ohne Bildschirm und ohne Datei. Gezeichnet wird jedes
// Vieleck als runde Kurve (`traceCurve`), gleich in der Datei (`outlineD`) und auf der Fläche, die `outlineOf` mit
// einem `fill` (Regel nonzero) füllt: Darum laufen alle Vielecke gleich herum, dann füllt sich ihre Vereinigung ohne
// Löcher.

/** Ein Knick, der stärker als 60 Grad ist (Kosinus kleiner als dieser Wert), teilt den Umriss. */
export const CORNER_COS = 0.5;
/** Die runden Enden haben alle 30 Grad eine Ecke, ein einzelner Punkt wird ein Zwölfeck. */
export const ARC_STEP = Math.PI / 6;
/**
 * So weit (Seiteneinheiten) darf eine vereinfachte Seite des Umrisses höchstens von den gerechneten Randpunkten abweichen. Die Kurve
 * durch ihre Ecken (`traceCurve`) liegt dann an den Seiten höchstens etwa 0,02 neben den Randpunkten, bei Zoom 6 etwa 0,1
 * Bildschirmpunkte: Auch gezoomt sieht man keine Ecken. Kleiner behielte der Umriss das Rauschen der auf 0,01 gerundeten Punkte der
 * Datei, und sie würde größer.
 */
export const SIMPLIFY = 0.019;

/** Punkte, die näher als das am vorigen liegen, fallen weg: Sie hätten keine Richtung. */
const SAME_POINT = 1e-6;
/** Schritte von `ARC_STEP` in einem Halbkreis. */
const HALF_TURN = Math.round(Math.PI / ARC_STEP);
/**
 * Muss ein Randpunkt an die Mittellinie heranrücken, steht er danach bei diesem Teil des größten Abstands, mit dem die
 * Seite noch vorwärts liefe. Der Rest ist Spielraum, damit kein Viereck zwischen zwei Punkten flach wird.
 */
const FORWARD = 0.9;

/** Ein Punkt der Mittellinie mit dem halben Strich als Radius. */
type Node = { x: number; y: number; r: number };

/** Ecken auf dem Kreis um `c` mit Radius `r`, Schritt `first` bis `last`, je `ARC_STEP` weiter mit abnehmendem Winkel ab `from`. */
function arc(c: Pt2, r: number, from: number, first: number, last: number): Pt2[] {
  const out: Pt2[] = [];
  for (let k = first; k <= last; k++) {
    const a = from - k * ARC_STEP;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

/** Die Punkte ohne doppelte (die größere Breite bleibt), jeder mit Radius, mindestens `minW / 2`. */
function nodesOf(pts: readonly Pt[], minW: number): Node[] {
  const nodes: Node[] = [];
  for (const p of pts) {
    const r = Math.max(p.w, minW) / 2;
    const last = nodes[nodes.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < SAME_POINT) {
      last.r = Math.max(last.r, r);
      continue;
    }
    nodes.push({ x: p.x, y: p.y, r });
  }
  return nodes;
}

/** Einheitsrichtung von `a` nach `b`. */
function unit(a: Pt2, b: Pt2): Pt2 {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
}

/** Quadrat des Abstands von `p` zur Strecke von `a` nach `b` (bei gleichen Enden zum Punkt). */
function segDist2(p: Pt2, a: Pt2, b: Pt2): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.y - a.y) * vy) / l2)) : 0;
  const dx = a.x + t * vx - p.x;
  const dy = a.y + t * vy - p.y;
  return dx * dx + dy * dy;
}

/**
 * Ramer-Douglas-Peucker: lässt Punkte weg, die höchstens `tolerance` neben dem vereinfachten Linienzug lägen. Erster
 * und letzter bleiben.
 */
function simplify(line: Pt2[], tolerance: number): Pt2[] {
  const n = line.length;
  if (n < 3) return line;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  // Ein Stapel statt Rekursion: Auch ein Strich mit sehr vielen Punkten kommt nicht an die Grenze der Aufruftiefe.
  const todo: [number, number][] = [[0, n - 1]];
  while (todo.length) {
    const [a, b] = todo.pop()!;
    let far = tolerance * tolerance;
    let at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = segDist2(line[i], line[a], line[b]);
      if (d > far) {
        far = d;
        at = i;
      }
    }
    if (at < 0) continue;
    keep[at] = 1;
    todo.push([a, at], [at, b]);
  }
  return line.filter((_, i) => keep[i]);
}

/** Eine Seite des Umrisses: Randpunkte und wie weit jeder von der Mittellinie absteht. */
type Side = { pts: Pt2[]; dist: number[] };

/**
 * Die Seite `s` (1 links, -1 rechts) eines Laufs: Randpunkt `p + s * N * r` mit `N = (-d.y, d.x)`. Kein
 * Rückwärtslaufen: Von Punkt zu Punkt muss die Seite vorwärts laufen, gemessen an der Richtung am einen wie am anderen
 * Punkt. Wo sie das mit dem vollen Radius nicht täte (Innenseite einer engen Kurve, Sprung in der Breite), rückt der
 * Randpunkt näher an die Mittellinie. Jede der beiden Bedingungen begrenzt nur den Abstand eines der beiden Punkte,
 * darum reicht ein Durchgang.
 */
function sideOf(run: Node[], dirs: Pt2[], s: number): Side {
  const n = run.length;
  const pts: Pt2[] = [];
  const dist: number[] = [];
  run.forEach((p, i) => {
    const nx = -s * dirs[i].y;
    const ny = s * dirs[i].x;
    let r = p.r;
    if (i > 0) {
      // Vor der Normalen des vorigen Punkts bleiben.
      const q = run[i - 1];
      const k = nx * dirs[i - 1].x + ny * dirs[i - 1].y;
      if (k < 0) r = Math.min(r, (FORWARD * ((p.x - q.x) * dirs[i - 1].x + (p.y - q.y) * dirs[i - 1].y)) / -k);
    }
    if (i < n - 1) {
      // Hinter der Normalen des nächsten Punkts bleiben.
      const q = run[i + 1];
      const k = nx * dirs[i + 1].x + ny * dirs[i + 1].y;
      if (k > 0) r = Math.min(r, (FORWARD * ((q.x - p.x) * dirs[i + 1].x + (q.y - p.y) * dirs[i + 1].y)) / k);
    }
    pts.push({ x: p.x + nx * r, y: p.y + ny * r });
    dist.push(r);
  });
  return { pts, dist };
}

/** Die Seite vereinfacht, höchstens um `SIMPLIFY` und um die Hälfte ihres kleinsten Abstands: Sie rutscht nie über die Mittellinie. */
function simplified(side: Side): Pt2[] {
  let near = Infinity;
  for (const d of side.dist) near = Math.min(near, d);
  return simplify(side.pts, Math.min(SIMPLIFY, near / 2));
}

/**
 * Das Vieleck eines Laufs (mindestens zwei Punkte ohne Knick): linke Seite vorwärts, Halbkreis vorne um den letzten
 * Punkt, rechte Seite rückwärts, Halbkreis hinten um den ersten Punkt. Richtung je Punkt aus der Summe der Richtungen
 * davor und danach, an den Enden die des einen Stücks. Die Halbkreise laufen mit abnehmendem Winkel von der Normalen
 * über die Richtung zur Gegennormalen (am Ende) und von der Gegennormalen über die Gegenrichtung zur Normalen (am
 * Anfang), derselbe Umlaufsinn wie die Seiten. Ist ein Endpunkt einer Seite herangerückt, beginnt der Halbkreis
 * trotzdem mit vollem Radius: Das Vieleck läuft dann entlang der Normalen hinaus.
 */
function band(run: Node[]): Pt2[] {
  const n = run.length;
  const seg: Pt2[] = [];
  for (let i = 0; i < n - 1; i++) seg.push(unit(run[i], run[i + 1]));
  // Ohne Knick (höchstens 60 Grad) ist die Summe zweier Richtungen nie kürzer als Wurzel 3, das Teilen ist also sicher.
  const dirs = run.map((_, i) => {
    if (i === 0) return seg[0];
    if (i === n - 1) return seg[n - 2];
    const x = seg[i - 1].x + seg[i].x;
    const y = seg[i - 1].y + seg[i].y;
    const len = Math.hypot(x, y);
    return { x: x / len, y: y / len };
  });
  const left = sideOf(run, dirs, 1);
  const right = sideOf(run, dirs, -1);
  const start = run[0];
  const end = run[n - 1];
  const endAngle = Math.atan2(dirs[n - 1].x, -dirs[n - 1].y); // Winkel der Normalen am Ende
  const startAngle = Math.atan2(-dirs[0].x, dirs[0].y); // Winkel der Gegennormalen am Anfang
  const inner = (side: Side, i: number) => side.dist[i] < run[i].r;
  return [
    ...simplified(left),
    ...arc(end, end.r, endAngle, inner(left, n - 1) ? 0 : 1, inner(right, n - 1) ? HALF_TURN : HALF_TURN - 1),
    ...simplified(right).reverse(),
    ...arc(start, start.r, startAngle, inner(right, 0) ? 0 : 1, inner(left, 0) ? HALF_TURN : HALF_TURN - 1),
  ];
}

/**
 * Der Umriss als Vielecke, alle mit demselben Umlaufsinn (Fläche nach der Gaußschen Trapezformel negativ), runde
 * Enden. Ein einzelner Punkt wird ein Kreis mit 12 Ecken, ein Knick über 60 Grad teilt den Strich in Läufe mit je
 * einem Vieleck, die sich den Knickpunkt teilen. Jedes Vieleck setzt sich aus Vierecken zusammen, die sich nicht
 * überschlagen, und deckt so seine Mittellinie ohne Loch. `minW` ist die kleinste Breite, die ein Punkt bekommt.
 */
export function outlinePolygons(pts: readonly Pt[], minW?: number): Pt2[][] {
  const nodes = nodesOf(pts, minW ?? 0);
  const n = nodes.length;
  if (n === 0) return [];
  if (n === 1) return [arc(nodes[0], nodes[0].r, 0, 0, 2 * HALF_TURN - 1)];
  const polys: Pt2[][] = [];
  let from = 0;
  let before = unit(nodes[0], nodes[1]);
  for (let i = 1; i < n - 1; i++) {
    const after = unit(nodes[i], nodes[i + 1]);
    if (before.x * after.x + before.y * after.y < CORNER_COS) {
      polys.push(band(nodes.slice(from, i + 1)));
      from = i;
    }
    before = after;
  }
  polys.push(band(nodes.slice(from)));
  return polys;
}

/** Was `traceCurve` zum Zeichnen braucht: Ein Canvas-Kontext kann es, für die Datei schreibt `outlineD` dieselben Schritte als Text. */
export type CurveContext = {
  moveTo(x: number, y: number): void;
  quadraticCurveTo(cpx: number, cpy: number, x: number, y: number): void;
  closePath(): void;
};

/**
 * Hängt ein Vieleck des Umrisses als geschlossene Kurve an `ctx`: quadratische Bézier-Stücke mit den Ecken als Kontrollpunkten und
 * den Mitten der Seiten als Kurvenpunkten. Sie beginnt in der Mitte der Seite vom letzten zum ersten Eckpunkt, dann folgt je Eckpunkt
 * ein Stück bis zur Mitte der nächsten Seite. An jeder Mitte laufen beide Stücke entlang derselben Seite, die Richtung springt also
 * nirgends, und der Rand wirkt auch gezoomt rund. Die Kurve bleibt in der Nähe ihrer Ecken (jedes Stück im Dreieck aus Eckpunkt und
 * den beiden Mitten). Ein Vieleck mit weniger als drei Ecken (`outlinePolygons` baut keins) wird ebenso gezeichnet und hat keine
 * Fläche, ein leeres gar nicht.
 */
export function traceCurve(ctx: CurveContext, poly: readonly Pt2[]): void {
  const n = poly.length;
  if (!n) return;
  const last = poly[n - 1];
  ctx.moveTo((last.x + poly[0].x) / 2, (last.y + poly[0].y) / 2);
  for (let i = 0; i < n; i++) {
    const v = poly[i];
    const next = poly[i + 1 < n ? i + 1 : 0];
    ctx.quadraticCurveTo(v.x, v.y, (v.x + next.x) / 2, (v.y + next.y) / 2);
  }
  ctx.closePath();
}

/**
 * Der Umriss als Pfad für die Datei, dieselbe Kurve wie auf der Fläche (`traceCurve`): je Vieleck `M x y Q x y x y … Z`, nur absolute
 * Zahlen mit höchstens zwei Nachkommastellen (`fmtCoord`). Ohne Punkte leer.
 */
export function outlineD(pts: readonly Pt[]): string {
  const parts: string[] = [];
  const writer: CurveContext = {
    moveTo: (x, y) => {
      parts.push(`M ${fmtCoord(x)} ${fmtCoord(y)}`);
    },
    quadraticCurveTo: (cpx, cpy, x, y) => {
      parts.push(`Q ${fmtCoord(cpx)} ${fmtCoord(cpy)} ${fmtCoord(x)} ${fmtCoord(y)}`);
    },
    closePath: () => {
      parts.push('Z');
    },
  };
  for (const poly of outlinePolygons(pts)) traceCurve(writer, poly);
  return parts.join(' ');
}

// Ein fertiger Strich ändert sich nie, sein Umriss und seine kleinste Breite werden darum nur einmal berechnet. Ist er
// irgendwo dünner als eine verlangte Mindestbreite, wird dazu der Umriss für die zuletzt verlangte gemerkt.
const known = new WeakMap<Stroke, Pt2[][]>();
const thinnest = new WeakMap<Stroke, number>();
const widened = new WeakMap<Stroke, { minW: number; polys: Pt2[][] }>();

/** Die kleinste Breite eines Punkts, je Strich nur einmal berechnet. */
function thinnestOf(s: Stroke): number {
  let w = thinnest.get(s);
  if (w === undefined) {
    w = Infinity;
    for (const p of s.pts) if (p.w < w) w = p.w;
    thinnest.set(s, w);
  }
  return w;
}

/**
 * Der Umriss eines fertigen Strichs, je Strich nur einmal berechnet. Mit `minW` (auf dem Bildschirm ein Bildpunkt) ist
 * kein Punkt dünner als `minW`. Ist der Strich überall mindestens so breit, ist das derselbe Umriss wie ohne. Sonst wird
 * der Umriss mit `minW` gemerkt und erst wieder berechnet, wenn eine andere Mindestbreite kommt (nach dem Zoomen).
 */
export function outlineOf(s: Stroke, minW = 0): Pt2[][] {
  if (minW > thinnestOf(s)) {
    const last = widened.get(s);
    if (last?.minW === minW) return last.polys;
    const polys = outlinePolygons(s.pts, minW);
    widened.set(s, { minW, polys });
    return polys;
  }
  let polys = known.get(s);
  if (!polys) {
    polys = outlinePolygons(s.pts);
    known.set(s, polys);
  }
  return polys;
}
