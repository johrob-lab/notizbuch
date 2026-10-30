import { expect, test, vi } from 'vitest';
import { StrokeBuilder } from '../../src/ink/stroke';
import { mergePages, parsePage, serializePage } from '../../src/ink/svg';
import type { FieldBox, InkColor, Page, Stroke } from '../../src/ink/types';

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
      '    <path data-id="s1793251082972a" data-werkzeug="kugel" data-farbe="rot" data-breite="0.2" data-t="1793251082972" d="M 10.5 20 L 30 40" fill="none" stroke="#c62828" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>',
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
  back.pts.forEach((p, i) => {
    expect(Math.abs(p.x - stroke.pts[i].x), `x ${i}`).toBeLessThanOrEqual(0.05 + 1e-9);
    expect(Math.abs(p.y - stroke.pts[i].y), `y ${i}`).toBeLessThanOrEqual(0.05 + 1e-9);
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
  expect(() => parsePage('<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="2"></svg>')).toThrow(
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
