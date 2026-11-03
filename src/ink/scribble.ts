import { boundsOf } from './bounds';
import { densify } from './erase';
import { hitStroke } from './stroke';
import { MM, type Stroke } from './types';

// Kritzeln zum Löschen: Wer mit dem Stift schnell hin und her über Geschriebenes fährt, löscht es. Hier steht nur die
// Rechnung: ob ein Strich ein Gekritzel ist, und welche Striche es löscht. Orte in Seiteneinheiten.

/** So klein darf ein Gekritzel höchstens sein (Diagonale seines Rahmens): 4 mm. */
const MIN_DIAG = 4 * MM;
/** Der Weg ist mindestens so oft so lang wie die Diagonale. */
const MIN_PATH_FACTOR = 3.5;
/** So viele Richtungswechsel entlang der Hauptachse braucht ein Gekritzel. */
const MIN_REVERSALS = 5;
/** Ein Wechsel zählt erst, wenn der Stift seit dem letzten mindestens diesen Anteil der Ausdehnung zurückgelegt hat. */
const MIN_RUN = 0.4;
const MAX_DURATION_MS = 2500;
/** So viel vom Rahmen eines Strichs muss im Rahmen des Gekritzels liegen, damit er in Frage kommt. */
const MIN_COVER = 0.6;
/** Quer zur Hauptachse ist ein Gekritzel mindestens 2 mm hoch: Eine Linie nachziehen ist keines. */
const MIN_ACROSS = 2 * MM;
/** So viel vom Strich selbst muss unter dem Gekritzel liegen (nicht nur sein Rahmen), damit er gelöscht wird. */
const MIN_UNDER = 0.8;
/** Breite der Spalten, in denen gemessen wird, wie weit das Gekritzel quer reicht. */
const COLUMN = 4;

type P = { x: number; y: number };

function box(pts: readonly P[]): [number, number, number, number] {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return [x0, y0, x1, y1];
}

/**
 * Ist der Weg ein Gekritzel? Mindestens 4 mm groß, der Weg mindestens 3,5-mal so lang wie die Diagonale, mindestens fünf
 * Richtungswechsel entlang der längeren Seite (jeder nach mindestens 40 % ihrer Länge) und höchstens 2,5 Sekunden lang.
 * Schreibschrift wie „mmm“ oder „www“ läuft entlang der längeren Seite in eine Richtung und ist darum keines.
 */
export function isScribble(pts: readonly P[], durationMs: number): boolean {
  if (pts.length < MIN_REVERSALS + 1 || durationMs > MAX_DURATION_MS) return false;
  const [x0, y0, x1, y1] = box(pts);
  const w = x1 - x0;
  const h = y1 - y0;
  const diag = Math.hypot(w, h);
  if (diag < MIN_DIAG || Math.min(w, h) < MIN_ACROSS) return false;
  let length = 0;
  for (let i = 1; i < pts.length; i++) length += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  if (length < MIN_PATH_FACTOR * diag) return false;
  const alongX = w >= h;
  const extent = alongX ? w : h;
  let dir = 0;
  let run = 0;
  let reversals = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = alongX ? pts[i].x - pts[i - 1].x : pts[i].y - pts[i - 1].y;
    if (d === 0) continue;
    const sign = Math.sign(d);
    if (dir === 0 || sign === dir) {
      dir = sign;
      run += Math.abs(d);
    } else {
      if (run >= MIN_RUN * extent) reversals++;
      dir = sign;
      run = Math.abs(d);
    }
  }
  return reversals >= MIN_REVERSALS;
}

/** Anteil eines Rahmens, der im anderen liegt: Fläche, bei einem Rahmen ohne Höhe oder Breite die Länge, bei einem Punkt 0 oder 1. */
function covered(inner: [number, number, number, number], outer: [number, number, number, number]): number {
  const ox = Math.max(0, Math.min(inner[2], outer[2]) - Math.max(inner[0], outer[0]));
  const oy = Math.max(0, Math.min(inner[3], outer[3]) - Math.max(inner[1], outer[1]));
  const iw = inner[2] - inner[0];
  const ih = inner[3] - inner[1];
  const inX = inner[0] >= outer[0] && inner[2] <= outer[2];
  const inY = inner[1] >= outer[1] && inner[3] <= outer[3];
  if (iw > 0 && ih > 0) return (ox * oy) / (iw * ih);
  if (iw > 0) return inY ? ox / iw : 0;
  if (ih > 0) return inX ? oy / ih : 0;
  return inX && inY ? 1 : 0;
}

/**
 * Wie weit das Gekritzel quer zur Hauptachse reicht, Spalte für Spalte (4 Einheiten breit): je Spalte kleinster und größter
 * Wert quer. So entsteht die Fläche, die das Gekritzel wirklich bedeckt, und nicht nur sein Rahmen.
 */
function band(path: readonly P[], alongX: boolean): Map<number, [number, number]> {
  const cols = new Map<number, [number, number]>();
  for (const p of path) {
    const key = Math.floor((alongX ? p.x : p.y) / COLUMN);
    const across = alongX ? p.y : p.x;
    const c = cols.get(key);
    if (c) {
      c[0] = Math.min(c[0], across);
      c[1] = Math.max(c[1], across);
    } else cols.set(key, [across, across]);
  }
  return cols;
}

/**
 * Die Striche, die ein Gekritzel löscht: Ihr Rahmen liegt zu mindestens 60 % im Rahmen des Gekritzels, mindestens 80 % ihrer
 * Länge liegen unter der Fläche, die das Gekritzel bedeckt, und das Gekritzel berührt sie. Ein Wort daneben bleibt, ebenso
 * ein Kreis oder Kästchen, das man ausschraffiert: Dessen Rand liegt außen um die Schraffur herum, nicht unter ihr.
 */
export function scribbleTargets(scribble: Stroke, strokes: readonly Stroke[]): string[] {
  const area = box(scribble.pts);
  const alongX = area[2] - area[0] >= area[3] - area[1];
  const path = densify(scribble.pts, 2);
  const cols = band(path, alongX);
  const r = scribble.w / 2;
  const hits: string[] = [];
  for (const s of strokes) {
    if (s.id === scribble.id) continue;
    const b = boundsOf(s).box;
    if (covered([b[0], b[1], b[2], b[3]], area) < MIN_COVER) continue;
    const m = r + s.w / 2;
    const pts = densify(s.pts, 2);
    const under = pts.filter((p) => {
      const c = cols.get(Math.floor((alongX ? p.x : p.y) / COLUMN));
      const across = alongX ? p.y : p.x;
      return c !== undefined && across >= c[0] - m && across <= c[1] + m;
    }).length;
    if (under < MIN_UNDER * pts.length) continue;
    if (path.some((p) => hitStroke(s, p.x, p.y, r))) hits.push(s.id);
  }
  return hits;
}
