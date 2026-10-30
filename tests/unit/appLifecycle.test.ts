import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { saveSettings, type Settings } from '../../src/lib/settings';
import { openStore, Store } from '../../src/sync/store';
import { ACTIVE_LOCK } from '../../src/ui/activeWindow';
import { App } from '../../src/ui/App';
import { quiet } from './syncHelpers';

// Die App wird geschlossen, während sie noch startet: Weder die Sperre des Fensters noch die Engine, noch der Speicher dürfen
// zurückbleiben. Das passiert in der Praxis beim Neuladen mitten im Start. Alles hier ist erfunden, GitHub ist ein Fake, der nie antwortet.

const SETTINGS: Settings = {
  token: 'github_pat_TEST_0123456789',
  repo: 'johrob-lab/2-gehirn-test',
  device: 'iPad',
  smoothing: 'mittel',
  prediction: true,
  tokenExpiry: '2027-10-29',
};

let host: HTMLDivElement;
let fetchMock: ReturnType<typeof vi.fn>;
let open: number;

/** Wie viele Zuhörer für `visibilitychange` am Dokument hängen (angemeldet minus abgemeldet). */
function countVisibilityListeners(): void {
  open = 0;
  const add = document.addEventListener.bind(document);
  const remove = document.removeEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === 'visibilitychange') open++;
    add(type, listener, options);
  });
  vi.spyOn(document, 'removeEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
    if (type === 'visibilitychange') open--;
    remove(type, listener, options);
  });
}

/**
 * Ein Lock-Manager, der die Frage nach der Sperre des Fensters erst beantwortet, wenn der Test es sagt (`answer`), und mitzählt,
 * wie oft gefragt, gewährt und freigegeben wurde. Die Sperre der Engine (`notizbuch-sync`) gewährt er sofort.
 */
function fakeLocks(o: { answerAtOnce?: boolean } = {}) {
  const state = { asked: 0, granted: 0, released: 0 };
  let answer: () => void = () => undefined;
  const answered = o.answerAtOnce ? Promise.resolve() : new Promise<void>((resolve) => (answer = resolve));
  const request = async (name: string, a: unknown, b?: unknown): Promise<unknown> => {
    const callback = (typeof a === 'function' ? a : b) as (lock: unknown) => unknown;
    if (name !== ACTIVE_LOCK) return callback({ name });
    state.asked++;
    await answered;
    state.granted++;
    await callback({ name }); // die Sperre gilt, bis das Versprechen des Rückrufs erfüllt ist (`release`)
    state.released++;
    return undefined;
  };
  Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
  return { state, answer: () => answer() };
}

async function seedSettings(): Promise<void> {
  const store = await openStore();
  await saveSettings(store, SETTINGS);
  store.close();
}

const mount = () => act(() => render(h(App, {}), host));
const unmount = () => act(() => render(null, host));

beforeEach(() => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  host = document.createElement('div');
  document.body.append(host);
  window.location.hash = '';
  fetchMock = vi.fn(() => new Promise(() => undefined)); // GitHub antwortet nie
  vi.stubGlobal('fetch', fetchMock);
  countVisibilityListeners();
});

afterEach(async () => {
  await unmount();
  host.remove();
  delete (navigator as { locks?: unknown }).locks;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  await quiet(10);
});

test('closing the app before the browser answers the lock question releases the lock later and starts no engine', async () => {
  await seedSettings();
  const locks = fakeLocks();
  await mount();
  await vi.waitFor(() => expect(locks.state.asked).toBe(1));
  await unmount(); // zum Beispiel ein Neuladen mitten im Start
  locks.answer(); // der Browser gewährt die Sperre erst jetzt
  await vi.waitFor(() => expect(locks.state.released).toBe(1));
  await quiet();
  expect(fetchMock).not.toHaveBeenCalled(); // keine Engine hat GitHub gefragt
  expect(open).toBe(0); // und keine hat Zuhörer zurückgelassen
});

test('closing the app while the engine is starting stops that engine', async () => {
  await seedSettings();
  const locks = fakeLocks({ answerAtOnce: true });
  let reached = false;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  // Der Start der Engine zählt zuerst die Warteschlange: Hier hängt er, bis der Test ihn weitergehen lässt.
  vi.spyOn(Store.prototype, 'count').mockImplementation(async () => {
    reached = true;
    await gate;
    return 0;
  });
  await mount();
  await vi.waitFor(() => expect(reached).toBe(true));
  await unmount();
  release(); // der Start ist durch, aber die App ist weg
  await vi.waitFor(() => expect(locks.state.released).toBe(1));
  await quiet();
  expect(fetchMock).not.toHaveBeenCalled();
  expect(open).toBe(0);
});

test('a store that opens after the app was closed is closed again', async () => {
  await seedSettings();
  fakeLocks({ answerAtOnce: true });
  const closed = vi.spyOn(IDBDatabase.prototype, 'close');
  await mount();
  await unmount(); // bevor der Speicher offen ist
  await vi.waitFor(() => expect(closed).toHaveBeenCalledTimes(1));
  await quiet();
  expect(closed).toHaveBeenCalledTimes(1); // genau die eine Verbindung, die die App geöffnet hat
  expect(fetchMock).not.toHaveBeenCalled();
});
