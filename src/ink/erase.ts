import type { Pt2 } from './gestures';
import { boundsOf, lineWidth } from './bounds';
import type { Removed } from './history';
import { hitStroke } from './stroke';
import type { EraserSize } from '../lib/settings';
import type { Pt, Stroke } from './types';

// Der Radierer nimmt ganze Striche weg. Hier steht die Rechnung dazu: wo geprüft wird, welche Striche getroffen werden
// und wie sie aus der Liste kommen. Orte sind Seiteneinheiten (Bildschirmpunkte nur dort, wo es dabeisteht).

/** Abstand der Prüfpunkte entlang des Radierwegs in Bildschirmpunkten: Auch ein schneller Stift lässt keine Lücke, durch die ein Strich rutscht. */
export const ERASER_STEP_PX = 5;

/**
 * Die Prüfpunkte entlang einer Strecke, höchstens `step` voneinander entfernt, gleichmäßig verteilt. Der erste liegt einen
 * Schritt hinter `from` (`from` selbst ist schon geprüft), der letzte ist `to`. Auch eine Strecke ohne Länge hat einen.
 */
export function pointsAlong(from: Pt2, to: Pt2, step = ERASER_STEP_PX): Pt2[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / step));
  const points: Pt2[] = [];
  for (let i = 1; i <= steps; i++) points.push({ x: from.x + ((to.x - from.x) * i) / steps, y: from.y + ((to.y - from.y) * i) / steps });
  return points;
}

/**
 * Die Stellen der Striche, die ein Radierer mit Radius `radius` an `at` trifft, die höchste zuerst (so lassen sie sich
 * nacheinander herausnehmen). `minW` ist die Breite eines Bildpunkts: Gezeichnet wird ein Strich nie dünner, also zählt
 * er beim Treffen auch so breit.
 */
export function hitIndexes(strokes: readonly Stroke[], at: Pt2, radius: number, minW: number): number[] {
  const hits: number[] = [];
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    const { box, maxW } = boundsOf(s);
    const w = lineWidth(s, minW);
    const m = radius + Math.max(maxW, w);
    if (at.x < box[0] - m || at.x > box[2] + m || at.y < box[1] - m || at.y > box[3] + m) continue;
    // `hitStroke` rechnet mit der Breite des Strichs, gezeichnet wird er aber mindestens einen Bildpunkt breit.
    if (hitStroke(s, at.x, at.y, radius + Math.max(0, w - s.w) / 2)) hits.push(i);
  }
  return hits;
}

/** Nimmt die Striche an diesen Stellen (höchste zuerst) aus der Liste und merkt sich, wo sie standen. */
export function takeOut(strokes: Stroke[], indexes: readonly number[]): Removed[] {
  return indexes.map((index) => ({ stroke: strokes.splice(index, 1)[0], index }));
}

/** Nimmt die Striche mit diesen ids aus der Liste, die höchsten zuerst, und merkt sich, wo sie standen. Unbekannte ids zählen nicht. */
export function takeOutIds(strokes: Stroke[], ids: ReadonlySet<string>): Removed[] {
  const indexes: number[] = [];
  for (let i = strokes.length - 1; i >= 0; i--) if (ids.has(strokes[i].id)) indexes.push(i);
  return takeOut(strokes, indexes);
}

// ---------- Teil-Radieren ----------

/** Radius des Radierers in Bildschirmpunkten je Größe. Er bleibt beim Zoomen auf dem Bildschirm gleich groß. */
export const ERASER_PX: Record<EraserSize, number> = { klein: 5, mittel: 10, gross: 22 };

/** Fügt Punkte ein, bis keine zwei Nachbarn weiter als `step` auseinander liegen. Die Breite `w` läuft linear mit. */
export function densify(pts: readonly Pt[], step: number): Pt[] {
  if (pts.length < 2 || !(step > 0)) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const k = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step);
    for (let j = 1; j < k; j++) out.push({ x: a.x + ((b.x - a.x) * j) / k, y: a.y + ((b.y - a.y) * j) / k, w: a.w + ((b.w - a.w) * j) / k });
    out.push(b);
  }
  return out;
}

/**
 * Radiert aus einem Strich, was der Kreis um `at` mit Radius `r` (Seiteneinheiten) berührt. `null`: nichts berührt, der
 * Strich bleibt, wie er ist. Sonst die Reststücke in ihrer Reihenfolge, jedes mit neuer `id` und sonst wie das Original
 * (auch dieselbe Breite `w`). Stücke mit weniger als zwei Punkten fallen weg, ein Strich aus einem Punkt verschwindet ganz.
 * Die Punkte werden vorher verdichtet (höchstens r / 2 auseinander), damit der Schnitt nah am Kreis liegt.
 */
export function cutStroke(s: Stroke, at: Pt2, r: number, newId: () => string): Stroke[] | null {
  if (!hitStroke(s, at.x, at.y, r)) return null;
  if (s.pts.length < 2) return [];
  const reach = r + s.w / 2;
  const pieces: Pt[][] = [];
  let run: Pt[] = [];
  for (const p of densify(s.pts, Math.max(r / 2, 0.1))) {
    if ((p.x - at.x) ** 2 + (p.y - at.y) ** 2 <= reach * reach) {
      if (run.length) pieces.push(run);
      run = [];
    } else run.push(p);
  }
  if (run.length) pieces.push(run);
  return pieces.filter((pts) => pts.length >= 2).map((pts) => ({ ...s, id: newId(), pts }));
}
