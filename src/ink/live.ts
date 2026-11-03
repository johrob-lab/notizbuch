// Ein Strich, der gerade entsteht, wird Stück für Stück gezeichnet: Was fest ist, kommt einmal auf die Live-Ebene und
// bleibt dort, nur das Endstück wird bei jeder Stiftbewegung neu gezeichnet. So kostet eine Bewegung immer gleich viel,
// egal wie lang der Strich schon ist.
//
// Der Pfad besteht aus Quadratsegmenten wie in `pathD`: Segment i hat den Kontrollpunkt i und läuft von der Mitte von
// i-1 und i (beim ersten Segment von Punkt 0) zur Mitte von i und i+1. Es braucht also die Punkte i-1, i und i+1.

/** Ein Bereich von Segmenten, `to` gehört nicht dazu. */
export type SegRange = { from: number; to: number };

/** Erstes Segment, das bei `settled` festen Punkten noch nicht fest ist (es gibt die Segmente 1 bis n-2). */
function firstOpen(n: number, settled: number): number {
  return Math.max(1, Math.min(settled - 1, n - 1));
}

/**
 * Die Segmente, die jetzt fest sind und noch nicht gezeichnet wurden. `drawnSegs` ist das erste Segment, das noch nicht
 * auf der Live-Ebene steht (am Anfang 1).
 */
export function fixedSegments(n: number, settled: number, drawnSegs: number): SegRange {
  return { from: drawnSegs, to: Math.max(drawnSegs, firstOpen(n, settled)) };
}

/** Erster Punkt des Endstücks, das bei jeder Bewegung neu gezeichnet wird. */
export function tailStart(n: number, settled: number): number {
  return Math.max(0, firstOpen(n, settled) - 1);
}
