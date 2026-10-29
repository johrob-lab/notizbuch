import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { unwrap } from 'idb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openStore, type Store } from '../../src/sync/store';

// Alles hier ist erfunden. Die Datenbank liegt im Speicher (fake-indexeddb), pro Test eine frische.

let store: Store;

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store = await openStore();
});
afterEach(() => store.close());

/** Wie Safari im Hintergrund: Die Verbindung ist zu, ohne dass die App sie geschlossen hätte. */
const closeBehindTheBack = (s: Store) => s.run(async (db) => db.close());
/**
 * Der Browser beendet die Verbindung und meldet es mit dem Ereignis `close`. Das kommt erst, wenn keine Transaktion mehr
 * läuft, darum wartet die Funktion, bis es da war (der Speicher hört seit dem Öffnen zu und war damit vor ihr dran).
 */
async function forceClose(db: IDBDatabase): Promise<void> {
  const delivered = new Promise<void>((resolve) => db.addEventListener('close', () => resolve()));
  forceCloseDatabase(db as never);
  await delivered;
}
const terminate = (s: Store) => s.run(async (db) => forceClose(unwrap(db)));

const record = (path: string, text: string) => ({ path, text, sha: null, base: null, syncedAt: 0 });

test('the plain methods read and write one value each', async () => {
  expect([...store.objectStoreNames].sort()).toEqual(['files', 'meta', 'outbox', 'settings']);
  await store.put('files', record('a.md', 'eins'));
  await store.put('files', record('b.md', 'zwei'));
  await store.put('meta', 'h1', 'lastHead');
  expect(await store.get('files', 'a.md')).toMatchObject({ text: 'eins' });
  expect((await store.getAll('files')).map((r) => r.path)).toEqual(['a.md', 'b.md']);
  expect(await store.count('files')).toBe(2);
  expect(await store.get('meta', 'lastHead')).toBe('h1');
  await store.delete('files', 'a.md');
  expect(await store.get('files', 'a.md')).toBeUndefined();
  expect(await store.count('files')).toBe(1);
});

test('a transaction commits everything the function wrote and returns its result', async () => {
  const result = await store.transact(['files', 'outbox'], async (tx) => {
    await Promise.all([
      tx.objectStore('files').put(record('a.md', 'eins')),
      tx.objectStore('outbox').put({ path: 'a.md', text: 'eins', kind: 'md', baseSha: null, baseText: null, queuedAt: 1 }),
    ]);
    return 'fertig';
  });
  expect(result).toBe('fertig');
  expect(await store.count('files')).toBe(1);
  expect(await store.count('outbox')).toBe(1);
});

test('a transaction whose function fails is rolled back completely and the error is passed on once', async () => {
  let runs = 0;
  await expect(
    store.transact(['files', 'outbox'], async (tx) => {
      runs++;
      await tx.objectStore('files').put(record('a.md', 'eins'));
      throw new Error('kaputt');
    }),
  ).rejects.toThrow('kaputt');
  expect(runs).toBe(1);
  expect(await store.count('files')).toBe(0);
});

test('an error that ends the transaction after the function returned is passed on and nothing is kept', async () => {
  await store.put('files', record('a.md', 'eins'));
  await expect(
    store.transact(['files', 'outbox'], async (tx) => {
      // Nicht abgewartet: Der Fehler tritt erst auf, wenn die Funktion schon fertig ist.
      void tx.objectStore('outbox').put({ path: 'a.md', text: 'zwei', kind: 'md', baseSha: null, baseText: null, queuedAt: 1 });
      tx.objectStore('files').add(record('a.md', 'zwei')).catch(() => undefined);
      return 'fertig';
    }),
  ).rejects.toBeTruthy();
  expect(await store.get('files', 'a.md')).toMatchObject({ text: 'eins' });
  expect(await store.count('outbox')).toBe(0);
});

test('a connection the browser closed is opened again and the access still works', async () => {
  await store.put('files', record('a.md', 'eins'));
  await closeBehindTheBack(store);
  await store.put('files', record('b.md', 'zwei'));
  expect(await store.get('files', 'a.md')).toMatchObject({ text: 'eins' });
  expect(await store.count('files')).toBe(2);

  // und die Daten sind wirklich in der Datenbank, nicht nur in einem Zwischenspeicher
  const second = await openStore();
  expect((await second.getAll('files')).map((r) => r.path)).toEqual(['a.md', 'b.md']);
  second.close();
});

test('a transaction on a closed connection opens it again and runs once more', async () => {
  await closeBehindTheBack(store);
  let runs = 0;
  const result = await store.transact(['files'], async (tx) => {
    runs++;
    await tx.objectStore('files').put(record('a.md', 'eins'));
    return runs;
  });
  expect(result).toBe(1); // der erste Versuch scheiterte schon beim Öffnen der Transaktion, die Funktion lief nur einmal
  expect(await store.get('files', 'a.md')).toMatchObject({ text: 'eins' });
});

test('a function is run a second time when the connection was already closed when it started', async () => {
  await closeBehindTheBack(store);
  let runs = 0;
  await store.run(async (db) => {
    runs++;
    await db.get('meta', 'lastHead');
  });
  expect(runs).toBe(2);
});

test('a connection the browser terminated is replaced before the next access, without a failed try', async () => {
  await store.put('meta', 'h1', 'lastHead');
  const open = vi.spyOn(indexedDB, 'open');
  await terminate(store);
  let runs = 0;
  await store.run(async (db) => {
    runs++;
    expect(await db.get('meta', 'lastHead')).toBe('h1');
  });
  expect(runs).toBe(1);
  expect(open).toHaveBeenCalledTimes(1);
  await store.put('meta', 'h2', 'lastHead'); // und es bleibt bei der einen neuen Verbindung
  expect(open).toHaveBeenCalledTimes(1);
});

test('an access that fails while the browser is terminating the connection is repeated once on a new connection', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  let runs = 0;
  const result = await store.run(async (db) => {
    runs++;
    if (runs === 1) {
      await forceClose(unwrap(db)); // der Browser beendet die Verbindung mitten im Zugriff
      throw new DOMException('abgebrochen', 'AbortError');
    }
    return db.count('files');
  });
  expect(result).toBe(0);
  expect(runs).toBe(2);
  expect(open).toHaveBeenCalledTimes(1);
});

test('the same kind of failure on a healthy connection is passed on and not repeated', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  let runs = 0;
  await expect(
    store.run(async () => {
      runs++;
      throw new DOMException('abgebrochen', 'AbortError');
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(runs).toBe(1);
  expect(open).not.toHaveBeenCalled();
});

test('a late close event of a connection that was already replaced does not make the new one look lost', async () => {
  let old!: IDBDatabase;
  await store.run(async (db) => {
    old = unwrap(db);
  });
  await closeBehindTheBack(store);
  await store.get('meta', 'lastHead'); // öffnet neu
  const open = vi.spyOn(indexedDB, 'open');
  await forceClose(old); // die alte Verbindung meldet ihr Ende erst jetzt
  await store.put('meta', 'h1', 'lastHead');
  expect(await store.get('meta', 'lastHead')).toBe('h1');
  expect(open).not.toHaveBeenCalled();
});

test('an access that only fails after another one replaced the connection runs on the new one without opening again', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let runs = 0;
  const slow = store.run(async (db) => {
    runs++;
    if (runs === 1) await gate; // arbeitet noch an der alten Verbindung, während ein anderer Zugriff sie schon ersetzt
    return db.count('files');
  });
  await closeBehindTheBack(store);
  await store.put('meta', 'h1', 'lastHead'); // scheitert an der geschlossenen Verbindung und öffnet neu
  expect(open).toHaveBeenCalledTimes(1);
  release();
  expect(await slow).toBe(0);
  expect(runs).toBe(2);
  expect(open).toHaveBeenCalledTimes(1); // der späte Zugriff nimmt die neue Verbindung, statt noch einmal zu öffnen
  expect(await store.get('meta', 'lastHead')).toBe('h1');
});

test('accesses at the same time after a loss share one new connection', async () => {
  await store.put('meta', 'h1', 'lastHead');
  await closeBehindTheBack(store);
  const open = vi.spyOn(indexedDB, 'open');
  const results = await Promise.all([
    store.get('meta', 'lastHead'),
    store.get('meta', 'lastHead'),
    store.count('files'),
    store.put('meta', 'h2', 'other'),
  ]);
  expect(results.slice(0, 3)).toEqual(['h1', 'h1', 0]);
  expect(open).toHaveBeenCalledTimes(1);
});

test('a failure for another reason is passed on and not repeated', async () => {
  let runs = 0;
  await expect(
    store.run(async () => {
      runs++;
      throw new Error('kaputt');
    }),
  ).rejects.toThrow('kaputt');
  expect(runs).toBe(1);
});

test('a second failure of the same kind is passed on, the access is repeated only once', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  let runs = 0;
  await expect(
    store.run(async () => {
      runs++;
      throw new DOMException('zu', 'InvalidStateError');
    }),
  ).rejects.toMatchObject({ name: 'InvalidStateError' });
  expect(runs).toBe(2);
  expect(open).toHaveBeenCalledTimes(1);
});

test('reopening closes the connection it replaces', async () => {
  // Ein InvalidStateError, obwohl die Verbindung offen ist: Die ersetzte Verbindung darf nicht offen bleiben,
  // sonst hielte sie spätere Änderungen an der Datenbank auf.
  let first = true;
  await store.run(async (db) => {
    if (first) {
      first = false;
      throw new DOMException('zu', 'InvalidStateError');
    }
    return db.count('files');
  });
  store.close();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase('notizbuch');
    request.onsuccess = () => resolve();
    request.onblocked = () => reject(new Error('Es ist noch eine Verbindung offen.'));
    request.onerror = () => reject(request.error);
  });
});

test('a store that was closed on purpose stays closed', async () => {
  const open = vi.spyOn(indexedDB, 'open');
  store.close();
  await expect(store.get('meta', 'lastHead')).rejects.toMatchObject({ name: 'InvalidStateError' });
  await expect(store.put('meta', 'h1', 'lastHead')).rejects.toMatchObject({ name: 'InvalidStateError' });
  expect(open).not.toHaveBeenCalled();
});

test('a store that was closed on purpose after the browser terminated it stays closed', async () => {
  await terminate(store);
  const open = vi.spyOn(indexedDB, 'open');
  store.close();
  await expect(store.get('meta', 'lastHead')).rejects.toMatchObject({ name: 'InvalidStateError' });
  expect(open).not.toHaveBeenCalled();
});

test('a connection that was replaced once can be replaced again', async () => {
  await store.put('meta', 'h1', 'lastHead');
  await closeBehindTheBack(store);
  expect(await store.get('meta', 'lastHead')).toBe('h1'); // erstes Mal neu geöffnet
  await closeBehindTheBack(store);
  const open = vi.spyOn(indexedDB, 'open');
  await store.put('meta', 'h2', 'lastHead'); // und noch einmal
  expect(open).toHaveBeenCalledTimes(1);
  expect(await store.get('meta', 'lastHead')).toBe('h2');
});

test('stores with different names are separate databases', async () => {
  await store.put('meta', 'h1', 'lastHead');
  const other = await openStore('anderes-notizbuch');
  expect(await other.get('meta', 'lastHead')).toBeUndefined();
  await closeBehindTheBack(other);
  await other.put('meta', 'h9', 'lastHead'); // öffnet die eigene Datenbank neu, nicht die andere
  expect(await store.get('meta', 'lastHead')).toBe('h1');
  expect(await other.get('meta', 'lastHead')).toBe('h9');
  other.close();
});
