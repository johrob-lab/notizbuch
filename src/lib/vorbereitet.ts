import { isValidDay } from './dates';
import { parseItem, parseSections, visibleLines, visibleText } from './dailyNote';
import { sanitizeThema } from './filenames';
import { plain } from './prioritaeten';

// Punkte, die Claude für eine Besprechung vorbereitet hat (aus Einladungen, Mails, Abstimmungen). Sie stehen in der Tagesnotiz
// der Besprechung im Abschnitt `## Besprechungen (vorbereitet)`, je Besprechung ein Block `### HH:MM Thema` (die Uhrzeit darf
// fehlen). Die Besprechungsseite zeigt sie auf Seite 1 über den Linien, wie geschrieben, nie in der Datei der Seite. Reine
// Rechnung ohne DOM und ohne Netz.

/** Die Überschrift des Abschnitts in der Tagesnotiz. */
export const VORBEREITET = 'Besprechungen (vorbereitet)';

/**
 * Eine Zeile des Blocks: eine Aufgabe mit Kästchen (`line` und `source` sagen, welche Zeile der Notiz sie ist, zum Abhaken), ein
 * Zwischentitel (eine Zeile nur in Fettschrift) oder einfacher Text.
 */
export type VorbereitetZeile =
  | { art: 'aufgabe'; text: string; done: boolean; line: number; source: string }
  | { art: 'titel'; text: string }
  | { art: 'text'; text: string };

/** Ein Block: seine Überschrift, wie sie in der Notiz steht, und seine Zeilen. */
export type VorbereitetBlock = { heading: string; zeilen: VorbereitetZeile[] };

const BLOCK_HEADING = /^﻿?###[ \t]+(\S.*?)\s*$/;
const ANY_HEADING = /^﻿?#{1,6}[ \t]+\S/;
const TIME = /^(\d{1,2}):(\d{2})(?:\s+|$)/;
const BOLD_ONLY = /^(\*\*|__)(.+)\1:?$/;

/** Uhrzeit (`HHMM`, leer wenn keine) und Thema aus dem Namen einer Besprechung, zum Beispiel `2026-11-26 0830 Biko-Besuch`. */
export function splitBase(base: string): { day: string; zeit: string; thema: string } | null {
  const match = /^(\d{4}-\d{2}-\d{2}) (\d{0,4}) (.*)$/.exec(base.normalize('NFC'));
  if (!match || !isValidDay(match[1])) return null;
  return { day: match[1], zeit: match[2], thema: match[3] };
}

/** Uhrzeit (`HHMM`, leer wenn keine) und Thema aus einer Überschrift `08:30 Thema` oder `Thema`. */
function splitHeading(heading: string): { zeit: string; thema: string } {
  const match = TIME.exec(heading);
  if (!match) return { zeit: '', thema: heading };
  return { zeit: `${match[1].padStart(2, '0')}${match[2]}`, thema: heading.slice(match[0].length) };
}

/** Ein Thema zum Vergleichen: wie im Dateinamen, ohne Unterschied bei Groß und Klein. */
const sameThema = (a: string, b: string): boolean => sanitizeThema(a.normalize('NFC')).toLowerCase() === sanitizeThema(b.normalize('NFC')).toLowerCase();

type RawBlock = { heading: string; start: number; end: number };

/** Alle Blöcke `###` im Abschnitt `## Besprechungen (vorbereitet)`, in der Reihenfolge der Datei. */
function blocks(md: string, lines: string[]): RawBlock[] {
  const found: RawBlock[] = [];
  for (const section of parseSections(md)) {
    if (section.heading.normalize('NFC') !== VORBEREITET) continue;
    for (let i = section.start + 1; i < section.end; i++) {
      const match = BLOCK_HEADING.exec(lines[i]);
      if (match) {
        const last = found.at(-1);
        if (last && last.end > i) last.end = i;
        found.push({ heading: match[1].normalize('NFC'), start: i, end: section.end });
      } else if (ANY_HEADING.test(lines[i])) {
        // Eine andere Überschrift (zum Beispiel `####`) beendet den Block davor: Was darunter steht, gehört zu keiner Besprechung.
        const last = found.at(-1);
        if (last && last.end > i) last.end = i;
      }
    }
  }
  return found;
}

/**
 * Welcher Block gehört zur Besprechung `base`? Zuerst der mit derselben Uhrzeit und demselben Thema, sonst der einzige mit
 * derselben Uhrzeit, sonst der einzige mit demselben Thema. Gibt es keinen eindeutigen, keiner.
 */
function pick(found: RawBlock[], zeit: string, thema: string): RawBlock | null {
  const heads = found.map((block) => ({ block, ...splitHeading(block.heading) }));
  const exact = heads.filter((h) => h.zeit === zeit && sameThema(h.thema, thema));
  if (exact.length > 0) return exact[0].block;
  if (zeit !== '') {
    const sameTime = heads.filter((h) => h.zeit === zeit);
    if (sameTime.length === 1) return sameTime[0].block;
  }
  const sameName = heads.filter((h) => sameThema(h.thema, thema));
  return sameName.length === 1 ? sameName[0].block : null;
}

/**
 * Der vorbereitete Block der Besprechung `base` aus ihrer Tagesnotiz `md`, oder `null`, wenn es keinen gibt (oder keinen
 * eindeutigen). Leere Zeilen und `Quelle:`-Zeilen zählen nicht.
 */
export function vorbereitetFuer(md: string | null, base: string): VorbereitetBlock | null {
  if (md === null) return null;
  const name = splitBase(base);
  if (!name) return null;
  // Zweimal geteilt (auch `parseSections` teilt selbst): beide trennen gleich an '\n', nur so passen die Zeilennummern zusammen.
  const raw = md.split('\n');
  const lines = visibleLines(raw);
  const block = pick(blocks(md, lines), name.zeit, name.thema);
  if (!block) return null;
  const zeilen: VorbereitetZeile[] = [];
  for (let i = block.start + 1; i < block.end; i++) {
    const shown = lines[i];
    const item = parseItem(shown);
    const text = plain(visibleText(shown));
    if (text === '' || text.startsWith('Quelle:')) continue;
    if (item?.box !== undefined) {
      zeilen.push({ art: 'aufgabe', text, done: item.box !== ' ', line: i, source: raw[i] });
      continue;
    }
    const bold = item ? null : BOLD_ONLY.exec(visibleText(shown));
    zeilen.push(bold ? { art: 'titel', text: plain(bold[2]) } : { art: 'text', text });
  }
  return { heading: block.heading, zeilen };
}
