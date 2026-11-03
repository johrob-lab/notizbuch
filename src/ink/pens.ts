/**
 * Das Stiftmodell: welche Stifte es gibt und wie ihre Breite entsteht. Reine Rechnung, ohne Bildschirm und ohne Datei.
 * Alle Startwerte für Breiten, Druck, Feder und Deckkraft stehen hier als benannte Konstanten.
 */

export type PenKind = 'kugel' | 'fineliner' | 'fueller' | 'bleistift';

export const PENS: readonly PenKind[] = ['kugel', 'fineliner', 'fueller', 'bleistift'];

export const PEN_NAMES: Record<PenKind, string> = {
  kugel: 'Kugelschreiber',
  fineliner: 'Fineliner',
  fueller: 'Füllfeder',
  bleistift: 'Bleistift',
};

/** Füllfeder und Bleistift haben je Punkt eine eigene Breite und werden in der Datei als Umriss geschrieben. */
export function isShape(pen: PenKind): boolean {
  return pen === 'fueller' || pen === 'bleistift';
}

/** Der Fineliner ist ein Stück breiter als die Nennbreite und ändert sich nicht mit dem Druck. */
export const FINELINER_FACTOR = 1.25;

/** Unter `low` zählt der Druck als 0, ab `high` als 1, dazwischen wächst er gleichmäßig. */
export const PRESSURE_RAMP = { low: 0.1, high: 0.8 };

/** Füllfeder: Faktor auf die Nennbreite bei kleinstem und größtem Druck. */
export const FUELLER_PRESSURE = { min: 0.5, max: 2 };

/** Die Feder: Faktor quer zur Federrichtung und längs dazu. */
export const NIB = { across: 0.5, along: 1.5 };

/** Die Füllfeder wird nie dünner als dieser Teil der Nennbreite. */
export const FUELLER_MIN = 0.25;

/** Bleistift: Faktor auf die Nennbreite bei kleinstem und größtem Druck. */
export const BLEISTIFT_PRESSURE = { min: 0.6, max: 1.4 };

/** Deckkraft des Bleistifts. */
export const BLEISTIFT_OPACITY = 0.85;

/** Federrichtung ohne Neigungswerte: oberes Ende des Stifts schräg nach rechts unten (Rechtshänder). */
export const DEFAULT_PEN_ANGLE = Math.PI / 4;

/** Gewicht des neuen Werts beim Glätten, wie beim Druck. */
export const SMOOTH_NEW = 0.3;

/** Ein Winkel als doppelter Winkel (cos 2a, sin 2a): Entgegengesetzte Richtungen sind dann gleich. */
export type Doubled = { c: number; s: number };

/** Druck 0 bis 1 auf den Bereich der Kurve: 0 bis `low`, 1 ab `high`, dazwischen linear. */
export function pressureRamp(p: number): number {
  return Math.min(1, Math.max(0, (p - PRESSURE_RAMP.low) / (PRESSURE_RAMP.high - PRESSURE_RAMP.low)));
}

/** Richtung, in die der Stift zeigt, aus den Neigungswerten. `null` ohne Neigung oder bei Werten, die keine Zahl sind. */
export function penAngle(tiltX: number, tiltY: number): number | null {
  if (!Number.isFinite(tiltX) || !Number.isFinite(tiltY)) return null;
  if (tiltX === 0 && tiltY === 0) return null;
  return Math.atan2(tiltY, tiltX);
}

export function doubled(angle: number): Doubled {
  return { c: Math.cos(2 * angle), s: Math.sin(2 * angle) };
}

/**
 * Faktor der Feder für eine Strichrichtung: `NIB.along` längs zur Feder, `NIB.across` quer dazu. Ein kurzer Vektor
 * (unsichere Richtung) landet in der Mitte.
 */
export function nibFactor(stroke: Doubled, pen: Doubled): number {
  return NIB.across + (NIB.along - NIB.across) * Math.sqrt(Math.max(0, (1 + stroke.c * pen.c + stroke.s * pen.s) / 2));
}
