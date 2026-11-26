import { formatDayLong, MONTHS, type Day } from './dates';
import { parseSperrenKey, sperrenTitel, type Fachlinie } from './sperren';

const DAILY_NOTES_DIR = '05 Daily Notes';
export const PAGES_DIR = '07 Anhänge/Notizbuch';
const MAX_THEMA_LENGTH = 80;

/** Die Terminliste, die das Morgenbriefing schreibt. Die App liest sie nur. */
export const TERMINE_PATH = '04 Ressourcen/Kalender/Termine.md';

/** Die Geburtstage und Jahrestage, die das Morgenbriefing schreibt. Die App liest sie nur. */
export const GEBURTSTAGE_PATH = '04 Ressourcen/Kalender/Geburtstage.md';

export function dailyNotePath(d: Day): string {
  return `${DAILY_NOTES_DIR}/${d}.md`;
}

export function tagPagePath(d: Day): string {
  return `${PAGES_DIR}/${d.slice(0, 4)}/${d} Tag.svg`;
}

/** Ordner und Jahreszahl im Namen folgen dem ISO-Jahr aus dem Wochenschlüssel, zum Beispiel `2026-W53`. */
export function wochePagePath(weekKey: string): string {
  const [year, week] = weekKey.split('-W');
  return `${PAGES_DIR}/${year}/${year} KW${week} Woche.svg`;
}

export function monatPagePath(monthKey: string): string {
  return `${PAGES_DIR}/${monthKey.slice(0, 4)}/${monthKey} Monat.svg`;
}

/** Die Seite mit zwei Monaten, benannt nach dem ersten, zum Beispiel `2027-03 Sperren IB.svg`. Wirft bei einem ungültigen Schlüssel. */
export function sperrenPagePath(key: string): string {
  const s = parseSperrenKey(key);
  if (!s) throw new Error(`Ungültiger Sperren-Schlüssel: ${key}`);
  return `${PAGES_DIR}/${s.jahr}/${s.jahr}-${String(s.monat).padStart(2, '0')} Sperren ${s.fachlinie}.svg`;
}

export function sperrenCsvName(f: Fachlinie, jahr: number): string {
  return `Sperren ${f} ${jahr}.csv`;
}

/** Die Liste aller Sperren einer Fachlinie und eines Jahres, neben den Seiten. */
export function sperrenCsvPath(f: Fachlinie, jahr: number): string {
  return `${PAGES_DIR}/${jahr}/${sperrenCsvName(f, jahr)}`;
}

/** Der JSON-Speicher dazu. */
export function sperrenJsonPath(f: Fachlinie, jahr: number): string {
  return `${PAGES_DIR}/${jahr}/Sperren ${f} ${jahr}.json`;
}

/** Der Stand der abgestimmten Sperren, den das Excel-Makro exportiert. Die App liest ihn nur. */
export function excelStandName(f: Fachlinie, jahr: number): string {
  return `Sperren ${f} ${jahr} Excel.csv`;
}

export function excelStandPath(f: Fachlinie, jahr: number): string {
  return `${PAGES_DIR}/${jahr}/${excelStandName(f, jahr)}`;
}

/**
 * Macht aus einem Thema einen Dateinamen-Teil: verbotene Zeichen werden zu Leerzeichen, Leerzeichen
 * zusammengefasst, höchstens 80 Zeichen. `\ / : * ? " < > |` vertragen Windows-Dateinamen nicht,
 * `# ^ [ ]` stören Obsidian-Links.
 */
export function sanitizeThema(s: string): string {
  let thema = s.replace(/[\\/:*?"<>|#^[\]]/g, ' ').replace(/\s+/g, ' ').trim();
  thema = thema.slice(0, MAX_THEMA_LENGTH);
  // Nicht mitten in einem Emoji (Surrogatpaar) kürzen: ein halbes Zeichen ist kein gültiger Text mehr.
  if (/[\uD800-\uDBFF]$/.test(thema)) thema = thema.slice(0, -1);
  return thema.trim();
}

/** Dateiname einer Besprechung ohne Seitennummer und Endung, zum Beispiel `2026-10-29 0800 Thema`. */
export function besprechungBase(d: Day, zeit: string, thema: string): string {
  return `${d} ${zeit.replace(/\D/g, '')} ${sanitizeThema(thema) || 'Besprechung'}`;
}

/** Seite `n` einer Besprechung. Der Ordner folgt dem Jahr am Anfang von `base`. */
export function besprechungPagePath(base: string, n: number): string {
  return `${PAGES_DIR}/${base.slice(0, 4)}/${base} S${n}.svg`;
}

/** Die CSV der Tabellenseiten einer Besprechung, neben den Seiten. */
export function tabelleCsvPath(base: string): string {
  return `${PAGES_DIR}/${base.slice(0, 4)}/${base} Tabelle.csv`;
}

/** Der JSON-Speicher dazu, neben den Seiten. */
export function tabelleJsonPath(base: string): string {
  return `${PAGES_DIR}/${base.slice(0, 4)}/${base} Tabelle.json`;
}

/**
 * Der Name einer Seite für Meldungen, so wie die App sie zeigt: `Fr 30.10.2026`, `KW 44 / 2026`, `Oktober 2026` oder
 * `Thema, Seite 2` für eine Besprechung. Andere Dateien heißen wie die Datei ohne Ordner und Endung.
 */
export function pageName(path: string): string {
  const file = path.slice(path.lastIndexOf('/') + 1);
  const day = /^(\d{4}-\d{2}-\d{2}) Tag\.svg$/.exec(file);
  if (day) return formatDayLong(day[1]);
  const week = /^(\d{4}) KW(\d{2}) Woche\.svg$/.exec(file);
  if (week) return `KW ${week[2]} / ${week[1]}`;
  const month = /^(\d{4})-(\d{2}) Monat\.svg$/.exec(file);
  if (month && Number(month[2]) >= 1 && Number(month[2]) <= 12) return `${MONTHS[Number(month[2]) - 1]} ${month[1]}`;
  const sperren = /^(\d{4})-(01|03|05|07|09|11) Sperren (IB|Lehne)\.svg$/.exec(file);
  if (sperren) return sperrenTitel(`${sperren[3]}-${sperren[1]}-${sperren[2]}`);
  const meeting = /^\d{4}-\d{2}-\d{2} \d* (.+) S(\d+)\.svg$/.exec(file);
  if (meeting) return `${meeting[1]}, Seite ${meeting[2]}`;
  return file.replace(/\.svg$/, '');
}

/** Name der Konfliktkopie: `(Konflikt)` kommt vor die letzte Dateiendung. */
export function conflictPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  const lastDot = path.lastIndexOf('.');
  // Ein Punkt im Ordnernamen oder am Anfang des Dateinamens ist keine Endung.
  const cut = lastDot > lastSlash + 1 ? lastDot : path.length;
  return `${path.slice(0, cut)} (Konflikt)${path.slice(cut)}`;
}
