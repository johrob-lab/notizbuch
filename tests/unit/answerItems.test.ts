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
  expect(texts(items)).toEqual(['Heute', 'Zwei Punkte sind offen.', 'Termin mit Muster', 'Unterpunkt', 'Erster Schritt', 'Stern', 'Zitat', 'Spalte A · Spalte B', 'a · b', 'code()']);
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
