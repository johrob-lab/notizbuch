import { beforeEach, expect, test, vi } from 'vitest';
import { GestureFilter } from '../../src/ink/gestures';
import { DEFAULT_INK } from '../../src/lib/settings';
import { inkPrefs } from '../../src/ui/inkPrefs';
import { inkTools, type InkToolsOptions } from '../../src/ui/inkTools';
import { toolActions } from '../../src/ui/toolActions';

beforeEach(() => {
  inkPrefs.value = DEFAULT_INK;
});

function setup(over: Partial<InkToolsOptions> = {}) {
  const surface = { current: { undo: vi.fn(), redo: vi.fn(), zoomToFit: vi.fn() } };
  const onVollbildAus = vi.fn();
  const o: InkToolsOptions = { surface, canWrite: true, full: false, canUndo: true, canRedo: false, onVollbildAus, filter: new GestureFilter(), ...over };
  return { o, surface, onVollbildAus };
}

test('choosing a colour picks the pen, choosing an eraser size picks the eraser', () => {
  const { o } = setup();
  inkPrefs.value = { ...DEFAULT_INK, tool: 'eraser' };
  inkTools(o).choose.color('blau');
  expect(inkPrefs.value.color).toBe('blau');
  expect(inkPrefs.value.tool).toBe('pen');
  inkTools(o).choose.eraserSize('gross');
  expect(inkPrefs.value.eraserSize).toBe('gross');
  expect(inkPrefs.value.tool).toBe('eraser');
});

test('the ring buttons run the same choices and the surface commands', () => {
  const { o, surface, onVollbildAus } = setup();
  const t = inkTools(o);
  t.runAction({ kind: 'width', width: 'breit' });
  expect(inkPrefs.value.width).toBe('breit');
  t.runAction({ kind: 'undo' });
  expect(surface.current.undo).toHaveBeenCalledTimes(1);
  t.runAction({ kind: 'exit' });
  expect(onVollbildAus).toHaveBeenCalledTimes(1);
});

test('there are ring buttons only in fullscreen', () => {
  expect(inkTools(setup({ full: false }).o).actions).toBeNull();
  const { o } = setup({ full: true });
  const expected = toolActions({ ink: inkPrefs.value, canWrite: true, canUndo: true, canRedo: false, canBack: false, canForward: false, stepLabels: ['Zurück', 'Weiter'] });
  expect(inkTools(o).actions).toEqual(expected);
});

test('the quick switch toggles between pen and eraser', () => {
  const { o } = setup();
  inkTools(o).quick.onToggle();
  expect(inkPrefs.value.tool).toBe('eraser');
  inkTools(o).quick.onToggle();
  expect(inkPrefs.value.tool).toBe('pen');
});
