import { beforeEach, expect, test, vi } from 'vitest';
import { GestureFilter } from '../../src/ink/gestures';
import { outlineD } from '../../src/ink/outline';
import { DEFAULT_FUELLER, type FuellerSettings } from '../../src/ink/pens';
import { WIDTH_MM } from '../../src/ink/types';
import { DEFAULT_INK } from '../../src/lib/settings';
import { fuellerPanel, previewD, previewStroke } from '../../src/ui/FuellerPanel';
import { inkPrefs } from '../../src/ui/inkPrefs';
import { inkTools, type InkToolsOptions } from '../../src/ui/inkTools';
import { toolActions } from '../../src/ui/toolActions';

beforeEach(() => {
  inkPrefs.value = DEFAULT_INK;
  fuellerPanel.value = null;
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

test('choosing a pen keeps the colour and the width', () => {
  const { o } = setup();
  inkPrefs.value = { ...DEFAULT_INK, color: 'blau', width: 'breit', tool: 'eraser' };
  inkTools(o).choose.pen('fueller');
  expect(inkPrefs.value).toMatchObject({ pen: 'fueller', tool: 'pen', color: 'blau', width: 'breit' });
  inkTools(o).runAction({ kind: 'pen', pen: 'fineliner' });
  expect(inkPrefs.value).toMatchObject({ pen: 'fineliner', tool: 'pen', color: 'blau', width: 'breit' });
});

test('a second choice of the fountain pen opens the panel', () => {
  const { o } = setup();
  // Die erste Wahl wählt nur.
  inkTools(o).choose.pen('fueller');
  expect(inkPrefs.value).toMatchObject({ tool: 'pen', pen: 'fueller' });
  expect(fuellerPanel.value).toBeNull();

  // Die zweite öffnet das Fenster, gewählt wird nichts neu: aus der Werkzeugleiste unter dem Knopf ...
  const chosen = inkPrefs.value;
  const button = { left: 104, top: 8, bottom: 52, width: 44 };
  inkTools(o).choose.pen('fueller', button);
  expect(fuellerPanel.value).toEqual({ at: 'leiste', rect: button });
  expect(inkPrefs.value).toBe(chosen);

  // ... aus Rad und Lasche in der Mitte der Bühne.
  fuellerPanel.value = null;
  inkTools(o).runAction({ kind: 'pen', pen: 'fueller' });
  expect(fuellerPanel.value).toEqual({ at: 'mitte' });
  expect(inkPrefs.value).toBe(chosen);
});

test('choosing the fountain pen again closes its open panel', () => {
  const { o } = setup();
  inkPrefs.value = { ...DEFAULT_INK, pen: 'fueller' };
  inkTools(o).choose.pen('fueller');
  expect(fuellerPanel.value).toEqual({ at: 'mitte' });
  inkTools(o).choose.pen('fueller', { left: 104, top: 8, bottom: 52, width: 44 });
  expect(fuellerPanel.value).toBeNull();
  expect(inkPrefs.value.pen).toBe('fueller');
});

test('the fountain pen with the eraser or without writing opens no panel', () => {
  // Beim Radierer ist die Füllfeder nicht gewählt: Der Tipp wählt sie.
  inkPrefs.value = { ...DEFAULT_INK, pen: 'fueller', tool: 'eraser' };
  inkTools(setup().o).choose.pen('fueller');
  expect(inkPrefs.value.tool).toBe('pen');
  expect(fuellerPanel.value).toBeNull();
  // Wo nicht geschrieben wird (Firmen-PC, Lesefenster, Seite nicht beschreibbar), gibt es kein Fenster.
  inkTools(setup({ canWrite: false }).o).choose.pen('fueller');
  inkTools(setup({ canWrite: false, full: true }).o).runAction({ kind: 'pen', pen: 'fueller' });
  expect(fuellerPanel.value).toBeNull();
});

/** Die Befehle eines Pfads (ohne Zahlen) und die Zahlenpaare, die auf sie folgen. */
function parse(d: string): { commands: string[]; points: [number, number][] } {
  const commands = d.match(/[A-Za-z]/g) ?? [];
  const numbers = (d.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
  const points: [number, number][] = [];
  for (let i = 0; i + 1 < numbers.length; i += 2) points.push([numbers[i], numbers[i + 1]]);
  return { commands, points };
}

test('previewD changes with the settings', () => {
  const flat = previewD({ ...DEFAULT_FUELLER, rundung: 0 }, WIDTH_MM.mittel);
  const round = previewD({ ...DEFAULT_FUELLER, rundung: 1 }, WIDTH_MM.mittel);
  expect(flat.d).not.toBe(round.d);
  for (const { d } of [flat, round]) {
    const { commands } = parse(d);
    expect(commands[0]).toBe('M');
    expect([...new Set(commands)].sort()).toEqual(['L', 'M', 'Z']);
  }
  // Jeder Regler wirkt auf die Vorschau.
  for (const key of ['schaerfe', 'druck', 'stabil'] as const) {
    const other: FuellerSettings = { ...DEFAULT_FUELLER, [key]: DEFAULT_FUELLER[key] === 1 ? 0 : 1 };
    expect(previewD(other, WIDTH_MM.mittel).d, key).not.toBe(previewD(DEFAULT_FUELLER, WIDTH_MM.mittel).d);
  }
});

test('the preview fits its viewBox with any settings and width', () => {
  const extremes: FuellerSettings[] = [
    DEFAULT_FUELLER,
    { schaerfe: 0, druck: 1, rundung: 0, stabil: 0 },
    { schaerfe: 1, druck: 1, rundung: 1, stabil: 1 },
    { schaerfe: 0, druck: 0, rundung: 0, stabil: 1 },
  ];
  for (const widthMm of Object.values(WIDTH_MM)) {
    for (const o of extremes) {
      const { d, viewBox } = previewD(o, widthMm);
      const [left, top, w, h] = viewBox.split(' ').map(Number);
      expect(w, viewBox).toBeGreaterThan(0);
      expect(h, viewBox).toBeGreaterThan(0);
      const { points } = parse(d);
      expect(points.length).toBeGreaterThan(10);
      for (const [x, y] of points) {
        expect(x, `${JSON.stringify(o)} ${widthMm} mm`).toBeGreaterThanOrEqual(left);
        expect(x, `${JSON.stringify(o)} ${widthMm} mm`).toBeLessThanOrEqual(left + w);
        expect(y, `${JSON.stringify(o)} ${widthMm} mm`).toBeGreaterThanOrEqual(top);
        expect(y, `${JSON.stringify(o)} ${widthMm} mm`).toBeLessThanOrEqual(top + h);
      }
    }
  }
});

test('the preview shows speed and tips', () => {
  // Die Vorschau setzt langsam an (0,2 Bildschirmpunkte je ms), wird zur Mitte etwas schneller (0,35) und hebt schnell ab (1,0).
  const done = previewStroke(DEFAULT_FUELLER, WIDTH_MM.mittel).pts;
  const base = previewStroke({ ...DEFAULT_FUELLER, schaerfe: 0 }, WIDTH_MM.mittel).pts; // ohne Verjüngung
  expect(previewD(DEFAULT_FUELLER, WIDTH_MM.mittel).d).toBe(outlineD(done));
  // Die Breite nimmt zum schnellen Ende hin ab: Am Ende ist die Linie schmaler als am Anfang, obwohl die Kurve dort dieselbe
  // Richtung hat und der Druck derselbe ist (gemessen 0,68-fach).
  const last = base.length - 1;
  expect(base[last].w).toBeLessThanOrEqual(0.8 * base[0].w);
  // Das Ende läuft länger spitz aus als der Anfang: Die Strecke, nach der die Breite 90 % der Grundbreite erreicht (gemessen am
  // Anfang 2,9 Einheiten, am Ende 12,9).
  const s = [0];
  for (let i = 1; i <= last; i++) s.push(s[i - 1] + Math.hypot(done[i].x - done[i - 1].x, done[i].y - done[i - 1].y));
  const full = done.map((p, i) => p.w >= 0.9 * base[i].w);
  const fromStart = s[full.indexOf(true)];
  const fromEnd = s[last] - s[full.lastIndexOf(true)];
  expect(fromStart).toBeLessThanOrEqual(4);
  expect(fromEnd).toBeGreaterThanOrEqual(3 * fromStart);
});

test('the quick switch goes back to the last pen', () => {
  const { o } = setup();
  inkPrefs.value = { ...DEFAULT_INK, pen: 'bleistift' };
  inkTools(o).quick.onToggle();
  expect(inkPrefs.value).toMatchObject({ tool: 'eraser', pen: 'bleistift' });
  inkTools(o).quick.onToggle();
  expect(inkPrefs.value).toMatchObject({ tool: 'pen', pen: 'bleistift' });
  expect(inkTools(o).quick.pen).toBe('bleistift');
});
