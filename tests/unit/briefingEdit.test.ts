import { expect, test } from 'vitest';
import { appendErgaenzung, newDailyNote } from '../../src/lib/dailyNote';
import { addToNote, editLine, findLine, STALE_NOTICE, tickLine } from '../../src/lib/briefingEdit';
import { fixture, lineOf } from './helpers';

// Die Entscheidungen hinter der Karte „Morgenbriefing“: Jede Änderung geht vom neuesten Text aus, trifft nur die Zeile, die man
// angetippt hat, und lässt alles andere (auch die Marker) unberührt. Stimmt die Zeile nicht mehr, wird nichts geschrieben.

const note = fixture('05 Daily Notes/2026-10-29.md');
const lines = note.split('\n');
const task1 = lineOf(note, 'Liste Planobjekte');
const task2 = lineOf(note, 'Urlaube im Plan');
const done = lineOf(note, 'Reorga abstimmen');
const mail = lineOf(note, 'Max Muster');
const text = (change: ReturnType<typeof tickLine>) => (change.ok ? change.text : null);

test('the notice says what happened and what to do', () => {
  expect(STALE_NOTICE).toBe('Die Zeile hat sich geändert, bitte noch einmal.');
});

test('a tick changes only the line that was tapped and keeps its markers byte for byte', () => {
  const result = text(tickLine(note, task1, lines[task1]));
  expect(result).toBe(note.replace('- [ ] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%', '- [x] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%'));
  expect(result!.split('\n')).toHaveLength(lines.length);
});

test('a done task is unticked, again with its markers', () => {
  expect(text(tickLine(note, done, lines[done]))).toBe(note.replace('- [x] Reorga abstimmen %%todo:AAMkTEST3 gemeldet%%', '- [ ] Reorga abstimmen %%todo:AAMkTEST3 gemeldet%%'));
});

test('a tick goes from the newest text: what changed elsewhere in the note stays', () => {
  const newest = note.replace('- nichts', '- etwas Neues von einem anderen Gerät');
  const result = text(tickLine(newest, task2, lines[task2]));
  expect(result).toContain('etwas Neues von einem anderen Gerät');
  expect(result).toContain('- [x] Urlaube im Plan nachziehen %%ob:k3x9 todo:AAMkTEST2%%');
});

test('a tick on a line that is not the line that was shown writes nothing', () => {
  // Eine Zeile ist darüber dazugekommen: An dieser Stelle steht jetzt ein anderer Eintrag.
  const shifted = note.replace(lines[task2], `- [ ] Neu oben %%todo:AAMkNEW%%\n${lines[task2]}`);
  expect(tickLine(shifted, task2, lines[task2])).toEqual({ ok: false });
  // Die Zeile selbst hat sich geändert.
  expect(tickLine(note.replace('Urlaube im Plan nachziehen', 'Urlaube anders'), task2, lines[task2])).toEqual({ ok: false });
  // Dieselbe Zeile, aber ein Haken ist inzwischen gesetzt: Der Tipp würde ihn wieder wegnehmen, also gilt er nicht.
  expect(tickLine(note.replace('- [ ] Urlaube', '- [x] Urlaube'), task2, lines[task2])).toEqual({ ok: false });
});

test('a tick on a line that is gone or has no checkbox writes nothing', () => {
  expect(tickLine(null, task1, lines[task1])).toEqual({ ok: false });
  expect(tickLine(note, 999, lines[task1])).toEqual({ ok: false });
  expect(tickLine(note, mail, lines[mail])).toEqual({ ok: false }); // Listenpunkt ohne Kästchen
  expect(tickLine(note, 0, lines[0])).toEqual({ ok: false });
  expect(tickLine('', 0, '')).toEqual({ ok: false });
});

test('an edit replaces the visible text, keeps the checkbox and moves the markers to the end', () => {
  const result = text(editLine(note, task2, lines[task2], 'Urlaube bis Ende November nachziehen'));
  expect(result).toBe(note.replace(lines[task2], '- [ ] Urlaube bis Ende November nachziehen %%ob:k3x9 todo:AAMkTEST2%%'));
});

test('an edit of a plain list item works too, and a marker typed into the text is dropped', () => {
  expect(text(editLine(note, mail, lines[mail], 'Mail erledigt %%x%%'))).toBe(note.replace(lines[mail], '- Mail erledigt x'));
});

test('an edit on a line that is not the line that was shown writes nothing', () => {
  const shifted = note.replace(lines[task2], `- [ ] Neu oben\n${lines[task2]}`);
  expect(editLine(shifted, task2, lines[task2], 'Anders')).toEqual({ ok: false });
  expect(editLine(null, task2, lines[task2], 'Anders')).toEqual({ ok: false });
  expect(editLine(note, 999, '', 'Anders')).toEqual({ ok: false });
  expect(editLine(note, 0, lines[0], 'Anders')).toEqual({ ok: false }); // keine Aufzählung
});

test('edits and ticks keep the line endings of a Windows note', () => {
  const windows = note.replace(/\n/g, '\r\n');
  const wlines = windows.split('\n');
  const ticked = text(tickLine(windows, task1, wlines[task1]));
  expect(ticked).toBe(windows.replace('- [ ] Liste Planobjekte', '- [x] Liste Planobjekte'));
  const edited = text(editLine(windows, task2, wlines[task2], 'Neu'));
  expect(edited).toBe(windows.replace(wlines[task2], '- [ ] Neu %%ob:k3x9 todo:AAMkTEST2%%\r'));
});

test('adding to a note appends to Ergänzungen, before the evening overview', () => {
  const result = addToNote(note, '2026-10-29', 'Frau Muster zurückrufen', true)!;
  expect(result).toBe(appendErgaenzung(note, 'Frau Muster zurückrufen', true));
  expect(result.indexOf('## Ergänzungen')).toBeLessThan(result.indexOf('## Abendüberblick (automatisch)'));
  expect(addToNote(note, '2026-10-29', 'Nur Text', false)).toBe(appendErgaenzung(note, 'Nur Text', false));
});

test('adding to a day without a note starts a new note for that day', () => {
  expect(addToNote(null, '2026-11-05', 'Erste Notiz', true)).toBe(appendErgaenzung(newDailyNote('2026-11-05'), 'Erste Notiz', true));
  expect(addToNote(null, '2026-11-05', 'Erste Notiz', true)).toContain('date: 2026-11-05');
});

test('adding nothing changes nothing, and creates no note', () => {
  expect(addToNote(note, '2026-10-29', '', true)).toBeNull();
  expect(addToNote(note, '2026-10-29', '   \n ', true)).toBeNull();
  expect(addToNote(note, '2026-10-29', '%%', true)).toBeNull();
  expect(addToNote(null, '2026-11-05', '', true)).toBeNull();
  expect(addToNote(null, '2026-11-05', '  ', false)).toBeNull();
});

test('findLine finds the line at the same place, or the only identical one somewhere else', () => {
  expect(findLine(note, lines[task2], task2)).toBe(task2);
  const shifted = note.replace(lines[task2], `- [ ] Neu oben\n${lines[task2]}`);
  expect(findLine(shifted, lines[task2], task2)).toBe(task2 + 1);
});

test('findLine gives up when the line is gone, changed or not unique', () => {
  expect(findLine(note.replace('Urlaube im Plan nachziehen', 'Anders'), lines[task2], task2)).toBeNull();
  const twice = `${note}${lines[task2]}\n${lines[task2]}\n`;
  expect(findLine(twice, lines[task2], 999)).toBeNull();
  expect(findLine(null, lines[task2], task2)).toBeNull();
  expect(findLine(note, '', 5)).toBe(5); // eine leere Zeile ist am selben Platz dieselbe Zeile
  expect(findLine(note, '', 999)).toBeNull(); // sonst gibt es viele davon
});
