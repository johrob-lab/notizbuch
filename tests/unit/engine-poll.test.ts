import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SyncEngine } from '../../src/sync/engine';
import { A, B, S, httpError, svgPage, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

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
  await until(async () => (await lastHead()) !== undefined); // die erste Abfrage merkt sich den Stand als Letztes
  await e.flush(); // kehrt erst zurück, wenn auch der Abgleich vom Start fertig ist
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

/** Eine Datei, die ein anderes Gerät ändert: Die Abfrage übernimmt sie und sagt es der Seite. */
async function changeElsewhere(text: string, sha: string, head: string): Promise<void> {
  fake.files[A] = { text, sha };
  fake.changes = [A];
  fake.head = head;
  await e.pollRemote();
}

async function openA(): Promise<void> {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();
}

test('listeners hear a remote change next to onRemoteChange, and each can sign off', async () => {
  await openA();
  const first: string[][] = [];
  const second: string[][] = [];
  const signOffFirst = e.addRemoteChangeListener((paths) => first.push(paths));
  e.addRemoteChangeListener((paths) => second.push(paths));

  await changeElsewhere('a2', 'sa2', 'h2');
  expect(h.remoteChanges).toEqual([[A]]);
  expect(first).toEqual([[A]]);
  expect(second).toEqual([[A]]);

  signOffFirst();
  await changeElsewhere('a3', 'sa3', 'h3');
  expect(first).toEqual([[A]]);
  expect(second).toEqual([[A], [A]]);
});

test('the same listener signing off twice is harmless, and the others stay', async () => {
  await openA();
  const heard: string[][] = [];
  const signOff = e.addRemoteChangeListener(() => undefined);
  e.addRemoteChangeListener((paths) => heard.push(paths));
  signOff();
  signOff();
  await changeElsewhere('a2', 'sa2', 'h2');
  expect(heard).toEqual([[A]]);
});

test('a listener that throws does not keep the others from hearing, and the error is reported', async () => {
  await openA();
  const heard: string[][] = [];
  const failure = new Error('kaputt');
  e.addRemoteChangeListener(() => {
    throw failure;
  });
  e.addRemoteChangeListener((paths) => heard.push(paths));

  await changeElsewhere('a2', 'sa2', 'h2');
  expect(heard).toEqual([[A]]);
  expect(h.errors).toEqual([{ path: '', error: failure }]);
  expect(await lastHead()).toBe('h2'); // die Abfrage selbst ist durch
});

test('a listener that signs off while it is being told does not skip the next one', async () => {
  await openA();
  const heard: string[] = [];
  const signOff: () => void = e.addRemoteChangeListener(() => {
    heard.push('first');
    signOff();
  });
  e.addRemoteChangeListener(() => heard.push('second'));
  await changeElsewhere('a2', 'sa2', 'h2');
  expect(heard).toEqual(['first', 'second']);
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

test.each([
  ['404', httpError(404)],
  ['422', httpError(422)],
  ['422 about the sha', httpError(422, '"sha" wasn\'t supplied')],
])('an unknown old commit (%s) does not block polling for good', async (_name, error) => {
  fake.head = 'h1';
  await e.pollRemote();
  fake.changedError = error;
  fake.head = 'h2';
  await e.pollRemote();
  expect(await lastHead()).toBe('h2');
  expect(h.errors).toEqual([]);
});

test.each([
  ['a server error', httpError(500)],
  ['a bad gateway', httpError(502)],
  ['an error without a status', new Error('kaputt')],
  ['an unreadable answer', new TypeError('Unerwartete Antwort')],
])('any other failure of the comparison (%s) keeps the old head, so the next poll asks again', async (_name, error) => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();

  fake.files[A] = { text: 'a2', sha: 'sa2' };
  fake.changes = [A];
  fake.changedError = error;
  fake.head = 'h2';
  await e.pollRemote();
  expect(await lastHead()).toBe('h1');
  expect(h.errors).toEqual([{ path: '', error }]);
  expect(h.remoteChanges).toEqual([]);

  fake.changedError = undefined;
  await e.pollRemote();
  expect(await lastHead()).toBe('h2');
  expect(h.remoteChanges).toEqual([[A]]); // die versäumte Änderung kommt mit der Wiederholung
  expect(fake.changedArgs).toEqual([
    ['h1', 'h2'],
    ['h1', 'h2'],
  ]);
});

test('paths that were already refreshed are reported even when a later one stops the poll', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.files[B] = { text: 'b1', sha: 'sb1' };
  fake.head = 'h1';
  await e.read(A);
  await e.read(B);
  await e.pollRemote();

  fake.files[A] = { text: 'a2', sha: 'sa2' };
  fake.files[B] = { text: 'b2', sha: 'sb2' };
  fake.changes = [A, B];
  fake.head = 'h2';
  fake.before = (line) => {
    if (line === `get ${B}`) fake.offline = true; // das Netz fällt aus, nachdem A schon übernommen ist
  };
  await e.pollRemote();
  expect(await h.store.get('files', A)).toMatchObject({ text: 'a2', sha: 'sa2' }); // A ist lokal schon neu
  expect(h.remoteChanges).toEqual([[A]]); // also muss die Seite es erfahren
  expect(await lastHead()).toBe('h1'); // und die Abfrage gilt als nicht fertig

  fake.before = undefined;
  fake.offline = false;
  await e.pollRemote();
  expect(h.remoteChanges).toEqual([[A], [B]]); // A wird nicht noch einmal gemeldet
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

test('a file deleted on GitHub is dropped locally and the page is told', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();

  delete fake.files[A];
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(await h.store.get('files', A)).toBeUndefined();
  expect(h.remoteChanges).toEqual([[A]]);
  expect(await e.read(A)).toBeNull(); // die Seite liest neu und findet nichts mehr
  expect(await lastHead()).toBe('h2');
});

test('a file deleted on GitHub keeps its local copy while a change is queued, and the change brings it back', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();
  await e.write(A, 'lokal', 'md');

  delete fake.files[A];
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal' });
  expect(h.remoteChanges).toEqual([]);

  await e.flush();
  expect(fake.files[A].text).toBe('lokal'); // die eigene Änderung geht nicht verloren, die Datei ist wieder da
  expect(h.conflicts).toEqual([]);
});

test('a copy that was never on GitHub is not dropped just because the file is missing there', async () => {
  // Ein Zustand, den die App selbst nicht herstellt: eine Kopie ohne sha und ohne offene Änderung
  await h.store.put('files', { path: A, text: 'lokal', sha: null, base: null, syncedAt: 0 });
  fake.head = 'h1';
  await e.pollRemote();
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(fake.finished('get')).toBe(1); // die Abfrage hat nachgesehen
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal' });
  expect(h.remoteChanges).toEqual([]);
});

test('a page that still shows a file deleted on GitHub can write it back', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();
  delete fake.files[A];
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(h.remoteChanges).toEqual([[A]]);

  await e.write(A, 'a1 plus Ergänzung', 'md'); // die Seite hat den Hinweis noch nicht verarbeitet
  await e.flush();
  expect(fake.files[A].text).toBe('a1 plus Ergänzung');
  expect(fake.log.filter((line) => line.startsWith(`put ${A} `))).toEqual([`put ${A} sa1`, `put ${A} null`]);
  expect(h.conflicts).toEqual([]);
});

test('a page that learned the file is gone writes it fresh, without the old version', async () => {
  fake.files[A] = { text: 'a1', sha: 'sa1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();
  delete fake.files[A];
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  expect(await e.read(A)).toBeNull(); // die Seite liest neu und findet nichts

  await e.write(A, 'neu angelegt', 'md');
  await e.flush();
  expect(fake.log.filter((line) => line.startsWith(`put ${A} `))).toEqual([`put ${A} null`]);
  expect(fake.files[A].text).toBe('neu angelegt');
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
  await e.start(); // kehrt sofort zurück, eine zweite Abfrage würde sofort im Protokoll stehen
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
  const added = { document: vi.spyOn(document, 'addEventListener'), window: vi.spyOn(window, 'addEventListener') };
  const removed = { document: vi.spyOn(document, 'removeEventListener'), window: vi.spyOn(window, 'removeEventListener') };
  await startIdle();
  await e.write(A, 'x', 'md');
  expect(vi.getTimerCount()).toBe(2); // der Takt der Abfrage und die Wartezeit des Schreibens
  e.stop();
  expect(vi.getTimerCount()).toBe(0);

  const handler = (spy: typeof added.document, type: string) => spy.mock.calls.find(([name]) => name === type)?.[1];
  const onVisibility = handler(added.document, 'visibilitychange');
  const onOnline = handler(added.window, 'online');
  expect(onVisibility).toBeTypeOf('function');
  expect(onOnline).toBeTypeOf('function');
  expect(removed.document).toHaveBeenCalledWith('visibilitychange', onVisibility);
  expect(removed.window).toHaveBeenCalledWith('online', onOnline);

  // und die Ereignisse selbst bewirken nichts mehr: Eine Abfrage stünde sofort im Protokoll
  const calls = fake.log.length;
  setVisibility('visible');
  expect(fake.log.length).toBe(calls);
  expect(fake.files[A]).toBeUndefined();
});

test('stop right after start leaves nothing running, and a later start sets everything up only once', async () => {
  const starting = e.start();
  e.stop(); // bevor die Warteschlange geladen ist
  await starting;
  expect(vi.getTimerCount()).toBe(0);
  expect(fake.count('head')).toBe(0);
  setVisibility('visible');
  expect(fake.count('head')).toBe(0); // nichts hört mehr zu

  await startIdle();
  expect(vi.getTimerCount()).toBe(1); // ein Takt
  const polls = fake.count('head');
  setVisibility('visible');
  expect(fake.count('head')).toBe(polls + 1); // ein Zuhörer, nicht zwei
});

test('stopping and starting again before the queue is loaded still sets up once', async () => {
  const first = e.start();
  e.stop();
  const second = e.start();
  await Promise.all([first, second]);
  await until(async () => (await lastHead()) !== undefined);
  await e.flush();
  expect(vi.getTimerCount()).toBe(1);
  const polls = fake.count('head');
  setVisibility('visible');
  expect(fake.count('head')).toBe(polls + 1);
});
