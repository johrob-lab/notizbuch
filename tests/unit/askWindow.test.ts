import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import { GestureFilter } from '../../src/ink/gestures';
import type { KiModel } from '../../src/lib/settings';
import type { SyncEngine } from '../../src/sync/engine';
import type { AskPage } from '../../src/ui/ask';
import { AskWindow, type AskControl } from '../../src/ui/AskWindow';

// Das Fenster „Frag Claude“ mit einer erfundenen Seite und einer erfundenen Engine. Hier geht es um die Hülle: Öffnen, Schließen,
// der Schalter „Seite mitschicken“ und die Hand, die beim Schreiben aufliegt. Die Zeit der Zeigerereignisse gibt der Test vor.
// happy-dom rechnet keine Größen aus: Jedes Element liegt bei 0, 0, und dort tippen die Zeiger. Der Weg durch den Browser ist
// Sache von tests/e2e/fragClaude.spec.ts.

type Kind = 'pen' | 'touch' | 'mouse';

function fakePage(o: Partial<AskPage> = {}): AskPage {
  return {
    label: 'Do 29.10.2026',
    day: '2026-10-29',
    describe: vi.fn(async () => 'Offene Seite: Tagesseite Do 29.10.2026'),
    svg: vi.fn(() => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    filter: new GestureFilter(),
    ...o,
  };
}

/** Eine Engine, die nichts kann: Die Hülle des Fensters liest und schreibt nichts. */
const fakeEngine = { readOnly: false } as unknown as SyncEngine;

type WindowProps = { engine: SyncEngine; kiKey: string; model: KiModel; page: AskPage | null; away: boolean; control: { current: AskControl | null } };

const hosts: HTMLElement[] = [];

function mount(o: { page?: AskPage | null } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const control: { current: AskControl | null } = { current: null };
  let props: WindowProps = { engine: fakeEngine, kiKey: 'sk-ant-test-0000', model: 'sonnet', page: o.page === undefined ? fakePage() : o.page, away: false, control };
  const draw = () => render(h(AskWindow, props), host);
  draw();
  return {
    host,
    control,
    /** Die App zeichnet das Fenster mit neuen Angaben. */
    set: (change: Partial<WindowProps>) =>
      act(() => {
        props = { ...props, ...change };
        draw();
      }),
  };
}

afterEach(() => {
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
});

const win = (host: HTMLElement) => host.querySelector<HTMLElement>('.frag-fenster')!;
const field = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('#frag-feld')!;
const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.frag-seite')!;
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function send(el: Element, type: string, o: { kind: Kind; t: number; size?: number; id?: number }): PointerEvent {
  const ev = new PointerEvent(type, {
    pointerId: o.id ?? 7,
    pointerType: o.kind,
    clientX: 0,
    clientY: 0,
    width: o.size ?? 1,
    height: o.size ?? 1,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'timeStamp', { value: o.t });
  el.dispatchEvent(ev);
  return ev;
}

/** Ein Tipp: aufsetzen und 40 ms später abheben. */
function tap(el: Element, kind: Kind, t: number, size?: number): void {
  send(el, 'pointerdown', { kind, t, size });
  send(el, 'pointerup', { kind, t: t + 40, size });
}

/** Das Ende einer Berührung, wie der Browser es nach dem Abheben meldet: abbrechbar, am Ort des Zeigers. */
function touchEnd(el: Element): TouchEvent {
  const ev = new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [new Touch({ identifier: 1, target: el, clientX: 0, clientY: 0 })] });
  el.dispatchEvent(ev);
  return ev;
}

/** Was der Browser aus einem Tipp macht, nachdem die Berührung geendet hat. */
function mouseAfterTouch(el: Element, type: 'mousedown' | 'click'): MouseEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, detail: 1 });
  el.dispatchEvent(ev);
  return ev;
}

const type = (host: HTMLElement, text: string) =>
  act(() => {
    field(host).value = text;
    field(host).dispatchEvent(new Event('input', { bubbles: true }));
  });

test('open shows the window and puts the focus in the field', async () => {
  const { host, control } = mount();
  expect(win(host).hidden).toBe(true);
  // Alles im selben Aufruf: Das iPad öffnet die Tastatur nur, solange der Tipp noch läuft, und das Fenster ist dann schon sichtbar.
  let shownAtFocus: boolean | null = null;
  field(host).addEventListener('focus', () => (shownAtFocus = !win(host).hidden));
  control.current!.open();
  expect(shownAtFocus).toBe(true);
  expect(document.activeElement).toBe(field(host));
  await act(() => undefined);
  expect(win(host).hidden).toBe(false);
  expect(document.activeElement).toBe(field(host));
  expect(host.querySelector(`label[for="frag-feld"]`)!.textContent).toBe('Was willst du wissen?');
  expect(host.querySelector('h2')!.textContent).toBe('Frag Claude');
  expect(host.querySelector('.frag-fehler')!.getAttribute('role')).toBe('alert');
  expect(host.querySelector('.frag-verlauf')!.children).toHaveLength(0);
});

test('the tap that opened the window does not take the focus away again', async () => {
  const { host, control } = mount();
  const knopf = document.createElement('button');
  document.body.append(knopf);
  try {
    // Der Tipp hat das Fenster geöffnet. Danach macht der Browser aus der Berührung noch die Maustaste auf dem Knopf: Sie nähme dem Feld
    // den Fokus, am iPad ginge die Tastatur gleich wieder zu.
    control.current!.open();
    expect(mouseAfterTouch(knopf, 'mousedown').defaultPrevented).toBe(true);
    // Nur die eine: Die nächste gehört zu einem neuen Zeiger.
    expect(mouseAfterTouch(knopf, 'mousedown').defaultPrevented).toBe(false);
    await act(() => undefined);
    // Setzt zuerst ein neuer Zeiger auf, geht seine Maustaste durch.
    button(host, 'Neue Frage').focus();
    await act(() => tap(button(host, 'Neue Frage'), 'pen', performance.now()));
    expect(document.activeElement).toBe(field(host));
    send(knopf, 'pointerdown', { kind: 'mouse', t: performance.now() });
    expect(mouseAfterTouch(knopf, 'mousedown').defaultPrevented).toBe(false);
  } finally {
    knopf.remove();
  }
});

test('the switch names the open page and follows it', async () => {
  const { host, set } = mount();
  expect(toggle(host).getAttribute('role')).toBe('switch');
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: Do 29.10.2026');
  expect(toggle(host).getAttribute('aria-checked')).toBe('true');
  expect(toggle(host).disabled).toBe(false);
  await set({ page: null });
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: keine Seite offen');
  expect(toggle(host).disabled).toBe(true);
  await set({ page: fakePage({ label: 'Fr 30.10.2026', day: '2026-10-30' }) });
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: Fr 30.10.2026');
  expect(toggle(host).disabled).toBe(false);
});

test('away hides the window and keeps the field', async () => {
  const { host, control, set } = mount();
  await act(() => control.current!.open());
  await type(host, 'Was steht an?');
  await set({ away: true });
  expect(win(host).hidden).toBe(true);
  await set({ away: false });
  expect(win(host).hidden).toBe(false);
  expect(field(host).value).toBe('Was steht an?');
});

test('Schließen hides and empties', async () => {
  const { host, control } = mount();
  await act(() => control.current!.open());
  expect(button(host, 'Fragen').disabled).toBe(true); // ohne Frage gibt es nichts zu fragen
  await type(host, 'Was steht an?');
  expect(button(host, 'Fragen').disabled).toBe(false);
  await act(() => tap(toggle(host), 'touch', performance.now()));
  expect(toggle(host).getAttribute('aria-checked')).toBe('false');
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now()));
  expect(win(host).hidden).toBe(true);
  expect(field(host).value).toBe('');
  expect(toggle(host).getAttribute('aria-checked')).toBe('true');
});

test('Neue Frage puts the focus back into the field and keeps it', async () => {
  const { host, control } = mount();
  await act(() => control.current!.open());
  await type(host, 'Was steht an?');
  button(host, 'Neue Frage').focus();
  await act(() => tap(button(host, 'Neue Frage'), 'mouse', performance.now()));
  expect(document.activeElement).toBe(field(host));
  expect(field(host).value).toBe('Was steht an?');
});

test('a resting hand triggers nothing', async () => {
  const page = fakePage();
  const { host, control } = mount({ page });
  await act(() => control.current!.open());

  // Der Stift schreibt auf der Seite: Ein Finger auf „Schließen“ ist die Hand.
  page.filter.penDown(performance.now());
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(false);

  // Eine große Auflage auf dem Feld: Ihr Ende und der Klick daraus gehen nicht durch, das Feld bekommt keinen Fokus.
  const t = performance.now();
  send(field(host), 'pointerdown', { kind: 'touch', t, size: 200, id: 9 });
  send(field(host), 'pointerup', { kind: 'touch', t: t + 40, size: 200, id: 9 });
  expect(touchEnd(field(host)).defaultPrevented).toBe(true);
  expect(mouseAfterTouch(field(host), 'mousedown').defaultPrevented).toBe(true);
  expect(mouseAfterTouch(field(host), 'click').defaultPrevented).toBe(true);

  // Der Stift hebt ab. 300 ms später ist ein Finger wieder ein Finger.
  page.filter.penUp(performance.now());
  await wait(300);
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(true);
});

test('a finger tap on the field goes through, a hand that lay there before the pen wrote does not', async () => {
  const page = fakePage();
  const { host, control } = mount({ page });
  await act(() => control.current!.open());

  // Ein Finger tippt aufs Feld: Der Browser darf daraus den Fokus machen.
  const t = performance.now();
  send(field(host), 'pointerdown', { kind: 'touch', t, size: 10 });
  send(field(host), 'pointerup', { kind: 'touch', t: t + 40, size: 10 });
  expect(touchEnd(field(host)).defaultPrevented).toBe(false);
  expect(mouseAfterTouch(field(host), 'click').defaultPrevented).toBe(false);

  // Die Hand liegt schon auf dem Feld, dann schreibt der Stift auf der Seite. Sie hebt erst lange nach dem Stift ab: Sie war die Hand.
  send(field(host), 'pointerdown', { kind: 'touch', t: performance.now(), size: 10, id: 8 });
  page.filter.penDown(performance.now());
  page.filter.penUp(performance.now());
  await wait(300);
  send(field(host), 'pointerup', { kind: 'touch', t: performance.now(), size: 10, id: 8 });
  expect(touchEnd(field(host)).defaultPrevented).toBe(true);
  expect(mouseAfterTouch(field(host), 'click').defaultPrevented).toBe(true);
});

test('a pen on the window holds the gate for the hand', async () => {
  const page = fakePage();
  const { host, control } = mount({ page });
  await act(() => control.current!.open());
  // Der Stift setzt im Fenster auf (Kritzeln ins Feld): Ein Finger auf „Schließen“ ist jetzt die Hand.
  const t = performance.now();
  send(field(host), 'pointerdown', { kind: 'pen', t, id: 3 });
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(false);
  // Er hebt ab, wo auch immer: Das Tor hört es.
  const up = new PointerEvent('pointerup', { pointerId: 3, pointerType: 'pen', bubbles: true, cancelable: true });
  Object.defineProperty(up, 'timeStamp', { value: performance.now() });
  document.body.dispatchEvent(up);
  await wait(300);
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(true);
});

test('Strg and the wheel over the window do not zoom the browser', () => {
  const { host } = mount();
  const zoom = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  Object.defineProperty(zoom, 'ctrlKey', { value: true }); // happy-dom übernimmt `ctrlKey` beim Rad nicht
  field(host).dispatchEvent(zoom);
  expect(zoom.defaultPrevented).toBe(true);
  const scroll = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  field(host).dispatchEvent(scroll);
  expect(scroll.defaultPrevented).toBe(false);
});
