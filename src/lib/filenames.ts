import type { Day } from './dates';

const DAILY_NOTES_DIR = '05 Daily Notes';
const PAGES_DIR = '07 Anhänge/Notizbuch';
const MAX_THEMA_LENGTH = 80;

/** Die Terminliste, die das Morgenbriefing schreibt. Die App liest sie nur. */
export const TERMINE_PATH = '04 Ressourcen/Kalender/Termine.md';

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

/** Name der Konfliktkopie: `(Konflikt)` kommt vor die letzte Dateiendung. */
export function conflictPath(path: string): string {
  const lastSlash = path.lastIndexOf('/');
  const lastDot = path.lastIndexOf('.');
  // Ein Punkt im Ordnernamen oder am Anfang des Dateinamens ist keine Endung.
  const cut = lastDot > lastSlash + 1 ? lastDot : path.length;
  return `${path.slice(0, cut)} (Konflikt)${path.slice(cut)}`;
}
