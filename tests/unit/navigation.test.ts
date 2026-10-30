import { signal } from '@preact/signals';
import { h, render, type ComponentChild } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SyncEngine, SyncStatus } from '../../src/sync/engine';
import { MonthTabs } from '../../src/ui/MonthTabs';
import { parseRoute, type Route } from '../../src/ui/router';
import { StatusPill } from '../../src/ui/StatusPill';
import { TopBar } from '../../src/ui/TopBar';

// Die Leiste oben, die Monatsreiter und die Statusanzeige. Die Engine ist ein Fake mit einem Status und den zwei
// Meldungen, die die Leiste abonniert. Heute ist fest der 29.10.2026. Alles hier ist erfunden.

type FakeEngine = Pick<SyncEngine, 'status' | 'onConflict' | 'onError'>;

let host: HTMLDivElement;

function fakeEngine(status: SyncStatus = { state: 'gesichert', pending: 0 }) {
  return { status: signal<SyncStatus>(status), onConflict: undefined, onError: undefined } as FakeEngine & { status: ReturnType<typeof signal<SyncStatus>> };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-29T10:00:00Z'));
  host = document.createElement('div');
  document.body.append(host);
  window.location.hash = '';
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.useRealTimers();
});

async function mount(vnode: ComponentChild): Promise<void> {
  await act(() => render(vnode, host));
}

const all = (selector: string): HTMLElement[] => [...host.querySelectorAll<HTMLElement>(selector)];
const item = (name: string): HTMLElement => {
  const found = all('a, button').find((el) => (el.getAttribute('aria-label') ?? el.textContent ?? '').trim() === name);
  if (!found) throw new Error(`kein Element mit dem Namen ${name}`);
  return found;
};
const route = (hash: string): Route => parseRoute(hash);

// ---------- Statusanzeige ----------

test('the status pill shows exactly the label of the engine status and keeps its test id', async () => {
  const engine = fakeEngine();
  await mount(h(StatusPill, { engine }));
  const pill = host.querySelector('[data-testid="status"]')!;
  expect(pill.textContent).toBe('Gesichert');
  expect(all('[data-testid="status"]')).toHaveLength(1);

  await act(() => {
    engine.status.value = { state: 'wartet', pending: 1 };
  });
  expect(pill.textContent).toBe('Wartet auf Netz · 1 Änderung');
  await act(() => {
    engine.status.value = { state: 'wartet', pending: 3 };
  });
  expect(pill.textContent).toBe('Wartet auf Netz · 3 Änderungen');
  await act(() => {
    engine.status.value = { state: 'zugang', pending: 2 };
  });
  expect(pill.textContent).toBe('Zugang erneuern');
  expect(pill.className).toContain('status-zugang');
});

// ---------- Monatsreiter ----------

test('the month tabs run from January to December of the year and open the month', async () => {
  await mount(h(MonthTabs, { year: 2026, current: '2026-10' }));
  const tabs = all('a');
  expect(tabs).toHaveLength(12);
  expect(tabs.map((t) => t.getAttribute('href'))).toEqual(
    Array.from({ length: 12 }, (_, i) => `#/monat/2026-${String(i + 1).padStart(2, '0')}`),
  );
  expect(tabs.map((t) => t.textContent)).toEqual(['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ']);
  expect(tabs[0].getAttribute('aria-label')).toBe('Januar 2026');
  expect(tabs[2].getAttribute('aria-label')).toBe('März 2026');
  expect(tabs[11].getAttribute('aria-label')).toBe('Dezember 2026');
  // Jeder Reiter führt auf eine Adresse, die der Router liest
  for (const tab of tabs) expect(parseRoute(tab.getAttribute('href')!).view).toBe('monat');
});

test('only the current month tab is highlighted', async () => {
  await mount(h(MonthTabs, { year: 2026, current: '2026-10' }));
  const current = all('a[aria-current]');
  expect(current).toHaveLength(1);
  expect(current[0].getAttribute('aria-label')).toBe('Oktober 2026');
  // Ein anderes Jahr hebt nichts hervor, die Reiter gehören dann zu diesem Jahr
  await mount(h(MonthTabs, { year: 2027, current: '2026-10' }));
  expect(all('a[aria-current]')).toHaveLength(0);
  expect(all('a')[0].getAttribute('href')).toBe('#/monat/2027-01');
});

// ---------- Leiste ----------

test('the bar has the views in order and only Month, Week and Day lead somewhere yet', async () => {
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine: fakeEngine() }));
  const names = all('nav a, nav button').map((el) => el.textContent);
  expect(names).toEqual(['Index', 'Jahr', 'Monat', 'Woche', 'Tag', 'To-Dos']);
  for (const name of ['Index', 'Jahr', 'To-Dos']) {
    const el = item(name);
    expect(el.tagName, name).toBe('BUTTON');
    expect(el.getAttribute('aria-disabled'), name).toBe('true');
    expect(el.getAttribute('title'), name).toBe('kommt mit Stufe C');
    expect(el.hasAttribute('href'), name).toBe(false);
  }
  expect(item('Monat').getAttribute('href')).toBe('#/monat/2026-10');
  expect(item('Woche').getAttribute('href')).toBe('#/woche/2026-W44');
  expect(item('Tag').getAttribute('href')).toBe('#/tag/2026-10-29');
});

test('the view of the shown page is marked, and the others keep its date', async () => {
  await mount(h(TopBar, { route: route('#/woche/2026-W45'), engine: fakeEngine() }));
  expect(item('Woche').getAttribute('aria-current')).toBe('page');
  expect(item('Tag').hasAttribute('aria-current')).toBe(false);
  expect(item('Monat').hasAttribute('aria-current')).toBe(false);
  // Woche 45 ohne heute: Montag 2.11. in den Ansichten Tag und Monat
  expect(item('Tag').getAttribute('href')).toBe('#/tag/2026-11-02');
  expect(item('Monat').getAttribute('href')).toBe('#/monat/2026-11');
});

test('the arrows step the page that is shown, and stop where there is nothing to step', async () => {
  await mount(h(TopBar, { route: route('#/tag/2026-12-31'), engine: fakeEngine() }));
  expect(item('Voriger Tag').getAttribute('href')).toBe('#/tag/2026-12-30');
  expect(item('Nächster Tag').getAttribute('href')).toBe('#/tag/2027-01-01');

  await mount(h(TopBar, { route: route('#/woche/2027-W01'), engine: fakeEngine() }));
  expect(item('Vorige Woche').getAttribute('href')).toBe('#/woche/2026-W53');
  expect(item('Nächste Woche').getAttribute('href')).toBe('#/woche/2027-W02');

  await mount(h(TopBar, { route: route('#/monat/2026-12'), engine: fakeEngine() }));
  expect(item('Voriger Monat').getAttribute('href')).toBe('#/monat/2026-11');
  expect(item('Nächster Monat').getAttribute('href')).toBe('#/monat/2027-01');

  for (const hash of ['#/einstellungen', `#/besprechung/${encodeURIComponent('2026-10-29 0800 Muster')}/1`]) {
    await mount(h(TopBar, { route: route(hash), engine: fakeEngine() }));
    const [prev, next] = all('[aria-label^="Vorig"], [aria-label^="Nächst"]');
    for (const arrow of [prev, next]) {
      expect(arrow.getAttribute('aria-disabled'), hash).toBe('true');
      expect(arrow.hasAttribute('href'), hash).toBe(false);
    }
  }
});

test('Today leads to the day page of today, worked out when it is tapped', async () => {
  await mount(h(TopBar, { route: route('#/monat/2026-03'), engine: fakeEngine() }));
  expect(item('Heute').getAttribute('href')).toBe('#/tag/2026-10-29');
  vi.setSystemTime(new Date('2026-10-30T10:00:00Z')); // die App blieb über Nacht offen
  await act(() => item('Heute').click());
  expect(window.location.hash).toBe('#/tag/2026-10-30');
  vi.setSystemTime(new Date('2026-10-30T23:30:00Z')); // 00:30 in Wien am 31., in UTC noch der 30.
  await act(() => item('Heute').click());
  expect(window.location.hash).toBe('#/tag/2026-10-31');
});

test('the gear opens the settings and is marked there', async () => {
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine: fakeEngine() }));
  expect(item('Einstellungen').getAttribute('href')).toBe('#/einstellungen');
  expect(item('Einstellungen').hasAttribute('aria-current')).toBe(false);
  await mount(h(TopBar, { route: route('#/einstellungen'), engine: fakeEngine() }));
  expect(item('Einstellungen').getAttribute('aria-current')).toBe('page');
  // In den Einstellungen ist keine Ansicht markiert
  for (const name of ['Monat', 'Woche', 'Tag']) expect(item(name).hasAttribute('aria-current'), name).toBe(false);
});

test('the bar shows the sync status exactly once', async () => {
  const engine = fakeEngine({ state: 'wartet', pending: 2 });
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine }));
  expect(all('[data-testid="status"]')).toHaveLength(1);
  expect(host.querySelector('[data-testid="status"]')!.textContent).toBe('Wartet auf Netz · 2 Änderungen');
});

test('tapping an item that is not there yet says so, once, and the note can be closed', async () => {
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine: fakeEngine() }));
  expect(all('[role="alert"], [role="status"]:not([data-testid])')).toHaveLength(0);
  await act(() => item('Index').click());
  await act(() => item('Index').click());
  const notes = all('.meldung');
  expect(notes).toHaveLength(1);
  expect(notes[0].textContent).toContain('Index kommt mit Stufe C');
  await act(() => item('Jahr').click());
  expect(all('.meldung')).toHaveLength(2);
  await act(() => (notes[0].querySelector('button') as HTMLElement).click());
  expect(all('.meldung')).toHaveLength(1);
  expect(all('.meldung')[0].textContent).toContain('Jahr kommt mit Stufe C');
});

// ---------- Meldungen der Engine ----------

test('a conflict copy is announced with its file name, and the note can be closed', async () => {
  const engine = fakeEngine();
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine }));
  await act(() =>
    engine.onConflict?.({
      path: '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg',
      copyPath: '07 Anhänge/Notizbuch/2026/2026-10-29 Tag (Konflikt).svg',
    }),
  );
  const notes = all('.meldung');
  expect(notes).toHaveLength(1);
  expect(notes[0].textContent).toContain('Konfliktkopie angelegt: 2026-10-29 Tag (Konflikt).svg');
  expect(notes[0].textContent).not.toContain('07 Anhänge');
  const close = notes[0].querySelector('button')!;
  expect(close.getAttribute('aria-label')).toBe('Hinweis schließen');
  await act(() => close.click());
  expect(all('.meldung')).toHaveLength(0);
});

test('an error with a file is announced with the file name, an error without a file is not', async () => {
  const engine = fakeEngine();
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine }));
  await act(() => engine.onError?.({ path: '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg', error: new Error('500') }));
  expect(all('.meldung').map((n) => n.textContent)).toEqual([expect.stringContaining('Speichern hat nicht geklappt: 2026-10-29 Tag.svg')]);
  // Ohne Datei weiß niemand, was gemeint wäre: die Statusanzeige sagt, was los ist
  await act(() => engine.onError?.({ path: '', error: new Error('Netz') }));
  expect(all('.meldung')).toHaveLength(1);
});

test('the same note twice is shown once', async () => {
  const engine = fakeEngine();
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine }));
  const info = { path: 'a/2026-10-29 Tag.svg', error: new Error('x') };
  await act(() => {
    engine.onError?.(info);
    engine.onError?.(info);
  });
  expect(all('.meldung')).toHaveLength(1);
  // Nach dem Schließen darf er wiederkommen
  await act(() => (all('.meldung')[0].querySelector('button') as HTMLElement).click());
  await act(() => engine.onError?.(info));
  expect(all('.meldung')).toHaveLength(1);
});

test('the bar listens only while it is shown and gives the hooks back', async () => {
  const engine = fakeEngine();
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine }));
  expect(engine.onConflict).toBeTypeOf('function');
  expect(engine.onError).toBeTypeOf('function');
  await act(() => render(null, host));
  expect(engine.onConflict).toBeUndefined();
  expect(engine.onError).toBeUndefined();
});

test('a hook that somebody else set meanwhile is not taken away', async () => {
  const engine = fakeEngine();
  await mount(h(TopBar, { route: route('#/tag/2026-10-29'), engine }));
  const other = () => undefined;
  engine.onError = other;
  await act(() => render(null, host));
  expect(engine.onError).toBe(other);
});
