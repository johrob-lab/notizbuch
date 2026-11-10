import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import type { Day } from '../../src/lib/dates';
import type { SyncEngine } from '../../src/sync/engine';
import { usePrioritaeten } from '../../src/ui/usePrioritaeten';

// Der Haken `usePrioritaeten` mit einer erfundenen Engine: Er liest die Prioritäten aus den Tagesnotizen einer Woche. Hier geht es
// darum, womit eine Woche beginnt, bevor ihre eigenen Anfragen antworten. Alle Tage und Texte sind erfunden.

/** Eine Tagesnotiz, wie sie die Abendroutine schreibt: unter `## Handschrift` der Block `### Prioritäten` mit diesen Zeilen. */
const note = (day: string, ...lines: string[]) =>
  ['---', `date: ${day}`, '---', `# ${day}`, '', '## Handschrift', '', '### Prioritäten', ...lines, ''].join('\n');

const MON = '2026-11-02';
const TUE = '2026-11-03';
const pathOf = (day: string) => `05 Daily Notes/${day}.md`;

/** Eine Antwort der Engine, die erst kommt, wenn der Test sie gibt. */
function later() {
  let answer!: (text: string | null) => void;
  const promise = new Promise<string | null>((resolve) => {
    answer = resolve;
  });
  return { promise, answer };
}

/** Eine Engine, die je Pfad aus `texts` antwortet, gleich. */
function fakeEngine(texts: Record<string, string>) {
  const engine = {
    read: vi.fn(async (path: string): Promise<string | null> => texts[path] ?? null),
    addRemoteChangeListener: vi.fn(() => () => undefined),
  };
  return { engine, as: engine as unknown as SyncEngine };
}

function Week(props: { engine: SyncEngine; days: Day[] }) {
  const prioritaeten = usePrioritaeten(props.engine, props.days);
  const shown = props.days.map((day) => `${day}:${(prioritaeten.get(day) ?? []).map((p) => p.text).join('+')}`);
  return h('p', { id: 'woche' }, shown.join(' '));
}

const hosts: HTMLElement[] = [];

function mount(engine: SyncEngine, days: Day[]): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => render(h(Week, { engine, days }), host));
  return host;
}

const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

const text = (host: HTMLElement) => host.querySelector('#woche')!.textContent;

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

test('eine Woche, die später aufgeht, zeigt sofort die letzten Prioritäten ihrer Tage und dann ihre eigenen', async () => {
  const { engine, as } = fakeEngine({ [pathOf(MON)]: note(MON, 'Angebot prüfen'), [pathOf(TUE)]: note(TUE, 'Plan schicken') });
  mount(as, [MON, TUE]);
  await settle();
  // Wie beim Zurückscrollen in eine eben verlassene Woche: Ihre Prioritäten stehen schon im ersten Bild da.
  const answers = [later(), later()];
  engine.read.mockImplementationOnce(() => answers[0].promise).mockImplementationOnce(() => answers[1].promise);
  const host = mount(as, [MON, TUE]);
  expect(text(host)).toBe(`${MON}:Angebot prüfen ${TUE}:Plan schicken`);
  answers[0].answer(note(MON, 'Angebot prüfen', 'Termin absagen'));
  answers[1].answer(null);
  await settle();
  expect(text(host)).toBe(`${MON}:Angebot prüfen+Termin absagen ${TUE}:`);
});

test('ein Tag ohne frühere Antwort und eine andere Engine beginnen leer', async () => {
  const first = fakeEngine({ [pathOf(MON)]: note(MON, 'Angebot prüfen') });
  mount(first.as, [MON]);
  await settle();
  first.engine.read.mockImplementation(() => later().promise);
  expect(text(mount(first.as, [MON, TUE]))).toBe(`${MON}:Angebot prüfen ${TUE}:`);
  const other = fakeEngine({});
  other.engine.read.mockImplementation(() => later().promise);
  expect(text(mount(other.as, [MON]))).toBe(`${MON}:`);
});

test('eine ältere Antwort ersetzt nicht, was eine neuere für denselben Tag schon gebracht hat', async () => {
  const { engine, as } = fakeEngine({});
  const slow = later();
  const fast = later();
  engine.read.mockImplementationOnce(() => slow.promise).mockImplementationOnce(() => fast.promise);
  const first = mount(as, [MON]);
  const second = mount(as, [MON]);
  fast.answer(note(MON, 'neu'));
  await settle();
  slow.answer(note(MON, 'alt'));
  await settle();
  expect(text(first)).toBe(`${MON}:alt`); // jede Woche zeigt die Antwort auf ihre eigene Anfrage
  expect(text(second)).toBe(`${MON}:neu`);
  engine.read.mockImplementation(() => later().promise);
  expect(text(mount(as, [MON]))).toBe(`${MON}:neu`);
});
