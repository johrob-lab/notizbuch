import type { Prioritaet } from '../lib/prioritaeten';
import type { Termin } from '../lib/termine';

// Termine und Prioritäten eines Tages als kurze Textzeilen für Woche und Monat. Reine Rechnung ohne DOM:
// Die Breite wird geschätzt (`textWidth`), gezeichnet wird in `agendaMarks` (layouts.ts).

/** Ein Eintrag einer Zeile. `tone` bestimmt die Farbe: Termin, Priorität oder erledigte Priorität. */
export type AgendaItem = { text: string; tone: 'termin' | 'prio' | 'erledigt' };

/** Eine Zeile: die gezeigten Einträge und die Zahl der Einträge, die nicht mehr hineinpassten (nur in der letzten Zeile). */
export type AgendaLine = { items: AgendaItem[]; more: number };

const SEPARATOR = ' · ';
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

/** Geschätzte Breite eines Textes: 0,58 der Schriftgröße je Zeichen (ein Emoji zählt als ein Zeichen). */
export function textWidth(s: string, size: number): number {
  return Array.from(s).length * size * 0.58;
}

const joined = (list: AgendaItem[]): string => list.map((i) => i.text).join(SEPARATOR);

/** Der Text mit Ellipse am Ende, so dass er höchstens `width` breit ist. Passt nicht einmal die Ellipse, bleibt sie allein. */
function shorten(s: string, size: number, width: number): string {
  if (textWidth(s, size) <= width) return s;
  const chars = Array.from(s);
  while (chars.length > 0 && textWidth(chars.join('') + ELLIPSIS, size) > width) chars.pop();
  return chars.join('') + ELLIPSIS;
}

/**
 * Verteilt die Einträge auf höchstens `lines` Zeilen der Breite `width`. Ein Eintrag kommt in die laufende Zeile,
 * wenn er mit Trenner passt, sonst beginnt die nächste Zeile. Ein Eintrag, der allein nicht passt, wird mit Ellipse
 * gekürzt. Was nach der letzten Zeile übrig bleibt, steht als `more` in der letzten Zeile; dort muss " +N" mitpassen,
 * notfalls fällt der letzte Eintrag der Zeile weg.
 */
export function fitLines(items: AgendaItem[], lines: number, width: number, size: number): AgendaLine[] {
  const out: AgendaLine[] = [];
  let next = 0;
  for (let n = 0; n < lines && next < items.length; n++) {
    const last = n === lines - 1;
    let taken = 0;
    while (next + taken < items.length && textWidth(joined(items.slice(next, next + taken + 1)), size) <= width) taken++;
    let more = 0;
    if (last) {
      // " +N" muss mitpassen: so lange den letzten Eintrag weglassen, bis es stimmt.
      const rest = (k: number) => items.length - next - k;
      while (taken > 0 && rest(taken) > 0 && textWidth(`${joined(items.slice(next, next + taken))} +${rest(taken)}`, size) > width) taken--;
      more = rest(Math.max(taken, 1));
    }
    if (taken === 0) {
      // Der erste Eintrag passt allein nicht (in der letzten Zeile samt " +N"): kürzen.
      const room = width - (more > 0 ? textWidth(` +${more}`, size) : 0);
      out.push({ items: [{ ...items[next], text: shorten(items[next].text, size, room) }], more });
      next++;
    } else {
      out.push({ items: items.slice(next, next + taken), more });
      next += taken;
    }
  }
  return out;
}
