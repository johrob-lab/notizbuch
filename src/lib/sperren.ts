import { MONTHS, type Day } from './dates';

export type Fachlinie = 'IB' | 'Lehne';
export const FACHLINIEN: readonly Fachlinie[] = ['IB', 'Lehne'];

export type SperrenSchluessel = { fachlinie: Fachlinie; jahr: number; quartal: 1 | 2 | 3 | 4 };

// Gleicher Jahresbereich wie im Router.
const JAHR_MIN = 1000;
const JAHR_MAX = 9998;

/** Liest einen Schlüssel wie `IB-2027-Q1`. Alles andere ergibt `null`. */
export function parseSperrenKey(key: string): SperrenSchluessel | null {
  const m = /^(IB|Lehne)-(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const jahr = Number(m[2]);
  if (jahr < JAHR_MIN || jahr > JAHR_MAX) return null;
  return { fachlinie: m[1] as Fachlinie, jahr, quartal: Number(m[3]) as 1 | 2 | 3 | 4 };
}

export function sperrenKey(s: SperrenSchluessel): string {
  return `${s.fachlinie}-${s.jahr}-Q${s.quartal}`;
}

export function quartalOf(day: Day): 1 | 2 | 3 | 4 {
  return (Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1) as 1 | 2 | 3 | 4;
}

/** Schlüssel des Quartals, in dem `today` liegt. */
export function aktuellerSperrenKey(today: Day, fachlinie: Fachlinie = 'IB'): string {
  return sperrenKey({ fachlinie, jahr: Number(today.slice(0, 4)), quartal: quartalOf(today) });
}

/** Das vorige (-1) oder nächste (1) Quartal. Am Rand des Kalenders bleibt der Schlüssel gleich. */
export function stepSperrenKey(key: string, delta: 1 | -1): string {
  const s = parseSperrenKey(key);
  if (!s) return key;
  const index = s.jahr * 4 + (s.quartal - 1) + delta;
  const jahr = Math.floor(index / 4);
  if (jahr < JAHR_MIN || jahr > JAHR_MAX) return key;
  return sperrenKey({ fachlinie: s.fachlinie, jahr, quartal: ((index % 4) + 1) as 1 | 2 | 3 | 4 });
}

/** Derselbe Zeitraum in der anderen Fachlinie. */
export function mitFachlinie(key: string, f: Fachlinie): string {
  const s = parseSperrenKey(key);
  return s ? sperrenKey({ ...s, fachlinie: f }) : key;
}

/** Die drei Monatsschlüssel `JJJJ-MM` des Quartals. */
export function quartalMonate(s: SperrenSchluessel): string[] {
  return [0, 1, 2].map((i) => `${s.jahr}-${String((s.quartal - 1) * 3 + i + 1).padStart(2, '0')}`);
}

/** Zum Beispiel `Sperren IB, 1. Quartal 2027`. */
export function sperrenTitel(key: string): string {
  const s = parseSperrenKey(key);
  return s ? `Sperren ${s.fachlinie}, ${s.quartal}. Quartal ${s.jahr}` : key;
}


const SPERREN_MONATE = MONTHS.map((m, i) => (i === 0 ? 'Jänner' : m));

/** Name des Monats `JJJJ-MM` auf der Sperrenseite: Hier heißt der erste Monat „Jänner“ (sonst im Notizbuch „Januar“). */
export function sperrenMonatsname(monthKey: string): string {
  return SPERREN_MONATE[Number(monthKey.slice(5, 7)) - 1] ?? '';
}

/** Hinweis am Knopf „Für Excel herunterladen“, wenn es die Liste der Fachlinie für das Jahr noch nicht gibt. */
export function keineListe(fachlinie: Fachlinie, jahr: number): string {
  return `Noch keine Liste für ${fachlinie} ${jahr}. Sie kommt mit der Abendroutine, sobald Sperren gelesen sind.`;
}
