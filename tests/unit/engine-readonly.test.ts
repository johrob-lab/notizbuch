import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ReadOnlyError, SyncEngine } from '../../src/sync/engine';
import { A, B, FakeClient, quiet, setupHarness, type Harness } from './syncHelpers';

// Eine Engine, die nur liest (das zweite Fenster eines Geräts), und eine, die beendet ist (nach einem Wechsel des Repos).
// Beide dürfen nichts in die Warteschlange stellen, nichts hochladen und nichts in den Speicher legen, was zu einem anderen
// Stand gehört. Alles hier ist erfunden, GitHub ist ein Fake.

let h: Harness;

beforeEach(async () => {
  h = await setupHarness();
});
afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  return h.dispose();
});

const readOnlyEngine = () => new SyncEngine({ client: h.fake, store: h.store, device: 'iPad', readOnly: true });

// ---------- Nur lesen ----------

test('an engine says whether it may write', () => {
  expect(h.e.readOnly).toBe(false);
  expect(readOnlyEngine().readOnly).toBe(true);
});

test('a read-only engine reads from GitHub and keeps no copy', async () => {
  h.fake.files[A] = { text: 'von GitHub', sha: 's1' };
  const ro = readOnlyEngine();
  expect(await ro.read(A)).toBe('von GitHub');
  expect(await ro.lookup(A)).toEqual({ text: 'von GitHub', unknown: false });
  expect(await ro.lookup(B)).toEqual({ text: null, unknown: false });
  await quiet();
  expect(await h.store.getAll('files')).toEqual([]);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(await h.store.getAll('meta')).toEqual([]);
});

test('a read-only engine shows the local copy of the active window and does not refresh it', async () => {
  h.fake.files[A] = { text: 'alt', sha: 's1' };
  await h.e.read(A);
  await h.e.write(A, 'neu', 'md'); // noch nicht hochgeladen
  const requests = h.fake.log.length;
  const ro = readOnlyEngine();
  expect(await ro.read(A)).toBe('neu');
  await quiet();
  expect(h.fake.log.length).toBe(requests);
  expect((await h.store.get('files', A))?.text).toBe('neu');
});

test('a read-only engine that cannot ask GitHub says it does not know', async () => {
  h.fake.offline = true;
  expect(await readOnlyEngine().lookup(A)).toEqual({ text: null, unknown: true });
});

test('a read-only engine refuses to write or delete and leaves the store alone', async () => {
  const ro = readOnlyEngine();
  await expect(ro.write(A, 'x', 'md')).rejects.toBeInstanceOf(ReadOnlyError);
  await expect(ro.write('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg', '<svg/>', 'svg')).rejects.toBeInstanceOf(ReadOnlyError);
  await expect(ro.remove(A)).rejects.toBeInstanceOf(ReadOnlyError);
  expect(await h.store.getAll('files')).toEqual([]);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.fake.log).toEqual([]);
});

test('the refusal is an error with a German message and a name', async () => {
  const error = await readOnlyEngine()
    .write(A, 'x', 'md')
    .catch((e: unknown) => e);
  expect(error).toBeInstanceOf(Error);
  expect((error as Error).name).toBe('ReadOnlyError');
  expect((error as Error).message).toBe('Dieses Fenster darf nicht schreiben.');
});

test('a read-only engine does not upload what the active window has queued', async () => {
  await h.e.write(A, 'x', 'md');
  const ro = readOnlyEngine();
  await ro.flush();
  await ro.flush();
  expect(h.fake.count('put')).toBe(0);
  expect(await h.store.count('outbox')).toBe(1);
});

test('a read-only engine does not start: no polling, no flush, no listening', async () => {
  await h.e.write(A, 'x', 'md');
  h.e.stop(); // die Wartezeit der Engine, die geschrieben hat, soll hier nicht mitzählen: Es geht um die Engine, die nur liest
  const ro = readOnlyEngine();
  await ro.start();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  document.dispatchEvent(new Event('visibilitychange'));
  window.dispatchEvent(new Event('online'));
  await ro.pollRemote();
  await quiet();
  expect(h.fake.log).toEqual([]);
  expect(await h.store.count('outbox')).toBe(1);
  expect(await h.store.get('meta', 'lastHead')).toBeUndefined();
  ro.stop();
});

// ---------- Beendet ----------

test('a closed engine stops for good: no polling and no restart', async () => {
  await h.e.start();
  await quiet();
  const heads = h.fake.count('head');
  expect(heads).toBeGreaterThan(0);
  h.e.close();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  expect(h.fake.count('head')).toBe(heads);
  await h.e.start();
  await vi.advanceTimersByTimeAsync(10 * 60_000);
  document.dispatchEvent(new Event('visibilitychange'));
  await quiet();
  expect(h.fake.count('head')).toBe(heads);
});

test('a closed engine refuses writes and uploads nothing', async () => {
  await h.e.write(A, 'x', 'md'); // steht in der Warteschlange, als die Engine beendet wird
  h.e.close();
  await expect(h.e.write(B, 'y', 'md')).rejects.toBeInstanceOf(ReadOnlyError);
  await expect(h.e.remove(B)).rejects.toBeInstanceOf(ReadOnlyError);
  await vi.advanceTimersByTimeAsync(20_000); // die Wartezeit des Hochladens
  await h.e.flush();
  expect(h.fake.count('put')).toBe(0);
  expect(await h.store.count('outbox')).toBe(1);
});

test('an upload that waits for the lock when the engine closes is never sent', async () => {
  let grant!: () => void;
  const granted = new Promise<void>((resolve) => (grant = resolve));
  Object.defineProperty(navigator, 'locks', {
    configurable: true,
    value: { request: async (_name: string, work: () => Promise<unknown>) => (await granted, work()) },
  });
  await h.e.write(A, 'x', 'md');
  const flushing = h.e.flush();
  h.e.close();
  grant();
  await flushing;
  expect(h.fake.count('put')).toBe(0);
});

test('a read that is still on its way when the engine closes is answered but not kept', async () => {
  h.fake.files[A] = { text: 'alt', sha: 's1' };
  const gate = h.fake.pause('get');
  const reading = h.e.read(A);
  await gate.reached;
  h.e.close(); // zum Beispiel, weil das Repo gewechselt wird und der Speicher gleich geleert wird
  gate.release();
  expect(await reading).toBe('alt');
  await quiet();
  expect(await h.store.getAll('files')).toEqual([]);
});

test('a poll that is still on its way when the engine closes keeps nothing', async () => {
  const gate = h.fake.pause('head');
  const polling = h.e.pollRemote();
  await gate.reached;
  h.e.close();
  gate.release();
  await polling;
  expect(await h.store.get('meta', 'lastHead')).toBeUndefined();
});

test('a refresh that is still on its way when the engine closes is not taken over', async () => {
  h.fake.files[A] = { text: 'alt', sha: 's1' };
  await h.e.read(A);
  h.fake.files[A] = { text: 'neu', sha: 's2' };
  const gate = h.fake.pause('get');
  expect(await h.e.read(A)).toBe('alt'); // die Kopie sofort, das Auffrischen läuft im Hintergrund
  await gate.reached;
  h.e.close();
  gate.release();
  await quiet();
  expect((await h.store.get('files', A))?.sha).toBe('s1');
});

test('an upload that GitHub accepts after the engine closed leaves its entry in the queue', async () => {
  await h.e.write(A, 'x', 'md');
  const gate = h.fake.pause('put'); // der Upload ist unterwegs
  const flushing = h.e.flush();
  await gate.reached;
  h.e.close(); // das Repo wird gewechselt
  gate.release(); // GitHub nimmt den Upload danach noch an
  await flushing;
  expect(h.fake.files[A]?.text).toBe('x'); // er ist angekommen ...
  // ... aber die beendete Engine erledigt nichts mehr: Der Eintrag bleibt, und die Prüfung beim Wechsel sieht ihn.
  expect((await h.store.getAll('outbox')).map((e) => e.path)).toEqual([A]);
  expect((await h.store.get('files', A))?.sha).toBeNull();
});

test('a write that the store repeats after a lost connection is refused when the engine closed meanwhile', async () => {
  const real = h.store.transact.bind(h.store);
  let first = true;
  vi.spyOn(h.store, 'transact').mockImplementation((areas, work) =>
    real(areas, async (tx) => {
      if (first) {
        first = false;
        h.e.close(); // während des ersten Versuchs wird die Engine beendet ...
        throw new DOMException('Die Verbindung ist zu.', 'InvalidStateError'); // ... und der Browser beendet die Verbindung
      }
      return work(tx); // der Speicher versucht es noch einmal und führt den Auftrag der Engine ein zweites Mal aus
    }),
  );
  await expect(h.e.write(A, 'x', 'md')).rejects.toBeInstanceOf(ReadOnlyError);
  expect(await h.store.getAll('files')).toEqual([]);
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('a closed engine that was about to delete a file sends no further request', async () => {
  h.fake.files[A] = { text: 'x', sha: 's1' };
  // Das Löschen wartet, und das Gerät kennt die Fassung auf GitHub nicht: Der Abgleich fragt zuerst danach.
  await h.store.put('outbox', { path: A, text: 'x', kind: 'md', baseSha: null, baseText: null, queuedAt: 1, deleted: true });
  const gate = h.fake.pause('get');
  const flushing = h.e.flush();
  await gate.reached;
  h.e.close(); // das Repo wird gewechselt, während die Frage unterwegs ist
  gate.release();
  await flushing;
  await quiet();
  expect(h.fake.log).toEqual([`get ${A}`]); // nur die Frage, die schon unterwegs war: kein Löschen, keine zweite Frage
  expect(h.fake.files[A]).toBeDefined();
  expect(await h.store.count('outbox')).toBe(1);
});

// ---------- Gerät und Zugang ändern ----------

test('the device in the commit message can change while the engine runs', async () => {
  h.e.setDevice('Firmen-PC');
  await h.e.write(A, 'x', 'md');
  await h.e.flush();
  expect(h.fake.messages).toEqual(['Notizbuch: 2026-10-29.md (Firmen-PC)']);
});

test('a new client takes over the queue and the status recovers', async () => {
  h.fake.auth = false;
  await h.e.write(A, 'x', 'md');
  await h.e.flush();
  expect(h.e.status.value).toEqual({ state: 'zugang', pending: 1 });
  const before = h.fake.log.length;
  const renewed = new FakeClient();
  h.e.setClient(renewed);
  await h.e.flush();
  expect(renewed.files[A].text).toBe('x');
  expect(h.e.status.value).toEqual({ state: 'gesichert', pending: 0 });
  expect(h.fake.log.length).toBe(before); // der alte Client wird nicht mehr gefragt
});
