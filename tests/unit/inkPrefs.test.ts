import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
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
