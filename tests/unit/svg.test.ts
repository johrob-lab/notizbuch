import { expect, test, vi } from 'vitest';
import { cutStroke, ERASER_PX } from '../../src/ink/erase';
import type { Pt2 } from '../../src/ink/gestures';
import { outlinePolygons } from '../../src/ink/outline';
import { StrokeBuilder, toHundredths } from '../../src/ink/stroke';
import { INK } from '../../src/ink/types';
import { DEFAULT_FUELLER, MIN_DIST_PX, stabilSigmaPx, type PenKind } from '../../src/ink/pens';
import { FORMAT_VERSION, PageTooNewError, mergePages, parsePage, serializePage, storedForm } from '../../src/ink/svg';
import type { FieldBox, InkColor, Page, Pt, Stroke } from '../../src/ink/types';

const DAY = '2026-10-29';

const FIELDS: FieldBox[] = [
  { id: 'notizen', rect: [0, 0, 600, 800], datum: DAY },
  { id: 'aufgaben', rect: [600, 0, 592, 800], datum: DAY },
];

let counter = 0;

/** Ein waagerechter Strich von 10 Einheiten Länge, dessen Rahmen seine Mitte genau bei (x, y) hat. */
function strokeAt(x: number, y: number, color: InkColor, id = `s${++counter}`): Stroke {
  return {
    id,
    tool: 'kugel',
    color,
    widthMm: 0.2,
    t: 1000 + counter,
    w: 1.2,
    pts: [
      { x: x - 5, y, w: 1.2 },
      { x: x + 5, y, w: 1.2 },
    ],
  };
}

function tagPage(strokes: Stroke[], meta: Record<string, string> = {}): Page {
  return { kind: 'tag', key: DAY, meta, strokes };
}

/** Eine Tagesseite mit je einem Strich pro `id`, alle in der Mitte des Feldes „notizen“. */
function svgWith(...ids: string[]): string {
  return serializePage(
    tagPage(ids.map((id) => strokeAt(300, 400, 'schwarz', id))),
    FIELDS,
    '',
  );
}

/** Die Feldgruppen einer Datei in Dateireihenfolge, mit den `id`s ihrer Striche. */
function groupsOf(svg: string) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  return Array.from(doc.documentElement.children)
    .filter((g) => g.hasAttribute('data-feld'))
    .map((g) => ({
      feld: g.getAttribute('data-feld'),
      datum: g.getAttribute('data-datum'),
      ids: Array.from(g.children).map((p) => p.getAttribute('data-id')),
    }));
}

/** Die Zeile mit dem Strich `id`. */
function lineOf(svg: string, id: string): string | undefined {
  return svg.split('\n').find((l) => l.includes(`data-id="${id}"`));
}

// ---------- Tests aus dem Brief ----------

test('serialize and parse roundtrip with fields', () => {
  const fields: FieldBox[] = [
    { id: 'notizen', rect: [0, 0, 600, 800], datum: '2026-10-29' },
    { id: 'aufgaben', rect: [600, 0, 592, 800], datum: '2026-10-29' },
  ];
  const page: Page = {
    kind: 'tag',
    key: '2026-10-29',
    meta: {},
    strokes: [strokeAt(100, 100, 'rot'), strokeAt(700, 100, 'gruen'), strokeAt(100, 1200, 'schwarz')],
  };
  const svg = serializePage(page, fields, '');
  expect(svg).toContain('data-feld="notizen"');
  expect(svg).toContain('data-feld="aufgaben"');
  expect(svg).toContain('data-feld="frei"');
  expect(parsePage(svg).strokes.map((s) => [s.id, s.color])).toEqual(page.strokes.map((s) => [s.id, s.color]));
});

test('escapes attributes', () => {
  const p: Page = {
    kind: 'besprechung',
    key: 'k',
    meta: { thema: 'Sperren & "Muster" <2027>' },
    strokes: [],
  };
  const svg = serializePage(p, [], '');
  expect(svg).toContain('&amp;');
  expect(svg).not.toContain('"Muster"');
  expect(parsePage(svg).meta.thema).toBe('Sperren & "Muster" <2027>');
});

test('mergePages keeps all strokes', () => {
  expect(
    parsePage(mergePages(svgWith('s1', 's2'), svgWith('s1', 's3')))
      .strokes.map((s) => s.id)
      .sort(),
  ).toEqual(['s1', 's2', 's3']);
});

// ---------- Format ----------

test('the file has the fixed format: root attributes, background group, one path per line', () => {
  const stroke: Stroke = {
    id: 's1793251082972a',
    tool: 'kugel',
    color: 'rot',
    widthMm: 0.2,
    t: 1793251082972,
    w: 1.2345,
    pts: [
      { x: 10.5, y: 20, w: 1.2345 },
      { x: 30, y: 40.04, w: 1.2345 },
    ],
  };
  const field: FieldBox = { id: 'notizen', rect: [0, 0, 600, 800], datum: DAY };
  const background = '<rect id="papier" x="0" y="0" width="1192" height="1590" fill="#fffefa"/>';
  const svg = serializePage(tagPage([stroke]), [field], background);
  expect(svg).toBe(
    [
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1192 1590" width="1192" height="1590" data-notizbuch="1" data-seite="tag" data-schluessel="2026-10-29">',
      `  <g data-hintergrund="1">${background}</g>`,
      '  <g data-feld="notizen" data-datum="2026-10-29">',
      '    <path data-id="s1793251082972a" data-werkzeug="kugel" data-farbe="rot" data-breite="0.2" data-t="1793251082972" d="M 10.5 20 L 30 40.04" fill="none" stroke="#c62828" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
      '  </g>',
      '</svg>',
      '',
    ].join('\n'),
  );
});

test('a page without strokes has the header and the background group only', () => {
  const svg = serializePage(tagPage([]), FIELDS, '');
  expect(svg).toContain('<g data-hintergrund="1"></g>');
  expect(svg).not.toContain('data-feld');
  expect(parsePage(svg)).toEqual(tagPage([]));
});

test('a read stroke has time, nominal width, stroke width and that width on every point', () => {
  const stroke: Stroke = { ...strokeAt(300, 400, 'blau', 's9'), widthMm: 0.4, t: 1793251082972, w: 2.4 };
  const back = parsePage(serializePage(tagPage([stroke]), FIELDS, '')).strokes[0];
  expect(back).toEqual({
    id: 's9',
    tool: 'kugel',
    color: 'blau',
    widthMm: 0.4,
    t: 1793251082972,
    w: 2.4,
    pts: [
      { x: 295, y: 400, w: 2.4 },
      { x: 305, y: 400, w: 2.4 },
    ],
  });
});

test('a drawn stroke survives the round trip within the rounding of the format', () => {
  const b = new StrokeBuilder({ color: 'blau', widthMm: 0.4, sigma: 1.6, t: 1793251082972, minDist: 0.6 });
  for (let i = 0; i < 300; i++) b.add(40 + i * 2.37, 200 + Math.sin(i / 7) * 60 + (i % 3) * 0.9, 0.3 + (i % 10) / 20);
  const stroke = b.stroke();
  const back = parsePage(serializePage(tagPage([stroke]), FIELDS, '')).strokes[0];
  expect(back).toMatchObject({ id: stroke.id, tool: 'kugel', color: 'blau', widthMm: 0.4, t: 1793251082972 });
  expect(Math.abs(back.w - stroke.w)).toBeLessThanOrEqual(0.05 + 1e-9);
  expect(back.pts).toHaveLength(stroke.pts.length);
  // Die Orte mit zwei Nachkommastellen, die Breite des Strichs (`stroke-width`) mit einer.
  back.pts.forEach((p, i) => {
    expect(Math.abs(p.x - stroke.pts[i].x), `x ${i}`).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(p.y - stroke.pts[i].y), `y ${i}`).toBeLessThanOrEqual(0.005 + 1e-9);
  });
});

test('a dot survives as a stroke', () => {
  const dot: Stroke = { ...strokeAt(0, 0, 'rot', 'punkt'), pts: [{ x: 300, y: 400, w: 1.2 }] };
  const svg = serializePage(tagPage([dot]), FIELDS, '');
  expect(svg).toContain('d="M 300 400 L 300 400"');
  const back = parsePage(svg).strokes[0];
  expect(back.id).toBe('punkt');
  expect(back.pts.every((p) => p.x === 300 && p.y === 400)).toBe(true);
});

test('a stroke without points is not written', () => {
  const empty: Stroke = { ...strokeAt(0, 0, 'rot', 'leer'), pts: [] };
  const svg = serializePage(tagPage([empty, strokeAt(300, 400, 'rot', 'voll')]), FIELDS, '');
  expect(svg).not.toContain('leer');
  expect(parsePage(svg).strokes.map((s) => s.id)).toEqual(['voll']);
});

test('serializePage needs no DOM', () => {
  vi.stubGlobal('DOMParser', undefined);
  vi.stubGlobal('XMLSerializer', undefined);
  try {
    const svg = serializePage(tagPage([strokeAt(300, 400, 'rot', 'ohne-dom')], { ort: 'Raum' }), FIELDS, '<g/>');
    expect(svg).toContain('data-id="ohne-dom"');
  } finally {
    vi.unstubAllGlobals();
  }
});

// ---------- Kopfdaten ----------

test('a meeting page keeps all its data attributes', () => {
  const meta = { thema: 'Muster', datum: DAY, zeit: '08:00', ort: 'Raum 1', projekt: 'Beispiel', seitennr: '2' };
  const page: Page = { kind: 'besprechung', key: '2026-10-29 0800 Muster S2', meta, strokes: [] };
  const svg = serializePage(page, [], '');
  for (const key of Object.keys(meta)) expect(svg).toContain(` data-${key}="`);
  expect(parsePage(svg)).toEqual(page);
});

test('meta values survive umlauts, quotes, ampersands, line breaks and empty values', () => {
  const meta = {
    thema: 'Ergänzungen: Größe "über" 5 % & mehr <b>',
    ort: 'Büro\nRaum 2\t(Süd)',
    projekt: '',
    zeit: "it's 08:00",
  };
  const page: Page = { kind: 'besprechung', key: 'K & "1"', meta, strokes: [] };
  const back = parsePage(serializePage(page, [], ''));
  expect(back.meta).toEqual(meta);
  expect(back.key).toBe('K & "1"');
});

test('meta keys that are not [a-z][a-z0-9]* or that the file uses itself are dropped', () => {
  const meta = {
    ok: '1',
    'Bad-Key': 'x',
    '1abc': 'y',
    ünder: 'z',
    'a b': 'q',
    seite: 'kaputt',
    notizbuch: '0',
    schluessel: 'k2',
  };
  const svg = serializePage({ kind: 'monat', key: '2026-10', meta, strokes: [] }, [], '');
  // Doppelte Attribute machen die Datei für einen echten Browser unlesbar, happy-dom merkt es nicht. Darum der Text.
  const names = [...svg.split('\n')[0].matchAll(/ ([\w:-]+)="/g)].map((m) => m[1]);
  expect(names).toEqual([
    'xmlns',
    'viewBox',
    'width',
    'height',
    'data-notizbuch',
    'data-seite',
    'data-schluessel',
    'data-ok',
  ]);
  const back = parsePage(svg);
  expect(back.meta).toEqual({ ok: '1' });
  expect(back.kind).toBe('monat');
  expect(back.key).toBe('2026-10');
});

test('characters that XML does not allow are removed so the file stays readable', () => {
  const thema = 'a\u{1}b\u{B}c\u{FFFE}d\u{D800}e\u{1F600}';
  const page: Page = { kind: 'besprechung', key: 'k', meta: { thema }, strokes: [] };
  const svg = serializePage(page, [], '<text>a\u{1}b</text>');
  expect(svg).not.toMatch(/[\u{0}-\u{8}\u{B}\u{C}\u{E}-\u{1F}\u{FFFE}\u{D800}]/u);
  expect(svg).toContain('<text>ab</text>');
  expect(parsePage(svg).meta.thema).toBe('abcde\u{1F600}');
});

// ---------- Felder ----------

test('a stroke belongs to the first field that contains the centre of its box, else to the free group', () => {
  const long = (x1: number, x2: number, y: number, id: string): Stroke => ({
    ...strokeAt(0, 0, 'rot', id),
    pts: [
      { x: x1, y, w: 1.2 },
      { x: x2, y, w: 1.2 },
    ],
  });
  const strokes = [
    strokeAt(300, 400, 'rot', 'a'), // mitten in notizen
    strokeAt(900, 400, 'rot', 'b'), // mitten in aufgaben
    strokeAt(300, 1000, 'rot', 'c'), // unter beiden Feldern
    strokeAt(600, 400, 'rot', 'd'), // genau auf der Grenze: das erste Feld gewinnt
    long(-100, 500, 100, 'e'), // beginnt links außerhalb, die Mitte (200) liegt in notizen
    long(500, 1100, 100, 'f'), // beginnt in notizen, die Mitte (800) liegt in aufgaben
  ];
  expect(groupsOf(serializePage(tagPage(strokes), FIELDS, ''))).toEqual([
    { feld: 'notizen', datum: DAY, ids: ['a', 'd', 'e'] },
    { feld: 'aufgaben', datum: DAY, ids: ['b', 'f'] },
    { feld: 'frei', datum: DAY, ids: ['c'] },
  ]);
});

test('groups without strokes are left out and the groups follow the order of the fields', () => {
  const svg = serializePage(tagPage([strokeAt(900, 400, 'rot', 'b')]), FIELDS, '');
  expect(groupsOf(svg)).toEqual([{ feld: 'aufgaben', datum: DAY, ids: ['b'] }]);
  expect(groupsOf(serializePage(tagPage([]), FIELDS, ''))).toEqual([]);
});

test('the group of a field carries the date of that field', () => {
  const fields: FieldBox[] = [
    { id: 'mo', rect: [0, 0, 600, 800], datum: '2026-10-26' },
    { id: 'di', rect: [600, 0, 592, 800], datum: '2026-10-27' },
  ];
  const page: Page = { kind: 'woche', key: '2026-W44', meta: {}, strokes: [strokeAt(900, 400, 'rot', 'x')] };
  expect(groupsOf(serializePage(page, fields, ''))).toEqual([{ feld: 'di', datum: '2026-10-27', ids: ['x'] }]);
});

test('the free group carries the date of the page', () => {
  const free = (p: Omit<Page, 'strokes'>) =>
    groupsOf(serializePage({ ...p, strokes: [strokeAt(300, 400, 'rot')] }, [], ''))[0];
  expect(free({ kind: 'tag', key: DAY, meta: {} })).toMatchObject({ feld: 'frei', datum: DAY });
  expect(free({ kind: 'woche', key: '2026-W44', meta: {} }).datum).toBe('2026-10-26'); // der Montag der Woche
  expect(free({ kind: 'monat', key: '2026-10', meta: {} }).datum).toBe('2026-10-01');
  expect(free({ kind: 'besprechung', key: 'k', meta: { datum: DAY } }).datum).toBe(DAY);
});

test('a page without a usable date still saves, the free group then has no date', () => {
  const free = (p: Omit<Page, 'strokes'>) =>
    groupsOf(serializePage({ ...p, strokes: [strokeAt(300, 400, 'rot')] }, [], ''))[0];
  expect(free({ kind: 'tag', key: 'kaputt', meta: {} })).toEqual({ feld: 'frei', datum: null, ids: expect.any(Array) });
  expect(free({ kind: 'woche', key: 'kaputt', meta: {} }).datum).toBeNull();
  expect(free({ kind: 'woche', key: '2026-W4', meta: {} }).datum).toBeNull();
  expect(free({ kind: 'monat', key: 'kaputt', meta: {} }).datum).toBeNull();
  expect(free({ kind: 'besprechung', key: 'k', meta: {} }).datum).toBeNull();
  expect(free({ kind: 'besprechung', key: 'k', meta: { datum: '2026-02-30' } }).datum).toBeNull();
});

// ---------- Lesen ----------

const ROOT =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1192 1590" width="1192" height="1590" data-notizbuch="1" data-seite="tag" data-schluessel="2026-10-29">';

const GOOD_PATH: Record<string, string | null> = {
  'data-id': 'ok',
  'data-werkzeug': 'kugel',
  'data-farbe': 'rot',
  'data-breite': '0.2',
  'data-t': '5',
  d: 'M 1 2 L 3 4',
  'stroke-width': '1.2',
};

/** Ein Strich von Hand geschrieben. `null` lässt das Attribut weg. */
function rawPath(changes: Record<string, string | null> = {}): string {
  const attrs = { ...GOOD_PATH, ...changes };
  const text = Object.entries(attrs)
    .filter(([, value]) => value !== null)
    .map(([name, value]) => `${name}="${value}"`)
    .join(' ');
  return `<path ${text}/>`;
}

function rawPage(...paths: string[]): string {
  return `${ROOT}<g data-feld="notizen" data-datum="${DAY}">${paths.join('')}</g></svg>`;
}

test('parsePage ignores the background, even a path in it', () => {
  const svg = serializePage(tagPage([strokeAt(300, 400, 'rot', 's1')]), FIELDS, rawPath({ 'data-id': 'hintergrund' }));
  expect(svg).toContain('data-id="hintergrund"');
  expect(parsePage(svg).strokes.map((s) => s.id)).toEqual(['s1']);
});

test('a bad path is skipped, the others are read, and nothing throws', () => {
  const bad = [
    rawPath({ 'data-id': null }),
    rawPath({ 'data-id': '' }),
    rawPath({ d: null }),
    rawPath({ d: '' }),
    rawPath({ d: 'M 1 2 Q 3' }),
    rawPath({ d: 'M 1 2 L x y' }),
    rawPath({ 'data-t': null }),
    rawPath({ 'data-t': 'abc' }),
    rawPath({ 'data-breite': '' }),
    rawPath({ 'data-breite': null }),
    rawPath({ 'stroke-width': 'NaN' }),
    rawPath({ 'stroke-width': null }),
  ];
  const svg = rawPage(...bad, rawPath({ 'data-id': 'gut' }));
  expect(() => parsePage(svg)).not.toThrow();
  expect(parsePage(svg).strokes.map((s) => s.id)).toEqual(['gut']);
});

test('an unknown or missing colour falls back to schwarz', () => {
  const svg = rawPage(
    rawPath({ 'data-id': 'a', 'data-farbe': 'lila' }),
    rawPath({ 'data-id': 'b', 'data-farbe': null }),
    rawPath({ 'data-id': 'c', 'data-farbe': 'constructor' }),
    rawPath({ 'data-id': 'd', 'data-farbe': 'gruen' }),
  );
  expect(parsePage(svg).strokes.map((s) => [s.id, s.color])).toEqual([
    ['a', 'schwarz'],
    ['b', 'schwarz'],
    ['c', 'schwarz'],
    ['d', 'gruen'],
  ]);
});

test('a file that another tool saved again with a declaration, comments and single quotes is read', () => {
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1192 1590' data-notizbuch='1' data-seite='woche' data-schluessel='2026-W44' data-thema='Ä'>",
    '  <!-- ein Kommentar -->',
    '  <g data-hintergrund="1">\n    <rect x="0" y="0" width="5" height="5"/>\n  </g>',
    '  <g data-feld="mo" data-datum="2026-10-26">',
    `    ${rawPath({ 'data-id': 'x' })}`,
    '  </g>',
    '</svg>',
  ].join('\n');
  expect(parsePage(svg)).toMatchObject({ kind: 'woche', key: '2026-W44', meta: { thema: 'Ä' } });
  expect(parsePage(svg).strokes.map((s) => s.id)).toEqual(['x']);
});

test('a byte order mark in front of the file is skipped', () => {
  // happy-dom nimmt das Zeichen hin, ein echter Browser lehnt die Datei damit ab. Darum zählt, was der Parser bekommt.
  const svg = svgWith('s1');
  const spy = vi.spyOn(DOMParser.prototype, 'parseFromString');
  try {
    expect(parsePage('\u{FEFF}' + svg).strokes.map((s) => s.id)).toEqual(['s1']);
    expect(mergePages('\u{FEFF}' + svg, svg)).toBe(svg);
    expect(spy.mock.calls.map(([text]) => text)).toEqual([svg, svg, svg]);
  } finally {
    spy.mockRestore();
  }
});

test('a file that is not a readable notebook page throws a clear error', () => {
  expect(() => parsePage('')).toThrow(/SVG/);
  expect(() => parsePage('hallo')).toThrow(/SVG/);
  expect(() => parsePage(`${ROOT}<g></svg>`)).toThrow(/SVG/); // nicht wohlgeformt
  expect(() => parsePage('<svg xmlns="http://www.w3.org/2000/svg"></svg>')).toThrow(/Seite des Notizbuchs/);
  expect(() => parsePage('<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="0"></svg>')).toThrow(
    /Seite des Notizbuchs/,
  );
  expect(() => parsePage('<html xmlns="http://www.w3.org/1999/xhtml" data-notizbuch="1"></html>')).toThrow(
    /Seite des Notizbuchs/,
  );
  expect(() => parsePage(ROOT.replace('data-seite="tag"', 'data-seite="jahr"') + '</svg>')).toThrow(/Seitentyp/);
  expect(() => parsePage(ROOT.replace(' data-seite="tag"', '') + '</svg>')).toThrow(/Seitentyp/);
});

// ---------- Zusammenführen ----------

// Mit Groß- und Kleinschreibung in Namen (SVG unterscheidet sie), Umlauten und maskierten Zeichen im Text.
const BACKGROUND =
  '<defs><linearGradient id="g" gradientUnits="userSpaceOnUse"><stop offset="0"/></linearGradient></defs>' +
  '<rect id="papier" x="0" y="0" width="10" height="10"/>' +
  '<text x="5" y="5">Ergänzungen &amp; mehr &lt;2027&gt;</text>';

test('mergePages keeps background and groups of ours and appends the strokes only theirs has', () => {
  const ours = serializePage(
    tagPage([strokeAt(300, 400, 'rot', 'o1'), strokeAt(900, 400, 'blau', 'o2')], { thema: 'meins' }),
    FIELDS,
    BACKGROUND,
  );
  const theirs = serializePage(
    tagPage(
      [
        strokeAt(300, 400, 'gruen', 'o1'), // gleiche id: ours gewinnt
        strokeAt(300, 500, 'schwarz', 't1'),
        strokeAt(900, 500, 'schwarz', 't2'),
        strokeAt(300, 520, 'schwarz', 't3'),
        strokeAt(300, 1200, 'schwarz', 't4'),
      ],
      { thema: 'deren' },
    ),
    FIELDS,
    '<rect id="fremd"/>',
  );
  const merged = mergePages(ours, theirs);
  expect(groupsOf(merged)).toEqual([
    { feld: 'notizen', datum: DAY, ids: ['o1', 't1', 't3'] },
    { feld: 'aufgaben', datum: DAY, ids: ['o2', 't2'] },
    { feld: 'frei', datum: DAY, ids: ['t4'] },
  ]);
  const page = parsePage(merged);
  // Ohne gemeinsamen Ausgangspunkt gelten die Kopfdaten von theirs, wo es welche hat.
  expect(page).toMatchObject({ kind: 'tag', key: DAY, meta: { thema: 'deren' } });
  expect(page.strokes.find((s) => s.id === 'o1')?.color).toBe('rot');
  expect(merged).toContain(`<g data-hintergrund="1">${BACKGROUND}</g>`);
  expect(merged).not.toContain('fremd');
  // Die Striche bleiben Zeichen für Zeichen, wie sie in ihrer Datei standen.
  expect(lineOf(merged, 'o1')).toBe(lineOf(ours, 'o1'));
  expect(lineOf(merged, 't1')).toBe(lineOf(theirs, 't1'));
});

test('groups that only theirs has come after the groups of ours, the free strokes stay last', () => {
  const zusatz: FieldBox = { id: 'zusatz', rect: [0, 800, 1192, 400], datum: DAY };
  // ours: Gruppen notizen und frei
  const ours = serializePage(tagPage([strokeAt(300, 400, 'rot', 'o1'), strokeAt(300, 1500, 'rot', 'o2')]), FIELDS, '');
  // theirs: Gruppen notizen und zusatz
  const theirs = serializePage(
    tagPage([strokeAt(300, 400, 'rot', 't1'), strokeAt(300, 1000, 'blau', 't2')]),
    [...FIELDS, zusatz],
    '',
  );
  expect(groupsOf(mergePages(ours, theirs)).map((g) => [g.feld, g.ids])).toEqual([
    ['notizen', ['o1', 't1']],
    ['zusatz', ['t2']],
    ['frei', ['o2']],
  ]);
});

test('a stroke keeps the group date of the file it came from', () => {
  const ours = serializePage(tagPage([strokeAt(300, 400, 'rot', 'o1')]), FIELDS, '');
  const otherDay: FieldBox[] = [{ ...FIELDS[0], datum: '2026-10-30' }];
  const theirs = serializePage(tagPage([strokeAt(300, 400, 'rot', 't1')]), otherDay, '');
  expect(groupsOf(mergePages(ours, theirs))).toEqual([
    { feld: 'notizen', datum: '2026-10-29', ids: ['o1'] },
    { feld: 'notizen', datum: '2026-10-30', ids: ['t1'] },
  ]);
});

test('merging again with the same input changes nothing and duplicates no stroke', () => {
  const ours = serializePage(
    tagPage([strokeAt(300, 400, 'rot', 'o1'), strokeAt(300, 1500, 'blau', 'o2')], { thema: 'meins' }),
    FIELDS,
    BACKGROUND,
  );
  const theirs = serializePage(
    tagPage([strokeAt(300, 400, 'gruen', 'o1'), strokeAt(900, 400, 'rot', 't1'), strokeAt(300, 1000, 'rot', 't2')]),
    FIELDS,
    '',
  );
  const once = mergePages(ours, theirs);
  expect(parsePage(once).strokes.map((s) => s.id).sort()).toEqual(['o1', 'o2', 't1', 't2']);
  expect(mergePages(once, theirs)).toBe(once);
  expect(mergePages(once, ours)).toBe(once);
  expect(mergePages(once, once)).toBe(once);
  // Dieselbe Fassung zweimal ergibt dieselbe Datei.
  expect(mergePages(ours, ours)).toBe(ours);
});

test('mergePages reads both sides strictly: an unreadable file throws', () => {
  expect(() => mergePages('kaputt', svgWith('s1'))).toThrow(/SVG/);
  expect(() => mergePages(svgWith('s1'), '<svg xmlns="http://www.w3.org/2000/svg"/>')).toThrow(/Notizbuchs/);
});

// ---------- Zusammenführen mit gemeinsamem Ausgangspunkt ----------

const MEETING = '2026-10-29 0800 Abstimmung Beispiel 2027';
/** Die Reihenfolge der Kopfdaten, wie die App sie schreibt. */
const HEADER_ORDER = ['thema', 'datum', 'zeit', 'ort', 'projekt', 'seitennr'];

/** Eine Besprechungsseite mit den Kopfdaten, die die App schreibt, und je einem Strich pro `id`. */
function meetingSvg(meta: Record<string, string>, ...ids: string[]): string {
  const full = { thema: 'Abstimmung Beispiel 2027', datum: DAY, zeit: '08:00', ort: '', projekt: '', seitennr: '1', ...meta };
  const strokes = ids.map((id) => strokeAt(300, 400, 'schwarz', id));
  return serializePage({ kind: 'besprechung', key: MEETING, meta: full, strokes }, FIELDS, '');
}

const strokeIds = (svg: string): string[] =>
  parsePage(svg)
    .strokes.map((s) => s.id)
    .sort();

test('with a base, a header change on theirs survives although ours only added strokes', () => {
  const base = meetingSvg({}, 'a');
  const ours = meetingSvg({}, 'a', 'o1');
  const theirs = meetingSvg({ projekt: 'Beispielprojekt A' }, 'a');
  const merged = mergePages(ours, theirs, base);
  expect(parsePage(merged).meta.projekt).toBe('Beispielprojekt A');
  expect(strokeIds(merged)).toEqual(['a', 'o1']);
});

test('with a base, a header change on ours survives although theirs only added strokes', () => {
  const base = meetingSvg({}, 'a');
  const ours = meetingSvg({ projekt: 'Beispielprojekt A' }, 'a');
  const theirs = meetingSvg({}, 'a', 't1');
  const merged = mergePages(ours, theirs, base);
  expect(parsePage(merged).meta.projekt).toBe('Beispielprojekt A');
  expect(strokeIds(merged)).toEqual(['a', 't1']);
});

test('with a base, the header is merged key by key: each side keeps what it changed', () => {
  const base = meetingSvg({ ort: 'Raum 1' });
  const ours = meetingSvg({ ort: 'Raum 3' }); // ours hat den Ort geändert
  const theirs = meetingSvg({ ort: 'Raum 1', projekt: 'Beispielprojekt B', zeit: '09:30' }); // theirs Projekt und Zeit
  const meta = parsePage(mergePages(ours, theirs, base)).meta;
  expect(meta).toEqual({ thema: 'Abstimmung Beispiel 2027', datum: DAY, zeit: '09:30', ort: 'Raum 3', projekt: 'Beispielprojekt B', seitennr: '1' });
  expect(Object.keys(meta)).toEqual(HEADER_ORDER); // die Reihenfolge bleibt, die Sitzung vergleicht Kopfdaten als Text
});

test('with a base, a key that both sides changed takes the value of ours', () => {
  // Gleichzeitig dasselbe Feld verschieden geändert: Eine der beiden Eingaben muss weichen, die dieses Geräts bleibt.
  const base = meetingSvg({ thema: 'Alt' });
  const ours = meetingSvg({ thema: 'Meins' });
  const theirs = meetingSvg({ thema: 'Deren', ort: 'Raum 2' });
  const meta = parsePage(mergePages(ours, theirs, base)).meta;
  expect(meta.thema).toBe('Meins');
  expect(meta.ort).toBe('Raum 2'); // was nur theirs geändert hat, kommt trotzdem
});

test('with a base, a key that only one side has is kept', () => {
  const base = meetingSvg({});
  const ours = meetingSvg({ farbe: 'rot' });
  const theirs = meetingSvg({ raum: 'B' });
  const meta = parsePage(mergePages(ours, theirs, base)).meta;
  expect(meta).toMatchObject({ farbe: 'rot', raum: 'B' });
  expect(Object.keys(meta)).toEqual([...HEADER_ORDER, 'farbe', 'raum']);
});

test('with a base, a key the base does not have counts as empty', () => {
  // Eine Seite aus der Zeit vor den Kopfdaten: Dieses Gerät hat sie beim Lesen ergänzt (Projekt leer), geändert hat es nichts.
  const old = serializePage({ kind: 'besprechung', key: MEETING, meta: { thema: 'Abstimmung Beispiel 2027' }, strokes: [] }, FIELDS, '');
  const ours = meetingSvg({}, 'o1');
  const theirs = meetingSvg({ projekt: 'Beispielprojekt A' });
  expect(parsePage(mergePages(ours, theirs, old)).meta.projekt).toBe('Beispielprojekt A');
});

test('with a base, a stroke erased on ours stays gone and a stroke only theirs has is kept', () => {
  const base = meetingSvg({}, 'a', 'b');
  const ours = meetingSvg({}, 'a'); // b wurde hier radiert
  const theirs = meetingSvg({}, 'a', 'b', 't1'); // dort ist t1 dazugekommen
  expect(strokeIds(mergePages(ours, theirs, base))).toEqual(['a', 't1']);
});

test('with a base, a stroke erased on theirs stays gone and a stroke only ours has is kept', () => {
  const base = meetingSvg({}, 'a', 'b');
  const ours = meetingSvg({}, 'a', 'b', 'o1');
  const theirs = meetingSvg({}, 'a'); // b wurde dort radiert
  expect(strokeIds(mergePages(ours, theirs, base))).toEqual(['a', 'o1']);
});

test('with a base, a stroke erased on both sides is gone, and a group that loses its last stroke disappears', () => {
  const base = serializePage(tagPage([strokeAt(300, 400, 'rot', 'a'), strokeAt(900, 400, 'rot', 'x')]), FIELDS, '');
  const ours = serializePage(tagPage([strokeAt(300, 400, 'rot', 'a')]), FIELDS, '');
  const theirs = serializePage(tagPage([strokeAt(300, 400, 'rot', 'a')]), FIELDS, '');
  const merged = mergePages(ours, theirs, base);
  expect(groupsOf(merged).map((g) => [g.feld, g.ids])).toEqual([['notizen', ['a']]]);
  // Auch wenn nur eine Seite radiert hat, bleibt die Gruppe nicht leer in der Datei stehen.
  const stillThere = serializePage(tagPage([strokeAt(300, 400, 'rot', 'a'), strokeAt(900, 400, 'rot', 'x')]), FIELDS, '');
  expect(groupsOf(mergePages(ours, stillThere, base)).map((g) => [g.feld, g.ids])).toEqual([['notizen', ['a']]]);
});

test('with a base, a stroke that is new on one side is never taken for an erase on the other', () => {
  const base = meetingSvg({}, 'a');
  const merged = mergePages(meetingSvg({}, 'a', 'o1'), meetingSvg({}, 'a', 't1'), base);
  expect(strokeIds(merged)).toEqual(['a', 'o1', 't1']);
});

test('with a base, nothing changes on either side: the result is the page', () => {
  const page = meetingSvg({ ort: 'Raum 1' }, 'a', 'b');
  expect(mergePages(page, page, page)).toBe(page);
});

test('without a base the strokes are united, an erased stroke comes back', () => {
  const ours = meetingSvg({}, 'a', 'o1');
  const theirs = meetingSvg({}, 'a', 'b');
  const merged = mergePages(ours, theirs);
  expect(strokeIds(merged)).toEqual(['a', 'b', 'o1']);
  expect(mergePages(ours, theirs, undefined)).toBe(merged);
});

test('without a base the header comes from theirs wherever theirs has a value, ours only fills what theirs lacks or leaves empty', () => {
  // Am PC wurde die Besprechung aus dem Termin angelegt und das Projekt gewählt. Das iPad hat dieselbe Besprechung ohne Netz
  // aus demselben Termin neu angelegt: Es kennt die Datei nicht, sein Projekt ist leer, den Ort hat es dazugeschrieben.
  const ours = meetingSvg({ projekt: '', ort: 'Raum 3', farbe: 'rot' }, 'o1');
  const theirs = meetingSvg({ projekt: 'Beispielprojekt A', ort: '', zeit: '09:30', raum: 'B' }, 't1');
  const page = parsePage(mergePages(ours, theirs));
  expect(page.meta).toEqual({
    thema: 'Abstimmung Beispiel 2027',
    datum: DAY,
    zeit: '09:30', // beide haben einen Wert: der von theirs
    ort: 'Raum 3', // theirs leer: ours füllt
    projekt: 'Beispielprojekt A', // ours leer: theirs
    seitennr: '1',
    farbe: 'rot', // nur ours hat die Angabe
    raum: 'B', // nur theirs hat die Angabe
  });
  expect(Object.keys(page.meta)).toEqual([...HEADER_ORDER, 'farbe', 'raum']); // die Reihenfolge von ours, dann was nur theirs hat
  expect(page.strokes.map((s) => s.id).sort()).toEqual(['o1', 't1']);
});

test('a base that is not a readable page is no base: the merge is the plain union', () => {
  const ours = meetingSvg({}, 'a');
  const theirs = meetingSvg({ projekt: 'Beispielprojekt A' }, 'a', 'b');
  const union = mergePages(ours, theirs);
  for (const bad of ['', 'kaputt', '<svg xmlns="http://www.w3.org/2000/svg"/>']) expect(mergePages(ours, theirs, bad), bad).toBe(union);
});

test('merging again with a base changes nothing', () => {
  const base = meetingSvg({ ort: 'Raum 1' }, 'a', 'b');
  const ours = meetingSvg({ ort: 'Raum 3' }, 'a', 'o1'); // Ort geändert, b radiert, o1 dazu
  const theirs = meetingSvg({ ort: 'Raum 1', projekt: 'Beispielprojekt A' }, 'a', 'b', 't1');
  const once = mergePages(ours, theirs, base);
  expect(strokeIds(once)).toEqual(['a', 'o1', 't1']);
  expect(parsePage(once).meta).toMatchObject({ ort: 'Raum 3', projekt: 'Beispielprojekt A' });
  expect(mergePages(once, theirs, base)).toBe(once);
  expect(mergePages(once, ours, base)).toBe(once);
  expect(mergePages(once, once, base)).toBe(once);
});

test('mergePages reads the base strictly only when it needs it: an unreadable page on either side still throws', () => {
  const base = meetingSvg({}, 'a');
  expect(() => mergePages('kaputt', meetingSvg({}, 'a'), base)).toThrow(/SVG/);
  expect(() => mergePages(meetingSvg({}, 'a'), 'kaputt', base)).toThrow(/SVG/);
});

test('merge after partial erase keeps the cut', async () => {
  const { cutStroke } = await import('../../src/ink/erase');
  const whole: Stroke = { id: 'a', tool: 'kugel', color: 'schwarz', widthMm: 0.2, t: 1, w: 1.2, pts: [{ x: 100, y: 300, w: 1.2 }, { x: 400, y: 300, w: 1.2 }] };
  let n = 0;
  const pieces = cutStroke(whole, { x: 250, y: 300 }, 5, () => `p${++n}`)!;
  const base = serializePage(tagPage([whole]), FIELDS, '');
  const ours = serializePage(tagPage(pieces), FIELDS, '');
  const merged = parsePage(mergePages(ours, base, base)).strokes.map((s) => s.id);
  expect(merged).not.toContain('a');
  expect(merged.sort()).toEqual(['p1', 'p2']);
});

// ---------- Neue Stifte und Version 2 ----------

/** Ein Strich mit dem Stift `pen`, gebaut wie in der App: leicht geschwungen, mit Druck und Neigung. */
function penStroke(pen: PenKind, color: InkColor = 'blau', id?: string): Stroke {
  const b = new StrokeBuilder({ pen, color, widthMm: 0.4, sigma: 1, t: 5000 + ++counter, minDist: 0.5 });
  for (let i = 0; i < 12; i++) b.add(100 + i * 8, 300 + Math.sin(i / 2) * 10, 0.3 + i * 0.05, 20, 30);
  const s = b.stroke();
  return id ? { ...s, id } : s;
}

const version = (svg: string) => /data-notizbuch="(\d+)"/.exec(svg)?.[1];

test('a page with ballpoint strokes only stays version 1 without defs', () => {
  const svg = serializePage(tagPage([penStroke('kugel')]), FIELDS, '');
  expect(FORMAT_VERSION).toBe(2);
  expect(version(svg)).toBe('1');
  expect(svg).not.toContain('<defs>');
  expect(svg).not.toContain('data-linie');
});

test('a fineliner stroke is a line with its own tool name and makes the page version 2', () => {
  const s = penStroke('fineliner');
  const svg = serializePage(tagPage([s]), FIELDS, '');
  expect(version(svg)).toBe('2');
  expect(svg).not.toContain('<defs>');
  const line = lineOf(svg, s.id)!;
  expect(line).toContain('data-werkzeug="fineliner"');
  expect(line).toContain('fill="none"');
  expect(line).toContain(`stroke="${INK.blau}"`);
  expect(parsePage(svg).strokes[0].tool).toBe('fineliner');
});

test('a fountain pen stroke is a filled outline with its centre line and widths', () => {
  const s = penStroke('fueller', 'blau');
  const svg = serializePage(tagPage([s]), FIELDS, '');
  expect(version(svg)).toBe('2');
  const line = lineOf(svg, s.id)!;
  expect(line).not.toContain('stroke=');
  expect(line).toContain(`fill="${INK.blau}"`);
  expect(line).toContain('data-linie="');
  const back = parsePage(svg).strokes[0];
  expect(back.tool).toBe('fueller');
  expect(back.color).toBe('blau');
  expect(back.pts).toHaveLength(s.pts.length);
  s.pts.forEach((p, i) => {
    // Orte und Breite mit zwei Nachkommastellen.
    expect(Math.abs(back.pts[i].x - p.x)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(back.pts[i].y - p.y)).toBeLessThanOrEqual(0.005 + 1e-9);
    expect(Math.abs(back.pts[i].w - p.w)).toBeLessThanOrEqual(0.005 + 1e-9);
  });
});

test('the centre line keeps two decimals for places and widths', () => {
  const s: Stroke = {
    id: 'f1',
    tool: 'fueller',
    color: 'schwarz',
    widthMm: 0.2,
    t: 5,
    w: 0.967,
    pts: [
      { x: 10.04, y: 20.06, w: 0.734 },
      { x: 30, y: 40.04, w: 1.2 },
    ],
  };
  const svg = serializePage(tagPage([s]), FIELDS, '');
  // x, y und die Breite mit zwei Nachkommastellen, ohne Nullen am Ende.
  expect(lineOf(svg, 'f1')).toContain(' data-linie="10.04 20.06 0.73 30 40.04 1.2" ');
  expect(parsePage(svg).strokes[0].pts).toEqual([
    { x: 10.04, y: 20.06, w: 0.73 },
    { x: 30, y: 40.04, w: 1.2 },
  ]);
  // Eine Datei von früher hat Orte und Breite mit einer Nachkommastelle: Sie wird weiter gelesen.
  const old = svg.replace(' data-linie="10.04 20.06 0.73 30 40.04 1.2" ', ' data-linie="10 20.1 0.7 30 40 1.2" ');
  expect(old).not.toBe(svg);
  expect(parsePage(old).strokes[0].pts).toEqual([
    { x: 10, y: 20.1, w: 0.7 },
    { x: 30, y: 40, w: 1.2 },
  ]);
});

test('a pencil stroke is grey, see through and grainy, and the grain is defined once', () => {
  const a = penStroke('bleistift');
  const b = penStroke('bleistift');
  const svg = serializePage(tagPage([a, b]), FIELDS, '');
  expect(version(svg)).toBe('2');
  expect(svg.match(/<defs>/g)).toHaveLength(1);
  expect(svg.match(/id="bleistift"/g)).toHaveLength(1);
  expect(svg.split('\n')[1]).toBe('  <defs>' + svg.split('\n')[1].slice(8));
  const line = lineOf(svg, a.id)!;
  expect(line).toContain('data-farbe="grau"');
  expect(line).toContain(`fill="${INK.grau}"`);
  expect(line).toContain('fill-opacity="0.85"');
  expect(line).toContain('filter="url(#bleistift)"');
  const back = parsePage(svg).strokes;
  expect(back.map((x) => x.tool)).toEqual(['bleistift', 'bleistift']);
  expect(back[0].color).toBe('grau');
});

test('a single point with the fountain pen survives the roundtrip', () => {
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.4, sigma: 1, t: 1, minDist: 0.5 });
  b.add(300, 400, 0.5, 20, 30);
  const s = b.stroke();
  expect(s.pts).toHaveLength(1);
  const svg = serializePage(tagPage([s]), FIELDS, '');
  expect(lineOf(svg, s.id)).toMatch(/ d="M /);
  const back = parsePage(svg).strokes;
  expect(back).toHaveLength(1);
  expect(back[0].tool).toBe('fueller');
  expect(back[0].pts).toHaveLength(1);
  expect(Math.abs(back[0].pts[0].w - s.pts[0].w)).toBeLessThanOrEqual(0.05);
});

test('a cut fountain pen stroke is still written as an outline', () => {
  const s = penStroke('fueller', 'rot');
  const left = { ...s, id: 'l1', pts: s.pts.slice(0, 4) };
  const right = { ...s, id: 'r1', pts: s.pts.slice(8) };
  const svg = serializePage(tagPage([left, right]), FIELDS, '');
  expect(version(svg)).toBe('2');
  for (const id of ['l1', 'r1']) expect(lineOf(svg, id)).toContain('data-linie="');
  const back = parsePage(svg).strokes;
  expect(back.map((x) => [x.id, x.tool, x.color, x.pts.length])).toEqual([
    ['l1', 'fueller', 'rot', 4],
    ['r1', 'fueller', 'rot', 4],
  ]);
});

test('merging a version 1 page with a version 2 page gives version 2 with the grain', () => {
  const ours = serializePage(tagPage([penStroke('kugel', 'blau', 'k1')]), FIELDS, '');
  const theirs = serializePage(tagPage([penStroke('bleistift', 'blau', 'b1')]), FIELDS, '');
  const merged = mergePages(ours, theirs);
  expect(version(merged)).toBe('2');
  expect(merged.match(/<defs>/g)).toHaveLength(1);
  expect(merged).toContain('id="bleistift"');
  expect(strokeIds(merged)).toEqual(['b1', 'k1']);
  expect(lineOf(merged, 'b1')).toBe(lineOf(theirs, 'b1'));
});

test('when all new pens are erased the merged page goes back to version 1', () => {
  const k = penStroke('kugel', 'blau', 'k1');
  const p = penStroke('bleistift', 'blau', 'b1');
  const base = serializePage(tagPage([k, p]), FIELDS, '');
  const ours = serializePage(tagPage([k]), FIELDS, '');
  const merged = mergePages(ours, base, base);
  expect(strokeIds(merged)).toEqual(['k1']);
  expect(version(merged)).toBe('1');
  expect(merged).not.toContain('<defs>');
});

test('a page of version 3 is too new', () => {
  const svg = svgWith('a').replace('data-notizbuch="1"', 'data-notizbuch="3"');
  expect(() => parsePage(svg)).toThrow(PageTooNewError);
  try {
    parsePage(svg);
  } catch (e) {
    expect((e as PageTooNewError).version).toBe(3);
    expect((e as Error).message).toBe('Diese Seite stammt aus einer neueren Version der App.');
  }
});

test('a missing or broken version number is not a page of the notebook', () => {
  for (const v of ['', '0', 'x', '1.5']) {
    const svg = svgWith('a').replace('data-notizbuch="1"', `data-notizbuch="${v}"`);
    let err: unknown;
    try {
      parsePage(svg);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(err).not.toBeInstanceOf(PageTooNewError);
  }
});

test('a broken centre line or an unknown tool skips only that stroke', () => {
  const good = penStroke('fueller', 'blau', 'gut');
  const svg = serializePage(tagPage([good, penStroke('fueller', 'blau', 'x1'), penStroke('fueller', 'blau', 'x2'), penStroke('kugel', 'blau', 'x3')]), FIELDS, '');
  const lines = svg.split('\n').map((l) => {
    if (l.includes('data-id="x1"')) return l.replace(/data-linie="[^"]*"/, 'data-linie="1 2"');
    if (l.includes('data-id="x2"')) return l.replace(/data-linie="[^"]*"/, 'data-linie="a b c"');
    if (l.includes('data-id="x3"')) return l.replace('data-werkzeug="kugel"', 'data-werkzeug="pinsel"');
    return l;
  });
  expect(parsePage(lines.join('\n')).strokes.map((s) => s.id)).toEqual(['gut']);
});

// ---------- Genauigkeit der Datei ----------

/** Seiteneinheiten je Bildschirmpunkt bei Zoom 6,7: So weit hineingezoomt liegen die Punkte eines Strichs nur etwa 0,1 Einheiten auseinander. */
const ZOOMED = 0.15;

/** Leichtes Zittern des Stifts, bis 0,15 Bildschirmpunkte zu jeder Seite, je `seed` (ab 1) anders. */
function tremorOf(seed: number): () => number {
  let r = seed;
  return () => {
    r = (r * 16807) % 2147483647;
    return (r / 2147483647 - 0.5) * 0.3;
  };
}

/** Die Strich-Stabilisierung, mit der die Füllfeder um `px` Bildschirmpunkte glättet: `stabilSigmaPx` umgekehrt. */
function stabilFor(px: number): number {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (stabilSigmaPx(mid) < px) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Drei kleine Schleifen mit der Füllfeder, gezoomt geschrieben wie in der Probe im Konzept. Gemessen in Bildschirmpunkten: Radius
 * 6,7, 240 Messpunkte je Sekunde (je Messpunkt 0,16 rad weiter auf der Schleife) und leichtes Zittern (`tremorOf`). Fertig wie
 * nach dem Abheben, aber noch ungerundet. Der Strich liegt `seed` × 10 Einheiten tiefer. Mit `pxUnit` 1 in normaler Größe
 * geschrieben, mit `pen` mit einem anderen Stift, mit `sigmaPx` mit dieser Stabilisierung statt der von heute.
 */
function zoomedLoops(seed: number, o: { pxUnit?: number; pen?: PenKind; sigmaPx?: number } = {}): Stroke {
  const { pxUnit = ZOOMED, pen = 'fueller', sigmaPx } = o;
  const tremor = tremorOf(seed);
  const fueller = sigmaPx === undefined ? undefined : { ...DEFAULT_FUELLER, stabil: stabilFor(sigmaPx) };
  const b = new StrokeBuilder({ pen, color: 'schwarz', widthMm: 0.2, sigma: 1, t: 1793853900000 + seed, minDist: MIN_DIST_PX * pxUnit, pxUnit, fueller });
  const steps = Math.round((6 * Math.PI) / 0.16);
  for (let i = 0; i <= steps; i++) {
    const a = i * 0.16;
    const x = 6.7 * (0.45 * a - Math.sin(a)) + tremor();
    const y = 6.7 * 1.3 * (Math.cos(a) - 1) + tremor();
    b.add(100 + x * pxUnit, 100 + 10 * seed + y * pxUnit, 0.5, 40, 40, (i * 1000) / 240);
  }
  return b.finish((steps * 1000) / 240);
}

/** Je Ecke aller Vielecke der Winkel in Grad, um den der Rand dort abknickt. */
function cornerTurns(polys: Pt2[][]): number[] {
  return polys.flatMap((poly) =>
    poly.map((b, i) => {
      const a = poly[(i + poly.length - 1) % poly.length];
      const c = poly[(i + 1) % poly.length];
      const [ux, uy, vx, vy] = [b.x - a.x, b.y - a.y, c.x - b.x, c.y - b.y];
      return (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI;
    }),
  );
}

/**
 * Der mittlere Winkel in Grad, um den der Rand an den Ecken aller Vielecke abknickt. Ein zerfranster Umriss knickt an vielen Ecken
 * stark ab (und zerfällt an Knicken über 60 Grad in mehrere Vielecke).
 */
function meanTurn(polys: Pt2[][]): number {
  const turns = cornerTurns(polys);
  return turns.reduce((sum, t) => sum + t, 0) / turns.length;
}

/** Wie viele Ecken aller Vielecke schärfer als 45 Grad abknicken. */
const sharpCorners = (polys: Pt2[][]) => cornerTurns(polys).filter((t) => t > 45).length;

/** Die Orte der Punkte ohne Breite. */
const places = (s: Stroke) => s.pts.map(({ x, y }) => ({ x, y }));

/**
 * Eine Seite, wie die App sie vor Paket 3d schrieb: alle Orte mit höchstens einer Nachkommastelle, die Breiten in `data-linie`
 * mit zwei. Ein Kugelschreiberstrich und ein locker geschriebener Füllfederstrich (die Punkte liegen gut 1,5 Einheiten auseinander).
 */
const OLD_PAGE = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1192 1590" width="1192" height="1590" data-notizbuch="2" data-seite="tag" data-schluessel="2026-10-29">',
  '  <g data-hintergrund="1"></g>',
  '  <g data-feld="frei" data-datum="2026-10-29">',
  '    <path data-id="s1793253000000alt1" data-werkzeug="kugel" data-farbe="schwarz" data-breite="0.2" data-t="1793253000000" d="M 100.1 200.5 Q 103.8 201.2 105.7 200.6 Q 107.6 200 108.8 200.3 L 110 200.5" fill="none" stroke="#1c1f26" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
  '    <path data-id="s1793253001000alt2" data-werkzeug="fueller" data-farbe="blau" data-breite="0.4" data-t="1793253001000" data-linie="120.3 300.1 0.42 121.9 301.4 1.37 123.6 302.2 2.05 125.4 302.6 2.31 127.2 302.5 1.88 128.9 301.9 0.56" d="M 120.2 300.3 L 121.5 302 L 123.3 303.2 L 125.3 303.8 L 127.4 303.4 L 129 302.2 L 129.1 302.1 L 129.2 302 L 129.2 301.8 L 129.1 301.7 L 129 301.6 L 128.8 301.6 L 123.9 301.2 L 122.3 300.8 L 120.4 299.9 L 120.3 299.9 L 120.2 299.9 L 120.1 300 L 120.1 300.1 L 120.1 300.2 Z" fill="#1f4fa3"/>',
  '  </g>',
  '</svg>',
  '',
].join('\n');

test('zoomed strokes keep their shape through the file', () => {
  // Sechzehn Mal dieselben Schleifen, jedes Mal anders zittrig. Bei einem einzelnen Umriss schwankt der mittlere Eckwinkel schon bei
  // winzigen Änderungen um bis zu 2 Grad (die Vereinfachung wählt andere Ecken), über die Seite gemessen bleibt, was das Runden
  // ausmacht. Auf eine Nachkommastelle gerundet knickt der Rand im Mittel um 15 Grad mehr ab, und fast jeder Umriss zerfällt.
  const written = Array.from({ length: 16 }, (_, k) => zoomedLoops(k + 1));
  const read = parsePage(serializePage(tagPage(written), FIELDS, '')).strokes;
  expect(read.map((s) => s.id)).toEqual(written.map((s) => s.id));
  const before = written.map((s) => outlinePolygons(s.pts));
  const after = read.map((s) => outlinePolygons(s.pts));
  const was = meanTurn(before.flat());
  expect(meanTurn(after.flat()), `vorher ${was.toFixed(1)} Grad`).toBeLessThanOrEqual(was + 2);
  // Kein Umriss zerfällt in mehr Teile als vorher.
  expect(after.map((polys, i) => polys.length - before[i].length).filter((more) => more > 0)).toEqual([]);
});

test('storedForm rounds the points as the file keeps them and leaves the rest', () => {
  const fueller: Stroke = {
    id: 'f1',
    tool: 'fueller',
    color: 'blau',
    widthMm: 0.4,
    t: 5,
    w: 0.968,
    pts: [
      { x: 10.004, y: -0.004, w: 0.736 },
      { x: 20.006, y: 40.5, w: 1.2 },
    ],
  };
  const copy = structuredClone(fueller);
  // Füllfeder und Bleistift: Orte und Breite je Punkt mit zwei Nachkommastellen, nie -0. `w` ist das Mittel dieser Breiten, so wie
  // `parsePage` es aus der Datei rechnet. Alles andere bleibt.
  for (const tool of ['fueller', 'bleistift'] as const) {
    expect(storedForm({ ...fueller, tool }), tool).toEqual({
      ...fueller,
      tool,
      w: (0.74 + 1.2) / 2,
      pts: [
        { x: 10, y: 0, w: 0.74 },
        { x: 20.01, y: 40.5, w: 1.2 },
      ],
    });
  }
  // Kugelschreiber und Fineliner: die Orte, und `w` mit einer Nachkommastelle wie `stroke-width` in der Datei. Die Breite je Punkt
  // bleibt, die Datei hat für sie eine Breite je Strich.
  for (const tool of ['kugel', 'fineliner'] as const) {
    expect(storedForm({ ...fueller, tool }), tool).toEqual({
      ...fueller,
      tool,
      w: 1,
      pts: [
        { x: 10, y: 0, w: 0.736 },
        { x: 20.01, y: 40.5, w: 1.2 },
      ],
    });
  }
  // Neue Punkte: Der Strich, aus dem sie entstehen, bleibt, wie er war.
  expect(fueller).toEqual(copy);
});

test('what you see after lifting is what is saved', () => {
  // So nimmt die Fläche einen fertigen Strich auf: gezoomte Füllfeder, Kugelschreiber und Fineliner.
  const shown = [storedForm(zoomedLoops(1)), storedForm(penStroke('kugel')), storedForm(penStroke('fineliner'))];
  // Die Orte haben wirklich zwei Nachkommastellen, sonst bewiese der Vergleich wenig.
  expect(shown[0].pts.some((p) => Math.round(p.x * 10) / 10 !== p.x)).toBe(true);
  const svg = serializePage(tagPage(shown), FIELDS, '');
  const back = parsePage(svg).strokes;
  // Füllfeder: Ort und Breite jedes Punkts genau gleich.
  expect(back[0].pts).toEqual(shown[0].pts);
  // Kugelschreiber und Fineliner: jeder Ort genau gleich (die Breite steht für den ganzen Strich in `stroke-width`).
  expect(back.slice(1).map(places)).toEqual(shown.slice(1).map(places));
  // Die Breite des ganzen Strichs, mit der Kugelschreiber und Fineliner gezeichnet werden: bei jedem Stift genau gleich.
  expect(back.map((s) => s.w)).toEqual(shown.map((s) => s.w));
  // Noch einmal gespeichert: dieselbe Datei.
  expect(serializePage(tagPage(back), FIELDS, '')).toBe(svg);

  // Teil-Radieren mit dem kleinen Radierer: Die Stücke kommen ebenso in der Form der Datei auf die Seite.
  let n = 0;
  const cut = cutStroke(shown[0], shown[0].pts[60], ERASER_PX.klein * ZOOMED, () => `stueck${++n}`);
  const pieces = (cut ?? []).map(storedForm);
  expect(pieces.length).toBeGreaterThanOrEqual(2);
  const backPieces = parsePage(serializePage(tagPage(pieces), FIELDS, '')).strokes;
  expect(backPieces.map((s) => s.pts)).toEqual(pieces.map((s) => s.pts));
  expect(backPieces.map((s) => s.w)).toEqual(pieces.map((s) => s.w));
});

test('old one decimal pages still read', () => {
  const old = parsePage(OLD_PAGE);
  expect(old.strokes).toEqual([
    {
      id: 's1793253000000alt1',
      tool: 'kugel',
      color: 'schwarz',
      widthMm: 0.2,
      t: 1793253000000,
      w: 1.2,
      pts: [
        { x: 100.1, y: 200.5, w: 1.2 },
        { x: 103.8, y: 201.2, w: 1.2 },
        { x: 107.6, y: 200, w: 1.2 },
        { x: 110, y: 200.5, w: 1.2 },
      ],
    },
    {
      id: 's1793253001000alt2',
      tool: 'fueller',
      color: 'blau',
      widthMm: 0.4,
      t: 1793253001000,
      w: (0.42 + 1.37 + 2.05 + 2.31 + 1.88 + 0.56) / 6,
      pts: [
        { x: 120.3, y: 300.1, w: 0.42 },
        { x: 121.9, y: 301.4, w: 1.37 },
        { x: 123.6, y: 302.2, w: 2.05 },
        { x: 125.4, y: 302.6, w: 2.31 },
        { x: 127.2, y: 302.5, w: 1.88 },
        { x: 128.9, y: 301.9, w: 0.56 },
      ],
    },
  ]);
  // Mit der neuen Genauigkeit gespeichert und wieder gelesen: dieselben Striche.
  expect(parsePage(serializePage(old, [], '')).strokes).toEqual(old.strokes);
});

test('merging keeps the new precision', () => {
  // Dieses Gerät hat die alte Seite gelesen und gezoomt weitergeschrieben, das andere hat noch die alte Fassung.
  const old = parsePage(OLD_PAGE).strokes;
  const fresh = [storedForm(zoomedLoops(1)), storedForm(penStroke('kugel', 'blau', 'k-neu'))];
  const ours = serializePage(tagPage([...old, ...fresh]), FIELDS, '');
  const merges = { 'mit Ausgangspunkt': mergePages(ours, OLD_PAGE, OLD_PAGE), ohne: mergePages(ours, OLD_PAGE), umgekehrt: mergePages(OLD_PAGE, ours) };
  for (const [name, merged] of Object.entries(merges)) {
    const strokes = parsePage(merged).strokes;
    const byId = (id: string) => strokes.find((s) => s.id === id);
    // Die neuen Striche Zeichen für Zeichen wie in ihrer Datei, also Punkt für Punkt mit zwei Nachkommastellen wie gezeigt.
    expect(lineOf(merged, fresh[0].id), name).toBe(lineOf(ours, fresh[0].id));
    expect(byId(fresh[0].id)?.pts, name).toEqual(fresh[0].pts);
    expect(places(byId('k-neu')!), name).toEqual(places(fresh[1]));
    // Die alten wie vorher.
    for (const s of old) expect(byId(s.id), name).toEqual(s);
  }
});

// ---------- Alte zerfranste Striche ----------

/**
 * Alte Striche entstanden mit der Stabilisierung, die bis Paket 3d galt: beim Startwert 14 % ein σ von 2,97 Bildschirmpunkten. Die
 * Proben unten schreiben sie mit genau diesem σ, so bleiben sie gleich, auch wenn sich die Formel der Stabilisierung ändert.
 */
const OLD_SIGMA_PX = 2.97;

/** Der Strich so, wie ihn die App vor Paket 3d in die Datei schrieb: Orte mit einer Nachkommastelle, Breiten mit zwei. */
function asOld(s: Stroke): Stroke {
  return { ...s, pts: s.pts.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, w: toHundredths(p.w) })) };
}

/** Der Median der Abstände aufeinanderfolgender Punkte. */
function medianStep(pts: readonly Pt[]): number {
  const steps = pts
    .slice(1)
    .map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y))
    .sort((a, b) => a - b);
  const m = steps.length >> 1;
  return steps.length % 2 ? steps[m] : (steps[m - 1] + steps[m]) / 2;
}

/**
 * Eine Schleife mit der Füllfeder, gezoomt geschrieben wie `zoomedLoops` mit der alten Stabilisierung: 1,25 Umläufe um (300, 400)
 * mit Radius 6,7 Bildschirmpunkten (1 Einheit), je Messpunkt 0,16 rad weiter, mit Zittern. Fertig wie nach dem Abheben, noch ungerundet.
 */
function zoomedCircle(seed: number): Stroke {
  const tremor = tremorOf(seed);
  const fueller = { ...DEFAULT_FUELLER, stabil: stabilFor(OLD_SIGMA_PX) };
  const b = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm: 0.2, sigma: 1, t: 1793853950000 + seed, minDist: MIN_DIST_PX * ZOOMED, pxUnit: ZOOMED, fueller });
  const steps = Math.round((2.5 * Math.PI) / 0.16);
  for (let i = 0; i <= steps; i++) {
    const a = i * 0.16;
    b.add(300 + (6.7 * Math.cos(a) + tremor()) * ZOOMED, 400 + (6.7 * Math.sin(a) + tremor()) * ZOOMED, 0.5, 40, 40, (i * 1000) / 240);
  }
  return b.finish((steps * 1000) / 240);
}

/** Der Radius der Schleife von `zoomedCircle`: der mittlere Abstand der Punkte von ihrem Mittelpunkt. */
const loopRadius = (s: Stroke) => s.pts.reduce((sum, p) => sum + Math.hypot(p.x - 300, p.y - 400), 0) / s.pts.length;

test('an old dense stroke is repaired on reading', () => {
  // Die sechzehn Schleifen von oben, gezoomt mit der alten Stabilisierung geschrieben und so gespeichert, wie es die App vor Paket 3d
  // tat. Ohne Reparatur knickt der Rand gelesen im Mittel um 16 Grad mehr ab als ungerundet, hat fast viermal so viele scharfe Ecken,
  // und jeder Umriss zerfällt in Teile.
  const written = Array.from({ length: 16 }, (_, k) => zoomedLoops(k + 1, { sigmaPx: OLD_SIGMA_PX }));
  const old = written.map(asOld);
  expect(old.every((s) => s.pts.length >= 5 && medianStep(s.pts) < 0.35)).toBe(true);
  const read = parsePage(serializePage(tagPage(old), FIELDS, '')).strokes;
  expect(read.map((s) => s.id)).toEqual(written.map((s) => s.id));
  const before = written.map((s) => outlinePolygons(s.pts));
  const after = read.map((s) => outlinePolygons(s.pts));
  const was = meanTurn(before.flat());
  // Repariert so ruhig wie ungerundet: im Mittel höchstens 2 Grad mehr (geeicht 1,4: Der ausgedünnte Umriss hat weniger Ecken, in
  // der Summe knickt er 5 % weniger ab), nicht mehr scharfe Ecken (geeicht 114 statt 134) und kein Umriss in mehr Teilen.
  expect(meanTurn(after.flat()), `ungerundet ${was.toFixed(1)} Grad`).toBeLessThanOrEqual(was + 2);
  expect(sharpCorners(after.flat())).toBeLessThanOrEqual(sharpCorners(before.flat()));
  expect(after.map((polys, i) => polys.length - before[i].length).filter((more) => more > 0)).toEqual([]);
});

test('an old loose stroke stays as it is', () => {
  // Dieselben Schleifen in normaler Größe geschrieben (Zoom 1): Die Punkte liegen weit genug auseinander, das Runden stört nicht.
  const loose = asOld(zoomedLoops(1, { pxUnit: 1, sigmaPx: OLD_SIGMA_PX }));
  expect(medianStep(loose.pts)).toBeGreaterThan(0.35);
  expect(parsePage(serializePage(tagPage([loose]), FIELDS, '')).strokes[0].pts).toEqual(loose.pts);
});

test('new precision is never repaired', () => {
  // Gezoomt geschrieben und mit zwei Nachkommastellen gespeichert: so dicht wie die alten Striche oben, aber genau.
  const fresh = [storedForm(zoomedLoops(1)), storedForm(zoomedLoops(2, { pen: 'bleistift' }))];
  expect(fresh.every((s) => medianStep(s.pts) < 0.35)).toBe(true);
  const read = parsePage(serializePage(tagPage(fresh), FIELDS, '')).strokes;
  expect(read.map((s) => s.pts)).toEqual(fresh.map((s) => s.pts));
  // Schon eine einzige Zahl mit zwei Nachkommastellen zeigt die neue Genauigkeit.
  const old = asOld(zoomedLoops(3, { sigmaPx: OLD_SIGMA_PX }));
  const mixed = { ...old, pts: old.pts.map((p, i) => (i === 40 ? { ...p, x: toHundredths(p.x + 0.01) } : p)) };
  expect(parsePage(serializePage(tagPage([mixed]), FIELDS, '')).strokes[0].pts).toEqual(mixed.pts);
});

test('the repair keeps loops and ends', () => {
  const written = zoomedCircle(1);
  const old = asOld(written);
  const read = parsePage(serializePage(tagPage([old]), FIELDS, '')).strokes[0];
  expect(places(read)).not.toEqual(places(old));
  // Anfang und Ende bleiben genau dort, wo sie in der Datei stehen.
  expect(places(read).at(0)).toEqual(places(old).at(0));
  expect(places(read).at(-1)).toEqual(places(old).at(-1));
  // Die Schleife wird höchstens 3 % kleiner als ungerundet (geeicht: 0,1 % kleiner).
  expect(loopRadius(read) / loopRadius(written)).toBeGreaterThanOrEqual(0.97);
});

test('the repair happens once', () => {
  // Eine alte Seite: gezoomt geschriebene Füllfeder und Bleistift, eine locker geschriebene Füllfeder und ein Kugelschreiber, dazu ein
  // neuer Strich. Lesen, speichern, lesen, speichern.
  const old = [
    asOld(zoomedLoops(1, { sigmaPx: OLD_SIGMA_PX })),
    asOld(zoomedLoops(2, { pen: 'bleistift' })),
    asOld(zoomedLoops(3, { pxUnit: 1, sigmaPx: OLD_SIGMA_PX })),
    asOld(penStroke('kugel')),
    storedForm(zoomedLoops(4)),
  ];
  const file = serializePage(tagPage(old), FIELDS, '');
  const read = parsePage(file).strokes;
  expect(read.map((s) => s.id)).toEqual(old.map((s) => s.id));
  // Repariert werden nur die beiden dichten alten Striche.
  expect(places(read[0])).not.toEqual(places(old[0]));
  expect(places(read[1])).not.toEqual(places(old[1]));
  expect(read.slice(2).map(places)).toEqual(old.slice(2).map(places));
  // Nach dem ersten Speichern bleibt alles, wie es ist: dieselben Striche und dieselbe Datei.
  const saved = serializePage(tagPage(read), FIELDS, '');
  const again = parsePage(saved).strokes;
  expect(again).toEqual(read);
  expect(serializePage(tagPage(again), FIELDS, '')).toBe(saved);
  // Mit der alten Fassung zusammengeführt, gleich welche gewinnt: gelesen dieselben Striche.
  for (const merged of [mergePages(saved, file, file), mergePages(file, saved)]) expect(parsePage(merged).strokes).toEqual(read);
});

test('old ballpoint and fineliner strokes are never repaired', () => {
  // So dicht und so alt wie die Füllfeder oben: Ihre Punkte bleiben, wie sie in der Datei stehen, auch die doppelten.
  const old = [asOld(zoomedLoops(1, { pen: 'kugel' })), asOld(zoomedLoops(2, { pen: 'fineliner' }))];
  expect(old.every((s) => s.pts.length >= 5 && medianStep(s.pts) < 0.35)).toBe(true);
  const read = parsePage(serializePage(tagPage(old), FIELDS, '')).strokes;
  expect(read.map(places)).toEqual(old.map(places));
});
