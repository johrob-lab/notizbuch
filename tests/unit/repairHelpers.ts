import type { Pt } from '../../src/ink/types';

// Gemeinsame Testdaten für die Reparatur alter Striche: repair.test.ts prüft die Rechnung, svg.test.ts das Lesen und Speichern einer
// Seite. Alles hier ist erfunden.

/** Ein kurzer senkrechter Strich der Füllfeder, gezoomt geschrieben und alt gespeichert. Repariert läge er wieder ganz auf dem Raster. */
export const UPRIGHT: Pt[] = [
  { x: 243.9, y: 1099.7, w: 0.19 },
  { x: 243.9, y: 1099.9, w: 0.88 },
  { x: 243.9, y: 1100, w: 1.15 },
  { x: 243.9, y: 1100.3, w: 1.14 },
  { x: 243.9, y: 1100.5, w: 0.81 },
  { x: 243.9, y: 1100.7, w: 0.18 },
];

/** Der Median der Abstände aufeinanderfolgender Punkte (mindestens zwei Punkte), gerechnet wie in der Reparatur (`repair.ts`). */
export function medianStep(pts: readonly Pt[]): number {
  const steps = pts
    .slice(1)
    .map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
    .sort((a, b) => a - b);
  const m = steps.length >> 1;
  return steps.length % 2 ? steps[m] : (steps[m - 1] + steps[m]) / 2;
}
