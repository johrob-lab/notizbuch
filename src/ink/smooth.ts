import type { Pt2 } from './gestures';

/**
 * Gauß-Glättung nach der Strecke für den Punkt `i` eines Linienzugs `pts`. `arc` hält je Punkt die Strecke ab dem Anfang, so viele
 * Werte wie Punkte. Das Ergebnis ist das Mittel der Punkte, deren Strecke höchstens `r` von der des Punkts abliegt, gewichtet mit
 * exp(−d² / 2σ²), `d` der Unterschied der Strecke. `r` ist `reach` (Seiteneinheiten) und wird zu den Enden hin kleiner, zu beiden
 * Seiten gleich weit: Anfang und Ende bleiben genau dort, wo sie sind. Ein Nachbar zählt auch dann mit, wenn er bis zu `margin` weiter
 * weg liegt. So glätten die Füllfeder beim Schreiben (`smoothArc`) und die Reparatur alter Striche (`repairOldLine`).
 */
export function arcGaussAt(pts: readonly Pt2[], arc: readonly number[], i: number, sigma: number, reach: number, margin = 0): Pt2 {
  const n = arc.length;
  const s = arc[i];
  const r = Math.min(reach, s, arc[n - 1] - s) + margin;
  const k = 1 / (2 * sigma * sigma);
  let lo = i;
  while (lo > 0 && s - arc[lo - 1] <= r) lo--;
  let hi = i;
  while (hi < n - 1 && arc[hi + 1] - s <= r) hi++;
  let sx = 0;
  let sy = 0;
  let sw = 0;
  for (let j = lo; j <= hi; j++) {
    const d = arc[j] - s;
    const w = Math.exp(-d * d * k);
    sx += w * pts[j].x;
    sy += w * pts[j].y;
    sw += w;
  }
  return { x: sx / sw, y: sy / sw };
}
