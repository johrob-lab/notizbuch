import { expect, test } from 'vitest';
import { DEFAULT_INK } from '../../src/lib/settings';
import { toolActions } from '../../src/ui/toolActions';

const ink = { ...DEFAULT_INK };
const base = { ink, canWrite: true, canUndo: true, canRedo: false, canBack: true, canForward: true, stepLabels: ['Voriger Tag', 'Nächster Tag'] as [string, string] };

test('pen shows colours and widths inside, everything else outside', () => {
  const { inner, outer } = toolActions(base);
  expect(inner.map((b) => b.label)).toEqual(['Schwarz', 'Blau', 'Rot (offen)', 'Grün (erledigt)', 'Fein (0,1 mm)', 'Mittel (0,2 mm)', 'Breit (0,4 mm)']);
  expect(outer.map((b) => b.label)).toEqual(['Kugelschreiber', 'Radierer', 'Rückgängig', 'Wiederholen', 'Voriger Tag', 'Heute', 'Nächster Tag', 'Ganze Seite', 'Vollbild aus']);
  expect(inner.find((b) => b.label === 'Schwarz')!.pressed).toBe(true);
  expect(outer.find((b) => b.label === 'Wiederholen')!.disabled).toBe(true);
  expect(outer.filter((b) => b.keepsOpen).map((b) => b.label)).toEqual(['Rückgängig', 'Wiederholen']);
});

test('eraser shows sizes and modes inside', () => {
  const { inner } = toolActions({ ...base, ink: { ...ink, tool: 'eraser', eraserSize: 'gross', eraserMode: 'stueck' } });
  expect(inner.map((b) => b.label)).toEqual(['Radierer klein', 'Radierer mittel', 'Radierer groß', 'Ganzer Strich', 'Nur Stück']);
  expect(inner.filter((b) => b.pressed).map((b) => b.label)).toEqual(['Radierer groß', 'Nur Stück']);
});

test('without writing only paging and the view are offered', () => {
  const { inner, outer } = toolActions({ ...base, canWrite: false, canForward: false });
  expect(inner).toEqual([]);
  expect(outer.map((b) => b.label)).toEqual(['Voriger Tag', 'Heute', 'Nächster Tag', 'Ganze Seite', 'Vollbild aus']);
  expect(outer.find((b) => b.label === 'Nächster Tag')!.disabled).toBe(true);
});

test('keys are unique', () => {
  const { inner, outer } = toolActions(base);
  const keys = [...inner, ...outer].map((b) => b.key);
  expect(new Set(keys).size).toBe(keys.length);
});
