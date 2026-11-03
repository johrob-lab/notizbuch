// Wo die Knöpfe des Rings sitzen: zwei Kreise um die Mitte, der erste Knopf jedes Kreises genau darüber, dann im Uhrzeigersinn.

export const RING = { inner: 62, outer: 118, item: 44, margin: 8 };

export type Pt = { x: number; y: number };

// Die Mitte so weit auf die Fläche geschoben, dass der äußerste Knopf samt Rand noch ganz drauf ist. Ist die Fläche
// dafür zu klein, bleibt nur ihre Mitte.
function clampAxis(v: number, size: number, reach: number): number {
  if (size < 2 * reach) return size / 2;
  return Math.min(Math.max(v, reach), size - reach);
}

function circle(center: Pt, radius: number, n: number): Pt[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = (-90 + (i * 360) / n) * (Math.PI / 180);
    return { x: center.x + radius * Math.cos(angle), y: center.y + radius * Math.sin(angle) };
  });
}

export function ringLayout(at: Pt, count: { inner: number; outer: number }, area: { w: number; h: number }): { center: Pt; inner: Pt[]; outer: Pt[] } {
  const reach = (count.outer > 0 ? RING.outer : RING.inner) + RING.item / 2 + RING.margin;
  const center = { x: clampAxis(at.x, area.w, reach), y: clampAxis(at.y, area.h, reach) };
  return { center, inner: circle(center, RING.inner, count.inner), outer: circle(center, RING.outer, count.outer) };
}
