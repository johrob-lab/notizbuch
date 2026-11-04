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

/** Bleistift: Faktor auf die Nennbreite bei kleinstem und größtem Druck. */
export const BLEISTIFT_PRESSURE = { min: 0.6, max: 1.4 };

/** Deckkraft des Bleistifts. */
export const BLEISTIFT_OPACITY = 0.85;

/** Federrichtung ohne Neigungswerte: oberes Ende des Stifts schräg nach rechts unten (Rechtshänder). */
export const DEFAULT_PEN_ANGLE = Math.PI / 4;

/** Gewicht des neuen Werts, wenn die Füllfeder die Stiftrichtung je Punkt glättet (so glätten die anderen Stifte den Druck). */
export const SMOOTH_NEW = 0.3;

// ---------- Füllfeder ----------

/** Die vier Regler der Füllfeder wie in GoodNotes, je von 0 bis 1 (0 bis 100 %). */
export type FuellerSettings = {
  /** Schärfe der Spitze: 0 runde Enden („Rund“), 1 spitz auslaufende Enden („Scharf“). */
  schaerfe: number;
  /** Druckempfindlichkeit: 0 der Druck wirkt nicht, 1 die Breite reicht von 0,2-fach (leicht) bis 1,8-fach (fest). */
  druck: number;
  /** Rundung der Spitze: 0 ganz flache Feder, 1 runde Spitze, die Linie ist überall gleich breit. */
  rundung: number;
  /** Strich-Stabilisierung: glättet die Orte mit σ = `STABIL_SIGMA` × stabil Punkten. */
  stabil: number;
};

/** Startwerte wie in GoodNotes gewohnt: Scharf, Druckempfindlichkeit 25 %, Rundung 33 %, Stabilisierung 14 %. */
export const DEFAULT_FUELLER: FuellerSettings = { schaerfe: 1, druck: 0.25, rundung: 0.33, stabil: 0.14 };

/** Druckfaktor 1 ± Empfindlichkeit × `PRESSURE_SPAN`: leicht dünner, fest breiter. */
export const PRESSURE_SPAN = 0.8;

/** Die ganz flache Feder (Rundung 0): Faktor quer zur Richtung, in die der Stift zeigt, und entlang dazu. */
export const FLAT_NIB = { across: 0.3, along: 1.7 };

/** So weit (Seiteneinheiten, 1,5 mm) läuft jedes Ende spitz aus. */
export const TAPER_LEN = 9;

/** Breite an der Spitze als Teil der vollen Breite, bei Schärfe 100 %. */
export const TAPER_TIP = 0.15;

/** Die Füllfeder wird nie dünner als dieser Teil der Nennbreite. */
export const FUELLER_FLOOR = 0.1;

/** Eine neue Richtung zählt erst, wenn der Stift so weit (Seiteneinheiten, 0,5 mm) vom letzten Richtungspunkt weg ist ... */
export const DIR_MIN = 3;

/** ... und mindestens so viele Bildschirmpunkte. Auch der Weg für die Verjüngung zählt erst ab so vielen Bildschirmpunkten. */
export const DIR_MIN_PX = 4;

/** Weglänge (Seiteneinheiten), über die eine neue Richtung geglättet wird. */
export const DIR_LEN = 2;

/** Weglänge (Seiteneinheiten), über die der Druck geglättet wird. Steht der Stift still, bleibt der Druck. */
export const PRESS_LEN = 1.5;

/** Die Strich-Stabilisierung glättet die Orte mit σ = `STABIL_SIGMA` × stabil, gemessen in Punkten. */
export const STABIL_SIGMA = 6;

/** Ist der ganze Weg eines Strichs kürzer (Seiteneinheiten), ist er ein Tipp: keine Verjüngung, er bleibt ein runder Punkt. */
export const TAP_MAX = 1e-6;

/** Mindestabstand zweier Stiftpunkte in Bildschirmpunkten: Die Fläche gibt `minDist` = `MIN_DIST_PX` / Zoom mit. */
export const MIN_DIST_PX = 0.6;

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

/** Druckfaktor der Füllfeder: 1 bei mittlerem Druck, von 1 − 0,8 × `druck` (leicht) bis 1 + 0,8 × `druck` (fest). */
export function pressureFactor(druck: number, pressure: number): number {
  return 1 + druck * PRESSURE_SPAN * (2 * pressureRamp(pressure) - 1);
}

/**
 * Federfaktor für die Strichrichtung `dir` bei der Stiftrichtung `pen` (beide als doppelter Winkel): Rundung 1 überall 1,
 * Rundung 0 entlang der Stiftrichtung `FLAT_NIB.along` und quer dazu `FLAT_NIB.across`, dazwischen gemischt. Solange die
 * Richtung nicht feststeht (`null`), ist die Feder rund. Ein kurzer Vektor (unsichere Richtung) landet in der Mitte.
 */
export function nibFactorR(rundung: number, dir: Doubled | null, pen: Doubled): number {
  if (!dir) return 1;
  const cos = Math.sqrt(Math.max(0, (1 + dir.c * pen.c + dir.s * pen.s) / 2)); // |cos| des Winkels zwischen beiden
  return rundung + (1 - rundung) * (FLAT_NIB.across + (FLAT_NIB.along - FLAT_NIB.across) * cos);
}

/**
 * Verjüngung an einem Ende: `s` ist der Weg ab diesem Ende, `len` die Länge der Verjüngung (Seiteneinheiten). Am Ende
 * 1 − `schaerfe` × (1 − `TAPER_TIP`), ab `len` 1, dazwischen wächst sie weich (quadratisch). Bei `len` ≤ 0 keine Verjüngung.
 */
export function taperFactor(schaerfe: number, s: number, len: number): number {
  if (!(len > 0)) return 1;
  const rest = 1 - Math.min(s / len, 1);
  return 1 - schaerfe * (1 - TAPER_TIP) * rest * rest;
}

/**
 * Form der Spitze für die Anzeige beim Schweben, bei mittlerem Druck: eine Ellipse, deren lange Achse quer zu der Richtung
 * steht, in die der Stift zeigt (`penAngle`, Bogenmaß). `long` ist so lang, wie die Linie entlang dieser Richtung breit wird,
 * `short` so lang wie quer dazu, `angle` ist die Richtung der langen Achse. Bei Rundung 1 ein Kreis mit Durchmesser `nomW`.
 */
export function nibShape(o: FuellerSettings, nomW: number, penAngle: number): { long: number; short: number; angle: number } {
  const r = o.rundung;
  return {
    long: nomW * (r + (1 - r) * FLAT_NIB.along),
    short: nomW * (r + (1 - r) * FLAT_NIB.across),
    angle: penAngle + Math.PI / 2,
  };
}
