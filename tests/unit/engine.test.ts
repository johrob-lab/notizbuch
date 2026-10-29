import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { toggleTask } from '../../src/lib/dailyNote';
import { GitHubClient } from '../../src/sync/github';
import { openStore } from '../../src/sync/store';
import { forceCloseDatabase } from 'fake-indexeddb';
import { unwrap } from 'idb';
import { PathNotAllowedError } from '../../src/sync/paths';
import { SyncEngine, statusLabel } from '../../src/sync/engine';
import { fixture, lineOf } from './helpers';
import { A, B, S, svgPage, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

const base = fixture('05 Daily Notes/2026-10-29.md');

let h: Harness;
let fake: FakeClient;
let e: SyncEngine;
let conflicts: Harness['conflicts'];

beforeEach(async () => {
  h = await setupHarness();
  ({ fake, e, conflicts } = h);
});
afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  return h.dispose();
});

/** Navigator-Wert für die Dauer eines Tests ändern. */
function setOnLine(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { value, configurable: true });
}

// ---------- Tests aus dem Brief ----------

test('statusLabel', () => {
  expect(statusLabel({ state: 'gesichert', pending: 0 })).toBe('Gesichert');
  expect(statusLabel({ state: 'wartet', pending: 1 })).toBe('Wartet auf Netz · 1 Änderung');
  expect(statusLabel({ state: 'wartet', pending: 2 })).toBe('Wartet auf Netz · 2 Änderungen');
  expect(statusLabel({ state: 'zugang', pending: 3 })).toBe('Zugang erneuern');
});

test('queues while offline', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  await e.write(B, 'y', 'md');
  await vi.advanceTimersByTimeAsync(2000);
  await until(() => e.status.value.state === 'wartet');
  expect(e.status.value).toEqual({ state: 'wartet', pending: 2 });
});

test('flush uploads and reports Gesichert', async () => {
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(fake.files[A].text).toBe('x');
  expect(e.status.value.state).toBe('gesichert');
});

test('merges remote change on other line', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  fake.files[A] = { text: base.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 gemeldet%%'), sha: 's2' }; // Routine war schneller
  await e.write(A, ours, 'md');
  await e.flush();
  expect(fake.files[A].text).toContain('- [x] Liste Planobjekte');
  expect(fake.files[A].text).toContain('todo:AAMkTEST2 gemeldet');
});

test('same line conflict writes copy and keeps remote', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = base.replace('Urlaube im Plan nachziehen', 'Urlaube heute nachziehen');
  const theirs = base.replace('Urlaube im Plan nachziehen', 'Urlaube morgen nachziehen');
  fake.files[A] = { text: theirs, sha: 's2' };
  await e.write(A, ours, 'md');
  await e.flush();
  expect(fake.files['05 Daily Notes/2026-10-29 (Konflikt).md'].text).toBe(ours);
  expect(fake.files['05 Daily Notes/2026-10-29.md'].text).toBe(theirs);
  expect(conflicts).toEqual([{ path: '05 Daily Notes/2026-10-29.md', copyPath: '05 Daily Notes/2026-10-29 (Konflikt).md' }]);
});

test('auth error keeps outbox', async () => {
  fake.auth = false;
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(e.status.value).toEqual({ state: 'zugang', pending: 1 });
});

test('outbox survives reload', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  const e2 = await h.restart();
  await e2.start();
  expect(e2.status.value.pending).toBe(1);
  expect(await e2.read(A)).toBe('x');
  await until(() => e2.status.value.state === 'wartet'); // der Abgleich beim Start scheitert ohne Netz
});

// ---------- Ablauf des Hochladens ----------

test('commit message names the file and the device', async () => {
  await e.write(A, 'x', 'md');
  await e.write(S, svgPage('a'), 'svg');
  await e.flush();
  expect(fake.messages).toEqual(['Notizbuch: 2026-10-29.md (iPad)', 'Notizbuch: 2026-10-29 Tag.svg (iPad)']);
});

test('text goes up 2 s and ink 10 s after the last change', async () => {
  await e.write(A, 'x', 'md');
  await vi.advanceTimersByTimeAsync(1999);
  await e.write(A, 'xy', 'md'); // jede Änderung beginnt die Wartezeit neu
  await vi.advanceTimersByTimeAsync(1999);
  expect(fake.count('put')).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  await until(() => fake.files[A]?.text === 'xy');
  await until(() => e.status.value.pending === 0);
  await e.flush(); // kehrt erst zurück, wenn der Abgleich von eben ganz durch ist, sonst nähme er die Handschrift gleich mit
  expect(fake.count('put')).toBe(1);

  const page = svgPage('a');
  await e.write(S, page, 'svg');
  await vi.advanceTimersByTimeAsync(9999);
  expect(fake.files[S]).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  await until(() => fake.files[S]?.text === page);
});

test('a new file goes up without sha and its sha is kept', async () => {
  await e.write(B, 'neu', 'md');
  await e.flush();
  expect(fake.log).toContain(`put ${B} null`);
  expect(await h.store.get('files', B)).toMatchObject({ text: 'neu', sha: fake.files[B].sha, base: 'neu' });
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('coalesced writes keep the first base', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  await e.write(A, 'eins', 'md');
  await e.write(A, 'zwei', 'md');
  const entries = await h.store.getAll('outbox');
  expect(entries).toHaveLength(1);
  expect(entries[0]).toMatchObject({ path: A, text: 'zwei', kind: 'md', baseSha: 's1', baseText: base });
  expect(await h.store.get('files', A)).toMatchObject({ text: 'zwei', sha: 's1', base });
  expect(e.status.value.pending).toBe(1);
});

test('a write during an upload survives and goes up next', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const hold = fake.hold('put');
  await e.write(A, 'v1', 'md');
  const flushing = e.flush();
  await hold.reached;
  await e.write(A, 'v2', 'md'); // kommt an, während v1 unterwegs ist
  hold.release();
  await flushing;

  const shaOfV1 = fake.files[A].sha;
  expect(fake.files[A].text).toBe('v1');
  expect(await h.store.get('outbox', A)).toMatchObject({ text: 'v2', baseSha: shaOfV1, baseText: 'v1' });
  expect(await h.store.get('files', A)).toMatchObject({ text: 'v2', sha: shaOfV1, base: 'v1' });
  expect(e.status.value.pending).toBe(1);

  await e.flush();
  expect(fake.files[A].text).toBe('v2');
  expect(fake.log.filter((line) => line.startsWith(`put ${A}`))).toEqual([`put ${A} s1`, `put ${A} ${shaOfV1}`]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('writing the same text back during an upload still ends with the newest text', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const hold = fake.hold('put');
  await e.write(A, 'v1', 'md');
  const flushing = e.flush();
  await hold.reached;
  await e.write(A, base, 'md'); // zurück zum alten Stand, während v1 hochgeladen wird
  hold.release();
  await flushing;
  await e.flush();
  expect(fake.files[A].text).toBe(base);
});

test('an upload that arrived but was never answered is recognised later and not sent twice', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  await e.write(A, ours, 'md');
  e.stop();
  const hold = fake.hold('put'); // GitHub nimmt die Änderung an, die Antwort kommt nie an
  const flushing = e.flush();
  await hold.reached;
  await vi.advanceTimersByTimeAsync(30_000);
  await flushing;
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  expect(fake.files[A].text).toBe(ours);
  const shaOnGitHub = fake.files[A].sha;

  hold.release();
  await e.flush();
  expect(fake.files[A].sha).toBe(shaOnGitHub); // kein zweiter Commit
  expect(fake.messages).toHaveLength(1);
  expect(h.conflicts).toEqual([]);
  expect(await h.store.get('files', A)).toMatchObject({ text: ours, sha: shaOnGitHub, base: ours });
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('the real GitHub client fits the engine', () => {
  const client = new GitHubClient({ token: 'test-zugang-0123456789', repo: 'johrob-lab/2-gehirn-test', fetchFn: () => Promise.reject(new TypeError('kein Netz')) });
  const engine = new SyncEngine({ client, store: h.store, device: 'iPad' });
  expect(engine.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('uploads run one at a time and a flush during a flush runs once more', async () => {
  const hold = fake.hold('put');
  await e.write(A, '1', 'md');
  const first = e.flush();
  await hold.reached;
  await e.write(B, '2', 'md');
  const second = e.flush(); // angefordert, während der erste läuft
  hold.release();
  await Promise.all([first, second]);
  expect(fake.files[B].text).toBe('2');
  expect(fake.maxActive).toBe(1);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a flush requested while a pass fails on the network gets a pass of its own', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  fake.before = (line) => {
    if (!line.startsWith('put ')) return;
    fake.before = undefined;
    void e.flush(); // das Netz ist zurück, und jemand ruft den Abgleich auf, während der laufende noch scheitert
    queueMicrotask(() => (fake.offline = false)); // erst nach dieser Anfrage, sie scheitert noch
  };
  await e.flush();
  expect(fake.files[A].text).toBe('x');
  expect(fake.count('put')).toBe(2);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('changes go up in the order in which their files were first changed, a later edit does not move a file back', async () => {
  await e.write(A, '1', 'md');
  vi.setSystemTime(Date.now() + 1000);
  await e.write(B, '2', 'md');
  vi.setSystemTime(Date.now() + 1000);
  await e.write(A, '3', 'md'); // A war zuerst dran und bleibt es
  await e.flush();
  expect(fake.log.filter((line) => line.startsWith('put '))).toEqual([`put ${A} null`, `put ${B} null`]);
  expect(fake.files[A].text).toBe('3');
});

test('unchanged text is not uploaded', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  await e.write(A, 'anders', 'md');
  await e.write(A, base, 'md'); // wieder der Stand von GitHub
  await e.flush();
  expect(fake.count('put')).toBe(0);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

// ---------- Status ----------

test('status stays during the waiting time and turns Gesichert after the upload', async () => {
  await e.write(A, 'x', 'md');
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 1 });
  await e.flush();
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('offline upload waits, then the next flush secures', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  fake.offline = false;
  await e.flush();
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
  expect(fake.files[A].text).toBe('x');
});

test('auth error turns zugang and recovers with the next good upload', async () => {
  fake.auth = false;
  await e.write(A, 'x', 'md');
  await e.flush();
  await e.write(B, 'y', 'md');
  expect(e.status.value).toEqual({ state: 'zugang', pending: 2 }); // der Status bleibt, wie er ist
  fake.auth = true;
  await e.flush();
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a failing flush on a fresh engine still counts the entries of an earlier session', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  const e2 = await h.restart(); // wie nach einem Neustart, nur ohne start()
  await e2.flush();
  expect(e2.status.value).toEqual({ state: 'wartet', pending: 1 });
});

test('rate limit counts as waiting', async () => {
  fake.rateLimit = true;
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
});

test('a write while the device is offline shows wartet right away', async () => {
  setOnLine(false);
  try {
    await e.write(A, 'x', 'md');
    expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  } finally {
    setOnLine(true);
  }
});

test('an upload that hangs for 30 s counts as offline', async () => {
  fake.hang.add('put');
  await e.write(A, 'x', 'md');
  e.stop(); // die Wartezeit des Schreibens soll nicht dazwischenfunken
  const flushing = e.flush();
  await until(() => fake.count('put') === 1);
  await vi.advanceTimersByTimeAsync(29_999);
  expect(e.status.value.state).toBe('gesichert');
  await vi.advanceTimersByTimeAsync(1);
  await flushing;
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  fake.hang.clear();
  await e.flush();
  expect(fake.files[A].text).toBe('x');
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

// ---------- Fehler je Datei ----------

test('a path that is never allowed is dropped and reported', async () => {
  fake.forbidden.add(A);
  await e.write(A, 'x', 'md');
  await e.write(B, 'y', 'md');
  await e.flush();
  expect(fake.files[B].text).toBe('y');
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.errors).toHaveLength(1);
  expect(h.errors[0].path).toBe(A);
  expect(h.errors[0].error).toBeInstanceOf(PathNotAllowedError);
  expect(e.status.value.pending).toBe(0);
});

test('any other error leaves the entry queued and goes on with the next one', async () => {
  fake.putErrors.set(A, new Error('kaputt'));
  await e.write(A, 'x', 'md');
  await e.write(B, 'y', 'md');
  await e.flush();
  expect(fake.files[B].text).toBe('y');
  expect((await h.store.getAll('outbox')).map((entry) => entry.path)).toEqual([A]);
  expect(h.errors.map((i) => i.path)).toEqual([A]);
  expect(e.status.value.pending).toBe(1);
  fake.putErrors.clear();
  await e.flush();
  expect(fake.files[A].text).toBe('x');
});

// ---------- Speicher, der vom Browser geschlossen wird ----------

test('after the browser closed the connection in the background, writing still works and the data is kept', async () => {
  await e.write(A, 'eins', 'md');
  await h.store.run(async (db) => db.close()); // Safari im Hintergrund
  await e.write(A, 'zwei', 'md');
  await e.flush();
  expect(fake.files[A].text).toBe('zwei');
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });

  const second = await openStore(); // ein zweites Öffnen der Datenbank sieht alles
  expect(await second.get('files', A)).toMatchObject({ text: 'zwei', sha: fake.files[A].sha });
  expect(await second.getAll('outbox')).toEqual([]);
  second.close();
});

test('a connection the browser terminated while changes were queued does not strand them', async () => {
  fake.offline = true;
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  await h.store.run(async (db) => forceCloseDatabase(unwrap(db) as never));
  fake.offline = false;
  await e.flush();
  expect(fake.files[A].text).toBe('x');
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('polling and reading survive a closed connection too', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  fake.head = 'h1';
  await h.store.run(async (db) => db.close());
  expect(await e.read(A)).toBe(base);
  await h.store.run(async (db) => db.close());
  await e.pollRemote();
  expect(await h.store.get('meta', 'lastHead')).toBe('h1');
  expect(h.errors).toEqual([]);
});

// ---------- Zwei Tabs auf derselben Datenbank ----------

/** Ein Schloss wie `navigator.locks`: Wer es hat, hält alle anderen Anfragen mit demselben Namen auf. */
function installLocks() {
  const queues = new Map<string, Promise<unknown>>();
  const request = vi.fn(async (name: string, callback: () => Promise<unknown>) => {
    const before = queues.get(name) ?? Promise.resolve();
    const run = before.then(callback);
    queues.set(name, run.catch(() => undefined));
    return run;
  });
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  return request;
}

test('the flush runs inside the lock "notizbuch-sync" when the browser has locks', async () => {
  const request = installLocks();
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(request).toHaveBeenCalledWith('notizbuch-sync', expect.any(Function));
  expect(fake.files[A].text).toBe('x');
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('two tabs sharing one database never send the same change twice, and never at the same time', async () => {
  installLocks();
  const second = await h.restart(); // der zweite Tab
  await e.write(A, 'x', 'md');
  await e.write(B, 'y', 'md');
  await Promise.all([e.flush(), second.flush()]);
  expect(fake.log.filter((line) => line.startsWith('put '))).toEqual([`put ${A} null`, `put ${B} null`]);
  expect(fake.maxActive).toBe(1);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
  expect(second.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a flush requested while the lock is being released still runs once more', async () => {
  let release: (() => void) | undefined;
  const request = vi.fn(async (_name: string, callback: () => Promise<unknown>) => {
    const result = await callback();
    // Beim ersten Mal wird das Schloss erst frei, wenn der Test es erlaubt: Der Durchgang ist dann schon fertig.
    if (request.mock.calls.length === 1) await new Promise<void>((resolve) => (release = resolve));
    return result;
  });
  Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
  await e.write(A, 'x', 'md');
  const first = e.flush();
  await until(() => release !== undefined);
  expect(fake.files[A].text).toBe('x');

  await e.write(B, 'y', 'md');
  const second = e.flush(); // zu spät für den Durchgang, der gerade das Schloss abgibt
  release?.();
  await Promise.all([first, second]);
  expect(fake.files[B].text).toBe('y');
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('without locks in the browser the flush works as before', async () => {
  expect((navigator as { locks?: unknown }).locks).toBeFalsy(); // happy-dom kennt keine Schlösser
  await e.write(A, 'x', 'md');
  await e.flush();
  expect(fake.files[A].text).toBe('x');
});
