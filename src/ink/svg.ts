import { isValidDay, weekDays } from '../lib/dates';
import { fmtNum, parsePathD, pathD } from './stroke';
import {
  INK,
  PAGE_H,
  PAGE_W,
  type FieldBox,
  type InkColor,
  type Page,
  type PageKind,
  type Pt,
  type Stroke,
} from './types';

// Eine Seite ist eine SVG-Datei: Kopfdaten als data-Attribute am <svg>, eine Hintergrundgruppe für Papier, Rahmen
// und Feldnamen (beim Lesen ignoriert) und je Feld eine Gruppe mit den Strichen, die dort liegen. Ein Strich ist
// ein <path>. Schreiben ist reine Textarbeit und braucht keinen DOM. Nur Lesen und Zusammenführen brauchen
// den DOMParser.

const SVG_NS = 'http://www.w3.org/2000/svg';
const PAGE_KINDS: readonly string[] = ['tag', 'woche', 'monat', 'besprechung'];
const INK_COLORS: readonly string[] = Object.keys(INK);
/** Gruppe für Striche, die in keinem Feld liegen. */
const FREI = 'frei';
/** Kopfangaben der Datei. Als Meta-Schlüssel gäben sie doppelte Attribute und machten die Datei unlesbar. */
const HEADER_KEYS = new Set(['notizbuch', 'seite', 'schluessel']);
const META_KEY = /^[a-z][a-z0-9]*$/;

type Attr = [name: string, value: string];

// ---------- Text für XML ----------

// Zeichen, die XML 1.0 nirgends erlaubt: Steuerzeichen außer Tab, Zeilenumbruch und Wagenrücklauf, einzelne
// Surrogate sowie U+FFFE und U+FFFF. Ein einziges davon macht die ganze Datei für den Browser unlesbar.
const INVALID_XML_CHARS = /[^\t\n\r\u{20}-\u{D7FF}\u{E000}-\u{FFFD}\u{10000}-\u{10FFFF}]/gu;
const ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  '\n': '&#10;',
  '\r': '&#13;',
  '\t': '&#9;',
};

function stripInvalid(text: string): string {
  return text.replace(INVALID_XML_CHARS, '');
}

/** Wert eines Attributs. Zeilenumbruch und Tab werden Zeichenverweise, sonst machen Parser Leerzeichen daraus. */
function escAttr(value: string): string {
  return stripInvalid(String(value)).replace(/[&<>"\n\r\t]/g, (c) => ESCAPES[c]);
}

function escText(text: string): string {
  return stripInvalid(text).replace(/[&<>]/g, (c) => ESCAPES[c]);
}

function attrs(list: Attr[]): string {
  return list.map(([name, value]) => ` ${name}="${escAttr(value)}"`).join('');
}

// ---------- Schreiben ----------

/** Ein <path> je Strich, alle Zahlen mit höchstens einer Nachkommastelle. */
function strokeMarkup(s: Stroke): string {
  return `<path${attrs([
    ['data-id', s.id],
    ['data-werkzeug', s.tool],
    ['data-farbe', s.color],
    ['data-breite', fmtNum(s.widthMm)],
    ['data-t', fmtNum(s.t)],
    ['d', pathD(s.pts)],
    ['fill', 'none'],
    ['stroke', INK[s.color]],
    ['stroke-width', fmtNum(s.w)],
    ['stroke-linecap', 'round'],
    ['stroke-linejoin', 'round'],
  ])}/>`;
}

/** Index des ersten Feldes, das die Mitte des Rahmens um die Punkte enthält (Ränder zählen mit), sonst -1. */
function fieldIndex(fields: FieldBox[], pts: Pt[]): number {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  return fields.findIndex(({ rect: [x, y, w, h] }) => cx >= x && cx <= x + w && cy >= y && cy <= y + h);
}

/**
 * Datum der Gruppe „frei“: bei einem Tag der Schlüssel, bei einer Besprechung ihr Datum, bei einer Woche der Montag,
 * bei einem Monat der Erste. Lässt sich aus der Seite kein Datum ableiten, ist es leer. Das Speichern bricht deshalb
 * nie ab (`weekDays` wirft bei einem kaputten Schlüssel).
 */
function pageDate(p: Page): string {
  let day = '';
  if (p.kind === 'tag') day = p.key;
  else if (p.kind === 'besprechung') day = p.meta.datum ?? '';
  else if (p.kind === 'monat') day = `${p.key}-01`;
  else if (/^\d{4}-W\d{2}$/.test(p.key)) day = weekDays(p.key)[0];
  return isValidDay(day) ? day : '';
}

/** Eine Feldgruppe, wie sie in der Datei steht: `paths` sind fertige <path>-Texte. */
type OutGroup = { feld: string; datum: string; paths: string[] };

function writeSvg(head: Pick<Page, 'kind' | 'key' | 'meta'>, background: string, groups: OutGroup[]): string {
  const root: Attr[] = [
    ['xmlns', SVG_NS],
    ['viewBox', `0 0 ${PAGE_W} ${PAGE_H}`],
    ['width', String(PAGE_W)],
    ['height', String(PAGE_H)],
    ['data-notizbuch', '1'],
    ['data-seite', head.kind],
    ['data-schluessel', head.key],
  ];
  for (const [key, value] of Object.entries(head.meta)) {
    if (META_KEY.test(key) && !HEADER_KEYS.has(key)) root.push([`data-${key}`, value]);
  }
  const lines = [`<svg${attrs(root)}>`, `  <g data-hintergrund="1">${background}</g>`];
  for (const g of groups) {
    if (!g.paths.length) continue;
    const open: Attr[] = [['data-feld', g.feld]];
    if (g.datum) open.push(['data-datum', g.datum]);
    lines.push(`  <g${attrs(open)}>`, ...g.paths.map((path) => `    ${path}`), '  </g>');
  }
  lines.push('</svg>', '');
  return lines.join('\n');
}

/**
 * Schreibt eine Seite als SVG-Text. `background` ist fertiges SVG für die Hintergrundgruppe (Papier, Rahmen,
 * Feldnamen), nur unzulässige XML-Zeichen werden daraus entfernt. Ein Strich kommt in das erste Feld, das die Mitte seines Rahmens enthält, sonst in die Gruppe „frei“.
 * Die Gruppen stehen in der Reihenfolge der Felder, „frei“ zuletzt, und nur wenn sie Striche enthalten. Striche ohne
 * Punkte werden nicht geschrieben. Meta-Daten werden zu `data-<schlüssel>` am <svg>, Schlüssel außerhalb von
 * `[a-z][a-z0-9]*` fallen weg.
 */
export function serializePage(p: Page, fields: FieldBox[], background: string): string {
  const groups: OutGroup[] = fields.map((f) => ({ feld: f.id, datum: f.datum, paths: [] }));
  const frei: OutGroup = { feld: FREI, datum: pageDate(p), paths: [] };
  for (const s of p.strokes) {
    if (!s.pts.length) continue;
    const i = fieldIndex(fields, s.pts);
    (i < 0 ? frei : groups[i]).paths.push(strokeMarkup(s));
  }
  return writeSvg(p, stripInvalid(background), [...groups, frei]);
}

// ---------- Lesen ----------

/** Ein gelesener Strich mit seinem <path>, aus dem das Zusammenführen den Text noch einmal schreibt. */
type Item = { stroke: Stroke; el: Element };
type Group = { feld: string; datum: string; items: Item[] };
type Doc = { head: Pick<Page, 'kind' | 'key' | 'meta'>; background: Element | null; groups: Group[] };

/** Zahl aus einem Attribut, `null` wenn das Attribut fehlt, leer ist oder keine endliche Zahl enthält. */
function toNumber(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Der Strich zu einem <path>, oder `null`, wenn ein Attribut fehlt oder nicht stimmt. */
function readStroke(el: Element): Stroke | null {
  const id = el.getAttribute('data-id');
  const t = toNumber(el.getAttribute('data-t'));
  const widthMm = toNumber(el.getAttribute('data-breite'));
  const w = toNumber(el.getAttribute('stroke-width'));
  const points = parsePathD(el.getAttribute('d') ?? '');
  if (!id || t === null || widthMm === null || w === null || !points.length) return null;
  const farbe = el.getAttribute('data-farbe') ?? '';
  const color = INK_COLORS.includes(farbe) ? (farbe as InkColor) : 'schwarz';
  return { id, tool: 'kugel', color, widthMm, t, w, pts: points.map((p) => ({ x: p.x, y: p.y, w })) };
}

function readDoc(svg: string): Doc {
  // Ein Byte-Order-Mark am Anfang (Windows-Editoren speichern „UTF-8 mit BOM“) ist für den Browser ein XML-Fehler.
  const text = svg.charCodeAt(0) === 0xfeff ? svg.slice(1) : svg;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  } catch (cause) {
    throw new Error('Die Datei ist kein gültiges SVG.', { cause });
  }
  // Browser melden einen Fehler nicht als Ausnahme, sondern legen ein <parsererror> in das Dokument.
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('Die Datei ist kein gültiges SVG.');
  const root = doc.documentElement;
  if (!root || root.localName !== 'svg' || root.getAttribute('data-notizbuch') !== '1') {
    throw new Error('Die Datei ist keine Seite des Notizbuchs.');
  }
  const kind = root.getAttribute('data-seite') ?? '';
  if (!PAGE_KINDS.includes(kind)) throw new Error(`Unbekannter Seitentyp „${kind}“.`);

  const meta: Record<string, string> = {};
  for (const a of Array.from(root.attributes)) {
    const key = a.name.slice(5);
    if (a.name.startsWith('data-') && !HEADER_KEYS.has(key)) meta[key] = a.value;
  }

  let background: Element | null = null;
  const groups: Group[] = [];
  for (const g of Array.from(root.children)) {
    if (g.localName !== 'g') continue;
    if (g.hasAttribute('data-hintergrund')) {
      background ??= g;
      continue;
    }
    const items: Item[] = [];
    for (const el of Array.from(g.children)) {
      const stroke = el.localName === 'path' ? readStroke(el) : null;
      if (stroke) items.push({ stroke, el });
    }
    groups.push({ feld: g.getAttribute('data-feld') ?? FREI, datum: g.getAttribute('data-datum') ?? '', items });
  }
  const pageKey = root.getAttribute('data-schluessel') ?? '';
  return { head: { kind: kind as PageKind, key: pageKey, meta }, background, groups };
}

/**
 * Liest eine Seite. Der Hintergrund wird ignoriert. Ein Strich mit fehlenden oder falschen Angaben wird übersprungen,
 * eine unbekannte Farbe wird schwarz. Jeder Punkt eines gelesenen Strichs hat als Breite die Breite des Strichs. Wirft
 * einen Fehler, wenn die Datei kein SVG ist, keine Seite des Notizbuchs oder von einem unbekannten Seitentyp. Fehlt
 * der Schlüssel, ist er leer.
 */
export function parsePage(svg: string): Page {
  const { head, groups } = readDoc(svg);
  return { ...head, strokes: groups.flatMap((g) => g.items.map((item) => item.stroke)) };
}

// ---------- Zusammenführen ----------

/** Der Text zu einem Knoten, so wie ihn das Schreiben auch macht: Anführungszeichen, leere Elemente als `<x/>`. */
function markup(node: Node): string {
  switch (node.nodeType) {
    case 1: {
      const el = node as Element;
      const open = el.tagName + attrs(Array.from(el.attributes, (a): Attr => [a.name, a.value]));
      const inner = Array.from(el.childNodes, (child) => markup(child)).join('');
      return inner ? `<${open}>${inner}</${el.tagName}>` : `<${open}/>`;
    }
    case 3: // Text
    case 4: // CDATA
      return escText(node.nodeValue ?? '');
    case 8: // Kommentar
      return `<!--${node.nodeValue ?? ''}-->`;
    default:
      return '';
  }
}

/** Der <path> eines Strichs mit genau seinen Attributen, so bleibt er beim Zusammenführen unverändert. */
function pathMarkup(el: Element): string {
  return `<path${attrs(Array.from(el.attributes, (a): Attr => [a.name, a.value]))}/>`;
}

/**
 * Führt zwei Fassungen derselben Seite zusammen: alle Striche beider, ein Strich mit gleicher `id` nur einmal, und
 * zwar der von `oursSvg`. Kopfdaten und Hintergrund kommen von `oursSvg`. Ein Strich bleibt in der Feldgruppe
 * (`data-feld` und `data-datum`), in der er in seiner Datei stand. Zuerst stehen die Gruppen von `oursSvg` mit ihren
 * Strichen, dahinter die Striche von `theirsSvg`, die `oursSvg` nicht hat, jeweils am Ende ihrer Gruppe in ihrer
 * Reihenfolge. Gruppen, die nur `theirsSvg` hat, kommen hinter die von `oursSvg`, die Gruppen „frei“ zuletzt. Das
 * Ergebnis ist eine gültige Seite, und noch einmal mit derselben Fassung zusammengeführt bleibt es gleich.
 * Wirft wie `parsePage`, wenn eine der Dateien keine lesbare Seite ist.
 */
export function mergePages(oursSvg: string, theirsSvg: string): string {
  const ours = readDoc(oursSvg);
  const theirs = readDoc(theirsSvg);
  const groups: OutGroup[] = ours.groups.map((g) => ({
    feld: g.feld,
    datum: g.datum,
    paths: g.items.map((item) => pathMarkup(item.el)),
  }));
  const seen = new Set(ours.groups.flatMap((g) => g.items.map((item) => item.stroke.id)));
  for (const g of theirs.groups) {
    for (const item of g.items) {
      if (seen.has(item.stroke.id)) continue;
      seen.add(item.stroke.id);
      let target = groups.find((x) => x.feld === g.feld && x.datum === g.datum);
      if (!target) {
        target = { feld: g.feld, datum: g.datum, paths: [] };
        groups.push(target);
      }
      target.paths.push(pathMarkup(item.el));
    }
  }
  const ordered = [...groups.filter((g) => g.feld !== FREI), ...groups.filter((g) => g.feld === FREI)];
  const background = ours.background ? Array.from(ours.background.childNodes, (child) => markup(child)).join('') : '';
  return writeSvg(ours.head, background, ordered);
}
