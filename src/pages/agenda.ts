import type { Geburtstag } from '../lib/geburtstage';
import type { Prioritaet } from '../lib/prioritaeten';
import type { Termin } from '../lib/termine';

// Geburtstage, Jahrestage, Termine und Prioritäten eines Tages als kurze Textzeilen für Woche und Monat (auf der Tagesseite
// nur die Geburtstage und Jahrestage). Reine Rechnung ohne DOM:
// Die Breite wird geschätzt (`textWidth`), gezeichnet wird in `agendaMarks` (layouts.ts).

/**
 * Ein Eintrag einer Zeile. `tone` bestimmt die Farbe: Geburtstag oder Jahrestag, Termin, Priorität oder erledigte Priorität.
 * `size` ist die Schriftgröße dieses Eintrags; fehlt sie, gilt die der Zeile.
 */
export type AgendaItem = { text: string; tone: 'geburtstag' | 'termin' | 'prio' | 'erledigt'; size?: number };

/** Alles, was ein Tag auf dem Bildschirm zeigt, so wie `agendaMarks` es braucht (Termine schon auf den Tag gefiltert und sortiert). Fehlt `geburtstage`, gibt es keine. */
export type AgendaDay = { geburtstage?: Geburtstag[]; termine: Termin[]; prioritaeten: Prioritaet[] };

/** Eine Zeile: die gezeigten Einträge und die Zahl der Einträge, die nicht mehr hineinpassten (nur in der letzten Zeile). */
export type AgendaLine = { items: AgendaItem[]; more: number };

/** Trenner zwischen zwei Einträgen einer Zeile. Gemessen (hier) und gezeichnet (`agendaMarks`) wird mit demselben Text. */
export const SEPARATOR = ' · ';

/** Der Rest am Ende der letzten Zeile: die Zahl der Einträge, die nicht mehr hineinpassten. */
export const moreLabel = (n: number): string => ` +${n}`;

const ELLIPSIS = '…';

/**
 * Die Termine eines Tages (schon auf einen Tag gefiltert und sortiert, siehe `termineAm`): ganztägige und solche
 * von 00:00 bis 23:59 zuerst (in der Reihenfolge der Eingabe) und nur mit Titel, die anderen als `HH:MM Titel` nach Beginn.
 */
export function terminItems(termine: Termin[]): AgendaItem[] {
  const wholeDay = (t: Termin) => t.allDay || (t.start === '00:00' && t.end === '23:59');
  const label = (t: Termin): AgendaItem => ({ text: wholeDay(t) ? t.title : `${t.start} ${t.title}`, tone: 'termin' });
  return [...termine.filter(wholeDay), ...termine.filter((t) => !wholeDay(t)).sort((a, b) => (a.start ?? '').localeCompare(b.start ?? ''))].map(label);
}

/** Prioritäten mit Pfeil, erledigte mit Haken. */
export function prioItems(list: Prioritaet[]): AgendaItem[] {
  return list.map((p) => (p.done ? { text: `✓ ${p.text}`, tone: 'erledigt' } : { text: `▸ ${p.text}`, tone: 'prio' }));
}

/**
 * Alle Geburtstage eines Tages als ein Eintrag: Geburtstage hinter einem Kuchen, Jahrestage dahinter hinter einem Herz,
 * jeweils durch Komma getrennt, in der Reihenfolge der Eingabe. Ohne Einträge `undefined`. `size` wird nur gesetzt, wenn übergeben.
 */
export function geburtstagItem(list: Geburtstag[], size?: number): AgendaItem | undefined {
  const names = (art: Geburtstag['art']) => list.filter((g) => g.art === art).map((g) => g.name).join(', ');
  const geburtstage = names('Geburtstag');
  const jahrestage = names('Jahrestag');
  const parts = [geburtstage ? `🎂 ${geburtstage}` : '', jahrestage ? `♥ ${jahrestage}` : ''].filter((x) => x !== '');
  if (parts.length === 0) return undefined;
  return { text: parts.join(' '), tone: 'geburtstag', ...(size !== undefined ? { size } : {}) };
}

/** Zusatz für die Liste „Tage dieser Seite“: zum Beispiel `1 Geburtstag, 2 Termine, 1 Priorität`. Was 0 ist, fehlt; ohne alles ist er leer. */
export function agendaInfo(day: AgendaDay): string {
  const geburtstage = (day.geburtstage ?? []).filter((g) => g.art === 'Geburtstag').length;
  const jahrestage = (day.geburtstage ?? []).filter((g) => g.art === 'Jahrestag').length;
  const termine = day.termine.length;
  const prioritaeten = day.prioritaeten.length;
  const parts: string[] = [];
  if (geburtstage > 0) parts.push(`${geburtstage} ${geburtstage === 1 ? 'Geburtstag' : 'Geburtstage'}`);
  if (jahrestage > 0) parts.push(`${jahrestage} ${jahrestage === 1 ? 'Jahrestag' : 'Jahrestage'}`);
  if (termine > 0) parts.push(`${termine} ${termine === 1 ? 'Termin' : 'Termine'}`);
  if (prioritaeten > 0) parts.push(`${prioritaeten} ${prioritaeten === 1 ? 'Priorität' : 'Prioritäten'}`);
  return parts.join(', ');
}

/** Breite eines Zeichens in Teilen der Schriftgröße (Schätzung): Versalien breiter, schmale Zeichen schmaler, Emoji am breitesten. */
function charFactor(ch: string): number {
  const cp = ch.codePointAt(0) ?? 0;
  if (cp >= 0x1f000) return 1.1;
  if ('MWmw'.includes(ch)) return 0.9;
  if (' ijl.,:;!\'|'.includes(ch)) return 0.32;
  if (ch !== ch.toLowerCase() && ch === ch.toUpperCase()) return 0.72;
  return 0.58;
}

/** Geschätzte Breite eines Textes: je Zeichen (Codepunkt) ein Faktor der Schriftgröße, siehe `charFactor`. */
export function textWidth(s: string, size: number): number {
  let sum = 0;
  for (const ch of Array.from(s)) sum += charFactor(ch);
  return sum * size;
}

/**
 * Kleine Toleranz, wenn `fitLines`, `shorten`, `wrapHead` und `withHead` prüfen, ob etwas in eine Zeile passt. Die Breiten sind Summen von Kommazahlen; was
 * rechnerisch genau passt, soll nicht an einem Rest aus der Rundung scheitern (sonst würde zum Beispiel `withHead` den
 * ersten Termin kürzen, obwohl er genau neben den Eintrag passt).
 */
const FIT_EPSILON = 1e-6;

/** Breite einer Reihe von Einträgen mit Trennern: jeder Eintrag mit seiner eigenen Größe, der Trenner mit der der Zeile. */
const rowWidth = (list: AgendaItem[], size: number): number =>
  list.reduce((sum, i, k) => sum + textWidth(i.text, i.size ?? size) + (k > 0 ? textWidth(SEPARATOR, size) : 0), 0);

/**
 * Der Text mit Ellipse am Ende (ohne Leerraum und ohne Komma davor), so dass er höchstens `width` breit ist. Passt nicht
 * einmal die Ellipse, gibt es `undefined`: Der Eintrag wird dann gar nicht gezeichnet. „Passt“ gilt mit derselben Toleranz
 * wie in `fitLines` (`FIT_EPSILON`): Sonst kürzte `withHead` die Geburtstage um ein, zwei Buchstaben, wenn sie mit dem
 * ersten Termin rechnerisch genau in die Zeile passen und nur ein Rest aus der Rundung fehlt.
 */
function shorten(s: string, size: number, width: number): string | undefined {
  if (textWidth(s, size) <= width + FIT_EPSILON) return s;
  if (textWidth(ELLIPSIS, size) > width + FIT_EPSILON) return undefined;
  const chars = Array.from(s);
  const cut = () => chars.join('').replace(/[\s,]+$/, '') + ELLIPSIS;
  while (chars.length > 0 && textWidth(cut(), size) > width + FIT_EPSILON) chars.pop();
  return cut();
}

/**
 * Verteilt die Einträge auf höchstens `lines` Zeilen. `width` ist die Breite einer Zeile oder eine Liste mit der Breite
 * je Zeile (ist sie kürzer als `lines`, gilt ihr letzter Wert weiter). Ein Eintrag kommt in die laufende Zeile,
 * wenn er mit Trenner passt, sonst beginnt die nächste Zeile. Ein Eintrag, der allein nicht passt, wird mit Ellipse
 * gekürzt. Was nach der letzten Zeile übrig bleibt, steht als `more` in der letzten Zeile; dort muss " +N" mitpassen,
 * notfalls fällt der letzte Eintrag der Zeile weg. Jeder Eintrag wird mit seiner eigenen Größe gemessen, sonst mit `size`.
 */
export function fitLines(items: AgendaItem[], lines: number, width: number | number[], size: number): AgendaLine[] {
  const widths = Array.isArray(width) ? width : [width];
  const out: AgendaLine[] = [];
  let next = 0;
  let row = 0;
  while (row < lines && next < items.length) {
    const last = row === lines - 1;
    const w = widths[Math.min(row, widths.length - 1)];
    let taken = 0;
    while (next + taken < items.length && rowWidth(items.slice(next, next + taken + 1), size) <= w + FIT_EPSILON) taken++;
    let more = 0;
    if (last) {
      // " +N" muss mitpassen: so lange den letzten Eintrag weglassen, bis es stimmt.
      const rest = (k: number) => items.length - next - k;
      while (taken > 0 && rest(taken) > 0 && rowWidth(items.slice(next, next + taken), size) + textWidth(moreLabel(rest(taken)), size) > w + FIT_EPSILON) taken--;
      more = rest(Math.max(taken, 1));
    }
    if (taken === 0) {
      // Der erste Eintrag passt allein nicht (in der letzten Zeile samt " +N"): kürzen. Reicht der Platz nicht einmal
      // für die Ellipse, wird er nicht gezeichnet: in der letzten Zeile endet damit alles, sonst zählt die Zeile neu.
      const room = w - (more > 0 ? textWidth(moreLabel(more), size) : 0);
      const text = shorten(items[next].text, items[next].size ?? size, room);
      if (text === undefined) {
        if (last) break;
        next++;
        continue;
      }
      out.push({ items: [{ ...items[next], text }], more });
      next++;
    } else {
      out.push({ items: items.slice(next, next + taken), more });
      next += taken;
    }
    row++;
  }
  return out;
}

/**
 * Anteil der Zeile 1, den die Geburtstage in jedem Fall behalten, wenn Termine folgen: Die Geburtstage werden nur so weit
 * gekürzt, wie der erste Termin es braucht, aber nie unter 40 %.
 */
export const HEAD_SHARE = 0.4;

/**
 * Der Eintrag der Geburtstage allein auf bis zu `lines` Zeilen. Passt er nicht in eine Zeile, bricht er nach einem
 * Namen um (nach „, “ oder vor „ ♥“), ohne zweiten Kuchen: Jede Zeile außer der letzten nimmt so viele ganze Namen, wie
 * hineinpassen (passt nicht einmal der erste, wird er gekürzt). Die letzte Zeile nimmt den Rest und endet notfalls mit
 * „…“. Keine Zeile ist breiter als `width`. Mit einer Zeile wie `fitLines([head], 1, …)`.
 */
function wrapHead(head: AgendaItem, lines: number, width: number, size: number): AgendaLine[] {
  const s = head.size ?? size;
  const out: AgendaLine[] = [];
  let text = head.text;
  while (text !== '' && out.length < lines) {
    let cut = text.length;
    if (out.length < lines - 1 && textWidth(text, s) > width + FIT_EPSILON) {
      // Stellen nach einem Namen: hinter dem Komma von „, “ und vor dem Leerzeichen von „ ♥“.
      const breaks = [...text.matchAll(/,(?= )| (?=♥)/g)].map((m) => m.index + (m[0] === ',' ? 1 : 0));
      cut = breaks.filter((b) => textWidth(text.slice(0, b), s) <= width + FIT_EPSILON).pop() ?? breaks[0] ?? text.length;
    }
    const shown = shorten(text.slice(0, cut), s, width);
    if (shown === undefined) break;
    out.push({ items: [{ ...head, text: shown }], more: 0 });
    text = text.slice(cut).trimStart();
  }
  return out;
}

/**
 * Die Geburtstage (`head`) als erster Eintrag der Zeile 1, dahinter die übrigen Einträge (`rest`, meist Termine).
 * Ohne `head` wie `fitLines`. Ohne `rest` darf `head` alle Zeilen nutzen und bricht nach einem Namen um (`wrapHead`).
 *
 * Der erste Termin steht in Zeile 1 oder, wenn zwei Zeilen frei sind, in Zeile 2. Mit mehr als einer Zeile gilt zuerst
 * der Fluss `fitLines([head, ...rest], …)`. Er bleibt, wenn darin `head` und der erste Eintrag von `rest` ungekürzt
 * stehen, nebeneinander oder untereinander, auch wenn spätere Einträge in „+N“ wandern. Hat `rest` genau einen Eintrag,
 * bleibt er immer, sobald dieser darin steht, ganz oder gekürzt: Dann bekommen Eintrag und Termin notfalls je eine ganze
 * Zeile, und es geht kein Termin verloren. Nie doppelt gekürzt: Wo beide so ganz Platz haben, und bei nur einem Termin
 * überhaupt, werden nicht Namen und Termin gekürzt, nur damit sie nebeneinander stehen.
 *
 * Sonst, und mit nur einer Zeile immer, gilt Variante C: `head` wird nur so weit mit Ellipse gekürzt, wie der erste
 * Eintrag von `rest` es braucht (samt Trenner und, wenn es nur eine Zeile gibt und weitere folgen, „ +N“), aber nie unter
 * `HEAD_SHARE * width`. Bekommt `head` mehr als diesen Anteil, steht der erste Eintrag von `rest` also ganz daneben.
 * `rest` fließt in den Rest von Zeile 1 und dann in die Zeilen darunter in voller Breite. Reicht der Rest von Zeile 1
 * nicht einmal für eine Ellipse, steht `head` allein und `rest` beginnt in Zeile 2 (gibt es nur eine Zeile, zählt `more`
 * die Einträge von `rest`). `more` zählt nur `rest`.
 */
export function withHead(head: AgendaItem | undefined, rest: AgendaItem[], lines: number, width: number, size: number): AgendaLine[] {
  if (!head) return fitLines(rest, lines, width, size);
  if (rest.length === 0) return wrapHead(head, lines, width, size);
  if (lines > 1) {
    const flow = fitLines([head, ...rest], lines, width, size);
    const [shownHead, shownFirst] = flow.flatMap((l) => l.items);
    const whole = shownHead?.text === head.text && shownFirst?.text === rest[0].text;
    if (whole || (rest.length === 1 && shownFirst !== undefined)) return flow;
  }
  const headSize = head.size ?? size;
  const plus = lines === 1 && rest.length > 1 ? textWidth(moreLabel(rest.length - 1), size) : 0;
  const need = textWidth(SEPARATOR, size) + textWidth(rest[0].text, rest[0].size ?? size) + plus;
  const text = shorten(head.text, headSize, Math.max(HEAD_SHARE * width, width - need));
  if (text === undefined) return fitLines(rest, lines, width, size);
  const shown: AgendaItem = { ...head, text };
  const avail = width - textWidth(text, headSize) - textWidth(SEPARATOR, size);
  const first = fitLines(rest, lines, [avail, width], size);
  if (first.length === 0 || (lines > 1 && textWidth(ELLIPSIS, size) > avail + FIT_EPSILON)) {
    // Neben `head` ist kein Platz für einen Eintrag: `head` steht allein, `rest` beginnt in Zeile 2.
    const below = lines > 1 ? fitLines(rest, lines - 1, width, size) : [];
    return [{ items: [shown], more: lines > 1 ? 0 : rest.length }, ...below];
  }
  return [{ items: [shown, ...first[0].items], more: first[0].more }, ...first.slice(1)];
}
