// Die Kette: die offene Seite mit ihren Nachbarn darüber und darunter, gerechnet in Seiteneinheiten der offenen Seite
// (ihr Oberrand liegt bei y = 0, ihr Unterrand bei PAGE_H). Zwischen zwei Seiten bleibt ein Spalt von `PAGE_GAP`.
// Reine Rechnung ohne DOM, damit sich das Weiterscrollen einfach testen lässt.

import { type View } from './gestures';
import { PAGE_H } from './types';

/** So viel Abstand hängt zwischen zwei Seiten, in Seiteneinheiten. */
export const PAGE_GAP = 24;

/** Der Nachbar über oder unter der offenen Seite. */
export type Side = 'above' | 'below';
/** Beide Nachbarn, der obere zuerst. */
export const SIDES: readonly Side[] = ['above', 'below'];
/** Welche Nachbarn es gibt (die erste Seite hat keinen oberen, die letzte keinen unteren). */
export type Present = { above: boolean; below: boolean };

/** Um wie viel der Oberrand des Nachbarn gegenüber der offenen Seite verschoben liegt. */
export function neighborOffset(side: Side): number {
  return side === 'below' ? PAGE_H + PAGE_GAP : -(PAGE_H + PAGE_GAP);
}

/** Wie weit die Kette nach oben (`top`, höchstens 0) und nach unten (`bottom`, mindestens PAGE_H) reicht. */
export function chainSpan(n: Present): { top: number; bottom: number } {
  return {
    top: n.above ? -(PAGE_H + PAGE_GAP) : 0,
    bottom: n.below ? 2 * PAGE_H + PAGE_GAP : PAGE_H,
  };
}

/** Zu welchem Nachbarn ein Punkt gehört, der auf der Seite `y` Einheiten unter dem Oberrand liegt. Der Spalt zählt zum Nachbarn (so gilt es für eine Berührung mit Stift oder Finger), `settledSide` wechselt dagegen erst jenseits der halben Lücke. */
export function sideAt(y: number, n: Present): Side | null {
  if (y < 0 && n.above) return 'above';
  if (y > PAGE_H && n.below) return 'below';
  return null;
}

/**
 * Welcher Nachbar die Mitte des Bildschirms (`size`) bedeckt, sobald die Ansicht zur Ruhe kommt, sonst `null`. Gewechselt
 * wird erst jenseits der halben Lücke, damit die offene Seite nicht schon im Spalt umspringt.
 */
export function settledSide(view: View, size: { w: number; h: number }, n: Present): Side | null {
  const cy = (size.h / 2 - view.y) / view.s;
  if (n.above && cy < -PAGE_GAP / 2) return 'above';
  if (n.below && cy > PAGE_H + PAGE_GAP / 2) return 'below';
  return null;
}

/** Die Ansicht, wenn der Nachbar zur offenen Seite wird: Er bleibt auf dem Bildschirm genau dort, wo er schon war. */
export function viewFor(view: View, side: Side): View {
  return { s: view.s, x: view.x, y: view.y + (side === 'below' ? 1 : -1) * (PAGE_H + PAGE_GAP) * view.s };
}
