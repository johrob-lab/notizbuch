import { expect, test } from 'vitest';
import { History, restore, type Removed } from '../../src/ink/history';
import type { Stroke } from '../../src/ink/types';

// Der Verlauf für Rückgängig und Wiederholen rechnet nur mit der Liste der Striche. Alles hier ist erfunden.

function stroke(id: string): Stroke {
  return { id, tool: 'kugel', color: 'schwarz', widthMm: 0.2, t: 1, w: 1.2, pts: [{ x: 1, y: 1, w: 1.2 }] };
}

const list = (...ids: string[]): Stroke[] => ids.map(stroke);
const ids = (strokes: Stroke[]): string[] => strokes.map((s) => s.id);

/** Nimmt die Striche an diesen Stellen heraus, einen nach dem anderen, und merkt sich die Stellen (wie der Radierer). */
function takeOut(strokes: Stroke[], ...indexes: number[]): Removed[] {
  return indexes.map((index) => ({ stroke: strokes.splice(index, 1)[0], index }));
}

test('undo takes a drawn stroke away and redo puts it back at the end', () => {
  const strokes = list('a');
  const history = new History();
  const b = stroke('b');
  strokes.push(b);
  history.push({ type: 'add', stroke: b });

  expect(history.undo(strokes)).toBe(true);
  expect(ids(strokes)).toEqual(['a']);
  expect(history.redo(strokes)).toBe(true);
  expect(ids(strokes)).toEqual(['a', 'b']);
  expect(strokes[1]).toBe(b);
});

test('undo of an erase puts every stroke back where it stood', () => {
  const strokes = list('a', 'b', 'c', 'd', 'e');
  const history = new History();
  // d zuerst (Stelle 3), dann b (Stelle 1): Jede Stelle gilt für die Liste, wie sie nach dem Vorgänger aussah.
  history.push({ type: 'erase', removed: takeOut(strokes, 3, 1) });
  expect(ids(strokes)).toEqual(['a', 'c', 'e']);

  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('undo of an erase works when a stroke at the front goes first and a later one behind it', () => {
  const strokes = list('a', 'b', 'c', 'd', 'e');
  const history = new History();
  history.push({ type: 'erase', removed: takeOut(strokes, 0, 2) }); // a, dann d (jetzt an Stelle 2)
  expect(ids(strokes)).toEqual(['b', 'c', 'e']);
  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('redo of an erase takes the same strokes out again', () => {
  const strokes = list('a', 'b', 'c', 'd', 'e');
  const history = new History();
  history.push({ type: 'erase', removed: takeOut(strokes, 3, 1) });
  history.undo(strokes);
  expect(history.redo(strokes)).toBe(true);
  expect(ids(strokes)).toEqual(['a', 'c', 'e']);
  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'b', 'c', 'd', 'e']);
});

test('steps are undone newest first', () => {
  const strokes = list('a', 'b', 'c');
  const history = new History();
  history.push({ type: 'erase', removed: takeOut(strokes, 1) });
  const d = stroke('d');
  strokes.push(d);
  history.push({ type: 'add', stroke: d });

  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'c']);
  history.undo(strokes);
  expect(ids(strokes)).toEqual(['a', 'b', 'c']);
  expect(history.canUndo).toBe(false);
  expect(history.canRedo).toBe(true);
});

test('there is nothing to do on an empty history, and the answer says so', () => {
  const strokes = list('a');
  const history = new History();
  expect(history.canUndo).toBe(false);
  expect(history.canRedo).toBe(false);
  expect(history.undo(strokes)).toBe(false);
  expect(history.redo(strokes)).toBe(false);
  expect(ids(strokes)).toEqual(['a']);
});

test('a new step makes the old redo steps disappear', () => {
  const strokes = list('a');
  const history = new History();
  const b = stroke('b');
  strokes.push(b);
  history.push({ type: 'add', stroke: b });
  history.undo(strokes);
  expect(history.canRedo).toBe(true);

  const c = stroke('c');
  strokes.push(c);
  history.push({ type: 'add', stroke: c });
  expect(history.canRedo).toBe(false);
  expect(history.redo(strokes)).toBe(false);
});

test('only the newest 300 steps can be undone', () => {
  const strokes: Stroke[] = [];
  const history = new History();
  for (let i = 0; i < 305; i++) {
    const s = stroke(`s${i}`);
    strokes.push(s);
    history.push({ type: 'add', stroke: s });
  }
  let undone = 0;
  while (history.undo(strokes)) undone++;
  expect(undone).toBe(300);
  expect(ids(strokes)).toEqual(['s0', 's1', 's2', 's3', 's4']);
});

test('the number of steps to keep can be chosen', () => {
  const strokes: Stroke[] = [];
  const history = new History(2);
  for (const id of ['a', 'b', 'c']) {
    const s = stroke(id);
    strokes.push(s);
    history.push({ type: 'add', stroke: s });
  }
  history.undo(strokes);
  history.undo(strokes);
  expect(history.undo(strokes)).toBe(false);
  expect(ids(strokes)).toEqual(['a']);
});

test('clear forgets undo and redo alike', () => {
  const strokes = list();
  const history = new History();
  const [a, b] = [stroke('a'), stroke('b')];
  strokes.push(a, b);
  history.push({ type: 'add', stroke: a });
  history.push({ type: 'add', stroke: b });
  history.undo(strokes); // einer ist rückgängig gemacht, einer lässt sich noch zurücknehmen
  expect(history.canUndo).toBe(true);
  expect(history.canRedo).toBe(true);
  history.clear();
  expect(history.canUndo).toBe(false);
  expect(history.canRedo).toBe(false);
});

test('undoing a stroke that is no longer on the page changes nothing else', () => {
  const strokes = list('a', 'b');
  const history = new History();
  history.push({ type: 'add', stroke: stroke('gone') });
  expect(history.undo(strokes)).toBe(true);
  expect(ids(strokes)).toEqual(['a', 'b']);
});

test('erased strokes can be put back without the history', () => {
  const strokes = list('a', 'b', 'c', 'd', 'e');
  const removed = takeOut(strokes, 3, 1);
  restore(strokes, removed);
  expect(ids(strokes)).toEqual(['a', 'b', 'c', 'd', 'e']);
});
