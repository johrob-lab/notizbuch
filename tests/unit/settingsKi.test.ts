import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi, type Mock } from 'vitest';
import type { Settings } from '../../src/lib/settings';
import { SettingsPage } from '../../src/ui/Settings';
import { confirmDialog } from '../../src/ui/Dialog';

// Der Abschnitt „KI“ der Einstellungen mit erfundenen Funktionen für die Props: Hier lässt sich bestimmen, was die Probe des
// Schlüssels antwortet. Der Weg durch den Browser (und die Probe bei der Schnittstelle) ist Sache von tests/e2e/settings.spec.ts.

vi.mock('../../src/ui/Dialog', () => ({ confirmDialog: vi.fn() }));

const BASE: Settings = { token: 'test-zugang-0123456789', repo: 'muster/vault-test', device: 'iPad', smoothing: 'mittel', prediction: true };

const hosts: HTMLElement[] = [];

type Fakes = {
  onKiKey: Mock<(key: string) => Promise<string | null>>;
  onKiRemove: Mock<() => Promise<void>>;
  onChange: Mock<(patch: Partial<Settings>) => Promise<void>>;
};

function mount(settings: Settings = BASE, fakes: Partial<Fakes> = {}): { host: HTMLElement } & Fakes {
  const all: Fakes = {
    onKiKey: fakes.onKiKey ?? vi.fn(async (_key: string) => null),
    onKiRemove: fakes.onKiRemove ?? vi.fn(async () => undefined),
    onChange: fakes.onChange ?? vi.fn(async (_patch: Partial<Settings>) => undefined),
  };
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  render(h(SettingsPage, { settings, warning: null, passive: false, onAccess: async () => null, ...all }), host);
  return { host, ...all };
}

beforeEach(() => {
  vi.mocked(confirmDialog).mockReset();
});

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

const field = (host: HTMLElement) => host.querySelector<HTMLInputElement>('input[type="password"]')!;
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name);
const message = (host: HTMLElement) => host.querySelector('.ki [role="status"]')!;
const section = (host: HTMLElement) => host.querySelector('section.ki')!;

async function type(host: HTMLElement, value: string) {
  await act(() => {
    const input = field(host);
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function submit(host: HTMLElement) {
  await act(() => {
    button(host, 'Prüfen und speichern')!.click();
  });
}

test('a key that does not look like one is refused at once', async () => {
  const { host, onKiKey } = mount();
  expect(host.querySelector(`label[for="${field(host).id}"]`)!.textContent).toBe('KI-Schlüssel');
  await type(host, 'abc');
  await submit(host);
  expect(message(host).textContent).toBe('Das ist kein KI-Schlüssel. Er beginnt mit sk-ant-.');
  expect(onKiKey).not.toHaveBeenCalled();
});

test('the key is checked, saved and never shown', async () => {
  const { host, onKiKey } = mount();
  await type(host, ' sk-ant-test-0000 ');
  await submit(host);
  await vi.waitFor(() => expect(message(host).textContent).toBe('Gespeichert.'));
  expect(onKiKey).toHaveBeenCalledWith('sk-ant-test-0000');
  expect(field(host).value).toBe('');

  const stored = mount({ ...BASE, kiKey: 'sk-ant-test-0000' });
  expect(section(stored.host).textContent).toContain('Schlüssel: gespeichert');
  expect(section(stored.host).textContent).not.toContain('sk-ant');
  expect(section(stored.host).innerHTML).not.toContain('sk-ant');
  expect(field(stored.host).value).toBe('');
  expect(mount().host.querySelector('section.ki')!.textContent).toContain('Schlüssel: keiner');
});

test('a failed check says why and keeps the field', async () => {
  let release!: (text: string) => void;
  const onKiKey = vi.fn((_key: string) => new Promise<string | null>((resolve) => (release = resolve)));
  const { host } = mount(BASE, { onKiKey });
  await type(host, 'sk-ant-test-0000');
  await submit(host);
  const busy = button(host, 'Wird geprüft …')!;
  expect(busy).toBeDefined();
  expect(busy.disabled).toBe(true);
  await act(() => release('Dieser Schlüssel passt nicht.'));
  await vi.waitFor(() => expect(message(host).textContent).toBe('Dieser Schlüssel passt nicht.'));
  expect(field(host).value).toBe('sk-ant-test-0000');
  expect(button(host, 'Prüfen und speichern')!.disabled).toBe(false);
});

test('removing asks first', async () => {
  const stored = { ...BASE, kiKey: 'sk-ant-test-0000' };
  vi.mocked(confirmDialog).mockResolvedValueOnce(true);
  const yes = mount(stored);
  await act(() => {
    button(yes.host, 'Schlüssel entfernen')!.click();
  });
  expect(confirmDialog).toHaveBeenCalledWith({ frage: 'Den KI-Schlüssel von diesem iPad entfernen?', ja: 'Entfernen' });
  await vi.waitFor(() => expect(yes.onKiRemove).toHaveBeenCalledTimes(1));

  vi.mocked(confirmDialog).mockResolvedValueOnce(false);
  const no = mount(stored);
  await act(() => {
    button(no.host, 'Schlüssel entfernen')!.click();
  });
  await vi.waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(2));
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(no.onKiRemove).not.toHaveBeenCalled();

  expect(button(mount().host, 'Schlüssel entfernen')).toBeUndefined();
});

test('the model choice applies at once', async () => {
  const { host, onChange } = mount();
  const radio = (label: string) => [...host.querySelectorAll<HTMLInputElement>('input[name="modell"]')].find((i) => i.parentElement!.textContent === label)!;
  expect(radio('Sonnet (genauer)').checked).toBe(true);
  expect(radio('Haiku (sparsam)').checked).toBe(false);
  await act(() => {
    radio('Haiku (sparsam)').click();
  });
  expect(onChange).toHaveBeenCalledWith({ kiModel: 'haiku' });
});

test('no KI section on the Firmen-PC', () => {
  const { host } = mount({ ...BASE, device: 'Firmen-PC' });
  const headings = [...host.querySelectorAll('h1, h2')].map((e) => e.textContent);
  expect(headings).not.toContain('KI');
  expect(host.querySelector('section.ki')).toBeNull();
  expect([...mount().host.querySelectorAll('h2')].map((e) => e.textContent)).toContain('KI');
});
