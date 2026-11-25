import { h, render } from 'preact';
import { afterEach, expect, test, vi } from 'vitest';
import { BETRA_FALSCH, STALE_NOTICE } from '../../src/lib/briefingEdit';
import { appendErgaenzung } from '../../src/lib/dailyNote';
import type { SyncEngine } from '../../src/sync/engine';
import { BriefingCard } from '../../src/ui/BriefingCard';
import { announceNoteWrite, noteQueue, onNoteWrite } from '../../src/ui/noteQueue';
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

/** Eine Engine, die nur kann, was die Karte braucht. `answer` ist, was `lookup` und `lookupFresh` antworten. */
function fakeEngine(first: Answer) {
  const state = { answer: first };
  const listeners = new Set<(paths: string[]) => void>();
  const engine = {
    lookup: vi.fn(async (_path: string): Promise<Answer> => state.answer),
    lookupFresh: vi.fn(async (_path: string): Promise<Answer> => state.answer),
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
  // Vor der Änderung frisch gelesen, nach dem Fehler neu gelesen wie beim Anzeigen
  expect(fake.engine.lookupFresh).toHaveBeenCalledTimes(1);
  expect(fake.engine.lookup).toHaveBeenCalledTimes(2);
});

test('a tick starts from a fresh read', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  const host = mount(fake.as);
  await loaded(host);
  await settled(host);
  const shownReads = fake.engine.lookup.mock.calls.length; // das Lesen zum Anzeigen
  tick(host, NAME1);
  await vi.waitFor(() => expect(fake.engine.write).toHaveBeenCalledTimes(1));
  await settled(host);
  expect(fake.engine.lookupFresh.mock.calls).toEqual([['05 Daily Notes/2026-10-29.md']]);
  expect(fake.engine.lookup).toHaveBeenCalledTimes(shownReads);
  expect(fake.engine.write.mock.calls[0][1]).toBe(note.replace(TASK1, TASK1.replace('[ ]', '[x]')));
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

test('a note written elsewhere in the app shows at once', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  const host = mount(fake.as);
  await loaded(host);
  await settled(host);
  fake.state.answer = { text: appendErgaenzung(note, 'Neu aus dem Fenster', false), unknown: false };
  announceNoteWrite(fake.as, '05 Daily Notes/2026-10-29.md');
  await vi.waitFor(() => expect(host.textContent).toContain('Neu aus dem Fenster'));
});

test('the card waits for a write from the window', async () => {
  const fake = fakeEngine({ text: note, unknown: false });
  const host = mount(fake.as);
  await loaded(host);
  await settled(host);
  const path = '05 Daily Notes/2026-10-29.md';
  const gate = deferred();
  const written = `${note.trimEnd()}\n- Vom Fenster\n`;
  // Die Aufgabe des Fensters hält an und schreibt erst dann.
  const windowTask = noteQueue(fake.as, path)(async () => {
    await gate.promise;
    fake.state.answer = { text: written, unknown: false };
  });
  tick(host, NAME1);
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(fake.engine.write).not.toHaveBeenCalled();
  gate.release();
  await windowTask;
  await vi.waitFor(() => expect(fake.engine.write).toHaveBeenCalledTimes(1));
  const text = fake.engine.write.mock.calls[0][1];
  expect(text).toContain('- Vom Fenster');
  expect(text).toContain(TASK1.replace('[ ]', '[x]'));
});

// ---------- Die Erinnerungen „Betra anmelden“ und ihre Betra-Nr. ----------

// Wie das Morgenbriefing sie schreibt (Reihenfolge rot, gelb, normal, dann die Aufgabe zum Einlesen), mit erfundenen Abschnitten.
const ROT = '- **<span style="color:#c62828">Betra anmelden bis Fr 18.12.: Muster Abschnitt 1, Mo 01.03.2027 (IB)</span>** %%sperre:IB-2027-03-01-1 rot%%';
const GELB = '- **==Betra anmelden bis Di 22.12.: Muster Abschnitt 2, Fr 05.03.2027 (IB)==** %%sperre:IB-2027-03-05-1 gelb%%';
const NORMAL = '- Betra anmelden bis Do 24.12.: Beispielstrecke Nord, Mo 08.03. bis Mi 10.03.2027 (IB) %%sperre:IB-2027-03-08-1%%';
const EINLESEN = '- [ ] Sperren IB 2027 einlesen (3 neu) %%einlesen:IB-2027@202611251905%%';
const BETRA_NOTE = ['# 2026-12-18', '', '## Morgenbriefing (automatisch)', '### Offene Punkte', ROT, GELB, NORMAL, EINLESEN, ''].join('\n');
const FUER_ROT = 'Betra-Nr. für Betra anmelden bis Fr 18.12.: Muster Abschnitt 1, Mo 01.03.2027 (IB)';
const FUER_GELB = 'Betra-Nr. für Betra anmelden bis Di 22.12.: Muster Abschnitt 2, Fr 05.03.2027 (IB)';
const FUER_NORMAL = 'Betra-Nr. für Betra anmelden bis Do 24.12.: Beispielstrecke Nord, Mo 08.03. bis Mi 10.03.2027 (IB)';

const betraFields = (host: HTMLElement) => [...host.querySelectorAll<HTMLInputElement>('form.betra input')];
const betraField = (host: HTMLElement, name: string) => host.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`);
/** Der Listenpunkt der Zeile `source` der Notiz. */
const itemOf = (host: HTMLElement, md: string, source: string) => host.querySelector(`li[data-line="${md.split('\n').indexOf(source)}"]`)!;

/** Tippt `typed` in das Feld `name` und tippt auf „Eintragen“. */
function enterBetra(host: HTMLElement, name: string, typed: string): void {
  const input = betraField(host, name)!;
  input.value = typed;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const button = [...input.closest('form')!.querySelectorAll('button')].find((b) => b.textContent === 'Eintragen')!;
  button.click();
}

async function mountBetra(text = BETRA_NOTE) {
  const fake = fakeEngine({ text, unknown: false });
  const host = mount(fake.as, '2026-12-18');
  await vi.waitFor(() => expect(itemOf(host, text, EINLESEN)).not.toBeNull());
  await settled(host);
  return { fake, host };
}

test('the reminders show yellow and red and have a field for the Betra number, the task to read in the list has a box instead', async () => {
  const { host } = await mountBetra();
  expect(betraFields(host).map((field) => field.getAttribute('aria-label'))).toEqual([FUER_ROT, FUER_GELB, FUER_NORMAL]);
  for (const field of betraFields(host)) {
    expect(field.type).toBe('text');
    expect(field.getAttribute('inputmode')).toBe('numeric');
    expect(field.getAttribute('autocomplete')).toBe('off');
    expect(field.getAttribute('placeholder')).toBe('Betra-Nr.');
    expect([...field.closest('form')!.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Eintragen']);
  }
  expect(itemOf(host, BETRA_NOTE, ROT).querySelector('.text strong > .rot')?.textContent).toBe('Betra anmelden bis Fr 18.12.: Muster Abschnitt 1, Mo 01.03.2027 (IB)');
  expect(itemOf(host, BETRA_NOTE, GELB).querySelector('.text strong > mark')?.textContent).toBe('Betra anmelden bis Di 22.12.: Muster Abschnitt 2, Fr 05.03.2027 (IB)');
  expect(itemOf(host, BETRA_NOTE, NORMAL).querySelector('mark, .rot, strong')).toBeNull();
  // Die Erinnerungen haben kein Kästchen: Erledigt sind sie mit der Nummer.
  for (const source of [ROT, GELB, NORMAL]) expect(itemOf(host, BETRA_NOTE, source).querySelector('input[type="checkbox"]')).toBeNull();
  // Die Aufgabe zum Einlesen hat ein Kästchen und kein Feld.
  expect(box(host, 'Sperren IB 2027 einlesen (3 neu)')).not.toBeNull();
  expect(itemOf(host, BETRA_NOTE, EINLESEN).querySelector('form, input[type="text"]')).toBeNull();
  // Vom Markup der Zeilen ist nichts zu sehen.
  for (const raw of ['**', '==', '<span', 'color', '%%', 'sperre']) expect(host.textContent).not.toContain(raw);
});

test('a Betra number goes into the marker of its line, and the line then shows it instead of the field', async () => {
  const { fake, host } = await mountBetra();
  const heard = vi.fn();
  onNoteWrite(fake.as, heard);
  enterBetra(host, FUER_ROT, ' 1234567 ');
  await vi.waitFor(() => expect(fake.engine.write).toHaveBeenCalledTimes(1));
  expect(fake.engine.write.mock.calls[0][1]).toBe(BETRA_NOTE.replace('rot%%', 'rot betra:1234567%%'));
  // Wer sonst in der App diese Notiz zeigt, erfährt es.
  await vi.waitFor(() => expect(heard).toHaveBeenCalledWith('05 Daily Notes/2026-12-18.md'));
  await settled(host);
  const rot = itemOf(host, BETRA_NOTE, ROT);
  expect(rot.querySelector('.betra-nr')?.textContent).toBe('Betra-Nr. 1234567');
  expect(rot.querySelector('form, input[type="text"]')).toBeNull();
  // Die anderen Erinnerungen haben ihr Feld noch, und eine gelungene Änderung meldet nichts.
  expect(betraFields(host).map((field) => field.getAttribute('aria-label'))).toEqual([FUER_GELB, FUER_NORMAL]);
  expect(polite(host).textContent).toBe('');
  expect(alert(host).textContent).toBe('');
});

test.each(['12a4567', '1234', '123456789', '123 4567'])('%s is no Betra number: the form says so and nothing is written', async (typed) => {
  const { fake, host } = await mountBetra();
  enterBetra(host, FUER_ROT, typed);
  const hint = betraField(host, FUER_ROT)!.closest('form')!.querySelector('[role="alert"]');
  await vi.waitFor(() => expect(hint?.textContent).toBe(BETRA_FALSCH));
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(fake.engine.lookupFresh).not.toHaveBeenCalled();
  expect(fake.engine.write).not.toHaveBeenCalled();
  expect(betraField(host, FUER_ROT)!.value).toBe(typed); // das Getippte bleibt zum Verbessern
  // Die anderen Formulare sagen nichts.
  expect(betraField(host, FUER_GELB)!.closest('form')!.querySelector('[role="alert"]')?.textContent).toBe('');
});

test('a wrong number first and then a right one: the hint goes away and the right one is written', async () => {
  const { fake, host } = await mountBetra();
  enterBetra(host, FUER_GELB, '1234');
  const form = betraField(host, FUER_GELB)!.closest('form')!;
  await vi.waitFor(() => expect(form.querySelector('[role="alert"]')?.textContent).toBe(BETRA_FALSCH));
  enterBetra(host, FUER_GELB, '12345');
  await vi.waitFor(() => expect(fake.engine.write).toHaveBeenCalledTimes(1));
  expect(fake.engine.write.mock.calls[0][1]).toBe(BETRA_NOTE.replace('gelb%%', 'gelb betra:12345%%'));
  await settled(host);
  expect(itemOf(host, BETRA_NOTE, GELB).querySelector('.betra-nr')?.textContent).toBe('Betra-Nr. 12345');
});

test('when the reminder is gone from the newest note, nothing is written and the card says so', async () => {
  const { fake, host } = await mountBetra();
  // Inzwischen lief das Morgenbriefing auf einem anderen Gerät neu, ohne diese Erinnerung.
  const newest = BETRA_NOTE.replace(`${ROT}\n`, '');
  fake.state.answer = { text: newest, unknown: false };
  enterBetra(host, FUER_ROT, '1234567');
  await vi.waitFor(() => expect(polite(host).textContent).toBe(STALE_NOTICE));
  await settled(host);
  expect(fake.engine.write).not.toHaveBeenCalled();
  expect(betraField(host, FUER_ROT)).toBeNull(); // die Karte zeigt den neuesten Stand
  expect(betraFields(host)).toHaveLength(2);
});

test('a window that only reads shows a Betra number but has no field for one', async () => {
  const gelb = GELB.replace('gelb%%', 'gelb betra:7654321%%');
  const withNumber = BETRA_NOTE.replace(GELB, gelb);
  const fake = fakeEngine({ text: withNumber, unknown: false });
  (fake.engine as { readOnly?: boolean }).readOnly = true; // das zweite Fenster eines Geräts
  const host = mount(fake.as, '2026-12-18');
  await vi.waitFor(() => expect(itemOf(host, withNumber, gelb)?.querySelector('.betra-nr')?.textContent).toBe('Betra-Nr. 7654321'));
  expect(host.querySelector('form.betra')).toBeNull();
  expect(host.querySelector('input[type="text"]')).toBeNull();
  expect([...host.querySelectorAll('button')].map((b) => b.textContent)).not.toContain('Eintragen');
});
