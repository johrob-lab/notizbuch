import { expect, test } from 'vitest';
import { renderNote } from '../../src/lib/markdown';
import { fixture, lineOf } from './helpers';

const md = fixture('05 Daily Notes/2026-10-29.md');
const at = (s: string) => lineOf(md, s);
// Mit YAML-Kopf (Zeilen 0 bis 3) und einer verschachtelten Liste.
const note = '---\ndate: 2026-10-29\ntags: [daily]\n---\n# Titel\n\n- [ ] Eltern\n  - [x] Kind\n  - Kind ohne Kästchen\n- Zweiter\n';

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
      '<li data-line="9">08:00 bis 14:00 Abstimmung Beispiel 2027 (Klagenfurt)</li>',
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
