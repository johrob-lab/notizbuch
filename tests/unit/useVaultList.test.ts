import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import type { SyncEngine } from '../../src/sync/engine';
import { useVaultList } from '../../src/ui/useVaultList';

// Der Haken `useVaultList` mit einer erfundenen Engine: Hier lässt sich zählen, wie oft gelesen wird, und eine Änderung von einem
// anderen Gerät auslösen.

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

type Props = { engine: SyncEngine; path: string; parse: (text: string) => string[] };

function List(props: Props) {
  const list = useVaultList(props.engine, props.path, props.parse);
  return h('p', { id: 'liste' }, list.join(','));
}

const hosts: HTMLElement[] = [];

/** Zeichnet die Liste; `act` führt dabei auch die Effekte des Haken aus. */
function mount(props: Props): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => render(h(List, props), host));
  return host;
}

/** Lässt die schon fälligen Versprechen laufen. */
const settle = () => act(async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
});

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

test('eine Funktion, die beim Parsen wirft, gibt eine leere Liste und keinen unbehandelten Fehler', async () => {
  const unhandled = vi.fn();
  process.on('unhandledRejection', unhandled);
  try {
    const { as } = fakeEngine('a');
    const host = mount({
      engine: as,
      path: 'Kalender/Liste.md',
      parse: () => {
        throw new Error('kaputt');
      },
    });
    await settle();
    // Der Fehler des Versprechens meldet sich erst nach einem Durchgang der Ereignisschleife.
    await new Promise((resolve) => setImmediate(resolve));
    expect(host.querySelector('#liste')!.textContent).toBe('');
    expect(unhandled).not.toHaveBeenCalled();
  } finally {
    process.off('unhandledRejection', unhandled);
  }
});

test('eine bei jedem Zeichnen neue Funktion liest die Datei nur einmal', async () => {
  const { engine, as } = fakeEngine('a');
  const host = mount({ engine: as, path: 'Kalender/Liste.md', parse: (text) => [text] });
  await settle();
  for (let i = 0; i < 3; i++) {
    act(() => render(h(List, { engine: as, path: 'Kalender/Liste.md', parse: (text: string) => [text + i] }), host));
    await settle();
  }
  expect(engine.read).toHaveBeenCalledTimes(1);
});

test('eine Änderung zur NFC-Form eines zerlegt gegebenen Pfads liest die Datei unter dem NFC-Pfad neu', async () => {
  const nfd = 'Kalender/Gebühr.md';
  const nfc = 'Kalender/Gebühr.md';
  const { engine, change, as } = fakeEngine('a');
  const host = mount({ engine: as, path: nfd, parse: (text) => [text] });
  await settle();
  expect(engine.read).toHaveBeenLastCalledWith(nfc);
  act(() => change(nfc));
  await settle();
  expect(engine.read).toHaveBeenCalledTimes(2);
  expect(engine.read).toHaveBeenLastCalledWith(nfc);
  expect(host.querySelector('#liste')!.textContent).toBe('a');
});

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

const text = (host: HTMLElement) => host.querySelector('#liste')!.textContent;
const asList = (t: string) => [t];

test('eine Liste, die später aufgeht, zeigt sofort die letzte Antwort der Engine und dann ihre eigene', async () => {
  const { engine, as } = fakeEngine('a');
  mount({ engine: as, path: 'Kalender/Liste.md', parse: asList });
  await settle();
  const next = later();
  engine.read.mockImplementationOnce(() => next.promise);
  // Beim Weiterscrollen zeigt die neue Seite so von Anfang an dieselben Einträge wie eben die Vorschau.
  const host = mount({ engine: as, path: 'Kalender/Liste.md', parse: asList });
  expect(text(host)).toBe('a');
  next.answer('b');
  await settle();
  expect(text(host)).toBe('b');
});

test('eine andere Engine und eine andere Datei beginnen leer', async () => {
  const first = fakeEngine('a');
  mount({ engine: first.as, path: 'Kalender/Liste.md', parse: asList });
  await settle();
  const other = fakeEngine('x');
  other.engine.read.mockImplementation(() => later().promise);
  expect(text(mount({ engine: other.as, path: 'Kalender/Liste.md', parse: asList }))).toBe('');
  first.engine.read.mockImplementation(() => later().promise);
  expect(text(mount({ engine: first.as, path: 'Kalender/Andere.md', parse: asList }))).toBe('');
});

test('eine ältere Antwort ersetzt nicht, was eine neuere schon gebracht hat', async () => {
  const { engine, as } = fakeEngine('a');
  const slow = later();
  const fast = later();
  engine.read.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise);
  const first = mount({ engine: as, path: 'Kalender/Liste.md', parse: asList });
  const second = mount({ engine: as, path: 'Kalender/Liste.md', parse: asList });
  fast.answer('neu');
  await settle();
  slow.answer('alt');
  await settle();
  expect(text(first)).toBe('alt'); // jede Liste zeigt die Antwort auf ihre eigene Anfrage
  expect(text(second)).toBe('neu');
  engine.read.mockImplementation(() => later().promise);
  expect(text(mount({ engine: as, path: 'Kalender/Liste.md', parse: asList }))).toBe('neu');
});

test('nach einer Datei, die fehlt, kaputt ist oder sich nicht lesen ließ, beginnt die nächste Liste leer', async () => {
  const { engine, as } = fakeEngine('a');
  mount({ engine: as, path: 'Kalender/Liste.md', parse: asList });
  await settle();
  engine.read.mockImplementation(() => later().promise);
  // Was die Engine lieferte, lässt sich nicht lesen: Auch die nächste Liste ist leer, ohne Fehler.
  const broken = mount({
    engine: as,
    path: 'Kalender/Liste.md',
    parse: () => {
      throw new Error('kaputt');
    },
  });
  expect(text(broken)).toBe('');

  const failing = later();
  engine.read.mockImplementationOnce(() => failing.promise);
  mount({ engine: as, path: 'Kalender/Liste.md', parse: asList });
  failing.fail(new Error('kein Netz'));
  await settle();
  expect(text(mount({ engine: as, path: 'Kalender/Liste.md', parse: asList }))).toBe('');
});
