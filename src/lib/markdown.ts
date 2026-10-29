import MarkdownIt from 'markdown-it';
import type { StateCore, StateInline } from 'markdown-it';

// Kommentare `%%…%%`, auch über mehrere Zeilen. Ein `%%` ohne Ende gilt bis zum Zeilenende.
const COMMENT = /%%[\s\S]*?%%|%%.*$/gm;
// Ziel eines Wikilinks, das genau ein Tag ist, optional mit `#Abschnitt`.
const DAY_TARGET = /^(\d{4}-\d{2}-\d{2})(?:#.*)?$/;
// Kästchen am Anfang eines Listenpunkts.
const TASK_BOX = /^\[([ xX])\](?=\s|$)/;

/** Nur die Zeilenumbrüche bleiben übrig, damit die Zeilennummern der Notiz stimmen. */
function keepLineBreaks(text: string): string {
  return text.replace(/[^\n]/g, '');
}

/** Ersetzt den YAML-Kopf durch Leerzeilen: er wird nicht angezeigt, die Zeilennummern bleiben. */
function blankFrontmatter(lines: string[]): void {
  if (lines[0]?.trimEnd() !== '---') return;
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  if (end > 0) lines.fill('', 0, end + 1);
}

/**
 * `[[2026-10-28]]`, `[[2026-10-28#Abschnitt]]` und `[[2026-10-28|gestern]]` werden Links auf die Tagesseite,
 * jeder andere Wikilink wird nur sein Text (nach dem `|`, sonst der Linktext).
 */
function wikilink(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x5b || src.charCodeAt(pos + 1) !== 0x5b) return false;
  const close = src.indexOf(']]', pos + 2);
  if (close < 0) return false;

  const inner = src.slice(pos + 2, close);
  if (/[\n[\]]/.test(inner)) return false;
  const bar = inner.indexOf('|');
  const target = (bar < 0 ? inner : inner.slice(0, bar)).trim();
  const label = (bar < 0 ? '' : inner.slice(bar + 1).trim()) || target;
  if (!target) return false;

  if (!silent) {
    const day = DAY_TARGET.exec(target)?.[1];
    if (day) {
      state.push('link_open', 'a', 1).attrs = [['href', `#/tag/${day}`]];
      state.push('text', '', 0).content = label;
      state.push('link_close', 'a', -1);
    } else {
      state.push('text', '', 0).content = label;
    }
  }
  state.pos = close + 2;
  return true;
}

/** Tauscht das Kästchen `[ ] ` am Anfang des Listenpunkts bei Token `i` gegen ein echtes Kästchen. */
function replaceBox(state: StateCore, i: number, line: number): void {
  const inline = state.tokens[i + 2];
  if (state.tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') return;
  const box = TASK_BOX.exec(inline.content);
  const children = inline.children;
  const first = children?.[0];
  if (!box || !children || first?.type !== 'text' || !first.content.startsWith(box[0])) return;

  first.content = first.content.slice(box[0].length);
  // Eigenes HTML-Token, nichts davon stammt aus dem Text der Notiz: nur die Zeilennummer steckt darin.
  const input = new state.Token('html_inline', '', 0);
  input.content = `<input type="checkbox" data-line="${line}"${box[1] === ' ' ? '' : ' checked'}>`;
  children.unshift(input);
}

// Rohes HTML aus der Notiz bleibt aus (html: false): Text aus der Notiz wird nie zu Markup.
const parser = new MarkdownIt({ html: false });
parser.inline.ruler.before('link', 'wikilink', wikilink);
parser.core.ruler.push('note_items', (state) => {
  state.tokens.forEach((token, i) => {
    if (token.type !== 'list_item_open' || !token.map) return;
    const line = token.map[0];
    token.attrSet('data-line', String(line));
    // Kästchen nur bei `- `: Nur dort kann toggleTask den Haken setzen.
    if (token.markup === '-') replaceBox(state, i, line);
  });
});

/**
 * Die Tagesnotiz als HTML. Jedes Listenelement trägt `data-line` mit dem Zeilenindex in der Notiz,
 * Aufgaben haben ein Kästchen mit demselben `data-line`. Der YAML-Kopf und `%%…%%` erscheinen nicht.
 */
export function renderNote(md: string): string {
  const lines = md.split('\n');
  blankFrontmatter(lines);
  return parser.render(lines.join('\n').replace(COMMENT, keepLineBreaks));
}
