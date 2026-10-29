import type { Day } from '../lib/dates';

/** Seiteneinheiten je Millimeter. */
export const MM = 6;
/** Größe einer Seite in Seiteneinheiten. */
export const PAGE_W = 1192;
export const PAGE_H = 1590;

export type InkColor = 'schwarz' | 'blau' | 'rot' | 'gruen';

/** Farbwerte der Tinte. Rot heißt „offen“, grün „erledigt“. */
export const INK: Record<InkColor, string> = {
  schwarz: '#1c1f26',
  blau: '#1f4fa3',
  rot: '#c62828',
  gruen: '#2e7d32',
};

export type WidthName = 'fein' | 'mittel' | 'breit';

/** Nennbreiten der Striche in Millimetern. */
export const WIDTH_MM: Record<WidthName, number> = { fein: 0.1, mittel: 0.2, breit: 0.4 };

/** Glättung als σ des Gauß-Fensters, gemessen in Punkten. 0 heißt: nicht glätten. */
export const SMOOTHING = { aus: 0, leicht: 1.0, mittel: 1.6, stark: 2.4 };

/** Ein Punkt eines Strichs in Seiteneinheiten. `w` ist die Breite des Strichs an dieser Stelle. */
export type Pt = { x: number; y: number; w: number };

export type Stroke = {
  /** Eindeutig über alle Geräte, beim Zusammenführen zweier Fassungen einer Seite zählt allein die `id`. */
  id: string;
  tool: 'kugel';
  color: InkColor;
  /** Nennbreite in Millimetern. */
  widthMm: number;
  /** Beginn des Strichs in Millisekunden seit 1970. */
  t: number;
  /** Mittlere Breite des Strichs in Seiteneinheiten. So breit wird er gezeichnet. */
  w: number;
  pts: Pt[];
};

export type PageKind = 'tag' | 'woche' | 'monat' | 'besprechung';

export type Page = {
  kind: PageKind;
  /** Tag `2026-10-29`, Woche `2026-W44`, Monat `2026-10`; bei einer Besprechung ein beliebiger Schlüssel. */
  key: string;
  /** Zusatzangaben der Seite, bei Besprechungen Thema, Datum, Zeit, Ort, Projekt und Seitennummer. */
  meta: Record<string, string>;
  strokes: Stroke[];
};

/** Ein Feld der Seite. `rect` ist `[x, y, Breite, Höhe]` in Seiteneinheiten. */
export type FieldBox = { id: string; rect: [number, number, number, number]; datum: Day };
