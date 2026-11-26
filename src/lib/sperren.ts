import { MONTHS, type Day } from './dates';

export type Fachlinie = 'IB' | 'Lehne';
export const FACHLINIEN: readonly Fachlinie[] = ['IB', 'Lehne'];

/** Erster Monat einer Seite: Jede Seite zeigt zwei Monate (Jänner und Februar, März und April und so weiter). */
export type ErsterMonat = 1 | 3 | 5 | 7 | 9 | 11;

export type SperrenSchluessel = { fachlinie: Fachlinie; jahr: number; monat: ErsterMonat };

// Gleicher Jahresbereich wie im Router.
const JAHR_MIN = 1000;
const JAHR_MAX = 9998;

const MM = (n: number): string => String(n).padStart(2, '0');

/** Liest einen Schlüssel wie `IB-2027-03` (erster Monat der Seite). Alles andere ergibt `null`. */
export function parseSperrenKey(key: string): SperrenSchluessel | null {
  const m = /^(IB|Lehne)-(\d{4})-(01|03|05|07|09|11)$/.exec(key);
  if (!m) return null;
  const jahr = Number(m[2]);
  if (jahr < JAHR_MIN || jahr > JAHR_MAX) return null;
  return { fachlinie: m[1] as Fachlinie, jahr, monat: Number(m[3]) as ErsterMonat };
}

export function sperrenKey(s: SperrenSchluessel): string {
  return `${s.fachlinie}-${s.jahr}-${MM(s.monat)}`;
}

/** Erster Monat der Seite, auf der `day` liegt. */
export function ersterMonat(day: Day): ErsterMonat {
  return (Math.floor((Number(day.slice(5, 7)) - 1) / 2) * 2 + 1) as ErsterMonat;
}

/** Schlüssel der Seite, auf der `today` liegt. */
export function aktuellerSperrenKey(today: Day, fachlinie: Fachlinie = 'IB'): string {
  return sperrenKey({ fachlinie, jahr: Number(today.slice(0, 4)), monat: ersterMonat(today) });
}

/** Die vorige (-1) oder nächste (1) Seite, zwei Monate weiter. Am Rand des Kalenders bleibt der Schlüssel gleich. */
export function stepSperrenKey(key: string, delta: 1 | -1): string {
  const s = parseSperrenKey(key);
  if (!s) return key;
  const index = s.jahr * 6 + (s.monat - 1) / 2 + delta;
  const jahr = Math.floor(index / 6);
  if (jahr < JAHR_MIN || jahr > JAHR_MAX) return key;
  return sperrenKey({ fachlinie: s.fachlinie, jahr, monat: ((index % 6) * 2 + 1) as ErsterMonat });
}

/** Derselbe Zeitraum in der anderen Fachlinie. */
export function mitFachlinie(key: string, f: Fachlinie): string {
  const s = parseSperrenKey(key);
  return s ? sperrenKey({ ...s, fachlinie: f }) : key;
}

/** Die beiden Monatsschlüssel `JJJJ-MM` der Seite. */
export function seitenMonate(s: SperrenSchluessel): [string, string] {
  return [`${s.jahr}-${MM(s.monat)}`, `${s.jahr}-${MM(s.monat + 1)}`];
}

/** Schlüssel der Seite in `seiten` des Zeilenspeichers: der erste Monat, zum Beispiel `03`. */
export function seitenSchluessel(s: SperrenSchluessel): string {
  return MM(s.monat);
}

/** Zum Beispiel `März und April 2027`. */
export function sperrenZeitraum(s: SperrenSchluessel): string {
  const [a, b] = seitenMonate(s);
  return `${sperrenMonatsname(a)} und ${sperrenMonatsname(b)} ${s.jahr}`;
}

/** Zum Beispiel `Sperren IB, März und April 2027`. */
export function sperrenTitel(key: string): string {
  const s = parseSperrenKey(key);
  return s ? `Sperren ${s.fachlinie}, ${sperrenZeitraum(s)}` : key;
}

/**
 * Bringt einen Schlüssel auf die neue Seite: Ein neuer Schlüssel bleibt, ein alter Quartalsschlüssel (`IB-2027-Q2`, aus den
 * Einstellungen eines Geräts oder einer alten Adresse) führt auf den ersten Monat seines Quartals (Q1 01, Q2 03, Q3 07, Q4 09).
 * Alles andere ergibt `null`.
 */
export function neuerSperrenKey(key: string): string | null {
  if (parseSperrenKey(key)) return key;
  const m = /^(IB|Lehne)-(\d{4})-Q([1-4])$/.exec(key);
  if (!m) return null;
  const monat = ([1, 3, 7, 9] as const)[Number(m[3]) - 1];
  const s = parseSperrenKey(`${m[1]}-${m[2]}-${MM(monat)}`);
  return s ? sperrenKey(s) : null;
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
