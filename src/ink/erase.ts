import type { Pt2 } from './gestures';
import { boundsOf, lineWidth } from './bounds';
import type { Removed } from './history';
import { hitStroke } from './stroke';
import type { Stroke } from './types';

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
