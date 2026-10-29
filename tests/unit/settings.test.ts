import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { unwrap } from 'idb';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { loadSettings, saveSettings, type Settings } from '../../src/lib/settings';
import { openStore, type Store } from '../../src/sync/store';

// Alles hier ist erfunden, auch der Token.
const settings: Settings = {
  token: 'test-zugang-0123456789',
  repo: 'johrob-lab/2-gehirn-test',
  device: 'iPad',
  smoothing: 'mittel',
  prediction: true,
  quickSwitchPos: [40, 120],
  tokenExpiry: '2027-10-29',
};

let store: Store;

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store = await openStore();
});
afterEach(() => store.close());

test('the store has its four areas', () => {
  expect([...store.objectStoreNames].sort()).toEqual(['files', 'meta', 'outbox', 'settings']);
});

test('without saved settings it reads null', async () => {
  expect(await loadSettings(store)).toBeNull();
});

test('settings round trip', async () => {
  await saveSettings(store, settings);
  expect(await loadSettings(store)).toEqual(settings);
});

test('settings are kept under the key settings in the area settings', async () => {
  await saveSettings(store, settings);
  expect(await store.get('settings', 'settings')).toEqual(settings);
});

test('saving again replaces the old settings', async () => {
  await saveSettings(store, settings);
  const next: Settings = { token: 'test-zugang-neu', repo: settings.repo, device: 'Firmen-PC', smoothing: 'aus', prediction: false };
  await saveSettings(store, next);
  expect(await loadSettings(store)).toEqual(next);
});

test('settings survive closing and opening the store again', async () => {
  await saveSettings(store, settings);
  const again = await openStore();
  expect(await loadSettings(again)).toEqual(settings);
  again.close();
});

test('stores with different names do not share settings', async () => {
  await saveSettings(store, settings);
  const other = await openStore('anderes-notizbuch');
  expect(await loadSettings(other)).toBeNull();
  other.close();
});

test('the token is kept in IndexedDB only', async () => {
  await saveSettings(store, settings);
  expect(JSON.stringify({ ...localStorage })).not.toContain(settings.token);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(settings.token);
  expect(await store.getAll('files')).toEqual([]);
  expect(await store.getAll('outbox')).toEqual([]);
  expect(await store.getAll('meta')).toEqual([]);
});

test('settings still save after the browser closed the connection in the background', async () => {
  await saveSettings(store, settings);
  await store.run(async (db) => db.close());
  const next: Settings = { ...settings, device: 'Firmen-PC', prediction: false };
  await saveSettings(store, next);
  expect(await loadSettings(store)).toEqual(next);
  const again = await openStore(); // und sie stehen wirklich in der Datenbank
  expect(await loadSettings(again)).toEqual(next);
  again.close();
});

test('settings still load after the browser terminated the connection', async () => {
  await saveSettings(store, settings);
  await store.run(async (db) => forceCloseDatabase(unwrap(db) as never));
  expect(await loadSettings(store)).toEqual(settings);
});
