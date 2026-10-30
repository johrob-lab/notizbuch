import { h, render } from 'preact';
import { afterEach, expect, test, vi } from 'vitest';
import type { SyncEngine } from '../../src/sync/engine';
import { BriefingCard } from '../../src/ui/BriefingCard';
import { FAILED } from '../../src/ui/texts';
import { fixture } from './helpers';

// Die Karte „Morgenbriefing“ mit einer erfundenen Engine: Hier lässt sich bestimmen, wann ein Schreiben fertig wird und woran es
// scheitert. Der Weg durch den Browser (Finger, Fokus, Zoom) ist Sache der Tests in tests/e2e/tag.spec.ts.

const note = fixture('05 Daily Notes/2026-10-29.md');
const TASK1 = '- [ ] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%';
const TASK2 = '- [ ] Urlaube im Plan nachziehen %%ob:k3x9 todo:AAMkTEST2%%';
const NAME1 = 'Liste Planobjekte ergänzen (fällig 30.10.)';
const NAME2 = 'Urlaube im Plan nachziehen';

type Answer = { text: string | null; unknown: boolean };

/** Eine Engine, die nur kann, was die Karte braucht. `answer` ist, was `lookup` antwortet. */
function fakeEngine(first: Answer) {
  const state = { answer: first };
  const listeners = new Set<(paths: string[]) => void>();
  const engine = {
    lookup: vi.fn(async (): Promise<Answer> => state.answer),
    write: vi.fn(async (_path: string, text: string): Promise<void> => {
      state.answer = { text, unknown: false };
    }),
    addRemoteChangeListener: vi.fn((listener: (paths: string[]) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
  };
  return { engine, state, as: engine as unknown as SyncEngine };
}

const hosts: HTMLElement[] = [];

function mount(engine: SyncEngine, day = '2026-10-29'): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  render(h(BriefingCard, { engine, day, rect: [0, 0, 600, 500] }), host);
  return host;
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

const box = (host: HTMLElement, name: string) => host.querySelector<HTMLInputElement>(`input[type="checkbox"][aria-label="${name}"]`);
const tick = (host: HTMLElement, name: string) => box(host, name)!.dispatchEvent(new Event('change', { bubbles: true }));
const polite = (host: HTMLElement) => host.querySelector('p[role="status"]')!;
const alert = (host: HTMLElement) => host.querySelector('p[role="alert"]')!;
const card = (host: HTMLElement) => host.querySelector('section')!;
const addButton = (host: HTMLElement) => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Hinzufügen')!;
const loaded = (host: HTMLElement) => vi.waitFor(() => expect(box(host, NAME1)).not.toBeNull());
const settled = (host: HTMLElement) => vi.waitFor(() => expect(card(host).getAttribute('aria-busy')).toBe('false'));

function deferred() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

test('the notice regions are in the tree from the start and empty', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  const host = mount(fake.as);
  await loaded(host);
  expect(polite(host).textContent).toBe('');
  expect(alert(host).textContent).toBe('');
  expect(host.querySelectorAll('p[role="status"]')).toHaveLength(1);
  expect(host.querySelectorAll('p[role="alert"]')).toHaveLength(1);
});

test('a write that fails puts the failure into the alert region and shows what the note really holds', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  fake.engine.write.mockRejectedValueOnce(new Error('voll'));
  const host = mount(fake.as);
  await loaded(host);
  const regions = { before: alert(host) };
  tick(host, NAME1);
  await vi.waitFor(() => expect(alert(host).textContent).toBe(FAILED));
  expect(alert(host)).toBe(regions.before); // dasselbe Element, es ist nicht neu entstanden
  expect(polite(host).textContent).toBe('');
  await settled(host);
  expect(box(host, NAME1)!.checked).toBe(false); // die Notiz hat den Haken nie bekommen
  expect(fake.state.answer.text).toBe(note);
});

test('taps that come while a write is under way queue behind it, and each goes from the result of the one before', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  const gate = deferred();
  const secondGate = deferred();
  const slow = (wait: Promise<void>) => async (_path: string, text: string) => {
    await wait;
    fake.state.answer = { text, unknown: false };
  };
  fake.engine.write.mockImplementationOnce(slow(gate.promise)).mockImplementationOnce(slow(secondGate.promise));
  const host = mount(fake.as);
  await loaded(host);
  tick(host, NAME1);
  tick(host, NAME2);
  await vi.waitFor(() => expect(fake.engine.write).toHaveBeenCalledTimes(1));
  expect(fake.engine.write).toHaveBeenCalledTimes(1); // der zweite wartet
  expect(box(host, NAME2)!.checked).toBe(true); // und sein Haken ist schon zu sehen
  expect(card(host).getAttribute('aria-busy')).toBe('true');
  gate.release();
  await vi.waitFor(() => expect(fake.engine.write).toHaveBeenCalledTimes(2));
  // Der erste Vorgang ist fertig, der zweite noch nicht: Der Haken des zweiten springt nicht zurück.
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(box(host, NAME1)!.checked).toBe(true);
  expect(box(host, NAME2)!.checked).toBe(true);
  expect(card(host).getAttribute('aria-busy')).toBe('true');
  secondGate.release();
  const [, first] = fake.engine.write.mock.calls[0];
  const [, second] = fake.engine.write.mock.calls[1];
  expect(first).toBe(note.replace(TASK1, TASK1.replace('[ ]', '[x]')));
  expect(second).toBe(first.replace(TASK2, TASK2.replace('[ ]', '[x]')));
  await settled(host);
  expect(box(host, NAME1)!.checked).toBe(true);
  expect(box(host, NAME2)!.checked).toBe(true);
  expect(polite(host).textContent).toBe('');
  expect(alert(host).textContent).toBe('');
});

test('a note that can not be asked about is not written, also when it was missing a moment ago', async () => {
  const fake = fakeEngine({ text: null, unknown: false });
  const host = mount(fake.as, '2026-11-05');
  await vi.waitFor(() => expect(host.textContent).toContain('Noch kein Briefing für diesen Tag'));
  // Das Netz ist weg: Ob inzwischen eine Notiz da ist, lässt sich nicht sagen.
  fake.state.answer = { text: null, unknown: true };
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Ergänzung"]')!;
  input.value = 'Offline getippt';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await vi.waitFor(() => expect(addButton(host).disabled).toBe(false));
  host.querySelector('form.ergaenzen')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(polite(host).textContent).toBe('Briefing offline nicht verfügbar'));
  expect(fake.engine.write).not.toHaveBeenCalled();
  expect(input.value).toBe('Offline getippt'); // das Getippte geht nicht verloren
});

test('a day that is not on the device and can not be asked about says so, then loads when the network is back', async () => {
  const fake = fakeEngine({ text: null, unknown: true });
  const host = mount(fake.as);
  await vi.waitFor(() => expect(host.textContent).toContain('Briefing offline nicht verfügbar'));
  expect(host.textContent).not.toContain('Noch kein Briefing');
  expect(addButton(host).disabled).toBe(true);
  expect(card(host).getAttribute('aria-busy')).toBe('false');

  fake.state.answer = { text: note, unknown: false };
  window.dispatchEvent(new Event('online'));
  await loaded(host);
  expect(host.textContent).not.toContain('Briefing offline nicht verfügbar');
  expect(addButton(host).disabled).toBe(false);
});

test('a server error is no unreadable note and is tried again, a note that is not UTF-8 is unreadable and is not', async () => {
  const fake = fakeEngine({ text: null, unknown: false });
  fake.engine.lookup.mockRejectedValueOnce(Object.assign(new Error('Server Error'), { status: 500 }));
  const host = mount(fake.as);
  await vi.waitFor(() => expect(host.textContent).toContain('Das Briefing konnte nicht geladen werden.'));
  expect(host.textContent).not.toContain('lässt sich nicht lesen');
  expect(addButton(host).disabled).toBe(true);
  fake.state.answer = { text: note, unknown: false };
  window.dispatchEvent(new Event('online'));
  await loaded(host);

  const broken = fakeEngine({ text: null, unknown: false });
  broken.engine.lookup.mockRejectedValue(new TypeError('The encoded data was not valid for encoding utf-8'));
  const other = mount(broken.as);
  await vi.waitFor(() => expect(other.textContent).toContain('Das Briefing lässt sich nicht lesen und wird nicht verändert.'));
  const asked = broken.engine.lookup.mock.calls.length;
  window.dispatchEvent(new Event('online'));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(broken.engine.lookup.mock.calls.length).toBe(asked);
  expect(addButton(other).disabled).toBe(true);
});

// ---------- Ein Fenster, das nur lesen darf ----------

test('a card of a read-only engine can be read but not ticked, edited or added to, and writes nothing', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  (fake.engine as { readOnly?: boolean }).readOnly = true; // das zweite Fenster eines Geräts
  const host = mount(fake.as);
  await loaded(host);
  // Die Kästchen sind gesperrt, es gibt keine Stifte zum Bearbeiten und kein Feld zum Ergänzen
  expect(box(host, NAME1)!.disabled).toBe(true);
  expect(box(host, NAME2)!.disabled).toBe(true);
  expect(host.querySelector('button.stift')).toBeNull();
  expect(host.querySelector('form.ergaenzen')).toBeNull();
  expect(host.textContent).toContain(NAME1); // gelesen werden kann die Notiz
  // Auch ein Ereignis, das trotzdem ankommt, schreibt nichts, und das Kästchen zeigt weiter, was in der Notiz steht
  tick(host, NAME1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(fake.engine.write).not.toHaveBeenCalled();
  expect(box(host, NAME1)!.checked).toBe(false);
  expect(polite(host).textContent).toBe('');
  expect(alert(host).textContent).toBe('');
});

test('a card of an engine that writes still has its boxes, pens and the form for additions', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  const host = mount(fake.as);
  await loaded(host);
  expect(box(host, NAME1)!.disabled).toBe(false);
  expect(host.querySelector('button.stift')).not.toBeNull();
  expect(host.querySelector('form.ergaenzen')).not.toBeNull();
});
