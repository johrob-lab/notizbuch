import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SyncEngine } from '../../src/sync/engine';
import { A, B, S, quiet, svgPage, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

let h: Harness;
let fake: FakeClient;
let e: SyncEngine;

beforeEach(async () => {
  h = await setupHarness();
  ({ fake, e } = h);
});
afterEach(() => {
  delete (navigator as { storage?: unknown }).storage;
  delete (document as { visibilityState?: unknown }).visibilityState;
  return h.dispose();
});

async function lastHead(): Promise<unknown> {
  return h.store.get('meta', 'lastHead');
}

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

/** Start und warten, bis der Abgleich beim Start (Abfrage und Hochladen) durch ist. */
async function startIdle() {
  await e.start();
  await until(() => fake.count('head') === 1);
  await quiet();
}

// ---------- pollRemote ----------

test('the first poll only stores the head', async () => {
  fake.head = 'h1';
  await e.pollRemote();
  expect(await lastHead()).toBe('h1');
  expect(fake.count('changed')).toBe(0);
});

test('a new head refreshes clean local copies and tells the page once', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.files[B] = { text: 'b1', sha: 'sb1' };
  fake.head = 'h1';
  await e.read(A);
  await e.read(B);
  await e.pollRemote();

  fake.files[A] = { text: 'a2', sha: 'sa2' };
  fake.files[B] = { text: 'b2', sha: 'sb2' };
  fake.files[S] = { text: svgPage('x'), sha: 'ss1' }; // geändert, aber nie geöffnet
  fake.changes = [A, B, S];
  fake.head = 'h2';
  await e.pollRemote();

  expect(fake.changedArgs).toEqual([['h1', 'h2']]);
  expect(h.remoteChanges).toEqual([[A, B]]);
  expect(await h.store.get('files', A)).toMatchObject({ text: 'a2', sha: 'sa2', base: 'a2' });
  expect(await h.store.get('files', B)).toMatchObject({ text: 'b2', sha: 'sb2' });
  expect(fake.log).not.toContain(`get ${S}`);
  expect(await lastHead()).toBe('h2');
});

test('a path with a queued change is left alone', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();
  await e.write(A, 'lokal', 'md');

  fake.files[A] = { text: 'fremd', sha: 'sa2' };
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal', sha: 'sa1' });
  expect(h.remoteChanges).toEqual([]);
  expect(await lastHead()).toBe('h2');
});

test('a copy that already has the new sha is not reported', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(h.remoteChanges).toEqual([]);
});

test('a head that did not change asks for nothing more', async () => {
  fake.head = 'h1';
  await e.pollRemote();
  await e.pollRemote();
  expect(fake.count('changed')).toBe(0);
});

test('polling never throws, and the old head stays when the network fails', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();

  fake.offline = true;
  fake.head = 'h2';
  await e.pollRemote();
  expect(await lastHead()).toBe('h1');

  // Das Netz fällt mitten im Auffrischen aus: Der neue Stand wird erst gemerkt, wenn alles durch ist.
  fake.offline = false;
  fake.files[A] = { text: 'a2', sha: 'sa2' };
  fake.changes = [A];
  fake.before = (line) => {
    if (line.startsWith('get ')) fake.offline = true;
  };
  await e.pollRemote();
  expect(await lastHead()).toBe('h1');
  expect(h.remoteChanges).toEqual([]);

  fake.before = undefined;
  fake.offline = false;
  await e.pollRemote();
  expect(await lastHead()).toBe('h2');
  expect(h.remoteChanges).toEqual([[A]]);
});

test('the old head stays when the network fails exactly while asking what changed', async () => {
  fake.head = 'h1';
  await e.pollRemote();
  fake.head = 'h2';
  fake.before = (line) => {
    if (line === 'changed') fake.offline = true;
  };
  await e.pollRemote();
  expect(await lastHead()).toBe('h1');

  fake.before = undefined;
  fake.offline = false;
  await e.pollRemote();
  expect(await lastHead()).toBe('h2');
});

test('an unknown old commit does not block polling for good', async () => {
  fake.head = 'h1';
  await e.pollRemote();
  fake.changedError = new Error('GitHub antwortete mit Status 404.');
  fake.head = 'h2';
  await e.pollRemote();
  expect(await lastHead()).toBe('h2');
});

test('a file that cannot be read does not stop the others', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.files[B] = { text: 'b1', sha: 'sb1' };
  fake.head = 'h1';
  await e.read(A);
  await e.read(B);
  await e.pollRemote();

  fake.files[A] = { text: 'a2', sha: 'sa2' };
  fake.files[B] = { text: 'b2', sha: 'sb2' };
  fake.broken.add(A);
  fake.changes = [A, B];
  fake.head = 'h2';
  await e.pollRemote();
  expect(h.remoteChanges).toEqual([[B]]);
  expect(h.errors.map((i) => i.path)).toEqual([A]);
  expect(await h.store.get('files', A)).toMatchObject({ text: 'a1', sha: 'sa1' });
  expect(await lastHead()).toBe('h2');
});

test('a refused access while polling shows zugang', async () => {
  fake.auth = false;
  await e.pollRemote();
  expect(e.status.value.state).toBe('zugang');
});

// ---------- start und stop ----------

test('start asks the browser once to keep the data', async () => {
  const persist = vi.fn(async () => true);
  Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
  await startIdle();
  expect(persist).toHaveBeenCalledTimes(1);
});

test('starting twice changes nothing', async () => {
  const persist = vi.fn(async () => true);
  Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true });
  await startIdle();
  await e.start();
  await quiet();
  expect(persist).toHaveBeenCalledTimes(1);
  expect(fake.count('head')).toBe(1);
});

test('start polls and sends what is waiting', async () => {
  await e.write(A, 'x', 'md');
  await startIdle();
  expect(fake.files[A].text).toBe('x');
  expect(fake.count('head')).toBe(1);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a hidden page sends what is waiting, a visible page polls', async () => {
  await startIdle();
  await e.write(A, 'x', 'md');
  setVisibility('hidden');
  await until(() => fake.files[A]?.text === 'x');
  setVisibility('visible');
  await until(() => fake.count('head') === 2);
});

test('coming online sends what is waiting', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  await e.start();
  await until(() => e.status.value.state === 'wartet');
  fake.offline = false;
  window.dispatchEvent(new Event('online'));
  await until(() => fake.files[A]?.text === 'x');
  await until(() => e.status.value.state === 'gesichert');
});

test('every 3 minutes it polls, and sends only when something is waiting', async () => {
  await startIdle();
  await vi.advanceTimersByTimeAsync(180_000); // erster Takt: nichts wartet, es wird nur abgefragt
  await until(() => fake.count('head') === 2);
  expect(fake.count('put')).toBe(0);

  fake.offline = true;
  await e.write(A, 'x', 'md');
  await vi.advanceTimersByTimeAsync(179_000); // die Wartezeit des Schreibens läuft ab, das Hochladen scheitert
  await until(() => e.status.value.state === 'wartet');
  fake.offline = false;
  await vi.advanceTimersByTimeAsync(1_000); // zweiter Takt
  await until(() => fake.files[A]?.text === 'x');
  expect(fake.count('head')).toBeGreaterThanOrEqual(3);
});

test('stop removes the listeners and the timers', async () => {
  await startIdle();
  await e.write(A, 'x', 'md');
  e.stop();
  const calls = fake.log.length;
  setVisibility('hidden');
  setVisibility('visible');
  window.dispatchEvent(new Event('online'));
  await vi.advanceTimersByTimeAsync(600_000); // auch die Wartezeit des Schreibens von eben ist abgebrochen
  await quiet();
  expect(fake.log.length).toBe(calls);
  expect(fake.files[A]).toBeUndefined();
});
