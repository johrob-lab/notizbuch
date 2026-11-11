import { escAttr, escText } from '../ink/svg';
import { MM, PAGE_H, PAGE_W, PAPER, type FieldBox, type PageKind } from '../ink/types';
import { formatDayLong, isValidDay, isoWeekKey, monthGrid, monthKey, MONTHS, weekDays, type Day } from '../lib/dates';
import { besprechungBase } from '../lib/filenames';
import { holidaysAT } from '../lib/holidays';
import { fitLines, geburtstagItem, moreLabel, prioItems, SEPARATOR, terminItems, textWidth, withHead, type AgendaDay, type AgendaItem } from './agenda';

export type { AgendaDay } from './agenda';

// Aufbau der Seiten. Ein Layout sagt, wo auf der Seite geschrieben wird (Felder), wo später Karten liegen und wie
// das Papier aussieht (Hintergrund als SVG-Text für Papier, Rahmen, Linien und Feldnamen). Alles hier ist reine
// Rechnung ohne DOM und ohne Uhr: Dieselbe Eingabe ergibt denselben Text. Was von heute abhängt, steht nur in
// `todayMarks` und kommt nie in die Datei.

/** Ein Rechteck auf der Seite: Ecke oben links, Breite, Höhe (Seiteneinheiten). */
export type Rect = [x: number, y: number, w: number, h: number];

export type Layout = {
  kind: PageKind;
  key: string;
  /**
   * Die Schreibfelder. Sie überlappen nicht, denn ein Strich gehört in das Feld, das seine Mitte enthält. `paper`: liniert
   * im Abstand von 7 mm, liniert im Abstand von 6 mm (die Tage der Woche) oder ohne Linien.
   */
  fields: (FieldBox & { label: string; paper: 'liniert7' | 'liniert6' | 'blanko' })[];
  /** Plätze für Karten, die später aus Text bestehen (Morgenbriefing, Kalender, Besprechungen). */
  cards: { id: string; rect: Rect }[];
  /** Papier, Rahmen, Linien und Beschriftung als SVG-Text für `serializePage`. Beim Aufruf immer derselbe Text. */
  background(): string;
};

// ---------- Maße (Seiteneinheiten, 6 je Millimeter) ----------

const LINE = 7 * MM; // Zeilenabstand 7 mm
const LEFT = 48;
const WIDTH = 1040; // Inhalt von 48 bis 1088, rechts bleibt Platz für die Monatsreiter
const RIGHT = LEFT + WIDTH;
const TOP = 144; // unter dem Seitenkopf
const FRAME_HEAD = 44; // Platz für den Feldnamen oben im Rahmen
const FRAME_FOOT = 8;
const INSET = 12; // Abstand der Linien zum Rand des Rahmens
const DAY_HEAD = 50; // Kopfzeile eines Tagesfeldes in der Woche
const TAP_HEIGHT = 68; // Tippfläche am oberen Rand eines Tagesfeldes: 44 px ab einer Ansicht von 0,65
const GRID_X = 80; // Monatsraster: links die Spalte der Kalenderwochen, dann 7 Spalten
const GRID_Y = TOP + 36;
const CELL_W = 144;
const CELL_H = 112;
const MEETING_HEAD = 200; // Kopfbereich der Besprechung, frei für Eingabefelder
const MEETING_MARGIN = 20 * MM; // roter Rand bei 20 mm

const COLOR = {
  text: '#2e3630',
  muted: '#5f6862',
  faint: '#7d877f',
  dim: '#a3aca5',
  label: '#44634c',
  ring: '#59695e',
  frame: '#d9deda',
  rule: '#c9d3cb',
  line: '#dfe5e0',
  soft: '#f5f7f5',
  header: '#e4ebe4',
  outside: '#fafbfa',
  check: '#6f7f73',
  holiday: '#a8674f',
  holidayFill: '#f8efea',
  holidayLine: '#ead9d1',
  ruled: '#cfdcea',
  margin: '#e29a9a',
};

const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
const WEEKDAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

// ---------- SVG-Text ----------

type Attrs = Record<string, string | number>;

const num = (v: number): string => String(Math.round(v * 100) / 100);
const attrs = (a: Attrs): string =>
  Object.entries(a)
    .map(([name, value]) => ` ${name}="${escAttr(typeof value === 'number' ? num(value) : value)}"`)
    .join('');
const rect = ([x, y, w, h]: Rect, a: Attrs = {}): string =>
  `<rect x="${num(x)}" y="${num(y)}" width="${num(w)}" height="${num(h)}"${attrs(a)}/>`;
const circle = (cx: number, cy: number, r: number, a: Attrs): string =>
  `<circle cx="${num(cx)}" cy="${num(cy)}" r="${num(r)}"${attrs(a)}/>`;
const text = (x: number, y: number, s: string, a: Attrs = {}): string =>
  `<text x="${num(x)}" y="${num(y)}"${attrs({ 'font-family': FONT, ...a })}>${escText(s)}</text>`;

/** Linien im Abstand `step` (sonst 7 mm): `rows` Stück, die erste eine Zeile unter `y`, die letzte am Ende des Feldes. */
function ruling(x: number, y: number, w: number, rows: number, color: string, step = LINE): string {
  let d = '';
  for (let i = 1; i <= rows; i++) d += `M${num(x)} ${num(y + i * step)}h${num(w)}`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2"/>`;
}

/** Ein Text, der höchstens `max` Zeichen lang ist und sonst mit einer Ellipse endet. */
function clip(s: string, max: number): string {
  const chars = Array.from(s);
  return chars.length > max ? `${chars.slice(0, max - 1).join('')}…` : s;
}

/** Ein Rahmen mit dem Feldnamen in Großbuchstaben oben links. */
function frame(r: Rect, label: string, fill = 'none'): string {
  return (
    rect(r, { rx: 12, fill, stroke: COLOR.frame, 'stroke-width': 1.5 }) +
    text(r[0] + 20, r[1] + 29, label.toUpperCase(), { 'font-size': 14, 'font-weight': 700, 'letter-spacing': 0.8, fill: COLOR.label })
  );
}

/** Das Schreibfeld in einem Rahmen: unter dem Namen, so viele ganze Zeilen, wie hineinpassen. */
function fieldIn(r: Rect): Rect {
  const rows = Math.floor((r[3] - FRAME_HEAD - FRAME_FOOT) / LINE);
  return [r[0] + INSET, r[1] + FRAME_HEAD, r[2] - 2 * INSET, rows * LINE];
}

function ruledField(f: Rect, bullets = false): string {
  const rows = f[3] / LINE;
  let marks = '';
  if (bullets) {
    for (let i = 0; i < rows; i++) marks += circle(f[0] + 14, f[1] + i * LINE + LINE / 2, 7.5, { fill: 'none', stroke: COLOR.check, 'stroke-width': 1.5 });
  }
  return ruling(f[0], f[1], f[2], rows, COLOR.line) + marks;
}

/** Seitenkopf: Titel, Untertitel und Linie. An einem Feiertag liegt der Kopf auf dem Farbton des Planers. */
function head(title: string, sub: string, holiday?: string): string {
  const ink = holiday ? COLOR.holiday : COLOR.text;
  return (
    (holiday ? rect([LEFT, 34, WIDTH, 84], { rx: 12, fill: COLOR.holidayFill }) : '') +
    text(LEFT + 16, 80, title, { 'font-size': 40, 'font-weight': 700, fill: ink }) +
    text(LEFT + 16, 106, sub, { 'font-size': 16, fill: holiday ? COLOR.holiday : COLOR.muted }) +
    (holiday ? text(RIGHT - 16, 80, holiday, { 'font-size': 20, 'font-weight': 700, 'text-anchor': 'end', fill: COLOR.holiday }) : '') +
    rect([LEFT, 124, WIDTH, 1.5], { fill: COLOR.rule })
  );
}

const paper = (): string => rect([0, 0, PAGE_W, PAGE_H], { fill: PAPER });
const foot = (s: string): string => text(LEFT, PAGE_H - 16, s, { 'font-size': 12, fill: COLOR.faint });

/** Einmal gebaut, danach immer derselbe Text. */
function once(build: () => string): () => string {
  let built: string | undefined;
  return () => (built ??= build());
}

// ---------- Tage ----------

const dayNumber = (d: Day): number => Number(d.slice(8, 10));
const weekdayIndex = (d: Day): number => weekDays(isoWeekKey(d)).indexOf(d);

/** Der Name des Feiertags eines Tages, falls es einer ist. Merkt sich die Jahre. */
function holidayLookup(): (d: Day) => string | undefined {
  const years = new Map<string, Map<Day, string>>();
  return (d) => {
    const year = d.slice(0, 4);
    let names = years.get(year);
    if (!names) years.set(year, (names = holidaysAT(Number(year))));
    return names.get(d);
  };
}

// ---------- Tag ----------

// Links Morgenbriefing und Notizen (628 breit), rechts daneben Kalender, Besprechungen, Prioritäten und Aufgaben (388).
const COLUMN_L = 628;
const COLUMN_R = 388;
const RIGHT_X = LEFT + COLUMN_L + 24;
const TAG_CARDS: { id: string; label: string; rect: Rect; fill: string }[] = [
  { id: 'briefing', label: 'Morgenbriefing', rect: [LEFT, TOP, COLUMN_L, 486], fill: COLOR.soft },
  { id: 'kalender', label: 'Kalender', rect: [RIGHT_X, TOP, COLUMN_R, 256], fill: 'none' },
  { id: 'besprechungen', label: 'Besprechungen', rect: [RIGHT_X, TOP + 272, COLUMN_R, 214], fill: 'none' },
];
const TAG_FIELDS: { id: string; label: string; frame: Rect; fill: string; bullets: boolean }[] = [
  { id: 'notizen', label: 'Notizen', frame: [LEFT, 652, COLUMN_L, 892], fill: 'none', bullets: false },
  { id: 'prioritaeten', label: 'Prioritäten', frame: [RIGHT_X, 652, COLUMN_R, 178], fill: COLOR.soft, bullets: true },
  { id: 'aufgaben', label: 'Aufgaben', frame: [RIGHT_X, 848, COLUMN_R, 696], fill: 'none', bullets: true },
];

export function tagLayout(d: Day): Layout {
  const holiday = holidayLookup()(d);
  const fields = TAG_FIELDS.map((f) => ({ id: f.id, rect: fieldIn(f.frame), datum: d, label: f.label, paper: 'liniert7' as const }));
  return {
    kind: 'tag',
    key: d,
    fields,
    cards: TAG_CARDS.map(({ id, rect: r }) => ({ id, rect: r })),
    background: once(() => {
      const week = isoWeekKey(d);
      const title = `${WEEKDAYS[weekdayIndex(d)]}, ${dayNumber(d)}. ${MONTHS[Number(d.slice(5, 7)) - 1]} ${d.slice(0, 4)}`;
      return (
        paper() +
        head(title, `KW ${week.slice(6)} / ${week.slice(0, 4)} · Tagesseite`, holiday) +
        TAG_CARDS.map((c) => frame(c.rect, c.label, c.fill)).join('') +
        TAG_FIELDS.map((f, i) => frame(f.frame, f.label, f.fill) + ruledField(fields[i].rect, f.bullets)).join('') +
        foot(`Tagesseite · ${formatDayLong(d)}`)
      );
    }),
  };
}

// ---------- Woche ----------

// Links sieben gleich hohe Tage, jeder mit Kopfzeile und vier Linien im Abstand von 6 mm (7 mm passen siebenmal nicht auf
// die Seite). Rechts daneben von oben nach unten: der gedruckte Monatskalender mit der Zeile dieser Woche, dann die
// Rahmen für Wochenziele, Prioritäten und Aufgaben (mit Kreisen) und Notizen. Die vier Rahmen enden zusammen mit dem
// letzten Tag bei 1550.
const WEEK_COLUMN = 600;
const WEEK_GAP = 8;
const WEEK_ROWS = 4;
const WEEK_LINE = 6 * MM;
const WEEK_DAY = DAY_HEAD + WEEK_ROWS * WEEK_LINE;
const SIDE_X = LEFT + WEEK_COLUMN + 24; // linker Rand der rechten Spalte
const SIDE_W = WIDTH - WEEK_COLUMN - 24; // Breite der Rahmen rechts (416)
const SIDE_GAP = 16; // Abstand zwischen den Rahmen rechts
const CAL_HEIGHT = 320;
const CAL_HEAD = 68; // Rahmenkopf mit Monatsname und die Kopfzeile der Wochentage
const CAL_ROW = 40; // Höhe einer Zeile des Kalenders
const CAL_WEEK_W = 42; // Spalte der Kalenderwochen
const CAL_COL = 50; // Breite einer Tagesspalte
const CAL_X = SIDE_X + INSET + CAL_WEEK_W; // linker Rand der Tagesspalten (726)
const CAL_Y = TOP + CAL_HEAD; // oberer Rand der ersten Zeile (212)
// Wochenziele (5 Zeilen, getönt), Prioritäten und Aufgaben (9), Notizen (7)
const SIDE_FIELDS: { id: string; label: string; rows: number; fill: string; bullets: boolean }[] = [
  { id: 'ziele', label: 'Wochenziele', rows: 5, fill: COLOR.soft, bullets: false },
  { id: 'aufgaben', label: 'Prioritäten und Aufgaben', rows: 9, fill: 'none', bullets: true },
  { id: 'notizen', label: 'Notizen', rows: 7, fill: 'none', bullets: false },
];

/** Ein Tag im gedruckten Kalender: Zelle, ob er zum Monat gehört, und sein Feiertag (nur bei Tagen des Monats). */
export type CalendarDay = { day: Day; rect: Rect; inMonth: boolean; holiday?: string };

/**
 * Der gedruckte Monatskalender rechts oben auf der Wochenseite: der Monat des Donnerstags der Woche, 42 Tage in der
 * Reihenfolge von `monthGrid`, und `weekRow`, die Zeile (0 bis 5), die mit dem Montag der Woche beginnt.
 */
export type WeekCalendar = { month: string; frame: Rect; days: CalendarDay[]; weekRow: number };

export function weekCalendar(weekKey: string): WeekCalendar {
  const week = weekDays(weekKey);
  const month = monthKey(week[3]);
  const holiday = holidayLookup();
  const grid = monthGrid(month);
  const days = grid.flatMap((row, r) =>
    row.map((day, c): CalendarDay => {
      const inMonth = monthKey(day) === month;
      const name = inMonth ? holiday(day) : undefined;
      return { day, rect: [CAL_X + c * CAL_COL, CAL_Y + r * CAL_ROW, CAL_COL, CAL_ROW], inMonth, ...(name ? { holiday: name } : {}) };
    }),
  );
  return { month, frame: [SIDE_X, TOP, SIDE_W, CAL_HEIGHT], days, weekRow: grid.findIndex((row) => row[0] === week[0]) };
}

export function wocheLayout(weekKey: string): Layout {
  const days = weekDays(weekKey);
  const holiday = holidayLookup();
  const sections = days.map((_, i): Rect => [LEFT, TOP + i * (WEEK_DAY + WEEK_GAP), WEEK_COLUMN, WEEK_DAY]);
  const cal = weekCalendar(weekKey);
  // Die Rahmen rechts untereinander: der erste beginnt unter dem Kalender, jeder so hoch wie Kopf, Zeilen und Fuß.
  let top = TOP + CAL_HEIGHT + SIDE_GAP;
  const side = SIDE_FIELDS.map((f) => {
    const frameRect: Rect = [SIDE_X, top, SIDE_W, FRAME_HEAD + f.rows * LINE + FRAME_FOOT];
    top += frameRect[3] + SIDE_GAP;
    return { ...f, frame: frameRect, rect: fieldIn(frameRect) };
  });
  const fields: Layout['fields'] = [
    ...days.map((day, i) => ({ id: `tag-${day}`, rect: sections[i], datum: day, label: `${WEEKDAYS[i]} ${dayNumber(day)}`, paper: 'liniert6' as const })),
    ...side.map((f) => ({ id: f.id, rect: f.rect, datum: days[0], label: f.label, paper: 'liniert7' as const })),
  ];
  return {
    kind: 'woche',
    key: weekKey,
    fields,
    cards: [],
    background: once(() => {
      const [first, last] = [days[0], days[6]];
      const from = `${dayNumber(first)}. ${MONTHS[Number(first.slice(5, 7)) - 1]}${first.slice(0, 4) === last.slice(0, 4) ? '' : ` ${first.slice(0, 4)}`}`;
      const to = `${dayNumber(last)}. ${MONTHS[Number(last.slice(5, 7)) - 1]} ${last.slice(0, 4)}`;
      const sectionsSvg = days.map((day, i) => {
        const [x, top, w] = sections[i];
        const name = holiday(day);
        const tint = name ? COLOR.holidayFill : i >= 5 ? COLOR.soft : 'none';
        const ink = name ? COLOR.holiday : COLOR.text;
        // Die Linie unter der Kopfzeile endet dort, wo die erste Zeile beginnt: alle vier Zeilen gleich hoch.
        return (
          (tint === 'none' ? '' : rect(sections[i], { rx: 12, fill: tint })) +
          text(x + 14, top + 36, String(dayNumber(day)).padStart(2, '0'), { 'font-size': 28, 'font-weight': 700, fill: ink }) +
          text(x + 62, top + 36, WEEKDAYS[i], { 'font-size': 18, 'font-weight': 700, fill: ink }) +
          (name ? text(x + w - 14, top + 36, name, { 'font-size': 14, 'font-weight': 700, 'text-anchor': 'end', fill: COLOR.holiday }) : '') +
          rect([x + INSET, top + DAY_HEAD - 1.5, w - 2 * INSET, 1.5], { fill: name ? COLOR.holiday : COLOR.ring }) +
          ruling(x + INSET, top + DAY_HEAD, w - 2 * INSET, WEEK_ROWS, name ? COLOR.holidayLine : COLOR.line, WEEK_LINE)
        );
      });
      // Kalender: Rahmen, Band hinter der Zeile dieser Woche, Kopfzeile, Kalenderwochen, Tageszahlen
      const weekdayHead = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'];
      const headMark = (x: number, s: string) => text(x, TOP + 62, s, { 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle', fill: COLOR.muted });
      const calendarSvg =
        frame(cal.frame, `${MONTHS[Number(cal.month.slice(5)) - 1]} ${cal.month.slice(0, 4)}`) +
        rect([SIDE_X + INSET, CAL_Y + CAL_ROW * cal.weekRow, SIDE_W - 2 * INSET, CAL_ROW], { rx: 8, fill: COLOR.header }) +
        headMark(CAL_X - CAL_WEEK_W / 2, 'KW') +
        weekdayHead.map((s, c) => headMark(CAL_X + c * CAL_COL + CAL_COL / 2, s)).join('') +
        Array.from({ length: 6 }, (_, r) =>
          text(CAL_X - CAL_WEEK_W / 2, CAL_Y + r * CAL_ROW + 25, isoWeekKey(cal.days[r * 7].day).slice(6), { 'font-size': 12, 'text-anchor': 'middle', fill: COLOR.muted }),
        ).join('') +
        cal.days
          .map((c) => {
            const [x, y, w] = c.rect;
            const ink = !c.inMonth ? COLOR.dim : c.holiday ? COLOR.holiday : COLOR.text;
            return text(x + w / 2, y + 26, String(dayNumber(c.day)), { 'font-size': 16, 'font-weight': c.holiday ? 700 : 400, 'text-anchor': 'middle', fill: ink });
          })
          .join('');
      return (
        paper() +
        head(`Woche ${weekKey.slice(6)}`, `${from} bis ${to}`) +
        sectionsSvg.join('') +
        calendarSvg +
        side.map((f) => frame(f.frame, f.label, f.fill) + ruledField(f.rect, f.bullets)).join('') +
        foot(`Wochenseite · KW ${weekKey.slice(6)} / ${weekKey.slice(0, 4)}`)
      );
    }),
  };
}

// ---------- Monat ----------

export function monatLayout(month: string): Layout {
  const grid = monthGrid(month);
  const holiday = holidayLookup();
  const cell = (row: number, col: number): Rect => [GRID_X + col * CELL_W, GRID_Y + row * CELL_H, CELL_W, CELL_H];
  const fields: Layout['fields'] = [];
  grid.forEach((days, row) =>
    days.forEach((day, col) => {
      if (day.startsWith(month)) fields.push({ id: `tag-${day}`, rect: cell(row, col), datum: day, label: `${WEEKDAYS[col]} ${dayNumber(day)}`, paper: 'blanko' });
    }),
  );
  const goals: Rect = [LEFT, GRID_Y + 6 * CELL_H + 22, WIDTH, FRAME_HEAD + 14 * LINE + FRAME_FOOT];
  fields.push({ id: 'monat', rect: fieldIn(goals), datum: `${month}-01`, label: 'Monatsziele und Notizen', paper: 'liniert7' });
  return {
    kind: 'monat',
    key: month,
    fields,
    cards: [],
    background: once(() => {
      const heads = WEEKDAYS.map((name, col) => {
        const weekend = col >= 5;
        const r: Rect = [GRID_X + col * CELL_W, TOP, CELL_W, 36];
        return (
          rect(r, { fill: weekend ? COLOR.soft : COLOR.header, stroke: COLOR.frame }) +
          text(r[0] + CELL_W / 2, r[1] + 24, name, { 'font-size': 14, 'font-weight': 700, 'text-anchor': 'middle', fill: COLOR.text })
        );
      }).join('');
      const weeks = grid
        .map((days, row) => {
          const r: Rect = [LEFT, GRID_Y + row * CELL_H, GRID_X - LEFT, CELL_H];
          const [cx, cy] = [r[0] + r[2] / 2, r[1] + r[3] / 2];
          return (
            rect(r, { fill: COLOR.soft, stroke: COLOR.frame }) +
            text(cx, cy + 4, `KW ${isoWeekKey(days[0]).slice(6)}`, { 'font-size': 12, 'font-weight': 700, 'text-anchor': 'middle', fill: COLOR.ring, transform: `rotate(-90 ${num(cx)} ${num(cy)})` })
          );
        })
        .join('');
      const cells = grid
        .flatMap((days, row) => days.map((day, col) => ({ day, r: cell(row, col), col })))
        .map(({ day, r, col }) => {
          const inMonth = day.startsWith(month);
          const name = inMonth ? holiday(day) : undefined;
          const fill = !inMonth ? COLOR.outside : name ? COLOR.holidayFill : col >= 5 ? COLOR.soft : 'none';
          const ink = !inMonth ? COLOR.dim : name ? COLOR.holiday : COLOR.text;
          return (
            rect(r, { fill, stroke: COLOR.frame }) +
            text(r[0] + r[2] - 10, r[1] + 29, String(dayNumber(day)).padStart(2, '0'), { 'font-size': 20, 'font-weight': inMonth ? 700 : 400, 'text-anchor': 'end', fill: ink }) +
            (name ? text(r[0] + 8, r[1] + r[3] - 9, name, { 'font-size': 11, 'font-weight': 700, fill: COLOR.holiday }) : '')
          );
        })
        .join('');
      return (
        paper() +
        head(`${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`, 'Monatsplaner') +
        heads +
        weeks +
        cells +
        frame(goals, 'Monatsziele und Notizen', COLOR.soft) +
        ruledField(fieldIn(goals)) +
        foot(`Monatsseite · ${MONTHS[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`)
      );
    }),
  };
}

// ---------- Besprechung ----------

const MEETING_ROWS = 32;

/** `meta` sind die Kopfangaben der Seite: thema, datum, zeit, ort, projekt, seitennr. Fehlende Angaben bleiben leer. */
export function besprechungLayout(meta: Record<string, string>): Layout {
  const datum = isValidDay(meta.datum ?? '') ? meta.datum : '';
  const page = /^[1-9]\d{0,3}$/.test(meta.seitennr ?? '') ? meta.seitennr : '1';
  const field: Rect = [0, MEETING_HEAD, PAGE_W, MEETING_ROWS * LINE];
  return {
    kind: 'besprechung',
    key: datum ? besprechungBase(datum, meta.zeit ?? '', meta.thema ?? '') : '',
    fields: [{ id: 'besprechung', rect: field, datum, label: 'Besprechung', paper: 'liniert7' }],
    cards: [],
    background: once(() => {
      const when = [datum ? formatDayLong(datum) : '', meta.zeit ?? '', meta.ort ?? ''].filter(Boolean).join(' · ');
      return (
        paper() +
        rect([0, 0, PAGE_W, MEETING_HEAD], { fill: COLOR.soft }) +
        rect([0, MEETING_HEAD - 2, PAGE_W, 2], { fill: COLOR.frame }) +
        text(LEFT, 80, clip(meta.thema?.trim() || 'Besprechung', 36), { 'font-size': 34, 'font-weight': 700, fill: COLOR.text }) +
        text(RIGHT, 80, `Seite ${page}`, { 'font-size': 16, 'text-anchor': 'end', fill: COLOR.muted }) +
        (when ? text(LEFT, 120, clip(when, 70), { 'font-size': 18, fill: COLOR.muted }) : '') +
        (meta.projekt ? text(LEFT, 154, clip(meta.projekt, 70), { 'font-size': 16, fill: COLOR.label }) : '') +
        ruling(field[0], field[1], field[2], MEETING_ROWS, COLOR.ruled) +
        rect([MEETING_MARGIN, MEETING_HEAD, 1.5, field[3]], { fill: COLOR.margin }) +
        foot(`Besprechung${datum ? ` · ${formatDayLong(datum)}` : ''}`)
      );
    }),
  };
}

// ---------- Tippen und Heute ----------

/** Eine Fläche, die ein Fingertipp oder Mausklick trifft: Sie öffnet die Tagesseite von `day`. */
export type TapTarget = { rect: Rect; day: Day; label: string };

/**
 * In Woche und Monat öffnet ein Tipp auf die Tageszahl die Tagesseite. Die Tippfläche ist der obere Rand des
 * Tagesfeldes, so hoch, dass sie auf dem iPad mindestens 44 px misst. Geschrieben wird dort trotzdem: Der Stift tippt nie.
 */
export function tapTargets(l: Layout): TapTarget[] {
  if (l.kind !== 'woche' && l.kind !== 'monat') return [];
  const holiday = holidayLookup();
  return l.fields
    .filter((f) => f.id.startsWith('tag-'))
    .map((f) => {
      const name = holiday(f.datum);
      return {
        rect: [f.rect[0], f.rect[1], f.rect[2], Math.min(f.rect[3], TAP_HEIGHT)],
        day: f.datum,
        label: name ? `${formatDayLong(f.datum)}, ${name}` : formatDayLong(f.datum),
      };
    });
}

/** Das Ziel an einer Stelle der Seite, falls dort eines liegt. Der untere und rechte Rand gehören nicht mehr dazu. */
export function tapTargetAt(targets: TapTarget[], x: number, y: number): TapTarget | null {
  return targets.find(({ rect: [rx, ry, w, h] }) => x >= rx && x < rx + w && y >= ry && y < ry + h) ?? null;
}

/**
 * Markierung für heute, als SVG-Text über dem Hintergrund. Sie steht nur auf dem Bildschirm und nie in der Datei,
 * damit eine Seite von gestern nicht für immer „heute“ zeigt. Leer, wenn die Seite den Tag nicht zeigt.
 */
export function todayMarks(l: Layout, today: Day): string {
  const f = l.fields.find((x) => x.id === `tag-${today}`);
  if (!f || (l.kind !== 'woche' && l.kind !== 'monat')) return '';
  const [x, y, w, h] = f.rect;
  if (l.kind === 'woche') return rect(f.rect, { rx: 12, fill: 'none', stroke: COLOR.ring, 'stroke-width': 2.5 });
  return (
    rect([x + 1, y + 1, w - 2, h - 2], { fill: 'none', stroke: COLOR.ring, 'stroke-width': 2.5 }) +
    circle(x + w - 22, y + 22, 19, { fill: 'none', stroke: COLOR.ring, 'stroke-width': 1.5 })
  );
}

// Schriftgröße des Eintrags der Geburtstage: kleiner als die Termine (Woche 13, Monat 10,5). In der Woche passen so mehr
// Namen und ein Termin daneben, im Monat mehr Namen in die Zeile, die den Geburtstagen gehört.
const WEEK_BIRTHDAY_SIZE = 11;
const MONTH_BIRTHDAY_SIZE = 9;

const AGENDA_COLOR = { geburtstag: COLOR.holiday, termin: '#55657a', prio: '#3d434d', erledigt: '#9aa1a9' };

// Tagesseite: Die Geburtstage stehen rechts in der Zeile des Untertitels (Grundlinie 106), also unter dem Namen eines
// Feiertags (Grundlinie 80). Die Fläche beginnt rechts vom Untertitel und endet am rechten Rand des Kopfes.
const DAY_BIRTHDAY_AREA: Rect = [340, 88, 732, 26];
const DAY_BIRTHDAY_BASELINE = 106;

/**
 * Eine Zeile als `<text>` mit einem `<tspan>` je Eintrag. Der Trenner hat die Farbe der Termine, der Rest " +N" die der
 * Prioritäten, wenn die Zeile mit einer Priorität beginnt, sonst die der Termine. Mit `anchor` ist `x` das rechte Ende.
 * Ein Eintrag mit eigener Größe (`size`) schreibt sie als `font-size` an seinen `<tspan>`.
 */
function agendaLine(x: number, y: number, size: number, items: AgendaItem[], more: number, anchor?: 'end'): string {
  const span = (s: string, color: string, own?: number) => `<tspan fill="${color}"${own !== undefined ? ` font-size="${own}"` : ''}>${escText(s)}</tspan>`;
  const body = items.map((i) => span(i.text, AGENDA_COLOR[i.tone], i.size)).join(span(SEPARATOR, AGENDA_COLOR.termin));
  const prioFirst = items[0].tone === 'prio' || items[0].tone === 'erledigt';
  const rest = more > 0 ? span(moreLabel(more), prioFirst ? AGENDA_COLOR.prio : AGENDA_COLOR.termin) : '';
  return `<text x="${num(x)}" y="${num(y)}"${attrs({ 'font-family': FONT, 'font-size': size, ...(anchor ? { 'text-anchor': anchor } : {}) })}>${body}${rest}</text>`;
}

/** Tagesseite: die Geburtstage des Tages als ein Eintrag rechtsbündig in der Zeile des Untertitels, sonst leer. */
function dayHeadMarks(l: Layout, dayData: (day: Day) => AgendaDay): string {
  const head = geburtstagItem(dayData(l.key).geburtstage ?? []);
  const lines = head ? fitLines([head], 1, DAY_BIRTHDAY_AREA[2], 16) : [];
  if (lines.length === 0) return '';
  const id = `agenda-${l.key}`;
  const [ax, , aw] = DAY_BIRTHDAY_AREA;
  return (
    `<clipPath id="${id}">${rect(DAY_BIRTHDAY_AREA)}</clipPath>` +
    `<g clip-path="url(#${id})">${agendaLine(ax + aw, DAY_BIRTHDAY_BASELINE, 16, lines[0].items, lines[0].more, 'end')}</g>`
  );
}

/**
 * Geburtstage, Termine und Prioritäten eines Tages als SVG-Text über dem Hintergrund, nur auf dem Bildschirm und nie
 * in der Datei (wie `todayMarks`). Woche: in der Kopfzeile des Tages rechts von Tageszahl und Wochentag, links vom
 * Feiertagsnamen, Zeile 1 Geburtstage und Termine, Zeile 2 Prioritäten; gibt es nur eine Art, bekommt sie beide
 * Zeilen. Alle Geburtstage eines Tages stehen in einem kleineren Eintrag vorn, daneben beginnt der erste Termin: Die
 * Geburtstage werden nur so weit gekürzt, wie der erste Termin es braucht, aber nie unter 40 %. Ist Zeile 2 frei und
 * passen Eintrag und erster Termin nicht nebeneinander, steht der Termin in Zeile 2, wenn beide untereinander ganz passen
 * oder wenn es der einzige Termin ist (`withHead`). Ohne Termine bricht der Eintrag nach einem Namen in Zeile 2 um, wenn
 * sie frei ist. Monat: nur Geburtstage und Termine, oben links in der Zelle, links von Tageszahl und Kreis für heute.
 * Zeile 1 gehört den Geburtstagen (ganze Breite), Zeile 2 den Terminen (mindestens einer, weitere als „+N“); ohne
 * Termine dürfen die Geburtstage beide Zeilen nutzen, ohne Geburtstage die Termine. Tag: nur die Geburtstage,
 * rechtsbündig in der Zeile des Untertitels. Jede Fläche hat ein Clip-Rechteck, damit nie etwas darüber hinausläuft.
 * Leer für die Besprechung und für Tage ohne Daten.
 */
export function agendaMarks(l: Layout, dayData: (day: Day) => AgendaDay): string {
  if (l.kind === 'tag') return dayHeadMarks(l, dayData);
  if (l.kind !== 'woche' && l.kind !== 'monat') return '';
  const holiday = holidayLookup();
  let out = '';
  for (const f of l.fields) {
    if (!f.id.startsWith('tag-')) continue;
    const day = f.id.slice(4);
    const { geburtstage, termine, prioritaeten } = dayData(day);
    const head = geburtstagItem(geburtstage ?? [], l.kind === 'woche' ? WEEK_BIRTHDAY_SIZE : MONTH_BIRTHDAY_SIZE);
    const items = terminItems(termine);
    const prios = l.kind === 'woche' ? prioItems(prioritaeten) : [];
    const hasGruppe = head !== undefined || items.length > 0;
    if (!hasGruppe && prios.length === 0) continue;
    const [x, y, w] = f.rect;
    let area: Rect;
    let size: number;
    let baselines: [number, number];
    let rows: ReturnType<typeof fitLines>[];
    if (l.kind === 'woche') {
      // Der Feiertagsname ist fett und rechtsbündig: seine Breite mit Zuschlag für Fett rechnen, dazu 12 Abstand.
      const name = holiday(day);
      const right = x + w - 14 - (name ? textWidth(name, 14 * 1.1) + 12 : 0);
      area = [x + 190, y + 4, right - (x + 190), 42];
      size = 13;
      baselines = [y + 20, y + 38];
      const both = hasGruppe && prios.length > 0;
      rows = both
        ? [withHead(head, items, 1, area[2], size), fitLines(prios, 1, area[2], size)]
        : [hasGruppe ? withHead(head, items, 2, area[2], size) : fitLines(prios, 2, area[2], size)];
    } else {
      area = [x + 8, y + 4, 92, 28];
      size = 10.5;
      baselines = [y + 15, y + 28];
      // Mit Geburtstagen und Terminen gehört Zeile 1 dem Eintrag der Geburtstage (ganze Breite) und Zeile 2 den Terminen
      // (mindestens einer, weitere als „+N“): 40 % von 92 ließen nur „🎂 Max…“ übrig. `fitLines` macht genau das, weil der
      // Eintrag als erster allein oder vorn in Zeile 1 steht und „+N“ nur Termine zählt; nur ein sehr kurzes Paar teilt sich
      // Zeile 1. Sonst wie `withHead`: ohne Termine nutzen die Geburtstage beide Zeilen, ohne Geburtstage die Termine.
      rows = [head && items.length > 0 ? fitLines([head, ...items], 2, area[2], size) : withHead(head, items, 2, area[2], size)];
    }
    const lines = rows.flat();
    if (area[2] <= 0 || lines.length === 0) continue;
    const id = `agenda-${day}`;
    out +=
      `<clipPath id="${id}">${rect(area)}</clipPath>` +
      `<g clip-path="url(#${id})">${lines.map((line, i) => agendaLine(area[0], baselines[i], size, line.items, line.more)).join('')}</g>`;
  }
  return out;
}
