import type { Rect } from '../pages/layouts';

/** Ort und Größe einer Karte auf der Seite. Seiteneinheiten sind Pixel der Ebene; als Zahl bekäme das Element keine Länge. */
export function cardStyle([x, y, w, h]: Rect): { left: string; top: string; width: string; height: string } {
  return { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` };
}
