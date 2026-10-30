import { afterEach, expect, test, vi } from 'vitest';
import { ACTIVE_LOCK, acquireActiveWindow } from '../../src/ui/activeWindow';

// Ein Fenster je Gerät darf schreiben. Der Browser ist hier ein Fake mit dem, was Web Locks tun: Wer die Sperre hat, hält
// sie, bis seine Aufgabe endet, und `ifAvailable` fragt nur, ohne zu warten.

type Request = { name: string; options: { ifAvailable: true } };

function fakeLocks() {
  const held = new Set<string>();
  const requests: Request[] = [];
  const locks = {
    request(name: string, options: { ifAvailable: true }, callback: (lock: unknown) => unknown): Promise<unknown> {
      requests.push({ name, options });
      if (held.has(name)) return Promise.resolve(callback(null));
      held.add(name);
      return Promise.resolve(callback({ name, mode: 'exclusive' })).finally(() => held.delete(name));
    },
  };
  return { locks, held, requests };
}

afterEach(() => {
  delete (navigator as { locks?: unknown }).locks;
  vi.useRealTimers();
});

test('the lock has its name', () => {
  expect(ACTIVE_LOCK).toBe('notizbuch-aktiv');
});

test('the first window is active and holds the lock', async () => {
  const { locks, held, requests } = fakeLocks();
  const first = await acquireActiveWindow({ locks });
  expect(first.active).toBe(true);
  expect(held.has('notizbuch-aktiv')).toBe(true);
  // Gefragt wird nur, nicht gewartet: Ein zweites Fenster soll nicht hängen, bis das erste schließt.
  expect(requests).toEqual([{ name: 'notizbuch-aktiv', options: { ifAvailable: true } }]);
});

test('a second window is not active, and the first keeps the lock', async () => {
  const { locks, held } = fakeLocks();
  const first = await acquireActiveWindow({ locks });
  const second = await acquireActiveWindow({ locks, retryMs: 1 });
  expect(first.active).toBe(true);
  expect(second.active).toBe(false);
  expect(held.has('notizbuch-aktiv')).toBe(true);
});

test('a window that is not active asks a second time before it gives up', async () => {
  const { locks, requests } = fakeLocks();
  await acquireActiveWindow({ locks });
  await acquireActiveWindow({ locks, retryMs: 1 });
  expect(requests).toHaveLength(3); // das erste Fenster einmal, das zweite zweimal
});

test('a lock that is let go just after the first question is taken by the second', async () => {
  vi.useFakeTimers();
  const { locks } = fakeLocks();
  const first = await acquireActiveWindow({ locks });
  const asking = acquireActiveWindow({ locks, retryMs: 500 });
  await vi.advanceTimersByTimeAsync(100);
  first.release(); // das alte Fenster ist beim Neuladen noch dabei, die Sperre abzugeben
  await vi.advanceTimersByTimeAsync(500);
  expect((await asking).active).toBe(true);
});

test('the lock is held until it is released, then the next window gets it', async () => {
  const { locks, held } = fakeLocks();
  const first = await acquireActiveWindow({ locks });
  await vi.waitFor(() => expect(held.size).toBe(1));
  first.release();
  await vi.waitFor(() => expect(held.size).toBe(0));
  const next = await acquireActiveWindow({ locks, retryMs: 1 });
  expect(next.active).toBe(true);
});

test('releasing twice does no harm', async () => {
  const { locks, held } = fakeLocks();
  const first = await acquireActiveWindow({ locks });
  first.release();
  first.release();
  await vi.waitFor(() => expect(held.size).toBe(0));
});

test('a window that is not active has nothing to release', async () => {
  const { locks, held } = fakeLocks();
  await acquireActiveWindow({ locks });
  const second = await acquireActiveWindow({ locks, retryMs: 1 });
  second.release();
  await new Promise((resolve) => setTimeout(resolve, 5));
  expect(held.has('notizbuch-aktiv')).toBe(true); // die Sperre des ersten Fensters bleibt
});

test('without Web Locks every window is active, as before', async () => {
  const window1 = await acquireActiveWindow({ locks: null });
  const window2 = await acquireActiveWindow({ locks: null });
  expect(window1.active).toBe(true);
  expect(window2.active).toBe(true);
  window1.release();
});

test('when the browser refuses the question, the window is active, as before', async () => {
  const locks = { request: () => Promise.reject(new DOMException('Nicht erlaubt.', 'SecurityError')) };
  const result = await acquireActiveWindow({ locks });
  expect(result.active).toBe(true);
  result.release();
});

test('the browser lock manager is used when none is handed in', async () => {
  const { locks, held } = fakeLocks();
  Object.defineProperty(navigator, 'locks', { value: locks, configurable: true });
  const first = await acquireActiveWindow({ retryMs: 1 });
  const second = await acquireActiveWindow({ retryMs: 1 });
  expect(first.active).toBe(true);
  expect(second.active).toBe(false);
  expect(held.has('notizbuch-aktiv')).toBe(true);
});
