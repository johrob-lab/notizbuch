import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { PAGES_DIR } from '../../src/lib/filenames';
import type { SyncEngine } from '../../src/sync/engine';
import type { DirEntry, ListDir } from '../../src/sync/github';
import { BesprechungenPage } from '../../src/ui/BesprechungenPage';

// Die Liste der Besprechungen zeigt sofort, was auf dem Gerät liegt, und hängt nie beim Laden: Antwortet GitHub nicht, gilt
// das nach 30 Sekunden als fehlendes Netz. Ohne Netz versucht sie es wieder, sobald es Sinn hat (Netz zurück, App wieder vorn,
// alle drei Minuten), aber nie zweimal zugleich. Alles hier ist erfunden.

const host = document.createElement('div');
document.body.appendChild(host);

const LOADING = 'Besprechungen werden geladen';
const HINT = 'Ohne Netz siehst du nur die Besprechungen auf diesem Gerät.';
const EMPTY = 'Noch keine Besprechungen';

/** Eine Besprechung, die nur auf diesem Gerät liegt, und eine, die nur GitHub kennt. */
const HERE = `${PAGES_DIR}/2026/2026-10-29 1000 Nur hier S1.svg`;
const HERE_LABEL = 'Do 29.10. · 10:00 · Nur hier';
const THERE = '2026-11-03 0900 Abstimmung Muster S1.svg';
const THERE_LABEL = 'Di 03.11. · 09:00 · Abstimmung Muster';

/** Was GitHub im Hauptordner listet: den Jahresordner 2026. */
const YEARS: DirEntry[] = [{ name: '2026', path: `${PAGES_DIR}/2026`, sha: 'a1', type: 'dir' }];

/** GitHub mit der einen Besprechung im Jahresordner 2026. */
const repo: ListDir = async (folder) =>
  folder === PAGES_DIR ? YEARS : [{ name: THERE, path: `${folder}/${THERE}`, sha: 'b2', type: 'file' }];

/** Eine Anfrage an GitHub, die nie antwortet. */
const never: ListDir = () => new Promise<never>(() => undefined);

/** Ein Gerät mit diesen Seiten, auf dem kein Löschen wartet. */
const device = (...present: string[]) => ({ localPaths: async () => ({ present, deleted: [] }) }) as unknown as SyncEngine;

/** Wie oft die Liste GitHub nach dem Hauptordner gefragt hat: einmal je Laden. */
const listings = (listDir: { mock: { calls: unknown[][] } }) => listDir.mock.calls.filter(([folder]) => folder === PAGES_DIR).length;

const links = () => [...host.querySelectorAll('a')].map((a) => a.textContent);
const statuses = () => [...host.querySelectorAll('p[role="status"]')].map((p) => p.textContent);
const busy = () => host.querySelector('section.besprechungen-liste')?.getAttribute('aria-busy');

async function mount(engine: SyncEngine, listDir: ListDir): Promise<void> {
  await act(() => {
    render(h(BesprechungenPage, { engine, listDir }), host);
  });
}

/** Die Zeit läuft um `ms` weiter, und was dabei fertig wird, ist gezeichnet. */
async function wait(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Ein Anlass für einen neuen Versuch kommt, und was er anstößt, ist gezeichnet. */
async function cue(send: () => void): Promise<void> {
  await act(async () => {
    send();
    await vi.advanceTimersByTimeAsync(0);
  });
}

const online = () => window.dispatchEvent(new Event('online'));

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  render(null, host);
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.useRealTimers();
});

test('while GitHub does not answer, the meetings on the device show at once with the loading status, and after 30 seconds the hint replaces it', async () => {
  await mount(device(HERE), never);
  await wait(0);
  expect(links()).toEqual([HERE_LABEL]);
  expect(statuses()).toEqual([LOADING]);
  expect(busy()).toBe('true');

  await wait(29_000);
  expect(links()).toEqual([HERE_LABEL]);
  expect(statuses()).toEqual([LOADING]);
  expect(busy()).toBe('true');

  await wait(1_000);
  expect(links()).toEqual([HERE_LABEL]);
  expect(statuses()).toEqual([HINT]);
  expect(busy()).toBe('false');
});

test('with nothing on the device, the list does not say there are no meetings while GitHub is still asked', async () => {
  await mount(device(), never);
  await wait(0);
  expect(statuses()).toEqual([LOADING]);
  expect(host.textContent).not.toContain(EMPTY);
  await wait(29_000);
  expect(host.textContent).not.toContain(EMPTY);

  await wait(1_000);
  expect(statuses()).toEqual([HINT]);
  expect(host.textContent).toContain(EMPTY);
});

test('cues while a reload runs start nothing, the list keeps the hint meanwhile, and the answer brings the meetings from GitHub', async () => {
  // Die erste Liste scheitert wie ohne Netz, jede weitere wartet, bis der Test antwortet.
  let asked = 0;
  const answers: ((entries: DirEntry[]) => void)[] = [];
  const listDir = vi.fn<ListDir>((folder) => {
    if (folder !== PAGES_DIR) return repo(folder);
    asked += 1;
    if (asked === 1) return Promise.reject(new TypeError('Failed to fetch'));
    return new Promise<DirEntry[]>((resolve) => answers.push(resolve));
  });
  await mount(device(HERE), listDir);
  await wait(0);
  expect(statuses()).toEqual([HINT]);
  expect(listings(listDir)).toBe(1);

  await cue(online);
  expect(listings(listDir)).toBe(2);
  // Zwei weitere Anlässe, während das Laden läuft: Sie starten nichts.
  await cue(online);
  await cue(() => setVisibility('visible'));
  expect(listings(listDir)).toBe(2);
  // Kein „werden geladen“: Die Liste und der Hinweis bleiben stehen, bis die Antwort da ist.
  expect(links()).toEqual([HERE_LABEL]);
  expect(statuses()).toEqual([HINT]);
  expect(busy()).toBe('false');

  await act(async () => {
    answers[0](YEARS);
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(statuses()).toEqual([]);
  expect(links()).toEqual([THERE_LABEL, HERE_LABEL]);
  expect(listings(listDir)).toBe(2);
});

test('without network the list tries again every 3 minutes, and once GitHub answered no cue starts anything', async () => {
  let offline = true;
  const listDir = vi.fn<ListDir>((folder) => (offline ? Promise.reject(new TypeError('Failed to fetch')) : repo(folder)));
  await mount(device(HERE), listDir);
  await wait(0);
  expect(statuses()).toEqual([HINT]);

  await wait(180_000);
  expect(listings(listDir)).toBe(2);
  expect(statuses()).toEqual([HINT]);
  expect(links()).toEqual([HERE_LABEL]);

  offline = false;
  await cue(online);
  expect(statuses()).toEqual([]);
  expect(links()).toEqual([THERE_LABEL, HERE_LABEL]);
  expect(listings(listDir)).toBe(3);

  await cue(online);
  await cue(() => setVisibility('visible'));
  await wait(600_000);
  expect(listings(listDir)).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});

test('a list that goes away without network leaves no cue behind', async () => {
  const listDir = vi.fn<ListDir>(() => Promise.reject(new TypeError('Failed to fetch')));
  await mount(device(HERE), listDir);
  await wait(0);
  expect(statuses()).toEqual([HINT]);

  await act(() => {
    render(null, host);
  });
  await cue(online);
  await wait(600_000);
  expect(listings(listDir)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('a cue during a reload that then fails starts exactly one more try right after it, without waiting for the next cue', async () => {
  // Die erste Liste scheitert, die zweite hängt, bis der Test sie scheitern lässt, die dritte bringt GitHub.
  let asked = 0;
  const fails: ((error: Error) => void)[] = [];
  const listDir = vi.fn<ListDir>((folder) => {
    if (folder !== PAGES_DIR) return repo(folder);
    asked += 1;
    if (asked === 1) return Promise.reject(new TypeError('Failed to fetch'));
    if (asked === 2) return new Promise<DirEntry[]>((_, reject) => fails.push(reject));
    return repo(folder);
  });
  await mount(device(HERE), listDir);
  await wait(0);
  expect(statuses()).toEqual([HINT]);

  // Die App kommt nach vorn, bevor das Netz da ist: Dieser Versuch hängt. Währenddessen kommt das Netz zurück.
  await cue(() => setVisibility('visible'));
  expect(listings(listDir)).toBe(2);
  await cue(online);
  await cue(online);
  expect(listings(listDir)).toBe(2);
  expect(statuses()).toEqual([HINT]);

  await act(async () => {
    fails[0](new TypeError('Load failed'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(listings(listDir)).toBe(3);
  expect(statuses()).toEqual([]);
  expect(links()).toEqual([THERE_LABEL, HERE_LABEL]);

  await wait(600_000);
  expect(listings(listDir)).toBe(3);
  expect(vi.getTimerCount()).toBe(0);
});

test('when the one try after a missed cue fails too, the list waits for the next cue again', async () => {
  let asked = 0;
  const fails: ((error: Error) => void)[] = [];
  const listDir = vi.fn<ListDir>((folder) => {
    if (folder !== PAGES_DIR) return repo(folder);
    asked += 1;
    if (asked === 2) return new Promise<DirEntry[]>((_, reject) => fails.push(reject));
    return Promise.reject(new TypeError('Failed to fetch'));
  });
  await mount(device(HERE), listDir);
  await wait(0);
  await cue(online);
  await cue(online);
  expect(listings(listDir)).toBe(2);

  await act(async () => {
    fails[0](new TypeError('Load failed'));
    await vi.advanceTimersByTimeAsync(0);
  });
  // Genau ein Versuch gleich danach, kein dritter von selbst.
  expect(listings(listDir)).toBe(3);
  await wait(0);
  expect(listings(listDir)).toBe(3);
  expect(statuses()).toEqual([HINT]);

  // Der nächste Anlass kommt wie sonst: nach drei Minuten.
  await wait(180_000);
  expect(listings(listDir)).toBe(4);
});

test('a list that goes away while GitHub has not answered yet leaves no cue behind', async () => {
  const listDir = vi.fn<ListDir>(never);
  await mount(device(HERE), listDir);
  await wait(10_000);
  await act(() => {
    render(null, host);
  });
  // Nach 30 Sekunden gibt die Anfrage auf; die Liste ist da schon weg und darf sich für nichts mehr anmelden.
  await wait(630_000);
  expect(listings(listDir)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});

test('a cue that comes while the very first listing still hangs is not lost: when that listing fails, the next try follows at once', async () => {
  let asked = 0;
  const fails: ((error: Error) => void)[] = [];
  const listDir = vi.fn<ListDir>((folder) => {
    if (folder !== PAGES_DIR) return repo(folder);
    asked += 1;
    if (asked === 1) return new Promise<DirEntry[]>((_, reject) => fails.push(reject));
    return repo(folder);
  });
  await mount(device(HERE), listDir);
  await wait(0);
  expect(statuses()).toEqual([LOADING]);

  // Das Netz kommt zurück, während die erste Anfrage noch hängt: Sie startet nichts zweites, wird aber gemerkt.
  await cue(online);
  expect(listings(listDir)).toBe(1);

  await act(async () => {
    fails[0](new TypeError('Load failed'));
    await vi.advanceTimersByTimeAsync(0);
  });
  expect(listings(listDir)).toBe(2);
  expect(statuses()).toEqual([]);
  expect(links()).toEqual([THERE_LABEL, HERE_LABEL]);
  await wait(600_000);
  expect(listings(listDir)).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});

test('a list that goes away after a cue during its first, still hanging listing starts nothing more', async () => {
  const listDir = vi.fn<ListDir>(never);
  await mount(device(HERE), listDir);
  await wait(10_000);
  await cue(online); // gemerkt, solange die erste Anfrage hängt
  await act(() => {
    render(null, host);
  });
  await wait(630_000);
  expect(listings(listDir)).toBe(1);
  expect(vi.getTimerCount()).toBe(0);
});
