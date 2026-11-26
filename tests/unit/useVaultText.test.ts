import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import type { SyncEngine } from '../../src/sync/engine';
import { announceNoteWrite } from '../../src/ui/noteQueue';
import { useVaultText } from '../../src/ui/useVaultText';

// Der Haken `useVaultText` mit einer erfundenen Engine: Hier lässt sich zählen, wie oft gelesen wird, und eine Änderung von einem
// anderen Gerät auslösen.

const PFAD = '07 Anhänge/Notizbuch/2027/Sperren IB 2027 Excel.csv';
const ANDERER = '07 Anhänge/Notizbuch/2027/Sperren IB 2027.csv';

function fakeEngine(text: string | null = 'a') {
  const listeners = new Set<(paths: string[]) => void>();
  const engine = {
    read: vi.fn(async (_path: string): Promise<string | null> => text),
    addRemoteChangeListener: vi.fn((listener: (paths: string[]) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  const change = (...paths: string[]) => listeners.forEach((listener) => listener(paths));
  return { engine, change, as: engine as unknown as SyncEngine };
}

function Text(props: { engine: SyncEngine; path: string }) {
  return h('p', { id: 'text' }, String(useVaultText(props.engine, props.path)));
}

const hosts: HTMLElement[] = [];

/** Zeichnet den Text; `act` führt dabei auch die Effekte des Haken aus. */
function mount(engine: SyncEngine, path = PFAD): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => render(h(Text, { engine, path }), host));
  return host;
}

/** Lässt die schon fälligen Versprechen laufen. */
const settle = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

const shown = (host: HTMLElement) => host.querySelector('#text')!.textContent;

/** Eine Antwort der Engine, die erst kommt, wenn der Test sie gibt. */
function later() {
  let answer!: (text: string | null) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<string | null>((resolve, reject) => {
    answer = resolve;
    fail = reject;
  });
  return { promise, answer, fail };
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

test('bis zur ersten Antwort undefined, dann der Text', async () => {
  const { engine, as } = fakeEngine();
  const next = later();
  engine.read.mockImplementationOnce(() => next.promise);
  const host = mount(as);
  expect(shown(host)).toBe('undefined');
  next.answer('Kopf\r\nZeile\r\n');
  await settle();
  expect(shown(host)).toBe('Kopf\r\nZeile\r\n');
  expect(engine.read).toHaveBeenCalledWith(PFAD);
});

test('ohne Datei null', async () => {
  const { as } = fakeEngine(null);
  const host = mount(as);
  await settle();
  expect(shown(host)).toBe('null');
});

test('wirft read, ist der Text null und kein Fehler bleibt unbehandelt', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const { engine, as } = fakeEngine();
    engine.read.mockImplementation(async () => {
      throw new Error('kein UTF-8');
    });
    const host = mount(as);
    await settle();
    // Der Fehler des Versprechens meldet sich erst nach einem Durchgang der Ereignisschleife.
    await new Promise((resolve) => setImmediate(resolve));
    expect(shown(host)).toBe('null');
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});

test('liest neu bei einer fremden Änderung des eigenen Pfads, auch in NFD gemeldet, nicht bei anderen Pfaden', async () => {
  const { engine, change, as } = fakeEngine('a');
  const host = mount(as);
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(1);
  act(() => change(ANDERER));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(1);
  engine.read.mockResolvedValueOnce('b');
  act(() => change(PFAD.normalize('NFD')));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(2);
  expect(engine.read).toHaveBeenLastCalledWith(PFAD);
  expect(shown(host)).toBe('b');
});

test('ein zerlegt gegebener Pfad wird in NFC gelesen und gemeldet', async () => {
  const { engine, change, as } = fakeEngine('a');
  mount(as, PFAD.normalize('NFD'));
  await settle();
  expect(engine.read).toHaveBeenLastCalledWith(PFAD);
  act(() => change(PFAD));
  act(() => announceNoteWrite(as, PFAD));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(3);
});

test('liest neu nach announceNoteWrite für den eigenen Pfad, nicht für andere Pfade', async () => {
  const { engine, as } = fakeEngine('a');
  const host = mount(as);
  await settle();
  act(() => announceNoteWrite(as, ANDERER));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(1);
  engine.read.mockResolvedValueOnce('neu geschrieben');
  act(() => announceNoteWrite(as, PFAD));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(2);
  expect(shown(host)).toBe('neu geschrieben');
});

test('nach dem Abbau liest der Haken nicht mehr neu', async () => {
  const { engine, change, as } = fakeEngine('a');
  const host = mount(as);
  await settle();
  act(() => render(null, host));
  act(() => change(PFAD));
  act(() => announceNoteWrite(as, PFAD));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(1);
});

test('eine spätere Antwort einer früheren Anfrage ersetzt die neuere nicht', async () => {
  const { engine, change, as } = fakeEngine('a');
  const slow = later();
  const fast = later();
  engine.read.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise);
  const host = mount(as);
  act(() => change(PFAD));
  fast.answer('neu');
  await settle();
  expect(shown(host)).toBe('neu');
  slow.answer('alt');
  await settle();
  expect(shown(host)).toBe('neu');
  // Auch die Engine merkt sich die neuere: Eine Seite, die jetzt aufgeht, beginnt damit.
  engine.read.mockImplementation(() => later().promise);
  expect(shown(mount(as))).toBe('neu');
});

test('eine zweite Seite beginnt mit der letzten Antwort und zeigt dann ihre eigene', async () => {
  const { engine, as } = fakeEngine('a');
  mount(as);
  await settle();
  const next = later();
  engine.read.mockImplementationOnce(() => next.promise);
  const host = mount(as);
  expect(shown(host)).toBe('a');
  next.answer('b');
  await settle();
  expect(shown(host)).toBe('b');
});

test('eine andere Engine und ein anderer Pfad beginnen mit undefined, nach einer fehlenden Datei beginnt die nächste mit null', async () => {
  const first = fakeEngine('a');
  mount(first.as);
  await settle();
  const other = fakeEngine('x');
  other.engine.read.mockImplementation(() => later().promise);
  expect(shown(mount(other.as))).toBe('undefined');
  first.engine.read.mockImplementation(() => later().promise);
  expect(shown(mount(first.as, ANDERER))).toBe('undefined');

  const missing = fakeEngine(null);
  mount(missing.as);
  await settle();
  missing.engine.read.mockImplementation(() => later().promise);
  expect(shown(mount(missing.as))).toBe('null');
});
