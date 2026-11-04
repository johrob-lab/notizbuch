import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { DEFAULT_FUELLER } from '../../src/ink/pens';
import { DEFAULT_INK, loadSettings, saveSettings, type Settings } from '../../src/lib/settings';
import { openStore, type Store } from '../../src/sync/store';
import { initInkPrefs, inkPrefs, setInkPrefs } from '../../src/ui/inkPrefs';

// Alles hier ist erfunden, auch der Token.
const settings: Settings = { token: 'test-zugang-0123456789', repo: 'muster/vault-test', device: 'iPad', smoothing: 'mittel', prediction: true };

let store: Store;
beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store = await openStore();
  await saveSettings(store, settings);
});
afterEach(() => {
  vi.useRealTimers();
  store.close();
});

test('initInkPrefs fills gaps and ignores garbage', () => {
  initInkPrefs(null);
  expect(inkPrefs.value).toEqual(DEFAULT_INK);
  initInkPrefs({ ...settings, ink: { tool: 'eraser', color: 'lila' } as never });
  expect(inkPrefs.value).toEqual({ ...DEFAULT_INK, tool: 'eraser' });
});

test('setInkPrefs saves once after 500 ms', async () => {
  initInkPrefs(settings, store);
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  setInkPrefs({ color: 'rot' }, store);
  setInkPrefs({ width: 'breit' }, store);
  expect(inkPrefs.value).toMatchObject({ color: 'rot', width: 'breit' });
  expect((await loadSettings(store))!.ink).toBeUndefined();
  await vi.advanceTimersByTimeAsync(500);
  await vi.waitFor(async () => expect((await loadSettings(store))!.ink).toMatchObject({ color: 'rot', width: 'breit' }));
  expect((await loadSettings(store))!.token).toBe(settings.token);
});

test('grey is not a colour you can choose', () => {
  initInkPrefs({ ...settings, ink: { color: 'grau' } as never });
  expect(inkPrefs.value.color).toBe('schwarz');
});

test('a saved choice without a pen or with an unknown pen is the ballpoint', () => {
  initInkPrefs({ ...settings, ink: { color: 'rot' } as never });
  expect(inkPrefs.value.pen).toBe('kugel');
  initInkPrefs({ ...settings, ink: { pen: 'pinsel' } as never });
  expect(inkPrefs.value.pen).toBe('kugel');
  initInkPrefs({ ...settings, ink: { pen: 'fueller' } as never });
  expect(inkPrefs.value.pen).toBe('fueller');
});

test('a saved pencil becomes the ballpoint', () => {
  initInkPrefs({ ...settings, ink: { pen: 'bleistift', color: 'rot' } as never });
  expect(inkPrefs.value.pen).toBe('kugel');
  expect(inkPrefs.value.color).toBe('rot');
});

test('fountain pen settings fall back to the start values', () => {
  expect(DEFAULT_INK.fueller).toEqual(DEFAULT_FUELLER);
  // Fehlt die ganze Einstellung, oder ist sie kein Objekt: alle vier Startwerte.
  for (const fueller of [undefined, null, 'scharf', Number.NaN]) {
    initInkPrefs({ ...settings, ink: { fueller } as never });
    expect(inkPrefs.value.fueller, String(fueller)).toEqual(DEFAULT_FUELLER);
  }
  // Je Regler: fehlt, null, Text, NaN, unendlich gibt seinen Startwert, die übrigen bleiben.
  initInkPrefs({ ...settings, ink: { fueller: { schaerfe: null, druck: '0.5', rundung: Number.NaN, stabil: Number.POSITIVE_INFINITY } } as never });
  expect(inkPrefs.value.fueller).toEqual(DEFAULT_FUELLER);
  initInkPrefs({ ...settings, ink: { fueller: { druck: 0.5 } } as never });
  expect(inkPrefs.value.fueller).toEqual({ ...DEFAULT_FUELLER, druck: 0.5 });
  // Auf 0 bis 1 begrenzt und auf zwei Nachkommastellen gerundet.
  initInkPrefs({ ...settings, ink: { fueller: { schaerfe: 1.7, druck: -0.2, rundung: 0.333, stabil: 0 } } as never });
  expect(inkPrefs.value.fueller).toEqual({ schaerfe: 1, druck: 0, rundung: 0.33, stabil: 0 });
  // Die übrige Wahl bleibt davon unberührt.
  expect(inkPrefs.value).toEqual({ ...DEFAULT_INK, fueller: { schaerfe: 1, druck: 0, rundung: 0.33, stabil: 0 } });
});
