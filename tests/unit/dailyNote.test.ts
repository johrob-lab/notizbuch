import { expect, test } from 'vitest';
import {
  SECTION_ORDER,
  appendErgaenzung,
  editItemText,
  ensureSection,
  isItemLine,
  newDailyNote,
  parseSections,
  toggleTask,
  visibleText,
} from '../../src/lib/dailyNote';
import { fixture, lineOf } from './helpers';

const md = fixture('05 Daily Notes/2026-10-29.md');
const at = (s: string) => lineOf(md, s);
const markersOf = (s: string) => s.match(/%%.*?%%/g) ?? [];

test('section order follows the daily note layout', () => {
  expect(SECTION_ORDER).toEqual([
    'Morgenbriefing (automatisch)',
    'Ergänzungen',
    'Handschrift',
    'Besprechungen',
    'Besprechungen (GoodNotes)',
    'Tagesabschluss (Chat)',
    'Abendüberblick (automatisch)',
  ]);
});

test('parseSections lists the level 2 headings with start and exclusive end', () => {
  expect(parseSections(md)).toEqual([
    { heading: 'Morgenbriefing (automatisch)', start: at('## Morgenbriefing'), end: at('## Abendüberblick') },
    { heading: 'Abendüberblick (automatisch)', start: at('## Abendüberblick'), end: md.split('\n').length },
  ]);
  expect(at('## Morgenbriefing')).toBe(6);
});

test('parseSections ignores other heading levels and lines that only look like headings', () => {
  const text = '# Titel\n## Eins\n### Unterpunkt\n##Kein Abstand\n#### Tief\ntext ## Mitte\n## Zwei  \n';
  expect(parseSections(text)).toEqual([
    { heading: 'Eins', start: 1, end: 6 },
    { heading: 'Zwei', start: 6, end: 8 },
  ]);
  expect(parseSections('')).toEqual([]);
});

test('isItemLine recognises bullets and task boxes, also indented', () => {
  expect(isItemLine('- Max Muster')).toBe(true);
  expect(isItemLine('- [ ] offen')).toBe(true);
  expect(isItemLine('- [x] erledigt')).toBe(true);
  expect(isItemLine('  - eingerückt')).toBe(true);
  expect(isItemLine('\t- [ ] eingerückt mit Tab')).toBe(true);
  expect(isItemLine('## Ergänzungen')).toBe(false);
  expect(isItemLine('Text - mit Strich')).toBe(false);
  expect(isItemLine('-kein Leerzeichen')).toBe(false);
  expect(isItemLine('---')).toBe(false);
  expect(isItemLine('')).toBe(false);
});

test('visibleText drops bullet, box and markers', () => {
  expect(visibleText('- [ ] A %%todo:1%%')).toBe('A');
  expect(visibleText('- [x] Reorga abstimmen %%todo:AAMkTEST3 gemeldet%%')).toBe('Reorga abstimmen');
  expect(visibleText('- Max Muster, Freigabe Beispiel')).toBe('Max Muster, Freigabe Beispiel');
  expect(visibleText('  - [ ] eingerückt')).toBe('eingerückt');
  expect(visibleText('- [ ] A %%ob:k3x9 todo:2%% %%x%%')).toBe('A');
  expect(visibleText('- [ ] Anfang %%m%% Ende')).toBe('Anfang Ende');
  expect(visibleText('Freitext %%m%%')).toBe('Freitext');
  expect(visibleText('- [ ] A %%offen')).toBe('A');
  expect(visibleText('- [ ] A\r')).toBe('A');
  expect(visibleText('- [ ] ')).toBe('');
});

test('visibleText trims white space around the text', () => {
  expect(visibleText('- [ ] %%m%% Anfang')).toBe('Anfang');
  expect(visibleText('-   Leerraum  ')).toBe('Leerraum');
  expect(visibleText('  Freitext  ')).toBe('Freitext');
});

test('toggle keeps markers', () => {
  expect(toggleTask(md, at('Liste Planobjekte')).split('\n')[at('Liste Planobjekte')])
    .toBe('- [x] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%');
  expect(() => toggleTask(md, 0)).toThrow();
});

test('toggle works both ways and changes only the clicked line', () => {
  const n = at('Reorga abstimmen');
  const out = toggleTask(md, n);
  expect(out.split('\n')[n]).toBe('- [ ] Reorga abstimmen %%todo:AAMkTEST3 gemeldet%%');
  expect(out.replace('- [ ] Reorga', '- [x] Reorga')).toBe(md);
  expect(toggleTask(out, n)).toBe(md);
});

test('toggle accepts an upper case X and writes a lower case x', () => {
  expect(toggleTask('- [X] a\n', 0)).toBe('- [ ] a\n');
  expect(toggleTask('- [ ] a\n', 0)).toBe('- [x] a\n');
  expect(toggleTask('  - [ ] eingerückt\n', 0)).toBe('  - [x] eingerückt\n');
});

test('toggle throws on lines without a box', () => {
  expect(() => toggleTask(md, at('Max Muster'))).toThrow(); // Listenpunkt ohne Kästchen
  expect(() => toggleTask(md, at('## Abendüberblick'))).toThrow(); // Überschrift
  expect(() => toggleTask(md, md.split('\n').indexOf(''))).toThrow(); // Leerzeile
  expect(() => toggleTask(md, -1)).toThrow();
  expect(() => toggleTask(md, 999)).toThrow();
});

test('edit keeps markers', () => {
  const n = at('Urlaube im Plan');
  expect(editItemText(md, n, 'Urlaube bis Freitag nachziehen').split('\n')[n])
    .toBe('- [ ] Urlaube bis Freitag nachziehen %%ob:k3x9 todo:AAMkTEST2%%');
  expect(visibleText('- [ ] A %%todo:1%%')).toBe('A');
});

test('edit keeps the box state and changes only the edited line', () => {
  const n = at('Reorga abstimmen');
  const out = editItemText(md, n, 'Reorga mit Muster abstimmen');
  expect(out.split('\n')[n]).toBe('- [x] Reorga mit Muster abstimmen %%todo:AAMkTEST3 gemeldet%%');
  expect(out.replace('Reorga mit Muster abstimmen', 'Reorga abstimmen')).toBe(md);
});

test('edit keeps the prefix of plain and indented items', () => {
  expect(editItemText('- Mail A\n', 0, 'Mail B')).toBe('- Mail B\n');
  expect(editItemText('  - [x] sub\n', 0, 'Unterpunkt')).toBe('  - [x] Unterpunkt\n');
});

test('edit moves all markers to the end, in order, one space apart', () => {
  expect(editItemText('- [ ] A %%m1%%  %%m2%% B %%m3 x%%\n', 0, 'Neu')).toBe('- [ ] Neu %%m1%% %%m2%% %%m3 x%%\n');
});

test('edit keeps an unclosed comment opener, so a block comment is not broken', () => {
  expect(editItemText('- [ ] A %%anfang\nversteckt\n%%\n', 0, 'B')).toBe('- [ ] B %%anfang\nversteckt\n%%\n');
});

test('an emptied item keeps prefix and markers', () => {
  expect(editItemText('- [ ] A %%m%%\n', 0, '  ')).toBe('- [ ] %%m%%\n');
  expect(editItemText('- A\n', 0, '')).toBe('- \n');
});

test('new text cannot create or break markers', () => {
  const n = at('Urlaube im Plan');
  const out = editItemText(md, n, '  50%% Rabatt %%evil:1%%\nzweite Zeile  ');
  expect(out.split('\n')[n]).toBe('- [ ] 50 Rabatt evil:1 zweite Zeile %%ob:k3x9 todo:AAMkTEST2%%');
  expect(out.split('\n')).toHaveLength(md.split('\n').length);
  expect(markersOf(out)).toEqual(markersOf(md));
  expect(visibleText(out.split('\n')[n])).toBe('50 Rabatt evil:1 zweite Zeile');
});

test('edit throws on lines that are not list items', () => {
  expect(() => editItemText(md, 0, 'x')).toThrow();
  expect(() => editItemText(md, at('### Mails'), 'x')).toThrow();
  expect(() => editItemText(md, -1, 'x')).toThrow();
  expect(() => editItemText(md, 999, 'x')).toThrow();
});

test('every edit and every toggle touches one line only and keeps all markers identical', () => {
  const lines = md.split('\n');
  const oneLineOnly = (out: string, n: number) => {
    const outLines = out.split('\n');
    expect(outLines).toHaveLength(lines.length);
    outLines.forEach((l, i) => {
      if (i !== n) expect(l).toBe(lines[i]);
    });
    expect(markersOf(outLines[n])).toEqual(markersOf(lines[n]));
    expect(markersOf(out)).toEqual(markersOf(md));
  };
  let edited = 0;
  let toggled = 0;
  lines.forEach((line, n) => {
    if (isItemLine(line)) {
      oneLineOnly(editItemText(md, n, 'Neu %%x%%\nmit Umbruch'), n);
      edited++;
    }
    if (/^- \[[ x]\] /.test(line)) {
      oneLineOnly(toggleTask(md, n), n);
      toggled++;
    }
  });
  // Termin, drei Aufgaben, Mail und "nichts": sonst prüft die Schleife nichts.
  expect(edited).toBe(6);
  expect(toggled).toBe(3);
});

test('Windows line endings: headings are found, edits and toggles keep the carriage return', () => {
  const crlf = md.replace(/\n/g, '\r\n');
  expect(parseSections(crlf).map((s) => s.heading)).toEqual(['Morgenbriefing (automatisch)', 'Abendüberblick (automatisch)']);
  const n = lineOf(crlf, 'Urlaube im Plan');
  expect(editItemText(crlf, n, 'Urlaube bis Freitag nachziehen').split('\n')[n])
    .toBe('- [ ] Urlaube bis Freitag nachziehen %%ob:k3x9 todo:AAMkTEST2%%\r');
  expect(toggleTask(crlf, n).split('\n')[n]).toBe('- [x] Urlaube im Plan nachziehen %%ob:k3x9 todo:AAMkTEST2%%\r');
  expect(toggleTask(toggleTask(crlf, n), n)).toBe(crlf);
});

test('Ergänzungen goes between Morgenbriefing and Abendüberblick, nothing else changes', () => {
  const out = appendErgaenzung(md, 'Muster anrufen', true);
  expect(parseSections(out).map(s => s.heading)).toEqual(['Morgenbriefing (automatisch)', 'Ergänzungen', 'Abendüberblick (automatisch)']);
  expect(out.replace('## Ergänzungen\n\n- [ ] Muster anrufen\n\n', '')).toBe(md);
  expect(appendErgaenzung(out, 'Notiz ohne Haken', false)).toContain('- [ ] Muster anrufen\n- Notiz ohne Haken\n');
});

test('a second Ergänzung keeps one blank line before the next heading', () => {
  const out = appendErgaenzung(appendErgaenzung(md, 'Muster anrufen', true), 'Notiz ohne Haken', false);
  expect(out).toContain('## Ergänzungen\n\n- [ ] Muster anrufen\n- Notiz ohne Haken\n\n## Abendüberblick (automatisch)\n');
  expect(out.replace('## Ergänzungen\n\n- [ ] Muster anrufen\n- Notiz ohne Haken\n\n', '')).toBe(md);
});

test('Ergänzungen in a new note: the file ends with the new line', () => {
  const once = appendErgaenzung(newDailyNote('2026-11-02'), 'Muster anrufen', true);
  expect(once).toBe('---\ndate: 2026-11-02\ntags: [daily]\n---\n# 2026-11-02\n\n## Ergänzungen\n\n- [ ] Muster anrufen\n');
  expect(appendErgaenzung(once, 'Notiz', false)).toBe(once + '- Notiz\n');
});

test('an item is added after the last item of an existing section, also after nested items', () => {
  const note = '## Morgenbriefing (automatisch)\n\n- a\n\n## Ergänzungen\n\n- [ ] eins\n  - Unterpunkt\n\n## Abendüberblick (automatisch)\n\n- b\n';
  expect(appendErgaenzung(note, 'zwei', true)).toBe(
    '## Morgenbriefing (automatisch)\n\n- a\n\n## Ergänzungen\n\n- [ ] eins\n  - Unterpunkt\n- [ ] zwei\n\n## Abendüberblick (automatisch)\n\n- b\n',
  );
});

test('free text in the section stays above the new item', () => {
  const note = '## Ergänzungen\n\nFreitext\n\n## Abendüberblick (automatisch)\n';
  expect(appendErgaenzung(note, 'neu', false)).toBe('## Ergänzungen\n\nFreitext\n\n- neu\n\n## Abendüberblick (automatisch)\n');
});

test('new text of an Ergänzung cannot create or break markers', () => {
  const out = appendErgaenzung(md, '  Anruf %%x%%\nMuster ', true);
  expect(out).toContain('- [ ] Anruf x Muster\n');
  expect(markersOf(out)).toEqual(markersOf(md));
  expect(out.match(/%%/g)).toHaveLength((md.match(/%%/g) ?? []).length);
});

test('an Ergänzung without visible text is not added', () => {
  expect(appendErgaenzung(md, '', true)).toBe(md);
  expect(appendErgaenzung(md, '  \n ', false)).toBe(md);
  expect(appendErgaenzung(md, '%%%%', true)).toBe(md);
  expect(appendErgaenzung(md, 'Muster', true)).not.toBe(md);
});

test('new daily note', () => {
  expect(newDailyNote('2026-11-02')).toBe('---\ndate: 2026-11-02\ntags: [daily]\n---\n# 2026-11-02\n');
  expect(ensureSection(newDailyNote('2026-11-02'), 'Ergänzungen').md).toBe('---\ndate: 2026-11-02\ntags: [daily]\n---\n# 2026-11-02\n\n## Ergänzungen\n');
});

test('ensureSection inserts before the first later section and returns the heading line', () => {
  const res = ensureSection(md, 'Ergänzungen');
  expect(res.md).toBe(md.replace('## Abendüberblick (automatisch)', '## Ergänzungen\n\n## Abendüberblick (automatisch)'));
  expect(res.line).toBe(at('## Abendüberblick'));
  expect(res.md.split('\n')[res.line]).toBe('## Ergänzungen');
});

test('ensureSection keeps the section order for a section in the middle', () => {
  const note = '# T\n\n## Morgenbriefing (automatisch)\n\n- a\n\n## Besprechungen\n\n- b\n\n## Abendüberblick (automatisch)\n\n- c\n';
  const res = ensureSection(note, 'Handschrift');
  expect(res.md).toBe(note.replace('## Besprechungen\n', '## Handschrift\n\n## Besprechungen\n'));
  expect(parseSections(res.md).map((s) => s.heading)).toEqual([
    'Morgenbriefing (automatisch)',
    'Handschrift',
    'Besprechungen',
    'Abendüberblick (automatisch)',
  ]);
  expect(res.md.split('\n')[res.line]).toBe('## Handschrift');
});

test('Besprechungen and Besprechungen (GoodNotes) are two different sections', () => {
  const note = '## Besprechungen (GoodNotes)\n\n- x\n';
  const res = ensureSection(note, 'Besprechungen');
  expect(res.md).toBe('## Besprechungen\n\n## Besprechungen (GoodNotes)\n\n- x\n');
  expect(res.line).toBe(0);
  expect(ensureSection(res.md, 'Besprechungen (GoodNotes)')).toEqual({ md: res.md, line: 2 });
});

test('ensureSection ignores sections that are not in the order list', () => {
  const note = '## Morgenbriefing (automatisch)\n\n## Eigene Notizen\n\n## Abendüberblick (automatisch)\n';
  const res = ensureSection(note, 'Ergänzungen');
  expect(parseSections(res.md).map((s) => s.heading)).toEqual([
    'Morgenbriefing (automatisch)',
    'Eigene Notizen',
    'Ergänzungen',
    'Abendüberblick (automatisch)',
  ]);
});

test('ensureSection returns the text unchanged when the heading exists', () => {
  expect(ensureSection(md, 'Abendüberblick (automatisch)')).toEqual({ md, line: at('## Abendüberblick') });
  const withErgaenzungen = appendErgaenzung(md, 'Muster anrufen', true);
  expect(ensureSection(withErgaenzungen, 'Ergänzungen')).toEqual({ md: withErgaenzungen, line: lineOf(withErgaenzungen, '## Ergänzungen') });
});

test('ensureSection at the end of the file: exactly one blank line before, a newline after', () => {
  const expected = { md: '# T\n\n## Ergänzungen\n', line: 2 };
  expect(ensureSection('# T', 'Ergänzungen')).toEqual(expected);
  expect(ensureSection('# T\n', 'Ergänzungen')).toEqual(expected);
  expect(ensureSection('# T\n\n\n\n', 'Ergänzungen')).toEqual(expected);
  expect(ensureSection('', 'Ergänzungen')).toEqual({ md: '## Ergänzungen\n', line: 0 });
});

test('ensureSection puts a blank line before the new heading when the previous line is text', () => {
  const note = '## Morgenbriefing (automatisch)\n- a\n## Abendüberblick (automatisch)\n';
  expect(ensureSection(note, 'Ergänzungen')).toEqual({
    md: '## Morgenbriefing (automatisch)\n- a\n\n## Ergänzungen\n\n## Abendüberblick (automatisch)\n',
    line: 3,
  });
});

test('ensureSection puts a heading that is not in the order list at the end', () => {
  const res = ensureSection(md, 'Etwas anderes');
  expect(res.md).toBe(md + '\n## Etwas anderes\n');
  expect(res.md.split('\n')[res.line]).toBe('## Etwas anderes');
});
