// Wo die Knöpfe des Rings sitzen: zwei Kreise um die Mitte, gegen den Uhrzeigersinn. Der innere beginnt genau über der Mitte. Den
// äußeren dreht `bottom` so, dass dieser Knopf genau unter der Mitte liegt: Mit „Heute“ dort liest man unten ‹ Heute › von links nach
// rechts (bei den Knöpfen aus `toolActions` in ihrer Reihenfolge), im Ring mit Schreiben (9 Knöpfe) wie ohne (5 Knöpfe).

export const RING = { inner: 62, outer: 118, item: 44, margin: 8 };

export type Pt = { x: number; y: number };

/** Der erste Knopf genau über der Mitte. Winkel in Grad wie auf dem Bildschirm (y nach unten): 0 rechts, -90 oben, 90 unten. */
const ABOVE = { index: 0, angle: -90 };

// Die Mitte so weit auf die Fläche geschoben, dass der äußerste Knopf samt Rand noch ganz drauf ist. Ist die Fläche
// dafür zu klein, bleibt nur ihre Mitte.
function clampAxis(v: number, size: number, reach: number): number {
  if (size < 2 * reach) return size / 2;
  return Math.min(Math.max(v, reach), size - reach);
}

/** `n` Orte auf einem Kreis, gegen den Uhrzeigersinn in gleichen Abständen. Der Ort `fix.index` liegt beim Winkel `fix.angle`. */
function circle(center: Pt, radius: number, n: number, fix: { index: number; angle: number }): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (fix.angle - ((i - fix.index) * 360) / n) * (Math.PI / 180);
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

/**
 * Die Orte der Knöpfe um `at`, die Mitte so weit verschoben, dass der Ring ganz auf der Fläche liegt. `bottom` ist der Knopf des äußeren
 * Kreises, der genau unter der Mitte liegt; ohne Angabe liegt dessen erster genau darüber.
 */
export function ringLayout(
  at: Pt,
  count: { inner: number; outer: number },
  area: { w: number; h: number },
  bottom?: number,
): { center: Pt; inner: Pt[]; outer: Pt[] } {
  const reach = (count.outer > 0 ? RING.outer : RING.inner) + RING.item / 2 + RING.margin;
  const center = { x: clampAxis(at.x, area.w, reach), y: clampAxis(at.y, area.h, reach) };
  const outer = bottom === undefined ? ABOVE : { index: bottom, angle: 90 };
  return { center, inner: circle(center, RING.inner, count.inner, ABOVE), outer: circle(center, RING.outer, count.outer, outer) };
}
