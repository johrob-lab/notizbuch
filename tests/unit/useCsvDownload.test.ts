// @vitest-environment happy-dom
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { ERNEUT_TIPPEN, OHNE_NETZ } from '../../src/lib/tabelleCsv';
import { OfflineError, type ReadFile } from '../../src/sync/github';
import { useCsvDownload } from '../../src/ui/useCsvDownload';

// Der Hook mit einem Testbauteil: Es zeigt den Hinweis und hat einen Knopf, der den Download anstößt. Die Datei kommt aus einem
// erfundenen `readFile`, die Ausgabe (Teilen oder Download) aus erfundenen Teilen-Funktionen des Browsers.

const KEINE = 'Noch keine Liste. Sperren fehlen.';
const CSV = '﻿a;b\r\n1;2\r\n';
const D = { csvPath: 'x/Liste.csv', jsonPath: 'x/Liste.json', name: 'Liste.csv', seite: 2, neuester: 0, keine: KEINE };

let host: HTMLElement;
let share: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T12:00:00Z'));
  host = document.createElement('div');
  document.body.appendChild(host);
  share = vi.fn(async () => undefined);
  Object.assign(navigator, { canShare: () => true, share });
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (navigator as unknown as Record<string, unknown>).canShare;
  delete (navigator as unknown as Record<string, unknown>).share;
});

function mount(readFile: ReadFile, d: Partial<typeof D> = {}) {
  function Probe() {
    const { hinweis, download } = useCsvDownload({ readFile, readOnly: false });
    return h('div', null, h('button', { onClick: () => void download({ ...D, ...d }) }, 'los'), h('p', { role: 'status' }, hinweis));
  }
  act(() => render(h(Probe, {}), host));
}
const tap = async () => {
  await act(async () => {
    host.querySelector('button')!.click();
    // Mehrere Schritte nacheinander (lesen, ausgeben, Speicher lesen): Erst wenn sie durch sind, steht der Hinweis da.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};
const status = () => host.querySelector('p')!.textContent;
const files = (map: Record<string, string | null>): ReadFile => vi.fn(async (path: string) => map[path] ?? null);

test('a missing CSV says so', async () => {
  mount(files({}));
  await tap();
  expect(status()).toBe(KEINE);
  expect(share).not.toHaveBeenCalled();
});

test('without network the hint says the app needs network', async () => {
  mount(
    vi.fn(async () => {
      throw new OfflineError();
    }),
  );
  await tap();
  expect(status()).toBe(OHNE_NETZ);
});

test('an expired tap keeps the CSV for the next tap, for a minute', async () => {
  share.mockRejectedValueOnce(new DOMException('abgelaufen', 'NotAllowedError'));
  const read = files({ [D.csvPath]: CSV });
  mount(read);
  await tap();
  expect(status()).toBe(ERNEUT_TIPPEN);
  expect(read).toHaveBeenCalledTimes(1);

  vi.setSystemTime(Date.now() + 59_000);
  await tap();
  expect(share).toHaveBeenCalledTimes(2);
  // Das zweite Teilen las nur den Zeilenspeicher, nicht die CSV noch einmal.
  expect(read).not.toHaveBeenLastCalledWith(D.csvPath);
  expect(vi.mocked(read).mock.calls.filter(([p]) => p === D.csvPath)).toHaveLength(1);

  // Einmal benutzt, verfällt der Text: der nächste Tipp lädt neu.
  await tap();
  expect(vi.mocked(read).mock.calls.filter(([p]) => p === D.csvPath)).toHaveLength(2);
});

test('after a minute the kept CSV is read again', async () => {
  share.mockRejectedValueOnce(new DOMException('abgelaufen', 'NotAllowedError'));
  const read = files({ [D.csvPath]: CSV });
  mount(read);
  await tap();
  vi.setSystemTime(Date.now() + 60_000);
  await tap();
  expect(vi.mocked(read).mock.calls.filter(([p]) => p === D.csvPath)).toHaveLength(2);
});

test('a store older than the strokes adds the Stand hint', async () => {
  const store = JSON.stringify({ format: 1, verarbeitet: '2026-10-29 19:02', seiten: { '2': { stand: 1000 } } });
  mount(files({ [D.csvPath]: CSV, [D.jsonPath]: store }), { neuester: 2000 });
  await tap();
  expect(share).toHaveBeenCalledTimes(1);
  expect(status()).toMatch(/^Stand der CSV: 29\.10\., 19:02\./);
});

test('a current store gives no hint', async () => {
  const store = JSON.stringify({ format: 1, verarbeitet: '2026-10-29 19:02', seiten: { '2': { stand: 1000 } } });
  mount(files({ [D.csvPath]: CSV, [D.jsonPath]: store }), { neuester: 500 });
  await tap();
  expect(status()).toBe('');
});
