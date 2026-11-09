import type { Geburtstag } from '../lib/geburtstage';
import type { Prioritaet } from '../lib/prioritaeten';
import type { Termin } from '../lib/termine';

// Geburtstage, Jahrestage, Termine und Prioritäten eines Tages als kurze Textzeilen für Woche und Monat (auf der Tagesseite
// nur die Geburtstage und Jahrestage). Reine Rechnung ohne DOM:
// Die Breite wird geschätzt (`textWidth`), gezeichnet wird in `agendaMarks` (layouts.ts).

/** Ein Eintrag einer Zeile. `tone` bestimmt die Farbe: Geburtstag oder Jahrestag, Termin, Priorität oder erledigte Priorität. */
export type AgendaItem = { text: string; tone: 'geburtstag' | 'termin' | 'prio' | 'erledigt' };

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

/** Geburtstage mit Kuchen, Jahrestage mit Herz, in der Reihenfolge der Eingabe. */
export function geburtstagItems(list: Geburtstag[]): AgendaItem[] {
  return list.map((g) => ({ text: `${g.art === 'Jahrestag' ? '♥' : '🎂'} ${g.name}`, tone: 'geburtstag' }));
}

/** Zusatz für die Liste „Tage dieser Seite“: zum Beispiel `1 Geburtstag, 2 Termine, 1 Priorität`. Was 0 ist, fehlt; ohne alles ist er leer. */
export function agendaInfo(day: AgendaDay): string {
  const geburtstage = (day.geburtstage ?? []).filter((g) => g.art === 'Geburtstag').length;
  const jahrestage = (day.geburtstage ?? []).length - geburtstage;
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

const joined = (list: AgendaItem[]): string => list.map((i) => i.text).join(SEPARATOR);

/**
 * Der Text mit Ellipse am Ende (ohne Leerraum davor), so dass er höchstens `width` breit ist. Passt nicht einmal die
 * Ellipse, gibt es `undefined`: Der Eintrag wird dann gar nicht gezeichnet.
 */
function shorten(s: string, size: number, width: number): string | undefined {
  if (textWidth(s, size) <= width) return s;
  if (textWidth(ELLIPSIS, size) > width) return undefined;
  const chars = Array.from(s);
  while (chars.length > 0 && textWidth(chars.join('').trimEnd() + ELLIPSIS, size) > width) chars.pop();
  return chars.join('').trimEnd() + ELLIPSIS;
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
  let row = 0;
  while (row < lines && next < items.length) {
    const last = row === lines - 1;
    let taken = 0;
    while (next + taken < items.length && textWidth(joined(items.slice(next, next + taken + 1)), size) <= width) taken++;
    let more = 0;
    if (last) {
      // " +N" muss mitpassen: so lange den letzten Eintrag weglassen, bis es stimmt.
      const rest = (k: number) => items.length - next - k;
      while (taken > 0 && rest(taken) > 0 && textWidth(joined(items.slice(next, next + taken)) + moreLabel(rest(taken)), size) > width) taken--;
      more = rest(Math.max(taken, 1));
    }
    if (taken === 0) {
      // Der erste Eintrag passt allein nicht (in der letzten Zeile samt " +N"): kürzen. Reicht der Platz nicht einmal
      // für die Ellipse, wird er nicht gezeichnet: in der letzten Zeile endet damit alles, sonst zählt die Zeile neu.
      const room = width - (more > 0 ? textWidth(moreLabel(more), size) : 0);
      const text = shorten(items[next].text, size, room);
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
