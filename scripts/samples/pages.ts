// Erzeugt erfundene Beispielseiten des Notizbuchs (SVG) für den Probebetrieb und für den Trockenlauf der Abendroutine.
// Benutzt die echten Funktionen der App: StrokeBuilder (Glättung, Breite), storedForm und serializePage (SVG-Format) und
// die Layouts (Felder, Hintergrund). Die Schrift ist eine einfache Einstrich-Schrift aus font.ts.
// Aufgerufen wird das über scripts/make-samples.mjs <Ausgabeordner>. Alles hier ist erfunden: keine echten Namen,
// keine Vault-Inhalte. Reine Rechnung ohne Dateizugriff: `buildSamples` liefert die Seiten, geschrieben werden sie vom Skript.

import type { PenKind } from '../../src/ink/pens';
import { StrokeBuilder } from '../../src/ink/stroke';
import { serializePage, storedForm } from '../../src/ink/svg';
import { SMOOTHING, type InkColor, type Page, type Stroke } from '../../src/ink/types';
import { besprechungPagePath, monatPagePath, sperrenPagePath, tagPagePath, wochePagePath } from '../../src/lib/filenames';
import { besprechungLayout, monatLayout, sperrenLayout, tabelleLayout, tagLayout, wocheLayout, type Layout, type Rect } from '../../src/pages/layouts';
import { tabelleGeometrie } from '../../src/pages/tabelle';
import { GAP, GLYPHS, type Pt } from './font';

// ---------- Zufall mit festem Startwert, damit jeder Lauf dieselben Dateien ergibt ----------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Baut etwas mit festem Zufall. Die Strich-Kennungen der App kommen aus Math.random: Ersetzt man es für die Dauer des Baus,
 * bleiben auch sie gleich. Danach steht das ursprüngliche Math.random wieder da.
 */
function seeded<T>(seed: number, build: (rng: () => number) => T): T {
  const original = Math.random;
  const rng = mulberry32(seed);
  Math.random = rng;
  try {
    return build(rng);
  } finally {
    Math.random = original;
  }
}

const LINE = 42; // Zeilenabstand: 7 mm bei 6 Einheiten je Millimeter
const WEEK_LINE = 36; // Zeilenabstand in den Tagen der Woche: 6 mm

// ---------- Schreiber ----------

/** Stift und Neigung für einen Strich. Ohne Angaben: Kugelschreiber ohne Neigung, wie bisher. */
type PenOpts = { pen?: PenKind; tiltX?: number; tiltY?: number };

class Scribe {
  readonly strokes: Stroke[] = [];
  t: number;

  constructor(
    private readonly rng: () => number,
    t: number,
  ) {
    this.t = t;
  }

  private jitter(): number {
    return this.rng() - 0.5;
  }

  /** Ein Linienzug als Strich, so wie ihn der Stift liefern würde: dicht abgetastet, leicht zittrig, mit Druck. */
  stroke(poly: Pt[], color: InkColor, widthMm = 0.2, opts: PenOpts = {}): void {
    if (poly.length === 0) return;
    const builder = new StrokeBuilder({ pen: opts.pen, color, widthMm, sigma: SMOOTHING.mittel, t: Math.round(this.t), minDist: 0.9 });
    const step = 2.0 + this.rng() * 0.8;
    const dense: Pt[] = [poly[0]];
    for (let i = 1; i < poly.length; i++) {
      const [x0, y0] = poly[i - 1];
      const [x1, y1] = poly[i];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / step));
      for (let k = 1; k <= n; k++) dense.push([x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n]);
    }
    let pressure = 0.5;
    for (const [x, y] of dense) {
      pressure = Math.min(0.78, Math.max(0.3, pressure + this.jitter() * 0.12));
      builder.add(x + this.jitter() * 0.45, y + this.jitter() * 0.45, pressure, opts.tiltX, opts.tiltY);
    }
    // Fertig wie nach dem Abheben in der App: bei der Füllfeder mit beiden spitzen Enden, bei den anderen Stiften wie `stroke()`, und
    // gleich in der Genauigkeit der Datei (`storedForm`), so wie die App den Strich aufnimmt und speichert.
    this.strokes.push(storedForm(builder.finish()));
    this.t += 160 + this.rng() * 260;
  }

  pause(ms: number): void {
    this.t += ms + this.rng() * ms * 0.3;
  }

  /** Text in Einstrich-Schrift. `x` ist der Anfang, `base` die Grundlinie, `scale` Seiteneinheiten je Schrifteinheit. */
  text(str: string, x: number, base: number, color: InkColor, scale = 2.2, widthMm = 0.2, opts: PenOpts = {}): { x0: number; x1: number } {
    let cx = x;
    const slant = 0.1 + this.rng() * 0.06;
    for (const ch of str.normalize('NFC')) {
      const g = GLYPHS[ch];
      if (!g) throw new Error(`Zeichen „${ch}“ fehlt in der Schrift`);
      const sc = scale * (1 + this.jitter() * 0.08);
      const dy = this.jitter() * 1.6;
      for (const s of g.s) {
        this.stroke(
          s.map(([gx, gy]) => [cx + gx * sc + gy * sc * slant, base + dy - gy * sc] as Pt),
          color,
          widthMm,
          opts,
        );
      }
      cx += (g.w + GAP) * sc;
      if (ch === ' ') this.pause(500);
    }
    this.pause(900);
    return { x0: x, x1: cx - GAP * scale };
  }

  underline(x0: number, x1: number, y: number, color: InkColor): void {
    this.stroke([[x0, y], [(x0 + x1) / 2, y + 0.8], [x1, y - 0.4]], color);
  }

  /** Haken (Häkchen) mit der Spitze unten bei (x, y). */
  check(x: number, y: number, size: number, color: InkColor): void {
    this.stroke([[x - 0.55 * size, y - 0.45 * size], [x - 0.15 * size, y], [x + 0.65 * size, y - 1.05 * size]], color);
  }

  /** Gekritzel, das niemand lesen kann: eine Wellenlinie. */
  scribble(x0: number, x1: number, y: number, color: InkColor): void {
    const poly: Pt[] = [];
    for (let x = x0; x <= x1; x += 3) poly.push([x, y - 7 + 6 * Math.sin((x - x0) / 3.1) * (0.6 + (x - x0) / (x1 - x0))]);
    this.stroke(poly, color);
  }
}

// ---------- Hilfen für Zeilen ----------

const baselineOf = (field: Rect, row: number): number => field[1] + (row + 1) * LINE - 9;

function field(layout: Layout, id: string): Rect {
  const found = layout.fields.find((f) => f.id === id);
  if (!found) throw new Error(`Feld ${id} fehlt`);
  return found.rect;
}

type Built = { page: Page; layout: Layout };

// ---------- Seiten ----------

const DAY = '2026-10-29';
const DAY_START = Date.UTC(2026, 9, 29, 6, 40); // 07:40 Uhr Wiener Zeit

/** Tagesseite. `nachtrag` ergänzt später geschriebene Striche: Der Anfang bleibt Strich für Strich derselbe. */
function dayPage(nachtrag: boolean): Built {
  const layout = tagLayout(DAY);
  return seeded(20261029, (rng) => {
    const s = new Scribe(rng, DAY_START);
    const notizen = field(layout, 'notizen');
    const aufgaben = field(layout, 'aufgaben');
    const nx = notizen[0] + 16;

    s.text('Anruf Muster: Termin verschoben', nx, baselineOf(notizen, 0), 'schwarz');
    s.text('Bericht Beispiel bis Freitag', nx, baselineOf(notizen, 1), 'schwarz');
    s.text('Sperren KW 12-14 prüfen', nx, baselineOf(notizen, 2), 'blau');

    // Skizze einer Bogenbrücke über Wasser, in den Zeilen 5 bis 9
    const top = notizen[1] + 4 * LINE + 8;
    s.stroke([[nx + 30, top + 30], [nx + 330, top + 30]], 'schwarz'); // Fahrbahn
    s.stroke(
      Array.from({ length: 19 }, (_, i) => {
        const a = Math.PI + (Math.PI * i) / 18;
        return [nx + 180 + 140 * Math.cos(a), top + 100 + 62 * Math.sin(a)] as Pt;
      }),
      'schwarz',
    ); // Bogen
    s.stroke([[nx + 40, top + 30], [nx + 40, top + 112]], 'schwarz'); // Pfeiler links
    s.stroke([[nx + 320, top + 30], [nx + 320, top + 112]], 'schwarz'); // Pfeiler rechts
    s.stroke(Array.from({ length: 30 }, (_, i) => [nx + 6 + i * 11.5, top + 124 + 4 * Math.sin(i * 1.3)] as Pt), 'blau'); // Wasser
    s.text('Brücke', nx + 120, top + 18, 'schwarz', 1.9);

    // Aufgaben: rot = offen, grün = erledigt, schwarz ohne Farbe
    const ax = aufgaben[0] + 14 + 7.5 + 12;
    const bullet = (row: number): [number, number] => [aufgaben[0] + 14, aufgaben[1] + row * LINE + LINE / 2];
    s.text('Muster anrufen', ax, baselineOf(aufgaben, 0), 'rot', 1.9);
    s.text('Bericht prüfen', ax, baselineOf(aufgaben, 1), 'gruen', 1.9);
    s.check(bullet(1)[0] + 2, bullet(1)[1] + 6, 20, 'gruen');
    s.text('Freigabe Beispiel holen', ax, baselineOf(aufgaben, 2), 'schwarz', 1.9);

    // Notiz im Seitenkopf, außerhalb aller Felder
    s.text('Merke: Freitag frei', 724, 102, 'blau', 2.0);

    if (nachtrag) {
      s.pause(6 * 3600 * 1000); // am Nachmittag weitergeschrieben
      s.text('Nachtrag: Muster ruft zurück', nx, baselineOf(notizen, 3), 'schwarz');
      s.text('Liste senden', ax, baselineOf(aufgaben, 3), 'rot', 1.9);
      s.check(bullet(0)[0] + 2, bullet(0)[1] + 6, 20, 'gruen'); // nachträglich als erledigt markiert
    }
    return { page: { kind: 'tag', key: DAY, meta: {}, strokes: s.strokes }, layout };
  });
}

const PEN_DAY = '2026-10-30';
const PEN_DAY_START = Date.UTC(2026, 9, 30, 6, 30); // 07:30 Uhr Wiener Zeit

/** Tagesseite mit je einer Zeile in jedem Stift, nacheinander geschrieben. Die Füllfeder liegt in der Hand geneigt (40, 40). */
function penPage(): Built {
  const layout = tagLayout(PEN_DAY);
  return seeded(20261030, (rng) => {
    const s = new Scribe(rng, PEN_DAY_START);
    const notizen = field(layout, 'notizen');
    const nx = notizen[0] + 16;
    s.text('Kugelschreiber', nx, baselineOf(notizen, 0), 'schwarz');
    s.text('Fineliner', nx, baselineOf(notizen, 1), 'blau', 2.2, 0.2, { pen: 'fineliner' });
    s.text('Füllfeder', nx, baselineOf(notizen, 2), 'schwarz', 2.2, 0.3, { pen: 'fueller', tiltX: 40, tiltY: 40 });
    s.text('Bleistift', nx, baselineOf(notizen, 3), 'schwarz', 2.2, 0.3, { pen: 'bleistift' });
    return { page: { kind: 'tag', key: PEN_DAY, meta: {}, strokes: s.strokes }, layout };
  });
}

const MEETING = { thema: 'Abstimmung Beispiel 2027', datum: DAY, zeit: '08:00', ort: 'Musterstadt', projekt: 'Beispielprojekt A' };

function meetingPage(n: 1 | 2): Built {
  const meta = { ...MEETING, seitennr: String(n) };
  const layout = besprechungLayout(meta);
  return seeded(20261029 + n, (rng) => {
    const s = new Scribe(rng, Date.UTC(2026, 9, 29, 7, 5 + (n - 1) * 20)); // ab 08:05 Uhr Wiener Zeit
    const f = field(layout, 'besprechung');
    const x = 140;
    const row = (i: number): number => baselineOf(f, i);
    if (n === 1) {
      s.text('Teilnehmer: Anna Muster, Max Beispiel', x, row(0), 'schwarz', 2.3);
      const head = s.text('Sperren 2027', x, row(1), 'blau', 2.3);
      s.underline(head.x0, head.x1, row(1) + 5, 'blau');
      s.text('Nachtsperre KW 12-14', x, row(2), 'schwarz', 2.3);
      const kosten = s.text('Kosten ca.', x, row(3), 'schwarz', 2.3);
      s.scribble(kosten.x1 + 14, kosten.x1 + 110, row(3), 'schwarz');
      s.text('Freigabe einholen', x, row(4), 'rot', 2.3);
      s.check(x + 4, row(5) - 2, 22, 'gruen');
      s.text('Liste verschickt', x + 34, row(5), 'gruen', 2.3);
    } else {
      const head = s.text('Nächste Schritte', x, row(0), 'blau', 2.3);
      s.underline(head.x0, head.x1, row(0) + 5, 'blau');
      s.text('Bericht an Muster senden', x, row(1), 'rot', 2.3);
      s.text('Termin: 05.11. 09:00', x, row(2), 'schwarz', 2.3);
      // Ablaufskizze: zwei Kästen mit Pfeil
      const top = f[1] + 4 * LINE + 6;
      const box = (x0: number, label: string): void => {
        s.stroke([[x0, top], [x0 + 150, top], [x0 + 150, top + 80], [x0, top + 80], [x0, top]], 'schwarz');
        s.text(label, x0 + 30, top + 54, 'schwarz', 2.4);
      };
      box(x, 'Plan');
      box(x + 330, 'Bau');
      s.stroke([[x + 160, top + 40], [x + 320, top + 40]], 'schwarz');
      s.stroke([[x + 304, top + 28], [x + 322, top + 40], [x + 304, top + 52]], 'schwarz');
    }
    return { page: { kind: 'besprechung', key: layout.key, meta, strokes: s.strokes }, layout };
  });
}

const TABLE_MEETING = { thema: 'Abstimmung Muster 2027', datum: '2026-10-30', zeit: '09:00', ort: 'Musterstadt', projekt: 'Beispielprojekt A', seitennr: '1', art: 'tabelle' };

/**
 * Tabellenseite (Arbeitsvorbereitung) mit acht beschriebenen Zeilen: zwei Vorhaben (Zeile 1 und 7), vier Schritte, eine Fortsetzung,
 * eine Summe und eine durchgestrichene Zeile. Jeder Strich liegt mit seiner Mitte im Band seiner Zeile (so ordnet ihn die App zu).
 * Die Schrift hat kein „•“, „×“, „€“: der Punkt ist ein kleiner Kreis, „x“ steht für „×“. Der Text der Vorhaben beginnt bei x 46,
 * damit er den Punkt bei x 34 nicht berührt.
 */
function tablePage(): Built {
  const layout = tabelleLayout(TABLE_MEETING);
  const geo = tabelleGeometrie();
  return seeded(20261030, (rng) => {
    const s = new Scribe(rng, Date.UTC(2026, 9, 30, 8, 5)); // ab 09:05 Uhr Wiener Zeit
    const top = (row: number): number => geo.zeilen[row - 1];
    const base = (row: number): number => top(row) + 34;
    // Zelle: Text in Spalte `col` (0 = Schritt) der Zeile `row`
    const cell = (row: number, col: number, str: string): void => {
      s.text(str, geo.spalten[col] + 8, base(row), 'schwarz', 2.0);
    };
    const dot = (row: number): void => {
      const cy = top(row) + 24;
      s.stroke(Array.from({ length: 17 }, (_, i) => [34 + 4 * Math.cos((i * Math.PI) / 8), cy + 4 * Math.sin((i * Math.PI) / 8)] as Pt), 'schwarz');
    };
    const vorhaben = (row: number, str: string): void => {
      dot(row);
      s.text(str, 46, base(row), 'schwarz', 2.0);
    };

    vorhaben(1, 'Musterbrücke 4711 km 12,345, 120 m x 1,70 m');
    // Zeile 2: Schritt, Monat, Std, Faktor 1, wer, Fahrzeuge, Ressourcen
    [[0, 'Vorarbeiten'], [1, '3'], [2, '50'], [3, '2'], [6, 'KI'], [7, 'BCR 8'], [8, 'SAS ET 8']].forEach(([c, t]) => cell(2, c as number, t as string));
    // Zeile 3: dazu Fremd € und Bemerkung
    [[0, 'Einbau'], [1, '4'], [2, '120'], [3, '4'], [6, 'IB'], [7, 'HTW 16'], [8, 'AZF 16'], [10, '2000'], [11, 'Kran']].forEach(([c, t]) => cell(3, c as number, t as string));
    cell(4, 7, 'LKW 8'); // Fortsetzung: nur Fahrzeuge
    // Zeile 5: Summe in der Spalte Std, darüber ein Strich
    cell(5, 2, '340');
    s.stroke([[geo.spalten[2] + 6, top(5) + 8], [(geo.spalten[2] + geo.spalten[3]) / 2, top(5) + 8.8], [geo.spalten[3] - 6, top(5) + 7.6]], 'schwarz');
    vorhaben(7, 'Musterbahn Lichtraum 40 lm, 8 Konsolen');
    // Zeile 8: Schritt, danach ein Strich quer durch die ganze Zeile
    [[0, 'Konsolen setzen'], [1, '5'], [2, '60'], [3, '2'], [6, 'KI']].forEach(([c, t]) => cell(8, c as number, t as string));
    const mid = top(8) + 24;
    s.stroke([[geo.spalten[0] + 4, mid + 1], [(geo.spalten[0] + geo.spalten[12]) / 2, mid - 1.2], [geo.spalten[12] - 4, mid + 0.6]], 'schwarz');
    // Zeile 9: Schritt, Monat, Std, Faktor 1, Anzahl, wer, Fahrzeuge
    [[0, 'SU'], [1, '9'], [2, '48'], [3, '2'], [5, '6'], [6, 'KI'], [7, 'BCR 48']].forEach(([c, t]) => cell(9, c as number, t as string));
    return { page: { kind: 'besprechung', key: layout.key, meta: TABLE_MEETING, strokes: s.strokes }, layout };
  });
}

/**
 * Sperrenseite für Jänner und Februar 2027 (Fachlinie IB) mit erfundenen Einträgen: ein Abschnitt in Platz 1 an drei Werktagen (15. bis 17.2.),
 * am 16.2. dazu je ein Eintrag in Platz 2 und Platz 3, und am 22.2. ein durchgestrichenes Wort in Platz 1. Die Schrift ist klein, damit der Text in die
 * schmalen Felder passt: jeder Strich liegt mit seiner Mitte im Feld, das ihn aufnimmt.
 */
function sperrenPage(): Built {
  const key = 'IB-2027-01';
  const layout = sperrenLayout(key);
  return seeded(20270215, (rng) => {
    const s = new Scribe(rng, Date.UTC(2026, 10, 25, 9, 0)); // 25.11.2026, ab 10:00 Uhr Wiener Zeit
    const write = (id: string, str: string, color: InkColor): { x0: number; x1: number; base: number } => {
      const r = field(layout, id);
      const base = r[1] + 30;
      const { x0, x1 } = s.text(str, r[0] + 4, base, color, 1.0);
      if (x1 > r[0] + r[2] - 4) throw new Error(`Text „${str}“ passt nicht in Feld ${id}`);
      return { x0, x1, base };
    };
    for (const id of ['sperre-2027-02-15-1', 'sperre-2027-02-16-1', 'sperre-2027-02-17-1']) write(id, 'Muster Abschnitt 1', 'schwarz');
    write('sperre-2027-02-16-2', 'Nord Gl. 2 8-14', 'blau');
    write('sperre-2027-02-16-3', 'Süd Gl. 1', 'blau');
    // Ein Wort, das gleich wieder durchgestrichen wird
    const w = write('sperre-2027-02-22-1', 'Muster', 'schwarz');
    s.stroke([[w.x0 - 2, w.base - 5], [(w.x0 + w.x1) / 2, w.base - 5.8], [w.x1 + 2, w.base - 4.6]], 'schwarz');
    return { page: { kind: 'sperren', key, meta: {}, strokes: s.strokes }, layout };
  });
}

function weekPage(): Built {
  const key = '2026-W44';
  const layout = wocheLayout(key);
  return seeded(202644, (rng) => {
    const s = new Scribe(rng, Date.UTC(2026, 9, 26, 6, 10));
    const dayRow = (id: string, i: number): { x: number; y: number } => {
      const r = field(layout, id);
      return { x: r[0] + 30, y: r[1] + 50 + (i + 1) * WEEK_LINE - 8 };
    };
    const tue = dayRow('tag-2026-10-27', 0);
    s.text('Zahnarzt 15:00', tue.x, tue.y, 'schwarz', 2.2);
    const tue2 = dayRow('tag-2026-10-27', 1);
    s.text('Rezept holen', tue2.x, tue2.y, 'rot', 2.2);
    const fri = dayRow('tag-2026-10-30', 0);
    s.text('Homeoffice', fri.x, fri.y, 'blau', 2.2);
    const goals = field(layout, 'ziele');
    s.text('Ziel: Sperren fertig', goals[0] + 16, baselineOf(goals, 0), 'schwarz', 2.0);
    // Aufgaben der Woche: offen schwarz, erledigt grün mit Haken im Kreis (Lage wie auf der Tagesseite)
    const tasks = field(layout, 'aufgaben');
    const tx = tasks[0] + 14 + 7.5 + 12;
    s.text('Dienstplan Muster', tx, baselineOf(tasks, 0), 'schwarz', 1.9);
    s.text('Bericht abgeben', tx, baselineOf(tasks, 1), 'gruen', 1.9);
    s.check(tasks[0] + 14 + 2, tasks[1] + LINE + LINE / 2 + 6, 20, 'gruen');
    const notes = field(layout, 'notizen');
    s.text('Urlaub Beispiel ab 20.11.', notes[0] + 16, baselineOf(notes, 0), 'blau', 2.0);
    return { page: { kind: 'woche', key, meta: {}, strokes: s.strokes }, layout };
  });
}

function monthPage(): Built {
  const key = '2026-10';
  const layout = monatLayout(key);
  return seeded(202610, (rng) => {
    const s = new Scribe(rng, Date.UTC(2026, 9, 5, 7, 5));
    const cellText = (id: string, i: number, str: string, color: InkColor): void => {
      const r = field(layout, id);
      s.text(str, r[0] + 8, r[1] + 52 + i * 22, color, 1.3);
    };
    cellText('tag-2026-10-14', 0, 'Urlaub Muster', 'blau');
    cellText('tag-2026-10-22', 0, 'Termin Muster', 'schwarz');
    cellText('tag-2026-10-22', 1, 'Unterlagen', 'rot');
    const goals = field(layout, 'monat');
    s.text('Ziel: Planung 2027 fertig', goals[0] + 16, baselineOf(goals, 0), 'schwarz', 2.0);
    return { page: { kind: 'monat', key, meta: {}, strokes: s.strokes }, layout };
  });
}

// ---------- Alle Beispielseiten ----------

/** Eine fertige Beispielseite: wohin sie im Ausgabeordner gehört und ihr SVG-Text. */
export type Sample = {
  /** Unterordner der Ausgabe: `lauf1`, `monat`, `lauf3-nachtrag`, `stifte`, `tabelle` oder `sperren`. */
  folder: string;
  /** Pfad im Vault, zum Beispiel `07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg`. */
  path: string;
  /** Die Seite, aus der der SVG-Text entstand. */
  page: Page;
  svg: string;
};

/**
 * Alle Beispielseiten. Jeder Aufruf ergibt dieselben Texte, Strich für Strich.
 * - `lauf1`: der Stand am Abend des 29.10.2026 (Tagesseite, Besprechung über zwei Seiten, Wochenseite)
 * - `monat`: die Monatsseite
 * - `lauf3-nachtrag`: dieselbe Tagesseite, am Nachmittag weitergeschrieben
 * - `stifte`: Tagesseite vom 30.10.2026 mit je einer Zeile in Kugelschreiber, Fineliner, Füllfeder und Bleistift (Version 2)
 * - `tabelle`: Tabellenseite der Arbeitsvorbereitung vom 30.10.2026 (Version 3)
 * - `sperren`: Sperrenseite IB, Jänner und Februar 2027, mit erfundenen Einträgen
 */
export function buildSamples(): Sample[] {
  const samples: Sample[] = [];
  const add = (folder: string, path: string, built: Built): void => {
    samples.push({ folder, path, page: built.page, svg: serializePage(built.page, built.layout.fields, built.layout.background()) });
  };

  add('lauf1', tagPagePath(DAY), dayPage(false));
  for (const n of [1, 2] as const) {
    const meeting = meetingPage(n);
    add('lauf1', besprechungPagePath(meeting.layout.key, n), meeting);
  }
  add('lauf1', wochePagePath('2026-W44'), weekPage());
  add('monat', monatPagePath('2026-10'), monthPage());
  add('lauf3-nachtrag', tagPagePath(DAY), dayPage(true));
  add('stifte', tagPagePath(PEN_DAY), penPage());
  const table = tablePage();
  add('tabelle', besprechungPagePath(table.layout.key, 1), table);
  add('sperren', sperrenPagePath('IB-2027-01'), sperrenPage());
  return samples;
}
