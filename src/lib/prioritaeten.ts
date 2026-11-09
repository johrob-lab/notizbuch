import { parseItem, parseSections, visibleLines, visibleText } from './dailyNote';

/** Eine Priorität des Tages, wie sie die Abendroutine unter `## Handschrift` → `### Prioritäten` in die Tagesnotiz schreibt. */
export type Prioritaet = { text: string; done: boolean };

const HANDSCHRIFT = 'Handschrift';
const BLOCK = 'Prioritäten';
// Überschrift der Ebenen 1 bis 6 (`#` bis `######`), ein BOM am Dateianfang gehört nicht dazu. Gruppe 1: die Raute, Gruppe 2: der Titel.
const ANY_HEADING = /^\ufeff?(#{1,6})[ \t]+(\S.*?)\s*$/;
// Trennzeile einer Markdown-Tabelle: nur `|`, `-`, `:` und Leerzeichen (mindestens ein Strich).
const TABLE_SEPARATOR = /^[|:\s-]*-[|:\s-]*$/;
const WIKILINK = /\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g;

/**
 * Eine Zeile als schlichter Text: `[[ziel|anzeige]]` wird `anzeige` (leere Anzeige: `ziel`), `[[ziel]]` wird `ziel`,
 * Fettschrift (`**` und `__`) verliert ihre Zeichen. Eine Tabellenzeile (beginnt mit `|`) wird zu ihren nicht leeren Zellen,
 * getrennt durch " · ". Trennzeilen von Tabellen ergeben einen leeren Text.
 */
function plain(text: string): string {
  let t = text.replace(WIKILINK, (_all, target: string, label?: string) => label || target).replace(/\*\*|__/g, '');
  const trimmed = t.trim();
  if (trimmed.startsWith('|')) {
    if (TABLE_SEPARATOR.test(trimmed)) return '';
    t = trimmed
      .split('|')
      .map((cell) => cell.replace(/\s+/g, ' ').trim())
      .filter((cell) => cell !== '')
      .join(' · ');
  }
  return t.replace(/\s+/g, ' ').trim();
}

/**
 * Die Prioritäten eines Tages: jede Zeile in jedem Block `### Prioritäten` des Abschnitts `## Handschrift`, in der Reihenfolge der
 * Datei. Ein Block reicht bis zur nächsten Überschrift. Leere Zeilen und `Quelle:`-Zeilen zählen nicht. Erledigt ist nur ein
 * Kästchen mit `x` oder `X`; ein Aufzählungszeichen ohne Kästchen ist einfacher Text. Eine Überschrift `### Prioritäten` in einem
 * anderen Abschnitt gilt nicht.
 */
export function parsePrioritaeten(md: string): Prioritaet[] {
  const section = parseSections(md).find((s) => s.heading.normalize('NFC') === HANDSCHRIFT);
  if (!section) return [];
  // Zweimal geteilt (auch `parseSections` teilt selbst): beide trennen gleich an '\n', nur so passen die Zeilennummern von `section` zu `lines`.
  const lines = visibleLines(md.split('\n'));
  const found: Prioritaet[] = [];
  let inBlock = false;
  for (let i = section.start + 1; i < section.end; i++) {
    const heading = ANY_HEADING.exec(lines[i]);
    if (heading) {
      inBlock = heading[1] === '###' && heading[2].normalize('NFC') === BLOCK;
      continue;
    }
    if (!inBlock) continue;
    const text = plain(visibleText(lines[i]));
    if (text === '' || text.startsWith('Quelle:')) continue;
    const box = parseItem(lines[i])?.box;
    found.push({ text, done: box === 'x' || box === 'X' });
  }
  return found;
}
