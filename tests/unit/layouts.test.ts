import { afterEach, describe, expect, test, vi } from 'vitest';
import { mergePages, parsePage, serializePage } from '../../src/ink/svg';
import { MM, PAGE_H, PAGE_W, type Page } from '../../src/ink/types';
import { monthGrid, weekDays } from '../../src/lib/dates';
import type { Geburtstag } from '../../src/lib/geburtstage';
import type { Termin } from '../../src/lib/termine';
import { textWidth } from '../../src/pages/agenda';
import {
  agendaMarks,
  besprechungLayout,
  monatLayout,
  tagLayout,
  tapTargetAt,
  tapTargets,
  todayMarks,
  wocheLayout,
  type AgendaDay,
  type Layout,
} from '../../src/pages/layouts';

afterEach(() => {
  vi.useRealTimers();
});

const MEETING = { thema: 'Abstimmung Muster 2027', datum: '2026-10-29', zeit: '08:00', ort: 'Musterort', projekt: 'Beispielprojekt A', seitennr: '2' };

function allLayouts(): Layout[] {
  const months = Array.from({ length: 12 }, (_, i) => `2026-${String(i + 1).padStart(2, '0')}`);
  return [
    tagLayout('2026-10-29'),
    tagLayout('2026-10-26'),
    wocheLayout('2026-W44'),
    wocheLayout('2026-W53'),
    wocheLayout('2027-W01'),
    ...months.map(monatLayout),
    monatLayout('2027-02'),
    besprechungLayout(MEETING),
    besprechungLayout({}),
  ];
}

/** Gibt den ersten Fehler gegen XML 1.0 zurück: nicht maskierte & und <, falsch geschachtelte oder offene Elemente. */
function xmlProblem(xml: string): string | null {
  const token =
    /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w:-]+="(?:[^"<&]|&(?:amp|lt|gt|quot|#\d+);)*")*)\s*(\/?)>|(?:[^<>&]|&(?:amp|lt|gt|quot|#\d+);)+/y;
  const open: string[] = [];
  let pos = 0;
  while (pos < xml.length) {
    token.lastIndex = pos;
    const m = token.exec(xml);
    if (!m) return `ungültig bei ${pos}: ${xml.slice(pos, pos + 40)}`;
    pos = token.lastIndex;
    if (m[2] === undefined) continue; // Text
    if (m[1]) {
      if (open.pop() !== m[2]) return `</${m[2]}> schließt das falsche Element`;
    } else if (!m[4]) {
      open.push(m[2]);
    }
  }
  return open.length ? `offen: ${open.join(', ')}` : null;
}

function overlap(a: number[], b: number[]): boolean {
  return a[0] < b[0] + b[2] && b[0] < a[0] + a[2] && a[1] < b[1] + b[3] && b[1] < a[1] + a[3];
}

/** Alle <rect> des Hintergrunds mit ihren Attributen. */
function rects(bg: string): Record<string, string>[] {
  return [...bg.matchAll(/<rect ([^>]*)\/>/g)].map((m) =>
    Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
  );
}

/** Die Füllfarbe des Rechtecks mit genau diesen Maßen. Gibt es keines, ist die Stelle ungefüllt: `none`. */
function fillAt(bg: string, [x, y, w, h]: number[]): string {
  const found = rects(bg).find((r) => r.x === String(x) && r.y === String(y) && r.width === String(w) && r.height === String(h));
  return found?.fill ?? 'none';
}

function fieldRect(l: Layout, id: string): number[] {
  return l.fields.find((f) => f.id === id)!.rect;
}

/** Die Linien des Hintergrunds. Jede steht als `M<x> <y>h<Breite>` darin. */
const linesIn = (bg: string) =>
  [...bg.matchAll(/M([\d.]+) ([\d.]+)h([\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]) }));

test('field ids unique, inside the page, right dates', () => {
  for (const l of [tagLayout('2026-10-29'), wocheLayout('2026-W44'), monatLayout('2026-10')]) {
    expect(new Set(l.fields.map((f) => f.id)).size).toBe(l.fields.length);
    for (const f of l.fields) {
      const [x, y, w, h] = f.rect;
      expect(x >= 0 && y >= 0 && x + w <= 1192 && y + h <= 1590).toBe(true);
    }
  }
  expect(wocheLayout('2026-W44').fields.find((f) => f.id === 'woche')!.datum).toBe('2026-10-26');
  expect(monatLayout('2026-10').fields.find((f) => f.id === 'monat')!.datum).toBe('2026-10-01');
  expect(monatLayout('2026-10').fields.filter((f) => f.id.startsWith('tag-'))).toHaveLength(31);
});

test('every layout has unique field ids, fields inside the page and no two fields overlapping', () => {
  for (const l of allLayouts()) {
    const name = `${l.kind} ${l.key}`;
    expect(new Set(l.fields.map((f) => f.id)).size, name).toBe(l.fields.length);
    for (const f of l.fields) {
      const [x, y, w, h] = f.rect;
      expect(x >= 0 && y >= 0 && w > 0 && h > 0 && x + w <= PAGE_W && y + h <= PAGE_H, `${name} ${f.id}`).toBe(true);
      expect(f.label, `${name} ${f.id}`).not.toBe('');
      expect(['liniert7', 'liniert6', 'blanko']).toContain(f.paper);
    }
    for (let i = 0; i < l.fields.length; i++) {
      for (let j = i + 1; j < l.fields.length; j++) {
        expect(overlap(l.fields[i].rect, l.fields[j].rect), `${name} ${l.fields[i].id} / ${l.fields[j].id}`).toBe(false);
      }
    }
  }
});

test('the day page has notes, priorities and tasks, and room for three cards: left 628, right 388 wide', () => {
  const l = tagLayout('2026-10-29');
  expect(l.kind).toBe('tag');
  expect(l.key).toBe('2026-10-29');
  expect(l.fields.map((f) => f.id)).toEqual(['notizen', 'prioritaeten', 'aufgaben']);
  expect(l.fields.every((f) => f.datum === '2026-10-29' && f.paper === 'liniert7')).toBe(true);
  expect(l.cards.map((c) => c.id)).toEqual(['briefing', 'kalender', 'besprechungen']);
  const card = (id: string) => l.cards.find((c) => c.id === id)!.rect;
  expect(card('briefing')[2]).toBe(628);
  expect(card('kalender')[2]).toBe(388);
  expect(card('besprechungen')[2]).toBe(388);
  // Der Briefing links, Kalender und Besprechungen rechts daneben, 24 Einheiten Abstand
  expect(card('kalender')[0]).toBe(card('briefing')[0] + 628 + 24);
  expect(card('besprechungen')[0]).toBe(card('kalender')[0]);
  expect(card('besprechungen')[1]).toBeGreaterThanOrEqual(card('kalender')[1] + card('kalender')[3]);
  // Die Schreibfelder liegen unter den Karten, in denselben zwei Spalten
  const field = (id: string) => l.fields.find((f) => f.id === id)!.rect;
  const cardsBottom = Math.max(...l.cards.map((c) => c.rect[1] + c.rect[3]));
  for (const f of l.fields) expect(f.rect[1]).toBeGreaterThanOrEqual(cardsBottom);
  expect(field('notizen')[0] + field('notizen')[2]).toBeLessThanOrEqual(card('briefing')[0] + 628);
  expect(field('prioritaeten')[0]).toBeGreaterThanOrEqual(card('kalender')[0]);
  expect(field('aufgaben')[0] + field('aufgaben')[2]).toBeLessThanOrEqual(card('kalender')[0] + 388);
  // Karten liegen auf der Seite und stoßen weder aneinander noch an ein Feld
  for (const c of l.cards) {
    const [x, y, w, h] = c.rect;
    expect(x >= 0 && y >= 0 && x + w <= PAGE_W && y + h <= PAGE_H, c.id).toBe(true);
    for (const f of l.fields) expect(overlap(c.rect, f.rect), `${c.id} / ${f.id}`).toBe(false);
  }
  expect(overlap(card('briefing'), card('kalender'))).toBe(false);
  expect(overlap(card('kalender'), card('besprechungen'))).toBe(false);
  // Das Notizfeld ist der größte Schreibplatz
  expect(field('notizen')[3]).toBeGreaterThan(field('aufgaben')[3]);
});

test('the week has seven day fields Monday to Sunday and one for goals and notes', () => {
  const l = wocheLayout('2026-W44');
  expect(l.kind).toBe('woche');
  expect(l.key).toBe('2026-W44');
  expect(l.cards).toEqual([]);
  expect(l.fields.map((f) => f.id)).toEqual([
    'tag-2026-10-26',
    'tag-2026-10-27',
    'tag-2026-10-28',
    'tag-2026-10-29',
    'tag-2026-10-30',
    'tag-2026-10-31',
    'tag-2026-11-01',
    'woche',
  ]);
  expect(l.fields.slice(0, 7).map((f) => f.datum)).toEqual(l.fields.slice(0, 7).map((f) => f.id.slice(4)));
  // Von oben nach unten, alle sieben gleich hoch und gleich breit, jeder mit seiner Kopfzeile und vier Linien
  const days = l.fields.slice(0, 7);
  for (let i = 1; i < 7; i++) expect(days[i].rect[1]).toBeGreaterThanOrEqual(days[i - 1].rect[1] + days[i - 1].rect[3]);
  expect(new Set(days.map((f) => f.rect[3])).size).toBe(1);
  expect(new Set(days.map((f) => f.rect[2])).size).toBe(1);
  expect(new Set(days.map((f) => f.rect[0])).size).toBe(1);
  const lines = linesIn(l.background());
  for (const day of days) {
    const [x, y, w, h] = day.rect;
    const mine = lines.filter((ln) => ln.y > y && ln.y <= y + h && ln.x >= x && ln.x + ln.w <= x + w);
    expect(mine, day.id).toHaveLength(4);
    expect(mine[0].y - y, day.id).toBeGreaterThanOrEqual(80); // darüber die Kopfzeile mit Tageszahl und Wochentag
  }
  // Die Zielspalte steht rechts daneben, als ein Feld, genau wie bisher
  const goals = l.fields[7];
  expect(goals.rect[0]).toBeGreaterThanOrEqual(days[0].rect[0] + days[0].rect[2]);
  expect(goals.rect).toEqual([684, 188, 392, 1344]);
  expect(goals.paper).toBe('liniert7');
  expect(goals.label).toBe('Wochenziele und Notizen');
  // Die Tage füllen ihre Spalte so hoch wie der Rahmen der Zielspalte: von 144 bis 1550
  expect(days[0].rect[1]).toBe(144);
  expect(days[6].rect[1] + days[6].rect[3]).toBe(1550);
});

test('a week over the new year has its days in both years', () => {
  expect(wocheLayout('2026-W53').fields.slice(0, 7).map((f) => f.datum)).toEqual(weekDays('2026-W53'));
  expect(wocheLayout('2026-W53').fields[0].datum).toBe('2026-12-28');
  expect(wocheLayout('2026-W53').fields[6].datum).toBe('2027-01-03');
  expect(wocheLayout('2026-W53').fields[7].datum).toBe('2026-12-28');
  expect(wocheLayout('2027-W01').fields[0].datum).toBe('2027-01-04');
});

test('the month fills a grid of 6 rows and 7 columns, Monday first, with the days of the month only', () => {
  const [x0, y0, w, h] = [80, 180, 144, 112];
  for (const month of ['2026-10', '2026-08', '2026-02', '2027-02', '2028-02', '2026-12']) {
    const l = monatLayout(month);
    expect(l.kind).toBe('monat');
    expect(l.key).toBe(month);
    expect(l.cards).toEqual([]);
    const byId = new Map(l.fields.map((f) => [f.id, f]));
    let count = 0;
    monthGrid(month).forEach((row, r) =>
      row.forEach((day, c) => {
        const f = byId.get(`tag-${day}`);
        if (!day.startsWith(month)) return expect(f, `${month} ${day} liegt im Nachbarmonat`).toBeUndefined();
        count++;
        expect(f, `${month} ${day}`).toBeDefined();
        expect(f!.rect).toEqual([x0 + c * w, y0 + r * h, w, h]);
        expect(f!.datum).toBe(day);
        expect(f!.paper).toBe('blanko');
      }),
    );
    expect(l.fields.filter((f) => f.id.startsWith('tag-'))).toHaveLength(count);
    expect(l.fields.at(-1)!.id).toBe('monat');
  }
  expect(monatLayout('2026-10').fields.find((f) => f.id === 'tag-2026-10-01')!.rect).toEqual([80 + 3 * 144, 180, 144, 112]);
  expect(monatLayout('2026-10').fields.find((f) => f.id === 'tag-2026-10-26')!.rect).toEqual([80, 180 + 4 * 112, 144, 112]);
  expect(monatLayout('2026-02').fields.filter((f) => f.id.startsWith('tag-'))).toHaveLength(28);
  expect(monatLayout('2028-02').fields.filter((f) => f.id.startsWith('tag-'))).toHaveLength(29);
  // Der Monat mit dem längsten Raster hat sechs Zeilen, und das Zielfeld steht darunter
  const aug = monatLayout('2026-08');
  const goals = aug.fields.find((f) => f.id === 'monat')!;
  expect(goals.rect[1]).toBeGreaterThanOrEqual(y0 + 6 * h);
  expect(goals.paper).toBe('liniert7');
});

test('the meeting page keeps the head free for input fields and has one lined field with a red margin at 20 mm', () => {
  const l = besprechungLayout(MEETING);
  expect(l.kind).toBe('besprechung');
  expect(l.key).toBe('2026-10-29 0800 Abstimmung Muster 2027');
  expect(l.cards).toEqual([]);
  expect(l.fields).toHaveLength(1);
  const f = l.fields[0];
  expect(f.id).toBe('besprechung');
  expect(f.paper).toBe('liniert7');
  expect(f.datum).toBe('2026-10-29');
  expect(f.rect[1]).toBeGreaterThanOrEqual(200);
  expect(f.rect[0]).toBe(0);
  expect(f.rect[2]).toBe(PAGE_W);
  // eine ganze Zahl Zeilen zu je 7 mm
  expect(f.rect[3] % (7 * MM)).toBe(0);
  // roter Rand bei 20 mm, vom Kopfbereich bis zum Ende des Feldes
  const margin = rects(l.background()).find((r) => r.fill === '#e29a9a');
  expect(margin, 'roter Rand').toBeDefined();
  expect(Number(margin!.x)).toBe(20 * MM);
  expect(Number(margin!.y)).toBe(200);
  expect(Number(margin!.y) + Number(margin!.height)).toBe(f.rect[1] + f.rect[3]);
});

test('a meeting page without a valid date or topic still has a layout', () => {
  const metas: Record<string, string>[] = [{}, { datum: 'gestern' }, { datum: '2026-02-30', thema: '' }, { seitennr: 'x' }];
  for (const meta of metas) {
    const l = besprechungLayout(meta);
    expect(l.fields[0].datum).toBe('');
    expect(l.key).toBe('');
    expect(xmlProblem(l.background())).toBeNull();
  }
  expect(besprechungLayout({ datum: '2026-10-29', zeit: '0800' }).key).toBe('2026-10-29 0800 Besprechung');
});

test('lined fields have lines every 7 mm (in the days of the week every 6 mm) and end on a line, blank fields have none', () => {
  const spacing = { liniert7: 7 * MM, liniert6: 6 * MM };
  for (const l of [tagLayout('2026-10-29'), wocheLayout('2026-W44'), monatLayout('2026-10'), besprechungLayout(MEETING)]) {
    const lines = linesIn(l.background());
    for (const f of l.fields) {
      const [x, y, w, h] = f.rect;
      const mine = lines.filter((ln) => ln.y > y && ln.y <= y + h && ln.x >= x && ln.x + ln.w <= x + w);
      const name = `${l.kind} ${f.id}`;
      if (f.paper === 'blanko') {
        expect(mine, name).toEqual([]);
        continue;
      }
      expect(f.paper, name).toBe(l.kind === 'woche' && f.id.startsWith('tag-') ? 'liniert6' : 'liniert7');
      expect(mine.length, name).toBeGreaterThan(1);
      const ys = mine.map((ln) => ln.y).sort((a, b) => a - b);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1], name).toBe(spacing[f.paper]);
      expect(ys.at(-1), name).toBe(y + h); // das Feld hört auf einer Linie auf
      expect(new Set(mine.map((ln) => ln.x)).size, name).toBe(1); // alle Linien beginnen an derselben Stelle
    }
  }
});

test('the background is well-formed SVG, covers the page with paper and names its fields', () => {
  for (const l of allLayouts()) {
    const bg = l.background();
    expect(xmlProblem(bg), `${l.kind} ${l.key}`).toBeNull();
    expect(bg.startsWith(`<rect x="0" y="0" width="${PAGE_W}" height="${PAGE_H}" fill="#fffefa"/>`), `${l.kind} ${l.key}`).toBe(true);
  }
  const tag = tagLayout('2026-10-29').background();
  for (const name of ['Notizen', 'Prioritäten', 'Aufgaben', 'Morgenbriefing', 'Kalender', 'Besprechungen']) {
    expect(tag.toUpperCase(), name).toContain(name.toUpperCase());
  }
  expect(tag).toContain('Donnerstag, 29. Oktober 2026');
  expect(tag).toContain('KW 44');
  const woche = wocheLayout('2026-W44').background();
  for (const name of ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag', 'Woche 44']) {
    expect(woche, name).toContain(name);
  }
  expect(woche).toContain('26. Oktober bis 1. November 2026');
  // Die Tageszahl in der Kopfzeile eines Tages ist zweistellig, wie im Entwurf: „01 Sonntag“
  expect(woche).toMatch(/>01<\/text><text [^>]*>Sonntag<\/text>/);
  expect(woche).toMatch(/>26<\/text><text [^>]*>Montag<\/text>/);
  const monat = monatLayout('2026-10').background();
  expect(monat).toContain('Oktober 2026');
  for (const name of ['Montag', 'Sonntag', 'KW 40', 'KW 44']) expect(monat, name).toContain(name);
  expect(wocheLayout('2026-W53').background()).toContain('28. Dezember 2026 bis 3. Januar 2027');
});

test('holidays are marked with the planner colours: text #a8674f on #f8efea', () => {
  const holidayText = (bg: string, name: string) =>
    new RegExp(`<text [^>]*fill="#a8674f"[^>]*>${name}</text>`).test(bg);
  const HOLIDAY = '#f8efea';

  // Monat: 26.10.2026 ist Nationalfeiertag. Sein Feld ist getönt, der Name steht darin, die Nachbartage sind es nicht.
  const monat = monatLayout('2026-10');
  const monatBg = monat.background();
  expect(fillAt(monatBg, fieldRect(monat, 'tag-2026-10-26'))).toBe(HOLIDAY);
  expect(fillAt(monatBg, fieldRect(monat, 'tag-2026-10-27'))).toBe('none');
  expect(holidayText(monatBg, 'Nationalfeiertag')).toBe(true);
  // Ein Wochenende ist kein Feiertag und bekommt andere Farben
  const saturday = fillAt(monatBg, fieldRect(monat, 'tag-2026-10-31'));
  expect(saturday).not.toBe(HOLIDAY);
  expect(saturday).not.toBe('none');
  // Ein Tag des Nachbarmonats im Raster (der 1.11.) ist nicht als Feiertag beschriftet
  expect(monatBg).not.toContain('Allerheiligen');

  // Woche: Montag der Nationalfeiertag und Sonntag Allerheiligen
  const woche = wocheLayout('2026-W44');
  const wocheBg = woche.background();
  expect(fillAt(wocheBg, fieldRect(woche, 'tag-2026-10-26'))).toBe(HOLIDAY);
  expect(fillAt(wocheBg, fieldRect(woche, 'tag-2026-11-01'))).toBe(HOLIDAY);
  expect(fillAt(wocheBg, fieldRect(woche, 'tag-2026-10-28'))).toBe('none');
  // Der Samstag ist kein Feiertag und hat den Ton des Wochenendes
  const samstag = fillAt(wocheBg, fieldRect(woche, 'tag-2026-10-31'));
  expect(samstag).not.toBe(HOLIDAY);
  expect(samstag).not.toBe('none');
  expect(holidayText(wocheBg, 'Nationalfeiertag')).toBe(true);
  expect(holidayText(wocheBg, 'Allerheiligen')).toBe(true);
  // Eine Woche über den Jahreswechsel kennt die Feiertage beider Jahre
  expect(holidayText(wocheLayout('2026-W53').background(), 'Neujahr')).toBe(true);
  expect(holidayText(wocheLayout('2026-W52').background(), 'Stefanitag')).toBe(true);

  // Tag: die Kopfzeile ist getönt und nennt den Feiertag
  const feiertag = tagLayout('2026-10-26').background();
  expect(holidayText(feiertag, 'Nationalfeiertag')).toBe(true);
  expect(feiertag).toContain(HOLIDAY);

  // Ohne Feiertag kommen die Farben nicht vor
  for (const bg of [tagLayout('2026-10-29').background(), monatLayout('2026-09').background(), wocheLayout('2026-W40').background()]) {
    expect(bg).not.toContain('#a8674f');
    expect(bg).not.toContain(HOLIDAY);
  }
});

test('texts with special characters are escaped and survive the file', () => {
  const meta = { ...MEETING, thema: 'Sperren & "Muster" <2027> \u{1F642}', ort: "Haus 'A' & B\u0001", projekt: '<x>&' };
  const l = besprechungLayout(meta);
  const bg = l.background();
  expect(xmlProblem(bg)).toBeNull();
  expect(bg).toContain('Sperren &amp; "Muster" &lt;2027&gt; \u{1F642}');
  expect(bg).not.toContain('\u0001');
  const page: Page = { kind: 'besprechung', key: l.key, meta: { ...meta, thema: 'Sperren' }, strokes: [] };
  const file = serializePage(page, l.fields, bg);
  expect(parsePage(file).key).toBe(l.key);
  // Beim Zusammenführen bleibt der Hintergrund der eigenen Fassung
  expect(mergePages(file, file)).toContain('Sperren &amp; "Muster"');
});

test('long meeting texts are shortened so they stay on the page', () => {
  const l = besprechungLayout({ ...MEETING, thema: 'T'.repeat(500), ort: 'O'.repeat(500), projekt: 'P'.repeat(500) });
  const bg = l.background();
  expect(bg).not.toContain('T'.repeat(100));
  expect(bg).not.toContain('O'.repeat(100));
  expect(bg).not.toContain('P'.repeat(100));
  expect(bg).toContain('…');
  expect(xmlProblem(bg)).toBeNull();
});

test('the background is the same text every time and does not depend on the clock', () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  for (const make of [() => tagLayout('2026-10-29'), () => wocheLayout('2026-W44'), () => monatLayout('2026-10'), () => besprechungLayout(MEETING)]) {
    vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
    const l = make();
    const first = l.background();
    expect(l.background()).toBe(first);
    vi.setSystemTime(new Date('2030-01-01T10:00:00Z'));
    expect(make().background()).toBe(first);
    expect(make().fields).toEqual(l.fields);
  }
});

test('a finger can hit the day number in the week and in the month, not elsewhere', () => {
  const week = wocheLayout('2026-W44');
  const targets = tapTargets(week);
  expect(targets.map((t) => t.day)).toEqual(weekDays('2026-W44'));
  const monat = monatLayout('2026-10');
  expect(tapTargets(monat)).toHaveLength(31);
  for (const l of [week, monat]) {
    for (const t of tapTargets(l)) {
      const field = l.fields.find((f) => f.id === `tag-${t.day}`)!;
      // an der Oberkante des Tagesfeldes, ganz im Feld, mindestens 44 px groß bei der kleinsten üblichen Ansicht (0,65)
      expect(t.rect[0]).toBe(field.rect[0]);
      expect(t.rect[1]).toBe(field.rect[1]);
      expect(t.rect[2]).toBe(field.rect[2]);
      expect(t.rect[3]).toBeLessThanOrEqual(field.rect[3]);
      expect(t.rect[2] * 0.65).toBeGreaterThanOrEqual(44);
      expect(t.rect[3] * 0.65).toBeGreaterThanOrEqual(44);
    }
  }
  // Ziel treffen: Mitte der Tageszahl am 29. im Monat (Do, Zeile 4), obere rechte Ecke des Feldes
  const f29 = monat.fields.find((f) => f.id === 'tag-2026-10-29')!;
  const monthTargets = tapTargets(monat);
  expect(tapTargetAt(monthTargets, f29.rect[0] + f29.rect[2] - 20, f29.rect[1] + 20)?.day).toBe('2026-10-29');
  expect(tapTargetAt(monthTargets, f29.rect[0] + 1, f29.rect[1] + 1)?.day).toBe('2026-10-29');
  // unten im Feld, im Kopf der Spalten, in der KW-Spalte, außerhalb der Seite: kein Ziel
  expect(tapTargetAt(monthTargets, f29.rect[0] + 20, f29.rect[1] + f29.rect[3] - 5)).toBeNull();
  expect(tapTargetAt(monthTargets, 100, 150)).toBeNull();
  expect(tapTargetAt(monthTargets, 60, f29.rect[1] + 20)).toBeNull();
  expect(tapTargetAt(monthTargets, -5, -5)).toBeNull();
  expect(tapTargetAt(monthTargets, PAGE_W + 5, PAGE_H + 5)).toBeNull();
  // Tage des Nachbarmonats sind kein Ziel: Montag 28.9. steht in der ersten Zeile links
  expect(tapTargetAt(monthTargets, 90, 190)).toBeNull();
  // Auf der Grenze zweier Tage gilt der rechte, und der untere Rand der Tippfläche gehört nicht mehr dazu
  const t26 = monthTargets.find((t) => t.day === '2026-10-26')!.rect;
  expect(tapTargetAt(monthTargets, t26[0] + t26[2] - 0.5, t26[1] + 10)?.day).toBe('2026-10-26');
  expect(tapTargetAt(monthTargets, t26[0] + t26[2], t26[1] + 10)?.day).toBe('2026-10-27');
  expect(tapTargetAt(monthTargets, t26[0] + 10, t26[1] + t26[3] - 0.5)?.day).toBe('2026-10-26');
  expect(tapTargetAt(monthTargets, t26[0] + 10, t26[1] + t26[3])).toBeNull();
  // Zwischen zwei Tagen der Woche (Lücke) ist nichts
  const [mon, tue] = week.fields;
  expect(tapTargetAt(targets, mon.rect[0] + 20, mon.rect[1] + mon.rect[3] + 2)).toBeNull();
  expect(tapTargetAt(targets, tue.rect[0] + 20, tue.rect[1] + 10)?.day).toBe('2026-10-27');
  // Die Tippfläche enthält keinen anderen Tag: jeder Punkt trifft höchstens ein Ziel
  for (const l of [week, monat]) {
    const ts = tapTargets(l);
    for (let i = 0; i < ts.length; i++) for (let j = i + 1; j < ts.length; j++) expect(overlap(ts[i].rect, ts[j].rect)).toBe(false);
  }
  // Tag- und Besprechungsseite haben keine Ziele
  expect(tapTargets(tagLayout('2026-10-29'))).toEqual([]);
  expect(tapTargets(besprechungLayout(MEETING))).toEqual([]);
});

test('tap targets are labelled with the day and the holiday, for the screen reader list', () => {
  const targets = tapTargets(monatLayout('2026-10'));
  expect(targets.find((t) => t.day === '2026-10-26')!.label).toBe('Mo 26.10.2026, Nationalfeiertag');
  expect(targets.find((t) => t.day === '2026-10-29')!.label).toBe('Do 29.10.2026');
  expect(tapTargets(wocheLayout('2026-W44')).find((t) => t.day === '2026-11-01')!.label).toBe('So 01.11.2026, Allerheiligen');
});

test('today is marked on the screen only, and only on a page that shows it', () => {
  const week = wocheLayout('2026-W44');
  const mark = todayMarks(week, '2026-10-29');
  expect(mark).not.toBe('');
  expect(xmlProblem(mark)).toBeNull();
  const f = week.fields.find((x) => x.id === 'tag-2026-10-29')!;
  expect(mark).toContain(`x="${f.rect[0]}" y="${f.rect[1]}"`);
  expect(week.background()).not.toContain(mark);
  expect(todayMarks(week, '2026-11-02')).toBe('');
  expect(todayMarks(week, '2026-10-25')).toBe('');
  const monat = monatLayout('2026-10');
  const monthMark = todayMarks(monat, '2026-10-29');
  expect(monthMark).not.toBe('');
  expect(xmlProblem(monthMark)).toBeNull();
  expect(monat.background()).not.toContain(monthMark);
  expect(todayMarks(monat, '2026-11-01')).toBe(''); // im Raster zu sehen, aber nicht im Monat
  expect(todayMarks(monat, '2026-09-30')).toBe('');
  expect(todayMarks(tagLayout('2026-10-29'), '2026-10-29')).toBe('');
  expect(todayMarks(besprechungLayout(MEETING), '2026-10-29')).toBe('');
  // Die Marke für zwei verschiedene Tage ist verschieden
  expect(todayMarks(week, '2026-10-28')).not.toBe(mark);
});

describe('agendaMarks', () => {
  const lang = (n: number, titel = 'Besprechung') =>
    Array.from({ length: n }, (_, i): Termin => ({ date: '2026-10-28', start: `${String(8 + i).padStart(2, '0')}:00`, end: '23:00', allDay: false, title: `${titel} Nummer ${i}` }));
  const termin = (title: string, date = '2026-10-28'): Termin => ({ date, allDay: true, title });
  const prio = [{ text: 'Angebot prüfen', done: false }];
  const only = (day: string, data: AgendaDay) => (d: string): AgendaDay => (d === day ? data : { termine: [], prioritaeten: [] });
  const texts = (svg: string) => [...svg.matchAll(/<text x="([\d.]+)" y="([\d.]+)"([^>]*)>/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]), attrs: m[3] }));
  const clips = (svg: string) =>
    [...svg.matchAll(/<clipPath id="([^"]+)"><rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)"\/><\/clipPath>/g)].map((m) => ({
      id: m[1],
      rect: [Number(m[2]), Number(m[3]), Number(m[4]), Number(m[5])],
    }));

  test('the week shows appointments in line 1 and priorities in line 2 of the day head', () => {
    const woche = wocheLayout('2026-W44');
    const [x, top] = fieldRect(woche, 'tag-2026-10-28');
    const svg = agendaMarks(woche, only('2026-10-28', { termine: [termin('Abstimmung')], prioritaeten: prio }));
    const t = texts(svg);
    expect(t).toHaveLength(2);
    expect(t[0].x).toBe(48 + 190);
    expect(t[1].x).toBe(48 + 190);
    expect(t[0].y).toBeGreaterThan(top);
    expect(t[1].y).toBeLessThanOrEqual(top + 49);
    expect(t[0].y).toBeLessThan(t[1].y);
    expect(t[0].attrs).toContain('font-size="13"');
    expect(x).toBe(48);
    expect(svg).toContain('fill="#55657a"');
    expect(svg).toContain('fill="#3d434d"');
    expect(svg.indexOf('#55657a')).toBeLessThan(svg.indexOf('#3d434d'));
  });

  test('the rest label takes the colour of its line', () => {
    const woche = wocheLayout('2026-W44');
    const many = Array.from({ length: 12 }, (_, i) => ({ text: `Aufgabe Nummer ${i}`, done: false }));
    const svg = agendaMarks(woche, only('2026-10-28', { termine: lang(12), prioritaeten: many }));
    const [termLine, prioLine] = [...svg.matchAll(/<text [^>]*>.*?<\/text>/g)].map((m) => m[0]);
    expect(termLine).toMatch(/<tspan fill="#55657a"> \+\d+<\/tspan><\/text>$/);
    expect(prioLine).toMatch(/<tspan fill="#3d434d"> \+\d+<\/tspan><\/text>$/);
  });

  test('with only one kind it gets both lines', () => {
    const woche = wocheLayout('2026-W44');
    const svg = agendaMarks(woche, only('2026-10-28', { termine: lang(3), prioritaeten: [] }));
    expect(texts(svg)).toHaveLength(2);
    expect(svg).toContain('#55657a');
    expect(svg).not.toContain('#3d434d');
  });

  test('a holiday name keeps its place', () => {
    const woche = wocheLayout('2026-W44');
    const withHoliday = clips(agendaMarks(woche, only('2026-10-26', { termine: [termin('Frei', '2026-10-26')], prioritaeten: [] })))[0].rect;
    const without = clips(agendaMarks(woche, only('2026-10-28', { termine: [termin('Abstimmung')], prioritaeten: [] })))[0].rect;
    expect(without[0] + without[2]).toBe(48 + 600 - 14);
    expect(withHoliday[0]).toBe(48 + 190);
    expect(withHoliday[0] + withHoliday[2]).toBeLessThan(48 + 600 - 14 - 100);
  });

  test('the month shows only appointments, top left in the cell, left of the day number and the circle for today', () => {
    const monat = monatLayout('2026-10');
    const [x, y] = fieldRect(monat, 'tag-2026-10-28');
    const svg = agendaMarks(monat, () => ({ termine: [termin('Abstimmung')], prioritaeten: prio }));
    const c = clips(svg).find((k) => k.id === 'agenda-2026-10-28')!;
    expect(c.rect).toEqual([x + 8, y + 4, 92, 28]);
    expect(svg).toContain('font-size="10.5"');
    expect(svg).not.toContain('#3d434d');
    expect(svg).not.toContain('Angebot');
    expect(clips(svg)).toHaveLength(31);
    expect(clips(svg).some((k) => k.id === 'agenda-2026-11-01')).toBe(false);
  });

  test('special characters stay valid SVG', () => {
    const woche = wocheLayout('2026-W44');
    const svg = agendaMarks(woche, (d) =>
      d === '2026-10-28'
        ? { termine: [{ date: d, allDay: true, title: '<b>&"x"</b> 🙂' }], prioritaeten: [{ text: '<i>&', done: true }] }
        : d === '2026-10-29'
          ? { termine: [termin('x'.repeat(80), d)], prioritaeten: [] }
          : { termine: [], prioritaeten: [] },
    );
    const wrapped = `<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`;
    // happy-dom lässt ein rohes < oder & im Text durch, darum zusätzlich der strenge Helfer.
    expect(xmlProblem(wrapped)).toBeNull();
    expect(new DOMParser().parseFromString(wrapped, 'image/svg+xml').querySelector('parsererror')).toBeNull();
    expect(svg).toContain('&lt;b&gt;&amp;');
    expect(svg).toContain('&lt;i&gt;&amp;');
    expect(svg).not.toContain('x'.repeat(80));
    expect(svg).toMatch(/x+…/);
  });

  const geb = (name: string, date = '2026-10-28', art: 'Geburtstag' | 'Jahrestag' = 'Geburtstag'): Geburtstag => ({ date, name, art });
  const lines = (svg: string) => [...svg.matchAll(/<text [^>]*>(.*?)<\/text>/g)].map((m) => m[1]);

  const plain = (html: string) => html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&');
  const LONG = ['Maximilian Beispielmann', 'Wilhelmine Musterfrau'];

  test('all birthdays and anniversaries of a week day are one small entry in line 1, the first appointment next to it, priorities in line 2', () => {
    const data = { geburtstage: [...LONG.map((n) => geb(n)), geb('Anna und Ben Beispiel', '2026-10-28', 'Jahrestag')], termine: lang(2), prioritaeten: prio };
    const [first, second] = lines(agendaMarks(wocheLayout('2026-W44'), only('2026-10-28', data)));
    expect(first.match(/<tspan[^>]*>🎂/g)).toHaveLength(1);
    expect(first.startsWith('<tspan fill="#a8674f" font-size="11">🎂 Maximilian')).toBe(true);
    expect(first).toContain('<tspan fill="#55657a"> · </tspan><tspan fill="#55657a">08:00 Besprechung');
    expect(first.match(/font-size="/g)).toHaveLength(1);
    expect(second).toContain('▸ Angebot prüfen');
  });

  test('on a holiday the 40 % of the birthdays count from the narrower area', () => {
    const svg = agendaMarks(wocheLayout('2026-W44'), only('2026-10-26', { geburtstage: LONG.map((n) => geb(n, '2026-10-26')), termine: lang(2), prioritaeten: [] }));
    const area = clips(svg)[0].rect;
    const head = plain(lines(svg)[0].match(/<tspan[^>]*font-size="11">(.*?)<\/tspan>/)![1]);
    expect(head.endsWith('…')).toBe(true);
    expect(textWidth(head, 11)).toBeLessThanOrEqual(0.4 * area[2]);
    expect(lines(svg)[0]).toContain('08:00 Besprechung');
  });

  test('with only birthdays the week gives them both lines, broken after a name, behind one cake', () => {
    const names = ['Max Beispiel', 'Erika Muster', 'Paul Beispiel', 'Anna Beispiel', 'Ben Beispiel', 'Lena Muster'];
    const svg = agendaMarks(wocheLayout('2026-W44'), only('2026-10-28', { geburtstage: names.map((n) => geb(n)), termine: [], prioritaeten: [] }));
    const out = lines(svg);
    expect(out).toHaveLength(2);
    // Jeder Name steht ganz in einer der Zeilen, nichts ist gekürzt, und nur Zeile 1 hat den Kuchen.
    for (const n of names) expect(out.some((l) => plain(l).includes(n))).toBe(true);
    expect(out.join('')).not.toContain('…');
    expect(out.join('').match(/🎂/g)).toHaveLength(1);
    expect(plain(out[0]).startsWith('🎂 Max Beispiel')).toBe(true);
    for (const l of out) {
      expect(l).toMatch(/^<tspan fill="#a8674f" font-size="11">[^<]*<\/tspan>$/);
      expect(textWidth(plain(l), 11)).toBeLessThanOrEqual(clips(svg)[0].rect[2]);
    }
  });

  test('without priorities the week keeps the whole entry in line 1 and the whole first appointment in line 2 when they do not fit side by side', () => {
    const at = (date: string, start: string, title: string): Termin => ({ date, start, end: '23:00', allDay: false, title });
    const cases: { day: string; names: string[]; termin: Termin; want: string[] }[] = [
      {
        day: '2026-10-28',
        names: ['Max Beispiel', 'Paul Beispiel'],
        termin: at('2026-10-28', '08:00', 'Koordinationsbesprechung Brücke'),
        want: ['<tspan fill="#a8674f" font-size="11">🎂 Max Beispiel, Paul Beispiel</tspan>', '<tspan fill="#55657a">08:00 Koordinationsbesprechung Brücke</tspan>'],
      },
      {
        day: '2026-10-28',
        names: ['Max Beispiel', 'Erika Muster', 'Paul Beispiel'],
        termin: at('2026-10-28', '08:00', 'Abstimmung Werkstatt'),
        want: ['<tspan fill="#a8674f" font-size="11">🎂 Max Beispiel, Erika Muster, Paul Beispiel</tspan>', '<tspan fill="#55657a">08:00 Abstimmung Werkstatt</tspan>'],
      },
      {
        // Nationalfeiertag: die schmalere Fläche links vom Namen des Feiertags.
        day: '2026-10-26',
        names: ['Max Beispiel', 'Paul Beispiel'],
        termin: at('2026-10-26', '09:30', 'Zahnarzt'),
        want: ['<tspan fill="#a8674f" font-size="11">🎂 Max Beispiel, Paul Beispiel</tspan>', '<tspan fill="#55657a">09:30 Zahnarzt</tspan>'],
      },
      {
        day: '2026-10-28',
        names: ['Maximilian Beispielmann', 'Wilhelmine Musterfrau'],
        termin: at('2026-10-28', '08:00', 'Abstimmung'),
        want: ['<tspan fill="#a8674f" font-size="11">🎂 Maximilian Beispielmann, Wilhelmine Musterfrau</tspan>', '<tspan fill="#55657a">08:00 Abstimmung</tspan>'],
      },
    ];
    for (const c of cases) {
      const svg = agendaMarks(wocheLayout('2026-W44'), only(c.day, { geburtstage: c.names.map((n) => geb(n, c.day)), termine: [c.termin], prioritaeten: [] }));
      expect(lines(svg)).toEqual(c.want);
    }
    expect(clips(agendaMarks(wocheLayout('2026-W44'), only('2026-10-26', { geburtstage: [geb('Max Beispiel', '2026-10-26')], termine: [], prioritaeten: [] })))[0].rect[2]).toBeLessThan(300);
  });

  test('with a birthday and a priority but no appointments the week shows the whole entry in line 1 and the priority in line 2', () => {
    const out = lines(agendaMarks(wocheLayout('2026-W44'), only('2026-10-28', { geburtstage: LONG.map((n) => geb(n)), termine: [], prioritaeten: prio })));
    expect(out).toHaveLength(2);
    expect(plain(out[0])).toBe('🎂 Maximilian Beispielmann, Wilhelmine Musterfrau');
    expect(out[1]).toContain('▸ Angebot prüfen');
  });

  test('the rest after a line that starts with a birthday has the colour of the appointments', () => {
    const out = lines(agendaMarks(wocheLayout('2026-W44'), only('2026-10-28', { geburtstage: [geb('Max Beispiel')], termine: lang(12), prioritaeten: prio })));
    expect(out[0].startsWith('<tspan fill="#a8674f" font-size="11">🎂 Max Beispiel</tspan>')).toBe(true);
    expect(out[0]).toMatch(/<tspan fill="#55657a"> \+\d+<\/tspan>$/);
  });

  test('a birthday on a holiday ends before the holiday name in the week', () => {
    const woche = wocheLayout('2026-W44');
    const withHoliday = clips(agendaMarks(woche, only('2026-10-26', { geburtstage: [geb('Max Beispiel', '2026-10-26')], termine: [], prioritaeten: [] })))[0].rect;
    const without = clips(agendaMarks(woche, only('2026-10-28', { geburtstage: [geb('Max Beispiel')], termine: [], prioritaeten: [] })))[0].rect;
    expect(withHoliday[2]).toBeLessThan(without[2]);
  });

  test('the month gives line 1 to the birthdays over the whole cell and line 2 to the appointments, the second one in +1', () => {
    const termine: Termin[] = [
      { date: '2026-10-28', start: '14:00', end: '15:00', allDay: false, title: 'Runde Werkstatt' },
      { date: '2026-10-28', start: '09:30', end: '10:00', allDay: false, title: 'Zahnarzt' },
    ];
    const geburtstage = [geb('Max Beispiel'), geb('Anna und Ben Beispiel', '2026-10-28', 'Jahrestag')];
    const out = lines(agendaMarks(monatLayout('2026-10'), only('2026-10-28', { geburtstage, termine, prioritaeten: prio })));
    expect(out).toHaveLength(2);
    // Zeile 1: nur der Eintrag, in Größe 9, ohne Trenner und nicht breiter als das Kästchen.
    expect(out[0].match(/<tspan/g)).toHaveLength(1);
    expect(out[0]).toMatch(/^<tspan fill="#a8674f" font-size="9">🎂 Max Beispiel[^<]*<\/tspan>$/);
    expect(textWidth(plain(out[0]), 9)).toBeLessThanOrEqual(92);
    // Zeile 2: zuerst der Termin, der früher beginnt; der andere zählt in „+1“.
    expect(out[1]).toMatch(/^<tspan fill="#55657a">09:30[^<]*<\/tspan><tspan fill="#55657a"> \+1<\/tspan>$/);
  });

  test('the month shows one birthday and one appointment whole, one below the other', () => {
    const out = lines(agendaMarks(monatLayout('2026-10'), only('2026-10-28', { geburtstage: [geb('Max Beispiel')], termine: [termin('Abstimmung')], prioritaeten: prio })));
    expect(out).toEqual(['<tspan fill="#a8674f" font-size="9">🎂 Max Beispiel</tspan>', '<tspan fill="#55657a">Abstimmung</tspan>']);
    // Sind beide sehr kurz, teilen sie sich Zeile 1.
    const short = lines(agendaMarks(monatLayout('2026-10'), only('2026-10-28', { geburtstage: [geb('Ina')], termine: [termin('Arzt')], prioritaeten: [] })));
    expect(short).toEqual(['<tspan fill="#a8674f" font-size="9">🎂 Ina</tspan><tspan fill="#55657a"> · </tspan><tspan fill="#55657a">Arzt</tspan>']);
  });

  test('without appointments the birthdays in the month go on in line 2 after a name, behind one cake', () => {
    const out = lines(agendaMarks(monatLayout('2026-10'), only('2026-10-28', { geburtstage: [geb('Max Beispiel'), geb('Paul Beispiel')], termine: [], prioritaeten: prio })));
    expect(out).toEqual(['<tspan fill="#a8674f" font-size="9">🎂 Max Beispiel,</tspan>', '<tspan fill="#a8674f" font-size="9">Paul Beispiel</tspan>']);
  });

  test('the day page shows its birthdays right aligned in the line of the subtitle, nothing else', () => {
    const svg = agendaMarks(tagLayout('2026-10-29'), (d) => ({ geburtstage: d === '2026-10-29' ? [geb('Max Beispiel', d)] : [], termine: [termin('A', '2026-10-29')], prioritaeten: prio }));
    expect(clips(svg)).toEqual([{ id: 'agenda-2026-10-29', rect: [340, 88, 732, 26] }]);
    const [line] = texts(svg);
    expect([line.x, line.y]).toEqual([1072, 106]);
    expect(line.attrs).toContain('text-anchor="end"');
    expect(line.attrs).toContain('font-size="16"');
    expect(lines(svg)).toEqual(['<tspan fill="#a8674f">🎂 Max Beispiel</tspan>']);
    expect(lines(svg)[0]).not.toContain('font-size');
    // Die Fläche beginnt rechts vom Untertitel „KW 44 / 2026 · Tagesseite“ (geschätzte Breite).
    expect(340).toBeGreaterThan(48 + 16 + textWidth('KW 44 / 2026 · Tagesseite', 16));
  });

  test('on a holiday the day page keeps the birthdays below the holiday name', () => {
    const svg = agendaMarks(tagLayout('2026-10-26'), () => ({ geburtstage: [geb('Max Beispiel', '2026-10-26')], termine: [], prioritaeten: [] }));
    expect(texts(svg)[0].y).toBe(106);
  });

  test('two birthdays on the day page are one entry', () => {
    const svg = agendaMarks(tagLayout('2026-10-29'), (d) => ({ geburtstage: ['Max Beispiel', 'Paul Beispiel'].map((n) => geb(n, d)), termine: [], prioritaeten: [] }));
    expect(lines(svg)).toEqual(['<tspan fill="#a8674f">🎂 Max Beispiel, Paul Beispiel</tspan>']);
  });

  test('too many long birthday names on the day page end in an ellipsis inside the area', () => {
    const names = ['Maximilian Beispielmann-Musterfrau', 'Wilhelmine Musterfrau-Beispielmann', 'Bartholomaeus Beispielhuber-Muster', 'Konstantin Musterberger-Beispiel'];
    const svg = agendaMarks(tagLayout('2026-10-29'), (d) => ({ geburtstage: names.map((n) => geb(n, d)), termine: [], prioritaeten: [] }));
    const out = lines(svg);
    expect(out).toHaveLength(1);
    expect(plain(out[0]).endsWith('…')).toBe(true);
    expect(textWidth(plain(out[0]), 16)).toBeLessThanOrEqual(732);
  });

  test('names with special characters stay valid SVG', () => {
    const svg = agendaMarks(wocheLayout('2026-W44'), only('2026-10-28', { geburtstage: [geb('Anna & Ben <Beispiel> "B"')], termine: [], prioritaeten: [] }));
    expect(xmlProblem(`<svg xmlns="http://www.w3.org/2000/svg">${svg}</svg>`)).toBeNull();
    expect(svg).toContain('🎂 Anna &amp; Ben &lt;Beispiel&gt;');
  });

  test('days without data, and day pages without birthdays, give nothing', () => {
    expect(agendaMarks(tagLayout('2026-10-29'), () => ({ termine: [termin('A', '2026-10-29')], prioritaeten: prio }))).toBe('');
    expect(agendaMarks(besprechungLayout(MEETING), () => ({ termine: [termin('A')], prioritaeten: prio }))).toBe('');
    expect(agendaMarks(wocheLayout('2026-W44'), () => ({ termine: [], prioritaeten: [] }))).toBe('');
  });

  test('the marks never touch the background', () => {
    const woche = wocheLayout('2026-W44');
    const before = woche.background();
    const svg = agendaMarks(woche, only('2026-10-28', { termine: [termin('Abstimmung')], prioritaeten: prio }));
    expect(svg).not.toBe('');
    expect(woche.background()).toBe(before);
    expect(before).not.toContain('agenda');
    expect(before).not.toContain('Abstimmung');
  });
});
