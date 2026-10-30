import { h, type ComponentChildren } from 'preact';
import { isValidDay } from '../lib/dates';
import { isItemLine, parseItem, visibleText } from '../lib/dailyNote';
import { Icon } from './Toolbar';

// Die Tagesnotiz als Bauteile der Karte „Morgenbriefing“. Der Renderer (`renderNote`) liefert HTML mit Zeilennummern. Hier
// wird daraus kein Markup übernommen, sondern ein Baum aus Bauteilen: Nur bekannte Elemente kommen durch, ohne ihre Attribute,
// und Kästchen und Stift sind echte Elemente mit eigenen Handlern. Die Notiz enthält Text aus Mails und Kalendern, daraus
// darf nie etwas mit Wirkung werden (Skripte, Bilder, Formulare, Handler, Stile).

/** Was die Bauteile von der Karte brauchen. */
export type NoteContext = {
  /** Die Zeilen der Notiz, wie sie in der Datei stehen (mit Markern): Das `data-line` des HTML zählt in ihnen. */
  lines: string[];
  /** Die Zeile, die gerade bearbeitet wird, mit dem Text im Eingabefeld. */
  editing: { line: number; draft: string } | null;
  /** Ein Vorgang läuft: Ein Tipp auf ein Kästchen tut nichts. */
  busy: boolean;
  /** Ein Kästchen wurde angetippt: die Zeile und die Quellzeile, wie sie gezeigt wurde. */
  onToggle(line: number, source: string): void;
  /** Ein Stift wurde angetippt. */
  onEdit(line: number, source: string): void;
  /** Im Eingabefeld wurde getippt. */
  onDraft(text: string): void;
  /** Enter oder „Speichern“. */
  onSave(): void;
  /** Escape oder „Abbrechen“. */
  onCancel(): void;
};

/** Diese Elemente kommen so durch, ohne Attribute. */
const PLAIN = new Set(['p', 'ul', 'ol', 'blockquote', 'pre', 'code', 'em', 'strong', 'b', 'i', 's', 'del', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'br', 'hr']);
/** Diese Elemente fallen samt Inhalt weg. Alles andere Unbekannte fällt weg, sein Text bleibt. */
const DROPPED = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'img',
  'picture',
  'source',
  'video',
  'audio',
  'track',
  'canvas',
  'svg',
  'math',
  'link',
  'meta',
  'base',
  'head',
  'title',
  'template',
  'noscript',
  'textarea',
  'select',
  'option',
  'optgroup',
  'datalist',
  'button',
  'input',
  'dialog',
  'map',
  'area',
]);
/** Zwischen diesen Elementen ist Leerraum nur Zeilenumbruch im Text. */
const STRUCTURE = new Set(['ul', 'ol', 'table', 'thead', 'tbody', 'tr']);
/** Diese Elemente beenden den Text eines Listenpunkts: Was danach kommt, ist Untergliederung. */
const BLOCKS = new Set(['ul', 'ol', 'p', 'blockquote', 'pre', 'table', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6']);

/** Wohin ein Link führen darf: auf einen Tag der App oder ins Netz. Alles andere ist nur Text. */
function linkOf(href: string | null): { href: string; external: boolean } | null {
  if (href === null) return null;
  const day = /^#\/tag\/(\d{4}-\d{2}-\d{2})$/.exec(href)?.[1];
  if (day !== undefined) return isValidDay(day) ? { href, external: false } : null;
  return /^https?:\/\/[^\s]+$/i.test(href) ? { href, external: true } : null;
}

/**
 * Setzt den Cursor ans Ende, wenn das Feld erscheint, und holt das ganze Formular ins Bild (auch „Speichern“ und „Abbrechen“
 * unter dem Feld). Eine feste Funktion: Sie läuft nur beim Einsetzen, nicht bei jedem Zeichnen.
 */
function focusAtEnd(el: HTMLInputElement | null): void {
  if (!el) return;
  el.focus({ preventScroll: true });
  const end = el.value.length;
  el.setSelectionRange(end, end);
  el.closest('form')?.scrollIntoView?.({ block: 'nearest' });
}

function isElement(node: Node): node is Element {
  return node.nodeType === 1;
}

/** Die Knoten als Bauteile. In Listen und Tabellen ist Leerraum zwischen den Elementen nur Zeilenumbruch im Text. */
function convertNodes(nodes: Node[], ctx: NoteContext, structural: boolean): ComponentChildren[] {
  const out: ComponentChildren[] = [];
  for (const node of nodes) {
    if (node.nodeType === 3) {
      const text = node.nodeValue ?? '';
      if (!(structural && text.trim() === '')) out.push(text);
    } else if (isElement(node)) {
      out.push(convert(node, ctx));
    }
  }
  return out;
}

function children(parent: ParentNode, ctx: NoteContext): ComponentChildren[] {
  return convertNodes(Array.from(parent.childNodes), ctx, parent instanceof Element && STRUCTURE.has(parent.localName));
}

function convert(el: Element, ctx: NoteContext): ComponentChildren {
  const tag = el.localName;
  if (PLAIN.has(tag)) return h(tag, null, ...children(el, ctx));
  if (/^h[1-6]$/.test(tag)) return h('h4', null, ...children(el, ctx));
  if (tag === 'li') return item(el, ctx);
  if (tag === 'a') {
    const link = linkOf(el.getAttribute('href'));
    if (!link) return children(el, ctx);
    return link.external
      ? h('a', { href: link.href, target: '_blank', rel: 'noopener noreferrer' }, ...children(el, ctx))
      : h('a', { href: link.href }, ...children(el, ctx));
  }
  // Ein Anhang, den der Renderer durch einen Hinweis ersetzt hat. Der Text ist fest, er kommt nicht aus der Notiz.
  if (tag === 'span' && el.classList.contains('anhang')) return h('span', { class: 'anhang' }, 'Anhang');
  if (DROPPED.has(tag)) return null;
  return children(el, ctx);
}

/** Das Kästchen, das der Renderer vor den Text gesetzt hat. Die Karte zeichnet ihr eigenes (oder keins, siehe `item`). */
function isCheckbox(node: Node): boolean {
  return isElement(node) && node.localName === 'input' && node.getAttribute('type') === 'checkbox';
}

/**
 * Ein Listenpunkt. Er besteht aus Kästchen (bei einer Aufgabe), Text und Stift, danach kommt, was darunter gehört (eine
 * Untergliederung). Bei einer losen Liste steht der Text in einem Absatz: Auch dann ist es derselbe Aufbau.
 */
function item(li: Element, ctx: NoteContext): ComponentChildren {
  const raw = li.getAttribute('data-line');
  const line = raw !== null && /^\d+$/.test(raw) ? Number(raw) : -1;
  const found = line >= 0 ? ctx.lines[line] : undefined;
  // Nur ein Listenpunkt im Zeilenmodell bekommt Kästchen und Stift. Ein Listenelement in einem Zitat oder in einer
  // nummerierten Liste ist nur Text.
  const own = found !== undefined && isItemLine(found) ? found : null;
  const box = own === null ? undefined : parseItem(own)?.box;
  const editing = own !== null && ctx.editing !== null && ctx.editing.line === line;

  // Den Text vom Rest trennen: bei einer losen Liste der erste Absatz, sonst alles bis zum ersten Block.
  const nodes = Array.from(li.childNodes);
  const first = nodes.findIndex((node) => isElement(node) && BLOCKS.has(node.localName));
  const lead = first >= 0 ? nodes[first] : undefined;
  let textNodes: Node[];
  let rest: Node[];
  if (lead && isElement(lead) && lead.localName === 'p' && nodes.slice(0, first).every((node) => node.nodeType === 3 && (node.nodeValue ?? '').trim() === '')) {
    textNodes = Array.from(lead.childNodes);
    rest = nodes.slice(first + 1);
  } else if (first >= 0) {
    textNodes = nodes.slice(0, first);
    rest = nodes.slice(first);
  } else {
    textNodes = nodes;
    rest = [];
  }

  const name = own === null ? '' : visibleText(own);
  // Während ein Vorgang läuft, ist nichts gesperrt (`disabled`): Das ließe alle Kästchen bei jedem Haken kurz aufblinken und
  // nähme einem Kästchen, das gerade den Fokus hat, ihn weg. Ein Tipp in dieser Zeit tut nichts, und das Kästchen bleibt, wie es ist.
  const checkbox =
    own !== null && box !== undefined ? (
      <label class="haken-flaeche">
        <input
          type="checkbox"
          checked={box !== ' '}
          aria-label={name}
          disabled={editing}
          onClick={(e) => {
            if (ctx.busy) e.preventDefault();
          }}
          onChange={() => ctx.onToggle(line, own)}
        />
      </label>
    ) : null;

  return h(
    'li',
    { key: editing ? 'bearbeiten' : line >= 0 ? line : undefined, 'data-line': line >= 0 ? String(line) : undefined, class: own !== null ? 'eintrag' : undefined },
    checkbox,
    own !== null && box === undefined ? <span class="punkt" aria-hidden="true" /> : null,
    editing && ctx.editing ? (
      <form
        class="bearbeiten"
        onSubmit={(e) => {
          e.preventDefault();
          ctx.onSave();
        }}
      >
        <input
          type="text"
          aria-label="Text bearbeiten"
          value={ctx.editing.draft}
          autoComplete="off"
          enterKeyHint="done"
          ref={focusAtEnd}
          onInput={(e) => ctx.onDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            e.preventDefault();
            ctx.onCancel();
          }}
        />
        <button type="submit" class="knopf" disabled={ctx.busy}>
          Speichern
        </button>
        <button type="button" class="knopf" onClick={() => ctx.onCancel()}>
          Abbrechen
        </button>
      </form>
    ) : (
      <span class="text">{convertNodes(textNodes.filter((node) => !isCheckbox(node)), ctx, false)}</span>
    ),
    own !== null && !editing ? (
      <button type="button" class="stift" aria-label={`Bearbeiten: ${name}`} disabled={ctx.editing !== null} onClick={() => ctx.onEdit(line, own)}>
        <Icon name="pen" />
      </button>
    ) : null,
    ...convertNodes(rest, ctx, false),
  );
}

/** Die Notiz (oder ein Teil davon, wie `renderNote` ihn liefert) als Bauteile. */
export function noteToVNodes(html: string, ctx: NoteContext): ComponentChildren {
  const template = document.createElement('template');
  template.innerHTML = html;
  return children(template.content, ctx);
}
