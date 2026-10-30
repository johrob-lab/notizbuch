import type { Day } from './dates';

/** Reihenfolge der Abschnitte (Überschriften der Ebene 2, ohne `## `) in einer Tagesnotiz. */
export const SECTION_ORDER: readonly string[] = [
  'Morgenbriefing (automatisch)',
  'Ergänzungen',
  'Handschrift',
  'Besprechungen',
  'Besprechungen (GoodNotes)',
  'Tagesabschluss (Chat)',
  'Abendüberblick (automatisch)',
];

/**
 * Abschnitt einer Tagesnotiz. `heading` ist der Name, wie die Notiz ihn zeigt (ohne Marker). `start` ist der Zeilenindex der
 * Überschrift, `end` exklusiv. Gezählt wird in `md.split('\n')`.
 */
export type Section = { heading: string; start: number; end: number };

const ERGAENZUNGEN = 'Ergänzungen';

// Dies ist das Zeilenmodell der Tagesnotiz. Was ein Eintrag, eine Aufgabe oder ein Marker ist, entscheiden
// nur `parseItem` und `splitMarkers` (mit `visibleLines`). Auch der Renderer (markdown.ts) fragt sie ab,
// statt es aus dem Markdown zu schließen: sonst zeigt er Kästchen, die sich nicht haken lassen.

// Überschrift der Ebene 2: `## Text`, nicht `### Text` und nicht `##Text`. `\s*$` schluckt auch ein `\r`.
// Ein BOM (U+FEFF) am Dateianfang gehört nicht zur ersten Zeile.
const HEADING = /^\uFEFF?## +(\S.*?)\s*$/;
// Aufzählungszeichen, optional eingerückt, optional mit Kästchen: `- `, `- [ ] `, `- [x] `. Gruppe 1: Inhalt des Kästchens.
const ITEM = /^\uFEFF?[ \t]*- (?:\[([ xX])\] )?/;

export type Item = {
  /** Einrückung, Aufzählungszeichen und Kästchen, zum Beispiel `- [ ] `. */
  prefix: string;
  /** Inhalt des Kästchens (` `, `x` oder `X`), bei einem Listenpunkt ohne Kästchen `undefined`. */
  box: string | undefined;
  /** Der Rest der Zeile ohne ein abschließendes `\r`. */
  body: string;
  /** `\r` bei Windows-Zeilenenden, sonst leer. Wird beim Zurückschreiben wieder angehängt. */
  eol: string;
};

function splitEol(line: string): [content: string, eol: string] {
  return line.endsWith('\r') ? [line.slice(0, -1), '\r'] : [line, ''];
}

/**
 * Zerlegt eine Zeile in einen Listenpunkt (`- Text`, eingerückt oder mit Kästchen) oder gibt `null`
 * zurück. Ein Kästchen ist nur `- [ ] `, `- [x] ` oder `- [X] ` mit genau einem Leerzeichen nach dem
 * Strich und nach der Klammer. Alles andere hat keins und behält die Klammern als Text: `-  [ ] x`,
 * `- [ ]` am Zeilenende, `- [ ]%%m%%`, `- [ ]` mit Tab oder geschütztem Leerzeichen dahinter. Zitate,
 * andere Aufzählungszeichen und nummerierte Listen sind keine Listenpunkte.
 */
export function parseItem(line: string): Item | null {
  const [content, eol] = splitEol(line);
  const match = ITEM.exec(content);
  if (!match) return null;
  return { prefix: match[0], box: match[1], body: content.slice(match[0].length), eol };
}

function itemAt(lines: string[], line: number): Item {
  const item = lines[line] === undefined ? null : parseItem(lines[line]);
  if (!item) throw new Error(`Zeile ${line} ist kein Listenpunkt`);
  return item;
}

/**
 * Trennt den Text einer Zeile (ohne Zeilenende) in sichtbaren Text und Marker. Ein Marker ist `%%…%%`
 * innerhalb der Zeile, samt Leerraum davor; ein `%%` ohne Ende gilt bis zum Zeilenende, nie darüber
 * hinaus (`100%% sicher` versteckt ` sicher`). Die Marker kommen in ihrer Reihenfolge zurück, ein offener
 * ohne Leerraum am Ende. Blockkommentare über mehrere Zeilen kennt `visibleLines`.
 */
export function splitMarkers(text: string): { visible: string; markers: string[] } {
  let visible = '';
  const markers: string[] = [];
  let pos = 0;
  for (;;) {
    const open = text.indexOf('%%', pos);
    if (open < 0) return { visible: visible + text.slice(pos), markers };
    visible += text.slice(pos, open).trimEnd();
    const close = text.indexOf('%%', open + 2);
    if (close < 0) {
      markers.push(text.slice(open).trimEnd());
      return { visible, markers };
    }
    markers.push(text.slice(open, close + 2));
    pos = close + 2;
  }
}

/** Eine Zeile nur aus `%%` (auch eingerückt) beginnt oder beendet einen Blockkommentar. */
function isCommentFence(line: string): boolean {
  return line.trim() === '%%';
}

/** Eine Zeile ohne Marker. Aufzählungszeichen und Kästchen bleiben stehen, auch wenn direkt dahinter ein Marker beginnt. */
function visibleLine(line: string): string {
  const [content] = splitEol(line);
  const item = parseItem(content);
  return item ? item.prefix + splitMarkers(item.body).visible : splitMarkers(content).visible;
}

/**
 * Die Zeilen so, wie die Notiz sie zeigt (für den Renderer): Marker sind entfernt, Blockkommentare
 * leer. Ein Blockkommentar reicht von einer Zeile nur mit `%%` bis zur nächsten solchen Zeile. Findet
 * sich keine zweite, versteckt die eine nur sich selbst (wie jedes `%%` ohne Ende). Die Zeilenzahl
 * bleibt gleich, damit die Zeilennummern stimmen; `\r` am Zeilenende fällt weg.
 */
export function visibleLines(lines: string[]): string[] {
  const shown: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const end = isCommentFence(lines[i]) ? lines.findIndex((line, j) => j > i && isCommentFence(line)) : -1;
    if (end < 0) {
      shown.push(visibleLine(lines[i]));
    } else {
      shown.push(...Array<string>(end - i + 1).fill(''));
      i = end;
    }
  }
  return shown;
}

/**
 * Text für eine Zeile: Zeilenumbrüche werden zu Leerzeichen, `%%` fällt weg (sonst entstünde oder
 * bräche ein Marker), getrimmt.
 */
function cleanText(text: string): string {
  return text.replace(/\s*[\r\n]+\s*/g, ' ').replace(/%%/g, '').trim();
}

/**
 * Zeilenende der Notiz, als Zusatz am Ende einer Zeile: `\r`, wenn mehr Umbrüche `\r\n` sind als einzelne
 * `\n`, sonst leer. Eingefügte Zeilen bekommen es, damit keine gemischten Enden entstehen.
 */
function eolOf(md: string): string {
  const breaks = md.split('\n').length - 1;
  const windows = md.split('\r\n').length - 1;
  return windows > breaks - windows ? '\r' : '';
}

/**
 * Alle Abschnitte der Ebene 2 in der Reihenfolge der Datei. Es zählt, was die Notiz zeigt (`visibleLines`): Der Name hat keine
 * Marker, und eine Überschrift in einem Blockkommentar ist keine. Sonst stünde `%%ob:k3x9%%` auf dem Knopf des Abschnitts, ein
 * Abschnitt wäre doppelt angelegt, oder eine Ergänzung landete im versteckten Teil der Notiz.
 */
export function parseSections(md: string): Section[] {
  const lines = md.split('\n');
  const sections: Section[] = [];
  visibleLines(lines).forEach((line, i) => {
    const match = HEADING.exec(line);
    if (!match) return;
    const previous = sections.at(-1);
    if (previous) previous.end = i;
    sections.push({ heading: match[1], start: i, end: lines.length });
  });
  return sections;
}

/** `- `, `- [ ] ` oder `- [x] ` am Zeilenanfang, auch eingerückt. */
export function isItemLine(line: string): boolean {
  return parseItem(line) !== null;
}

/** Der Text, den man in der Notiz sieht: ohne Aufzählungszeichen, ohne Kästchen, ohne `%%…%%`. */
export function visibleText(line: string): string {
  const [content] = splitEol(line);
  const item = parseItem(content);
  return splitMarkers(item ? item.body : content).visible.trim();
}

/** Setzt den Haken oder nimmt ihn weg. Wirft, wenn die Zeile kein Kästchen hat. */
export function toggleTask(md: string, line: number): string {
  const lines = md.split('\n');
  const item = itemAt(lines, line);
  if (item.box === undefined) throw new Error(`Zeile ${line} hat kein Kästchen`);
  const box = item.box === ' ' ? 'x' : ' ';
  lines[line] = item.prefix.replace(/\[[ xX]\]/, `[${box}]`) + item.body + item.eol;
  return lines.join('\n');
}

/**
 * Ersetzt den sichtbaren Text eines Listenpunkts. Das Präfix bleibt, alle Marker bleiben in ihrer
 * Reihenfolge und wandern ans Zeilenende, getrennt durch je ein Leerzeichen. Wirft, wenn die Zeile
 * kein Listenpunkt ist.
 */
export function editItemText(md: string, line: number, text: string): string {
  const lines = md.split('\n');
  const item = itemAt(lines, line);
  const { markers } = splitMarkers(item.body);
  lines[line] = item.prefix + [cleanText(text), ...markers].filter(Boolean).join(' ') + item.eol;
  return lines.join('\n');
}

/**
 * Legt den Abschnitt an, falls er fehlt, und gibt den Zeilenindex seiner Überschrift zurück.
 * Er kommt vor den ersten vorhandenen Abschnitt, der laut `SECTION_ORDER` später folgt, sonst ans
 * Ende (so auch eine Überschrift, die nicht in `SECTION_ORDER` steht). Neue Zeilen haben das
 * Zeilenende der Notiz.
 */
export function ensureSection(md: string, heading: string): { md: string; line: number } {
  const sections = parseSections(md);
  const existing = sections.find((section) => section.heading === heading);
  if (existing) return { md, line: existing.start };

  const eol = eolOf(md);
  const lines = md.split('\n');
  const rank = SECTION_ORDER.indexOf(heading);
  const later = rank < 0 ? undefined : sections.find((section) => SECTION_ORDER.indexOf(section.heading) > rank);

  if (later) {
    // Direkt vor die spätere Überschrift. Die Leerzeile danach trennt den neuen Abschnitt von ihr,
    // davor steht normalerweise schon eine, sonst kommt eine dazu.
    const needsBlank = later.start > 0 && lines[later.start - 1].trim() !== '';
    const block = [...(needsBlank ? [''] : []), `## ${heading}`, ''];
    lines.splice(later.start, 0, ...block.map((text) => text + eol));
    return { md: lines.join('\n'), line: later.start + (needsBlank ? 1 : 0) };
  }

  // Ans Ende: genau eine Leerzeile davor, danach endet die Datei mit einem Zeilenumbruch.
  const unfinished = lines[lines.length - 1].trim() !== ''; // die Notiz endet ohne Zeilenumbruch
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  // Hinter der bisher letzten Zeile steht jetzt ein Umbruch, im Stil der Notiz.
  if (unfinished && !lines[lines.length - 1].endsWith(eol)) lines[lines.length - 1] += eol;
  const line = lines.length > 0 ? lines.length + 1 : 0;
  lines.push(...(lines.length > 0 ? [eol] : []), `## ${heading}${eol}`, '');
  return { md: lines.join('\n'), line };
}

/**
 * Hängt `- [ ] text` (mit Haken) oder `- text` unten an den Abschnitt „Ergänzungen“ an und legt ihn
 * bei Bedarf an. Ein Text ohne sichtbare Zeichen ändert nichts. Neue Zeilen haben das Zeilenende der
 * Notiz.
 */
export function appendErgaenzung(md: string, text: string, asTask: boolean): string {
  const clean = cleanText(text);
  if (!clean) return md;

  const ensured = ensureSection(md, ERGAENZUNGEN);
  const eol = eolOf(ensured.md);
  const lines = ensured.md.split('\n');

  // Die neue Zeile kommt hinter die letzte nicht leere Zeile des Abschnitts (sonst hinter die Überschrift).
  // Die Leerzeile vor der nächsten Überschrift bleibt dadurch erhalten. Wo der Abschnitt endet, sagt `parseSections`:
  // Eine Überschrift in einem Blockkommentar beendet ihn nicht, sonst läge die Zeile im versteckten Teil.
  const end = parseSections(ensured.md).find((section) => section.start === ensured.line)?.end ?? lines.length;
  let last = ensured.line;
  for (let i = ensured.line + 1; i < end; i++) {
    if (lines[i].trim() !== '') last = i;
  }
  const item = asTask ? `- [ ] ${clean}` : `- ${clean}`;
  // Nach einem Listenpunkt geht es direkt weiter, nach Überschrift oder Fließtext trennt eine Leerzeile.
  const added = (isItemLine(lines[last]) ? [item] : ['', item]).map((entry) => entry + eol);
  if (last === lines.length - 1) {
    // Die Notiz endet ohne Zeilenumbruch: Die bisher letzte Zeile bekommt jetzt einen, die neue bleibt die letzte.
    if (!lines[last].endsWith(eol)) lines[last] += eol;
    added[added.length - 1] = item;
  }
  lines.splice(last + 1, 0, ...added);
  return lines.join('\n');
}

/** Neue Tagesnotiz mit YAML-Kopf und Titel, noch ohne Abschnitte. */
export function newDailyNote(d: Day): string {
  return `---\ndate: ${d}\ntags: [daily]\n---\n# ${d}\n`;
}
