import { MM, PAGE_W } from '../ink/types';

// Die Tabellenseite (Arbeitsvorbereitung): zwölf gedruckte Spalten und 27 Zeilen. Dieser Teil ist reine Rechnung aus Maßen,
// ohne SVG. Das Layout in `layouts.ts` und die Abendroutine im Vault lesen dieselben Zahlen.

/** Kopf und Breite (mm) jeder Spalte, von links nach rechts. Zusammen 191 mm. */
export const TABELLE_SPALTEN: readonly { titel: string; mm: number }[] = [
  { titel: 'Schritt', mm: 32 },
  { titel: 'Monat', mm: 9 },
  { titel: 'Std', mm: 12 },
  { titel: '×', mm: 9 },
  { titel: '×', mm: 9 },
  { titel: 'Anz.', mm: 10 },
  { titel: 'wer', mm: 12 },
  { titel: 'Fahrzeuge', mm: 22 },
  { titel: 'Ressourcen', mm: 22 },
  { titel: 'Mat. €', mm: 16 },
  { titel: 'Fremd €', mm: 16 },
  { titel: 'Bemerkung', mm: 22 },
];

export const TABELLE_ZEILEN = 27;

const TABELLE_BREITE = 191 * MM;
const KOPF_OBEN = 212;
const ZEILEN_OBEN = 248;
const ZEILE_HOEHE = 8 * MM;

export type TabelleGeometrie = {
  /** x der Spaltengrenzen: links, zwischen den Spalten und rechts (13 Werte). */
  spalten: number[];
  /** y der Zeilengrenzen: oben, zwischen den Zeilen und unten (28 Werte). */
  zeilen: number[];
  /** y oben und unten der Spaltenköpfe. */
  kopfzeile: [number, number];
};

/** Die Grenzen der Tabelle in Seiteneinheiten: Sie steht in der Mitte der Seite. */
export function tabelleGeometrie(): TabelleGeometrie {
  const spalten = [(PAGE_W - TABELLE_BREITE) / 2];
  for (const s of TABELLE_SPALTEN) spalten.push(spalten[spalten.length - 1] + s.mm * MM);
  const zeilen = Array.from({ length: TABELLE_ZEILEN + 1 }, (_, i) => ZEILEN_OBEN + i * ZEILE_HOEHE);
  return { spalten, zeilen, kopfzeile: [KOPF_OBEN, ZEILEN_OBEN] };
}

/** Die Feld-ID der Zeile `n` (ab 1): `zeile-01` bis `zeile-27`. */
export function zeilenFeld(n: number): string {
  return `zeile-${String(n).padStart(2, '0')}`;
}
