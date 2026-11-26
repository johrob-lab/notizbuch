import { expect, test } from 'vitest';
import { answerItems } from '../../src/ki/answerItems';
import { addItemsToNote } from '../../src/lib/briefingEdit';
import { newDailyNote } from '../../src/lib/dailyNote';

// Aus Frage und Antwort werden flache Punkte für „Ergänzungen“: zuerst die Frage mit Uhrzeit, dann jede Zeile der Antwort.

const texts = (items: { text: string }[]) => items.map((item) => item.text);

test('the question comes first, on one line', () => {
  expect(answerItems('Was\nsteht   an?', 'Ok', '14:05')[0]).toEqual({ text: 'Claude, 14:05: Was steht an?', asTask: false });
});

test('every kind of line becomes one flat item', () => {
  const answer = ['## Heute', '', 'Zwei Punkte sind offen.', '- Termin mit Muster', '  - Unterpunkt', '1. Erster Schritt', '* Stern', '> Zitat', '| Spalte A | Spalte B |', '|---|---|', '| a | b |', '---', '```js', 'code()', '```'].join('\n');
  const items = answerItems('Frage', answer, '14:05').slice(1);
  expect(texts(items)).toEqual(['Heute', 'Zwei Punkte sind offen.', 'Termin mit Muster', 'Unterpunkt', '1\\. Erster Schritt', 'Stern', 'Zitat', 'Spalte A · Spalte B', 'a · b', 'code()']);
  expect(items.every((item) => !item.asTask)).toBe(true);
});

test('tasks stay tasks', () => {
  const items = answerItems('F', ['- [ ] Angebot prüfen', '* [ ] Zwei', '1. [ ] Drei', '- [x] Fertig', '- [X] Auch fertig', '- [ ]'].join('\n'), '14:05').slice(1);
  expect(items).toEqual([
    { text: 'Angebot prüfen', asTask: true },
    { text: 'Zwei', asTask: true },
    { text: 'Drei', asTask: true },
    { text: 'Fertig', asTask: false },
    { text: 'Auch fertig', asTask: false },
  ]);
});

test('nothing is hidden or lost', () => {
  const items = answerItems('F', 'Preis %%geheim%% steht\n<b>x</b>', '14:05').slice(1);
  expect(items).toHaveLength(2);
  const note = addItemsToNote(newDailyNote('2026-10-29'), '2026-10-29', items)!;
  expect(note).toContain('- Preis geheim steht');
  expect(note).not.toContain('%%');
  expect(texts(items)[1]).toBe('<b>x</b>');
});

test('numbers stay, escaped so the line stays flat', () => {
  const items = answerItems('F', ['1. Erster Schritt', '2) Zweiter', '29. Oktober: Abstimmung', '1. [ ] Drei'].join('\n'), '14:05').slice(1);
  expect(items).toEqual([
    { text: '1\\. Erster Schritt', asTask: false },
    { text: '2\\) Zweiter', asTask: false },
    { text: '29\\. Oktober: Abstimmung', asTask: false },
    { text: 'Drei', asTask: true },
  ]);
});

test('every leading quote sign goes', () => {
  const items = answerItems('F', ['> > verschachtelt', '>>noch tiefer', '> - [ ] Aufgabe'].join('\n'), '14:05').slice(1);
  expect(items).toEqual([
    { text: 'verschachtelt', asTask: false },
    { text: 'noch tiefer', asTask: false },
    { text: 'Aufgabe', asTask: true },
  ]);
});

test('mit Quellen ist die Zeile der letzte Punkt, die Zeile der Antwort kein eigener', () => {
  const zeile = 'Quellen: [[2026-11-26]], [[Beispiel Projekt]]';
  const items = answerItems('F', 'Antwort.\nQuellen: 05 Daily Notes/2026-11-26.md | 02 Projekte/Beispiel Projekt.md', '14:05', zeile);
  expect(texts(items)).toEqual(['Claude, 14:05: F', 'Antwort.', zeile]);
  expect(items[2].asTask).toBe(false);
  // Ohne Quellen im Aufruf fehlt auch die Zeile der Antwort.
  expect(texts(answerItems('F', 'Antwort.\nQuellen: a', '14:05'))).toEqual(['Claude, 14:05: F', 'Antwort.']);
});

test('die Klammern der Quellen bleiben in der Notiz unverändert', () => {
  const zeile = 'Quellen: [[2026-11-26]], [[Beispiel Projekt]]';
  const items = answerItems('F', 'Antwort', '14:05', zeile);
  const note = addItemsToNote(newDailyNote('2026-11-26'), '2026-11-26', items)!;
  expect(note).toContain(`\n- ${zeile}`);
});
