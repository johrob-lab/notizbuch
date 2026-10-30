import { expect, test } from 'vitest';
import { toggleTask, visibleText } from '../../src/lib/dailyNote';
import { renderNote } from '../../src/lib/markdown';
import { fixture, lineOf } from './helpers';

const md = fixture('05 Daily Notes/2026-10-29.md');
const at = (s: string) => lineOf(md, s);
// Mit YAML-Kopf (Zeilen 0 bis 3) und einer verschachtelten Liste.
const note = '---\ndate: 2026-10-29\ntags: [daily]\n---\n# Titel\n\n- [ ] Eltern\n  - [x] Kind\n  - Kind ohne Kästchen\n- Zweiter\n';
// Alle Kästchen einer Ausgabe mit Zeilennummer und Haken.
const checkboxes = (html: string) =>
  [...html.matchAll(/<input type="checkbox" data-line="(\d+)"( checked)?>/g)].map((m) => ({ line: Number(m[1]), checked: m[2] !== undefined }));

test('render hides markers and maps lines', () => {
  const html = renderNote(md);
  expect(html).not.toContain('%%');
  expect(html).toContain(`data-line="${at('Liste Planobjekte')}"`);
});

test('every list item carries its line number and tasks get a checkbox with the same number', () => {
  const html = renderNote(md);
  const open = at('Liste Planobjekte');
  const done = at('Reorga abstimmen');
  const mail = at('Max Muster');
  expect(html).toContain(`<li data-line="${open}"><input type="checkbox" data-line="${open}"> Liste Planobjekte ergänzen (fällig 30.10.)</li>`);
  expect(html).toContain(`<li data-line="${done}"><input type="checkbox" data-line="${done}" checked> Reorga abstimmen</li>`);
  expect(html).toContain(`<li data-line="${mail}">Max Muster, Freigabe Beispiel, bittet um Rückmeldung</li>`);
  expect(html.match(/<input /g)).toHaveLength(3);
  expect(html).not.toContain('[ ]');
  expect(html).not.toContain('[x]');
});

test('the fixture note renders as expected', () => {
  expect(renderNote(md)).toBe(
    [
      '<h1>2026-10-29</h1>',
      '<h2>Morgenbriefing (automatisch)</h2>',
      '<h3>Termine heute</h3>',
      '<ul>',
      '<li data-line="9">08:00 bis 14:00 Abstimmung Beispiel 2027 (Musterstadt)</li>',
      '</ul>',
      '<h3>Offene Punkte</h3>',
      '<ul>',
      '<li data-line="12"><input type="checkbox" data-line="12"> Liste Planobjekte ergänzen (fällig 30.10.)</li>',
      '<li data-line="13"><input type="checkbox" data-line="13"> Urlaube im Plan nachziehen</li>',
      '<li data-line="14"><input type="checkbox" data-line="14" checked> Reorga abstimmen</li>',
      '</ul>',
      '<h3>Mails</h3>',
      '<ul>',
      '<li data-line="17">Max Muster, Freigabe Beispiel, bittet um Rückmeldung</li>',
      '</ul>',
      '<h2>Abendüberblick (automatisch)</h2>',
      '<h3>Offene Punkte</h3>',
      '<ul>',
      '<li data-line="22">nichts</li>',
      '</ul>',
      '',
    ].join('\n'),
  );
});

test('Windows line endings render the same way', () => {
  expect(renderNote(md.replace(/\n/g, '\r\n'))).toBe(renderNote(md));
});

test('frontmatter is not rendered, but its lines still count', () => {
  const html = renderNote(note);
  expect(html).toContain('<h1>Titel</h1>');
  expect(html).not.toContain('date');
  expect(html).not.toContain('daily');
  expect(html).not.toContain('<hr');
  expect(html).toContain(`<li data-line="${lineOf(note, 'Eltern')}"><input type="checkbox" data-line="${lineOf(note, 'Eltern')}"> Eltern`);
  expect(html).toContain(`<li data-line="${lineOf(note, '[x] Kind')}"><input type="checkbox" data-line="${lineOf(note, '[x] Kind')}" checked> Kind</li>`);
  expect(html).toContain(`<li data-line="${lineOf(note, 'Kind ohne')}">Kind ohne Kästchen</li>`);
  expect(html).toContain(`<li data-line="${lineOf(note, 'Zweiter')}">Zweiter</li>`);
  expect(lineOf(note, 'Zweiter')).toBe(9);
});

test('a leading rule without a closing line is not frontmatter', () => {
  expect(renderNote('---\nnur ein Text\n')).toBe('<hr>\n<p>nur ein Text</p>\n');
});

test('comments over several lines disappear and the line numbers stay right', () => {
  const text = 'Anfang\n%%\nversteckt\n%%\n\n- Punkt\n';
  const html = renderNote(text);
  expect(html).not.toContain('versteckt');
  expect(html).not.toContain('%%');
  expect(html).toContain(`<li data-line="${lineOf(text, '- Punkt')}">Punkt</li>`);
  expect(lineOf(text, '- Punkt')).toBe(5);
});

test('an unclosed marker hides only the rest of its line', () => {
  const html = renderNote('- A %%offen\n- B\n');
  expect(html).not.toContain('%%');
  expect(html).not.toContain('offen');
  expect(html).toContain('<li data-line="0">A</li>');
  expect(html).toContain('<li data-line="1">B</li>');
});

test('raw HTML from the note is shown as text and never becomes markup', () => {
  const html = renderNote('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)> Punkt\n\n[klick](javascript:alert(1))\n\n<b>fett</b>\n');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('<b>');
  expect(html).not.toContain('href="javascript:');
  expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; Punkt');
});

test('wikilinks to a day become links to the day page', () => {
  expect(renderNote('[[2026-10-28]]')).toBe('<p><a href="#/tag/2026-10-28">2026-10-28</a></p>\n');
  expect(renderNote('[[2026-10-28#Abschnitt]]')).toBe('<p><a href="#/tag/2026-10-28">2026-10-28#Abschnitt</a></p>\n');
  expect(renderNote('[[2026-10-28|gestern]]')).toBe('<p><a href="#/tag/2026-10-28">gestern</a></p>\n');
  expect(renderNote('[[2026-10-28#Abschnitt|gestern]]')).toBe('<p><a href="#/tag/2026-10-28">gestern</a></p>\n');
});

test('other wikilinks render as plain label text', () => {
  expect(renderNote('Siehe [[Muster Notiz]] und [[Ordner/Notiz|Alias]].')).toBe('<p>Siehe Muster Notiz und Alias.</p>\n');
  expect(renderNote('[[Notiz#Abschnitt]]')).toBe('<p>Notiz#Abschnitt</p>\n');
  // nur die Tagesnotiz selbst ist ein Tag, nicht jede Datei, deren Name mit einem Datum beginnt
  expect(renderNote('[[2026-10-28 0800 Besprechung]]')).toBe('<p>2026-10-28 0800 Besprechung</p>\n');
  expect(renderNote('[[2026-10-28 0800 Besprechung|Besprechung]]')).toBe('<p>Besprechung</p>\n');
});

test('wikilink labels are escaped', () => {
  expect(renderNote('[[Notiz|<i>x</i>]]')).toBe('<p>&lt;i&gt;x&lt;/i&gt;</p>\n');
  expect(renderNote('[[2026-10-28|<i>x</i>]]')).toBe('<p><a href="#/tag/2026-10-28">&lt;i&gt;x&lt;/i&gt;</a></p>\n');
});

test('text that only looks like a wikilink stays as it is', () => {
  expect(renderNote('[[offen')).toBe('<p>[[offen</p>\n');
  expect(renderNote('[[]]')).toBe('<p>[[]]</p>\n');
  expect(renderNote('[[a\nb]]')).toBe('<p>[[a\nb]]</p>\n');
  expect(renderNote('[[a]b]]')).toBe('<p>[[a]b]]</p>\n');
  expect(renderNote('[[|nur Alias]]')).toBe('<p>[[|nur Alias]]</p>\n');
  expect(renderNote('`[[2026-10-28]]`')).toBe('<p><code>[[2026-10-28]]</code></p>\n');
});

test('a wikilink inside a list item', () => {
  expect(renderNote('- Gestern: [[2026-10-28|siehe dort]] **wichtig**\n')).toBe(
    '<ul>\n<li data-line="0">Gestern: <a href="#/tag/2026-10-28">siehe dort</a> <strong>wichtig</strong></li>\n</ul>\n',
  );
});

test('a task keeps its formatting next to the checkbox', () => {
  expect(renderNote('- [ ] **fett** und [[2026-10-28]]\n')).toBe(
    '<ul>\n<li data-line="0"><input type="checkbox" data-line="0"> <strong>fett</strong> und <a href="#/tag/2026-10-28">2026-10-28</a></li>\n</ul>\n',
  );
  expect(renderNote('- [X] groß geschrieben\n')).toContain('<input type="checkbox" data-line="0" checked> groß geschrieben');
});

test('an empty task still renders a checkbox', () => {
  expect(renderNote('- [ ] \n')).toBe('<ul>\n<li data-line="0"><input type="checkbox" data-line="0"></li>\n</ul>\n');
});

test('only dash bullets get a checkbox, other list items just get their line', () => {
  const html = renderNote('1. [ ] nummeriert\n\n* [ ] Stern\n\n- [ ]ohne Leerzeichen\n');
  expect(html).not.toContain('<input');
  expect(html).toContain('<li data-line="0">[ ] nummeriert</li>');
  expect(html).toContain('<li data-line="2">[ ] Stern</li>');
  expect(html).toContain('<li data-line="4">[ ]ohne Leerzeichen</li>');
});

test('items of a loose list keep the checkbox inside the paragraph', () => {
  expect(renderNote('- [ ] a\n\n- [x] b\n')).toBe(
    '<ul>\n<li data-line="0">\n<p><input type="checkbox" data-line="0"> a</p>\n</li>\n<li data-line="2">\n<p><input type="checkbox" data-line="2" checked> b</p>\n</li>\n</ul>\n',
  );
});

test('rendering is repeatable: earlier calls leave no state behind', () => {
  const first = renderNote(note);
  renderNote(md);
  renderNote('- [x] x\n');
  expect(first).toContain('<h1>Titel</h1>');
  expect(renderNote(note)).toBe(first);
});

// Sehen aus wie Aufgaben, sind es für das Zeilenmodell (`- [ ] ` mit genau einem Leerzeichen davor und danach) aber nicht.
const NOT_TASKS: [name: string, source: string, text: string][] = [
  ['quote', '> - [ ] x\n', '[ ] x'],
  ['callout', '> [!note]\n> - [ ] x\n', '[ ] x'],
  ['box at the end of the line', '- [ ]\n', '[ ]'],
  ['two spaces after the dash', '-  [ ] x\n', '[ ] x'],
  ['tab after the dash', '-\t[ ] x\n', '[ ] x'],
  ['tab after the box', '- [ ]\tx\n', '[ ]\tx'],
  ['no-break space after the box', '- [ ]\u00A0x\n', '[ ]\u00A0x'],
  ['second dash', '- - [ ] x\n', '[ ] x'],
  ['marker right after the box', '- [ ]%%m%%\n', '[ ]'],
  ['numbered list', '1. - [ ] x\n', '[ ] x'],
  // Erst ohne den Marker davor sähe die Zeile wie eine Aufgabe aus: Maßgeblich ist die Zeile in der Datei.
  ['marker before the dash', '%%m%%- [ ] x\n', '[ ] x'],
];

test.each(NOT_TASKS)('%s: no checkbox, the brackets stay text', (_name, source, text) => {
  const html = renderNote(source);
  expect(html).not.toContain('<input');
  expect(html).toContain(text);
  expect(html).not.toContain('%%');
});

// Quelle und die Zeilen, die ein Kästchen bekommen müssen.
const BOX_CASES: [name: string, source: string, boxes: number[]][] = [
  ['fixture note', md, [12, 13, 14]],
  ['frontmatter and nested list', note, [6, 7]],
  ...NOT_TASKS.map(([name, source]): [string, string, number[]] => [name, source, []]),
  ['marker without an end above other markers', '- [ ] A %%todo:1\n- [ ] B %%todo:2%%\n- [x] C %%todo:3%%\n', [0, 1, 2]],
  ['block comment', '%%\n- [ ] versteckt\n%%\n- [ ] sichtbar\n- [X] groß %%m%%\n', [3, 4]],
  ['Windows line endings', '- [ ] a\r\n- [x] b %%m%%\r\n  - [ ] c\r\n', [0, 1, 2]],
  ['nested, indented with tab and spaces, loose list', '- a\n\t- [ ] mit Tab\n  - [x] mit Leerzeichen\n\n- [ ] lose\n\n- [x] Liste\n', [1, 2, 4, 6]],
  ['byte order mark', '\uFEFF- [ ] mit BOM\n', [0]],
  ['byte order mark and frontmatter', '\uFEFF---\ndate: 2026-10-29\n---\n- [ ] nach Kopf\n', [3]],
  ['lone carriage return', '- [ ] a\r- [ ] b\n- [ ] c\n', [0, 1]],
  ['empty tasks', '- [ ] %%m%%\n- [ ] \n- [ ]\n', [0, 1]],
];

test.each(BOX_CASES)('%s: every checkbox sits on a line that toggleTask accepts', (_name, source, boxes) => {
  const html = renderNote(source);
  const found = checkboxes(html);
  expect(found.map((box) => box.line)).toEqual(boxes);
  expect(html.match(/<input /g) ?? []).toHaveLength(found.length);
  for (const { line, checked } of found) {
    // Die Zeile lässt sich haken, und der Haken im HTML ist der Haken in der Notiz.
    expect(toggleTask(source, line).split('\n')[line]).toContain(checked ? '[ ]' : '[x]');
  }
});

test('a marker without an end hides only the rest of its own line, also with Windows line endings', () => {
  const source = '- [ ] A %%todo:1\n- [ ] B %%todo:2%%\n- [ ] C %%todo:3%%\n';
  const html = renderNote(source);
  expect(html).toBe(
    [
      '<ul>',
      '<li data-line="0"><input type="checkbox" data-line="0"> A</li>',
      '<li data-line="1"><input type="checkbox" data-line="1"> B</li>',
      '<li data-line="2"><input type="checkbox" data-line="2"> C</li>',
      '</ul>',
      '',
    ].join('\n'),
  );
  expect(renderNote(source.replace(/\n/g, '\r\n'))).toBe(html);
});

test('two percent signs in the middle of a line hide only the rest of that line', () => {
  const source = '- A 100%% sicher\n- B %%todo:1%%\n';
  const html = '<ul>\n<li data-line="0">A 100</li>\n<li data-line="1">B</li>\n</ul>\n';
  expect(renderNote(source)).toBe(html);
  expect(renderNote(source.replace(/\n/g, '\r\n'))).toBe(html);
});

test('a comment that starts after text does not reach into the next lines', () => {
  expect(renderNote('- A %%anfang\n- B\n- C ende%% D\n')).toBe(
    '<ul>\n<li data-line="0">A</li>\n<li data-line="1">B</li>\n<li data-line="2">C ende</li>\n</ul>\n',
  );
});

test('a block comment runs from a line with only %% to the next such line, also with Windows line endings', () => {
  const source = 'Anfang\n%%\nversteckt\n- [ ] auch versteckt\n%%\n\n- Punkt\n';
  const html = '<p>Anfang</p>\n<ul>\n<li data-line="6">Punkt</li>\n</ul>\n';
  expect(renderNote(source)).toBe(html);
  expect(renderNote(source.replace(/\n/g, '\r\n'))).toBe(html);
  expect(renderNote('%%\na\n%%\n- sichtbar\n  %%  \nb\n  %%  \n')).toBe('<ul>\n<li data-line="3">sichtbar</li>\n</ul>\n');
});

test('a line with only %% and no matching end hides just itself', () => {
  expect(renderNote('%%\n- A\n- B\n')).toBe('<ul>\n<li data-line="1">A</li>\n<li data-line="2">B</li>\n</ul>\n');
  expect(renderNote('%% Text\n- A\n%%\n')).toBe('<ul>\n<li data-line="1">A</li>\n</ul>\n');
});

test('the text of a rendered entry is the visible text of its line', () => {
  const bodies = [
    'A %%todo:1%%',
    'A 100%% sicher',
    '%%m%%A',
    '%%m%% A',
    'A %%m1%% B %%m2%% C',
    '[ ] A %%x%%',
    '[x] fertig %%todo:9 gemeldet%%',
    '[ ] %%m%%B',
    '[ ]%%m%%',
  ];
  const lines = bodies.map((body) => `- ${body}`);
  const html = renderNote(lines.join('\n') + '\n');
  lines.forEach((line, n) => {
    const item = new RegExp(`<li data-line="${n}">(.*?)</li>`).exec(html);
    expect(item, line).not.toBeNull();
    expect(item?.[1].replace(/<[^>]*>/g, '').trim(), line).toBe(visibleText(line));
  });
});

test('a byte order mark at the start is ignored, also in front of the frontmatter', () => {
  expect(renderNote('\uFEFF' + note)).toBe(renderNote(note));
  expect(renderNote('\uFEFF# Titel\n')).toBe('<h1>Titel</h1>\n');
  expect(renderNote('\uFEFF---\ndate: 2026-10-29\n---\n# Titel\n')).toBe('<h1>Titel</h1>\n');
});

test('a wikilink to a date that does not exist stays plain text', () => {
  expect(renderNote('[[2026-13-45]]')).toBe('<p>2026-13-45</p>\n');
  expect(renderNote('[[2026-02-30#Abschnitt]] und [[2026-00-10|nie]]')).toBe('<p>2026-02-30#Abschnitt und nie</p>\n');
  expect(renderNote('[[2028-02-29]]')).toBe('<p><a href="#/tag/2028-02-29">2028-02-29</a></p>\n');
});

test('a lone carriage return inside a line does not shift the line numbers', () => {
  expect(renderNote('- [ ] a\r- [ ] b\n- [x] c\n')).toBe(
    '<ul>\n<li data-line="0"><input type="checkbox" data-line="0"> a - [ ] b</li>\n<li data-line="1"><input type="checkbox" data-line="1" checked> c</li>\n</ul>\n',
  );
});

test('an embed is a neutral hint, without the file name and without a stray exclamation mark', () => {
  expect(renderNote('![[2026-10-29 Tag.svg]]\n')).toBe('<p><span class="anhang">Anhang</span></p>\n');
  expect(renderNote('Davor ![[Bild.png|200]] danach\n')).toBe('<p>Davor <span class="anhang">Anhang</span> danach</p>\n');
  expect(renderNote('- [ ] Aufgabe ![[Skizze.svg]]\n')).toBe(
    '<ul>\n<li data-line="0"><input type="checkbox" data-line="0"> Aufgabe <span class="anhang">Anhang</span></li>\n</ul>\n',
  );
  // Ein Wikilink ohne Ausrufezeichen bleibt, was er war.
  expect(renderNote('[[Seite]] und ![[Seite]]\n')).toBe('<p>Seite und <span class="anhang">Anhang</span></p>\n');
});

test('what looks a little like an embed stays text', () => {
  expect(renderNote('![[offen\n')).toBe('<p>![[offen</p>\n');
  expect(renderNote('![[]]\n')).toBe('<p>![[]]</p>\n');
  expect(renderNote('Hallo! [[Seite]]\n')).toBe('<p>Hallo! Seite</p>\n');
});

test('a markdown image keeps its markup, the Tagesseite drops it later', () => {
  expect(renderNote('![Alt](bild.png)\n')).toBe('<p><img src="bild.png" alt="Alt"></p>\n');
});

test('a range renders only the lines inside it and keeps the line numbers of the whole note', () => {
  const doc = ['# Titel', '', '## A', '- [ ] eins %%m:1%%', '- zwei', '', '## B', '- [x] drei', ''].join('\n');
  expect(renderNote(doc, { start: 3, end: 6 })).toBe(
    '<ul>\n<li data-line="3"><input type="checkbox" data-line="3"> eins</li>\n<li data-line="4">zwei</li>\n</ul>\n',
  );
  expect(renderNote(doc, { start: 7, end: 9 })).toBe('<ul>\n<li data-line="7"><input type="checkbox" data-line="7" checked> drei</li>\n</ul>\n');
  expect(renderNote(doc, { start: 0, end: 0 })).toBe('');
  expect(renderNote(doc, { start: 0, end: 100 })).toBe(renderNote(doc));
});

test('a block comment that reaches into a range hides its lines there too', () => {
  const doc = ['## A', '- sichtbar', '%%', '- versteckt', '## B', '- auch versteckt', '%%', '- wieder sichtbar', ''].join('\n');
  // Der Kommentar beginnt in Abschnitt A und endet in B: Die Zeilen dazwischen bleiben überall versteckt.
  expect(renderNote(doc, { start: 1, end: 4 })).toBe('<ul>\n<li data-line="1">sichtbar</li>\n</ul>\n');
  expect(renderNote(doc, { start: 5, end: 8 })).toBe('<ul>\n<li data-line="7">wieder sichtbar</li>\n</ul>\n');
});

test('a range never shows the front matter', () => {
  const doc = '---\ndate: 2026-10-29\n---\n- [ ] a\n';
  expect(renderNote(doc, { start: 0, end: 4 })).toBe('<ul>\n<li data-line="3"><input type="checkbox" data-line="3"> a</li>\n</ul>\n');
});
