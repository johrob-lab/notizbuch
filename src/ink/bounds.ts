import type { Pt2 } from './gestures';
import { MM, type Stroke } from './types';

// Rahmen und Linienbreite eines Strichs. Gebraucht beim Zeichnen (was liegt im Bild?) und beim Radieren (was liegt in
// der Nähe?).

/** Rahmen als [links, oben, rechts, unten]. */
export type Box = [number, number, number, number];
/** Der Rahmen um alle Punkte eines Strichs und die größte Breite eines Punkts. */
export type Bounds = { box: Box; maxW: number };

export const emptyBox = (): Box => [Infinity, Infinity, -Infinity, -Infinity];

/** Weitet den Rahmen so, dass der Punkt darin liegt. */
export function growBox(b: Box, p: Pt2): void {
  if (p.x < b[0]) b[0] = p.x;
  if (p.y < b[1]) b[1] = p.y;
  if (p.x > b[2]) b[2] = p.x;
  if (p.y > b[3]) b[3] = p.y;
}

// Ein fertiger Strich ändert sich nie, sein Rahmen wird darum nur einmal berechnet.
const known = new WeakMap<Stroke, Bounds>();

export function boundsOf(s: Stroke): Bounds {
  let b = known.get(s);
  if (!b) {
    const box = emptyBox();
    let maxW = 0;
    for (const p of s.pts) {
      growBox(box, p);
      if (p.w > maxW) maxW = p.w;
    }
    b = { box, maxW };
    known.set(s, b);
  }
  return b;
}

/**
 * Linienbreite eines Strichs in Seiteneinheiten: seine mittlere Breite (oder die Nennbreite, wenn er keine hat), nie
 * dünner als `min` (ein Bildpunkt), sonst verschwindet er.
 */
export function lineWidth(s: Stroke, min: number): number {
  return Math.max(s.w > 0 ? s.w : s.widthMm * MM, min);
}
