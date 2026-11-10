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
