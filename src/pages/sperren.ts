import type { Day } from '../lib/dates';

/**
 * Geometrie der Sperrenseite (Seiteneinheiten). Die Abendroutine liest sie aus dem Element `data-sperren` im Hintergrund:
 * Monatsspalten bei x 40 und 608 (je 544 breit), Tageszeilen ab y 184 (je 44 hoch), in jeder Zeile 76 für die
 * Beschriftung, dann Platz 1, Platz 2 und Platz 3 je 156 breit.
 */
export const SPERREN_GEOMETRIE = { spalten: [40, 608], breite: 544, zeile0: 184, zeilenhoehe: 44, label: 76, platz: 156 } as const;

/** Ein Schreibfeld je Tag und Platz: 1 links, 2 Mitte, 3 rechts. */
export type Platz = 1 | 2 | 3;
export const PLAETZE: readonly Platz[] = [1, 2, 3];

/** Das leere Element für die Abendroutine. Genau diese Zeichen, nicht zusammengebaut. */
export const SPERREN_MARKER = '<g data-sperren="1" data-spalten="40 608" data-zeilen="184 44" data-platz="76 156" data-plaetze="3"/>';

/** Name des Feldes eines Tages: `sperre-2027-03-01-1` (Platz 1 links, 2 Mitte, 3 rechts). */
export function sperrenFeldId(day: Day, platz: Platz): string {
  return `sperre-${day}-${platz}`;
}
