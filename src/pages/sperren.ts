import type { Day } from '../lib/dates';

/**
 * Geometrie der Sperrenseite (Seiteneinheiten). Die Abendroutine liest sie aus dem Element `data-sperren` im Hintergrund:
 * Monatsspalten bei x 40, 415 und 790 (je 362 breit), Tageszeilen ab y 184 (je 44 hoch), in jeder Zeile 76 für die
 * Beschriftung, dann Platz 1 und Platz 2 je 143 breit.
 */
export const SPERREN_GEOMETRIE = { spalten: [40, 415, 790], breite: 362, zeile0: 184, zeilenhoehe: 44, label: 76, platz: 143 } as const;

/** Das leere Element für die Abendroutine. Genau diese Zeichen, nicht zusammengebaut. */
export const SPERREN_MARKER = '<g data-sperren="1" data-spalten="40 415 790" data-zeilen="184 44" data-platz="76 143"/>';

/** Name des Feldes eines Tages: `sperre-2027-03-01-1` (Platz 1 links, 2 rechts). */
export function sperrenFeldId(day: Day, platz: 1 | 2): string {
  return `sperre-${day}-${platz}`;
}
