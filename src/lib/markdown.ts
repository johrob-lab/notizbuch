import MarkdownIt from 'markdown-it';
import type { StateCore, StateInline } from 'markdown-it';
import { parseItem, visibleLines } from './dailyNote';
import { isValidDay } from './dates';

// Ziel eines Wikilinks, das genau ein Tag ist, optional mit `#Abschnitt`.
const DAY_TARGET = /^(\d{4}-\d{2}-\d{2})(?:#.*)?$/;
const BOM = '\uFEFF';

/** Ersetzt den YAML-Kopf durch Leerzeilen: er wird nicht angezeigt, die Zeilennummern bleiben. */
function blankFrontmatter(lines: string[]): string[] {
  if (lines[0]?.trimEnd() !== '---') return lines;
  const end = lines.findIndex((line, i) => i > 0 && line.trimEnd() === '---');
  return end > 0 ? lines.map((line, i) => (i <= end ? '' : line)) : lines;
}

/**
 * `[[2026-10-28]]`, `[[2026-10-28#Abschnitt]]` und `[[2026-10-28|gestern]]` werden Links auf die Tagesseite,
 * jeder andere Wikilink wird nur sein Text (nach dem `|`, sonst der Linktext). Ein Datum, das es nicht
 * gibt (`[[2026-13-45]]`), ist kein Tag.
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
    if (day && isValidDay(day)) {
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

/**
 * `![[Datei.svg]]` ist ein eingebetteter Anhang. Die Karte zeigt ihn nicht, sie hat weder die Datei noch darf sie einen
 * Namen verraten: Es bleibt ein neutraler Hinweis „Anhang“. Ohne Ende (`![[offen`), ohne Namen (`![[]]`) oder mit einem
 * Zeilenumbruch darin ist es keine Einbettung und bleibt Text. Das Ausrufezeichen gehört dazu, auch das verschwindet.
 */
function embed(state: StateInline, silent: boolean): boolean {
  const { src, pos } = state;
  if (src.charCodeAt(pos) !== 0x21 || src.charCodeAt(pos + 1) !== 0x5b || src.charCodeAt(pos + 2) !== 0x5b) return false;
  const close = src.indexOf(']]', pos + 3);
  if (close < 0) return false;

  const inner = src.slice(pos + 3, close);
  if (/[\n[\]]/.test(inner) || !inner.trim()) return false;

  if (!silent) {
    // Eigenes HTML-Token mit festem Text: Nichts davon stammt aus der Notiz.
    state.push('html_inline', '', 0).content = '<span class="anhang">Anhang</span>';
  }
  state.pos = close + 2;
  return true;
}

/**
 * Tauscht `[ ]` / `[x]` am Anfang des Listenpunkts bei Token `i` gegen ein echtes Kästchen. Ob es
 * eins gibt und wie es steht (`box`), hat das Zeilenmodell schon entschieden.
 */
function replaceBox(state: StateCore, i: number, line: number, box: string): void {
  const inline = state.tokens[i + 2];
  if (state.tokens[i + 1]?.type !== 'paragraph_open' || inline?.type !== 'inline') return;
  const children = inline.children;
  const first = children?.[0];
  const mark = `[${box}]`;
  if (!children || first?.type !== 'text' || !first.content.startsWith(mark)) return;

  first.content = first.content.slice(mark.length);
  // Eigenes HTML-Token, nichts davon stammt aus dem Text der Notiz: nur die Zeilennummer steckt darin.
  const input = new state.Token('html_inline', '', 0);
  input.content = `<input type="checkbox" data-line="${line}"${box === ' ' ? '' : ' checked'}>`;
  children.unshift(input);
}

// Rohes HTML aus der Notiz bleibt aus (html: false): Text aus der Notiz wird nie zu Markup.
const parser = new MarkdownIt({ html: false });
parser.inline.ruler.before('link', 'wikilink', wikilink);
// Vor dem Bild: `![[…]]` beginnt wie ein Markdown-Bild, ist aber ein Anhang.
parser.inline.ruler.before('image', 'embed', embed);
parser.core.ruler.push('note_items', (state) => {
  // Die Zeilen der Notiz, wie sie in der Datei stehen (mit Markern): `token.map` zählt in denselben Zeilen.
  const lines = (state.env.lines ?? []) as string[];
  state.tokens.forEach((token, i) => {
    if (token.type !== 'list_item_open' || !token.map) return;
    const line = token.map[0];
    token.attrSet('data-line', String(line));
    // Ob es ein Kästchen gibt, entscheidet das Zeilenmodell auf der Quellzeile, nicht der Text, den
    // markdown-it sieht. So gibt es nur Kästchen, die toggleTask auch haken kann.
    const box = parseItem(lines[line] ?? '')?.box;
    if (box !== undefined) replaceBox(state, i, line, box);
  });
});

/**
 * Die Tagesnotiz als HTML. Jedes Listenelement trägt `data-line` mit dem Zeilenindex in der Notiz.
 * Aufgaben (`- [ ] ` und `- [x] `, wie `parseItem` sie kennt) haben ein Kästchen mit demselben
 * `data-line`; jede andere Zeile mit `[ ]` zeigt die Klammern als Text. Der YAML-Kopf, ein BOM am
 * Anfang und `%%…%%` erscheinen nicht. Nicht jedes `data-line` ist ein Eintrag im Zeilenmodell: In
 * Zitaten und in `*`- oder nummerierten Listen gibt es Listenelemente, die `isItemLine` nicht kennt.
 *
 * Mit `range` (Zeilenindex `start` bis `end`, exklusiv, in der Notiz) erscheinen nur diese Zeilen, zum Beispiel ein
 * Abschnitt. Die Zeilennummern bleiben die der ganzen Notiz, und Blockkommentare und der YAML-Kopf gelten weiter über
 * die ganze Notiz: Ein Kommentar, der in einem Abschnitt beginnt und im nächsten endet, versteckt auch dort seine Zeilen.
 */
export function renderNote(md: string, range?: { start: number; end: number }): string {
  const lines = (md.startsWith(BOM) ? md.slice(1) : md).split('\n');
  // markdown-it bekommt die Zeilen ohne Kopf, Marker und Kommentare, aber mit derselben Zeilenzahl.
  // Ein einzelnes \r mitten in der Zeile würde es als Zeilenumbruch zählen und alle Nummern verschieben.
  const shown = visibleLines(blankFrontmatter(lines)).map((line) => line.replace(/\r/g, ' '));
  // Außerhalb des Bereichs leere Zeilen statt weggelassener: So bleiben die Zeilennummern die der ganzen Notiz.
  const inRange = range ? shown.map((line, i) => (i >= range.start && i < range.end ? line : '')) : shown;
  return parser.render(inRange.join('\n'), { lines });
}
