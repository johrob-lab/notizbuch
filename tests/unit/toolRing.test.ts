import { h, render } from 'preact';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GestureFilter } from '../../src/ink/gestures';
import { DEFAULT_INK } from '../../src/lib/settings';
import { RING } from '../../src/ui/ringLayout';
import { toolActions, type ToolAction } from '../../src/ui/toolActions';
import { ToolRing } from '../../src/ui/ToolRing';

// Der Ring um das Rad im Vollbild: Ein Knopf wirkt beim Abheben, ein Finger nur, wenn ihn das Tor gegen Handballen annimmt. Daneben
// fängt ein Schutzfeld jeden Zeiger und schließt den Ring. Die Zeit der Ereignisse gibt der Test vor. happy-dom rechnet keine Größen
// aus: Die Knöpfe bekommen ihre Maße aus ihrem Stil.

type Kind = 'pen' | 'touch' | 'mouse';

const ANCHOR = { x: 400, y: 400 };
const AREA = { w: 800, h: 800 };
const HALF = RING.item / 2;

let host: HTMLDivElement;
let filter: GestureFilter;
let done: ToolAction[];
let closes: number;

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function mount(o: { canRedo?: boolean } = {}) {
  host = document.createElement('div');
  document.body.append(host);
  const actions = toolActions({
    ink: DEFAULT_INK,
    canWrite: true,
    canUndo: true,
    canRedo: o.canRedo ?? false,
    canBack: true,
    canForward: true,
    stepLabels: ['Voriger Tag', 'Nächster Tag'],
  });
  render(
    h(ToolRing, {
      anchor: ANCHOR,
      area: AREA,
      actions,
      filter,
      onAction: (a: ToolAction) => {
        done.push(a);
      },
      onClose: () => {
        closes++;
      },
    }),
    host,
  );
  for (const b of buttons()) b.getBoundingClientRect = () => rect(parseFloat(b.style.left), parseFloat(b.style.top), RING.item, RING.item);
}

const shield = () => host.querySelector<HTMLElement>('.ring-schutz');
const buttons = () => [...host.querySelectorAll<HTMLButtonElement>('.ring-knopf')];
const knopf = (label: string) => host.querySelector<HTMLButtonElement>(`.ring-knopf[aria-label="${label}"]`)!;

function centre(el: HTMLElement): { x: number; y: number } {
  return { x: parseFloat(el.style.left) + HALF, y: parseFloat(el.style.top) + HALF };
}

function send(el: Element, type: string, o: { kind: Kind; t: number; x: number; y: number; size?: number; id?: number }): PointerEvent {
  const ev = new PointerEvent(type, {
    pointerId: o.id ?? 7,
    pointerType: o.kind,
    clientX: o.x,
    clientY: o.y,
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

/** Ein Tipp in die Mitte eines Knopfs. */
function tap(label: string, kind: Kind, t: number, size?: number): void {
  const el = knopf(label);
  const at = centre(el);
  send(el, 'pointerdown', { kind, t, size, ...at });
  send(el, 'pointerup', { kind, t: t + 40, size, ...at });
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  filter = new GestureFilter();
  done = [];
  closes = 0;
});

afterEach(() => {
  render(null, host);
  host.remove();
  vi.unstubAllGlobals();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

test('the buttons sit where ringLayout puts them, with their name, state and lock', () => {
  mount();
  expect(buttons()).toHaveLength(16);
  // Der erste Knopf jedes Kreises steht genau über der Mitte.
  expect(knopf('Kugelschreiber').style.left).toBe(`${ANCHOR.x - HALF}px`);
  expect(knopf('Kugelschreiber').style.top).toBe(`${ANCHOR.y - RING.outer - HALF}px`);
  expect(knopf('Schwarz').style.top).toBe(`${ANCHOR.y - RING.inner - HALF}px`);
  expect(knopf('Kugelschreiber').getAttribute('aria-pressed')).toBe('true');
  expect(knopf('Radierer').getAttribute('aria-pressed')).toBe('false');
  expect(knopf('Rückgängig').hasAttribute('aria-pressed')).toBe(false);
  expect(knopf('Wiederholen').disabled).toBe(true);
  expect(knopf('Rückgängig').disabled).toBe(false);
});

test('a pen on a button acts when it lifts, the ring closes, and the gate hears the pen', () => {
  mount();
  const down = vi.spyOn(filter, 'penDown');
  const up = vi.spyOn(filter, 'penUp');
  const el = knopf('Rot (offen)');
  send(el, 'pointerdown', { kind: 'pen', t: 1000, ...centre(el) });
  expect(down).toHaveBeenCalledWith(1000);
  expect(done).toEqual([]);
  send(el, 'pointerup', { kind: 'pen', t: 1040, ...centre(el) });
  expect(up).toHaveBeenCalledWith(1040);
  expect(done).toEqual([{ kind: 'color', color: 'rot' }]);
  expect(closes).toBe(1);
});

test('undo keeps the ring open', () => {
  mount({ canRedo: true });
  tap('Rückgängig', 'pen', 1000);
  tap('Wiederholen', 'mouse', 2000);
  expect(done).toEqual([{ kind: 'undo' }, { kind: 'redo' }]);
  expect(closes).toBe(0);
});

test('a finger acts only when the gate takes it as a finger', () => {
  mount();
  filter.penDown(900);
  tap('Blau', 'touch', 1000); // während der Stift aufliegt
  filter.penUp(1100);
  tap('Blau', 'touch', 1200); // in der Pause danach
  const el = knopf('Blau');
  send(el, 'pointerdown', { kind: 'touch', t: 2000, ...centre(el) }); // die Hand liegt da, dann setzt der Stift auf
  filter.penDown(2010);
  send(el, 'pointerup', { kind: 'touch', t: 2040, ...centre(el) });
  filter.penUp(2100);
  tap('Blau', 'touch', 3000, 150); // ein Handballen
  expect(done).toEqual([]);
  expect(closes).toBe(0);

  tap('Blau', 'touch', 4000);
  expect(done).toEqual([{ kind: 'color', color: 'blau' }]);
  expect(closes).toBe(1);
});

test('a locked button does nothing and the ring stays', () => {
  mount();
  tap('Wiederholen', 'pen', 1000);
  tap('Wiederholen', 'touch', 2000);
  expect(done).toEqual([]);
  expect(closes).toBe(0);
});

test('a pointer that lifts away from its button does nothing', () => {
  mount();
  const el = knopf('Rot (offen)');
  const at = centre(el);
  send(el, 'pointerdown', { kind: 'pen', t: 1000, ...at });
  send(el, 'pointerup', { kind: 'pen', t: 1040, x: at.x + RING.item, y: at.y });
  expect(done).toEqual([]);
  expect(closes).toBe(0);
});

test('the keyboard acts through a click without a pointer, a click after a pointer does not act again', () => {
  mount();
  knopf('Grün (erledigt)').click(); // detail 0
  expect(done).toEqual([{ kind: 'color', color: 'gruen' }]);
  knopf('Fein (0,1 mm)').dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
  expect(done).toHaveLength(1);
});

test('a pen next to the ring closes it: the buttons go at once, the shield stays until the pen lifts', async () => {
  mount();
  const down = vi.spyOn(filter, 'penDown');
  const up = vi.spyOn(filter, 'penUp');
  const ev = send(shield()!, 'pointerdown', { kind: 'pen', t: 1000, x: 50, y: 50 });
  await settle();
  expect(ev.defaultPrevented).toBe(true);
  expect(down).toHaveBeenCalledWith(1000);
  expect(buttons()).toHaveLength(0);
  expect(shield()).not.toBeNull();
  expect(closes).toBe(0);
  send(shield()!, 'pointermove', { kind: 'pen', t: 1020, x: 60, y: 50 });
  send(shield()!, 'pointerup', { kind: 'pen', t: 1040, x: 60, y: 50 });
  expect(closes).toBe(1);
  expect(up).toHaveBeenCalledWith(1040);
  expect(done).toEqual([]);
});

test('a finger next to the ring closes it when it lifts, the hand and a finger that holds do not', async () => {
  mount();
  filter.penDown(900);
  send(shield()!, 'pointerdown', { kind: 'touch', t: 1000, x: 50, y: 50 }); // die Hand, während der Stift aufliegt
  send(shield()!, 'pointerup', { kind: 'touch', t: 1040, x: 50, y: 50 });
  filter.penUp(1100);
  send(shield()!, 'pointerdown', { kind: 'touch', t: 2000, x: 50, y: 50, size: 150 }); // ein Handballen
  send(shield()!, 'pointerup', { kind: 'touch', t: 2040, x: 50, y: 50, size: 150 });
  send(shield()!, 'pointerdown', { kind: 'touch', t: 3000, x: 50, y: 50 }); // ein Finger, der länger liegt als ein Tipp
  send(shield()!, 'pointerup', { kind: 'touch', t: 3600, x: 50, y: 50 });
  await settle();
  expect(buttons()).toHaveLength(16);
  expect(closes).toBe(0);

  const down = send(shield()!, 'pointerdown', { kind: 'touch', t: 4000, x: 50, y: 50 });
  await settle();
  expect(down.defaultPrevented).toBe(true); // nichts darunter bekommt ihn
  expect(buttons()).toHaveLength(16); // noch könnte er die Hand sein
  expect(closes).toBe(0);
  send(shield()!, 'pointerup', { kind: 'touch', t: 4040, x: 50, y: 50 });
  expect(closes).toBe(1);
});

test('the mouse next to the ring closes it at once', async () => {
  mount();
  send(shield()!, 'pointerdown', { kind: 'mouse', t: 1000, x: 50, y: 50 });
  await settle();
  expect(buttons()).toHaveLength(0);
  expect(closes).toBe(0);
  send(shield()!, 'pointerup', { kind: 'mouse', t: 1040, x: 50, y: 50 });
  expect(closes).toBe(1);
});

test('a hand resting beside the ring leaves it open, and the pen still chooses a button', async () => {
  mount();
  // Die Hand landet neben dem Ring, bevor der Stift einen Knopf erreicht.
  const hand = send(shield()!, 'pointerdown', { kind: 'touch', t: 1000, x: 50, y: 50, id: 21 });
  await settle();
  expect(hand.defaultPrevented).toBe(true); // nichts darunter bekommt sie
  expect(buttons()).toHaveLength(16);
  tap('Rückgängig', 'pen', 1200);
  expect(done).toEqual([{ kind: 'undo' }]);
  // Sie hebt erst ab, als der Stift längst gewählt hat: Sie war die Hand, der Ring bleibt offen.
  send(shield()!, 'pointerup', { kind: 'touch', t: 1600, x: 50, y: 50, id: 21 });
  await settle();
  expect(closes).toBe(0);
  expect(buttons()).toHaveLength(16);
  tap('Rot (offen)', 'pen', 2000);
  expect(done).toEqual([{ kind: 'undo' }, { kind: 'color', color: 'rot' }]);
  expect(closes).toBe(1);
});

test('the ring closes when that pointer lifts somewhere else, so the shield never stays behind', () => {
  mount();
  send(shield()!, 'pointerdown', { kind: 'pen', t: 1000, x: 50, y: 50, id: 3 });
  send(document.body, 'pointerup', { kind: 'pen', t: 1040, x: 50, y: 50, id: 4 }); // ein anderer Zeiger
  expect(closes).toBe(0);
  send(document.body, 'pointerup', { kind: 'pen', t: 1060, x: 50, y: 50, id: 3 });
  expect(closes).toBe(1);
});

test('when the closing pointer never lifts, the next pointer closes the ring at once, the hand does not', async () => {
  mount();
  send(shield()!, 'pointerdown', { kind: 'pen', t: 1000, x: 50, y: 50, id: 3 }); // sein Abheben kommt nie an (iOS beim Wechsel der App)
  await settle();
  expect(buttons()).toHaveLength(0);
  send(shield()!, 'pointerdown', { kind: 'pen', t: 1500, x: 50, y: 50, id: 3 }); // derselbe Zeiger noch einmal: Der Ring wartet auf sein Abheben
  send(shield()!, 'pointerdown', { kind: 'touch', t: 2000, x: 60, y: 60, id: 21, size: 150 }); // ein Handballen
  expect(closes).toBe(0);
  const next = send(shield()!, 'pointerdown', { kind: 'pen', t: 3000, x: 60, y: 60, id: 4 });
  expect(next.defaultPrevented).toBe(true);
  expect(closes).toBe(1);
});

test('the ring closes when the page is hidden or the window loses focus, and stops listening when it goes', async () => {
  mount();
  document.dispatchEvent(new Event('visibilitychange')); // noch sichtbar
  expect(closes).toBe(0);
  window.dispatchEvent(new Event('blur'));
  expect(closes).toBe(1);

  render(null, host);
  host.remove();
  mount();
  send(shield()!, 'pointerdown', { kind: 'pen', t: 1000, x: 50, y: 50, id: 3 }); // sein Abheben kommt nie an
  await settle();
  expect(buttons()).toHaveLength(0);
  Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(closes).toBe(2);

  render(null, host);
  window.dispatchEvent(new Event('blur'));
  document.dispatchEvent(new Event('visibilitychange'));
  expect(closes).toBe(2);
});

test('the ring closes when the stage changes size, not before', () => {
  let report: ResizeObserverCallback | null = null;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        report = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  mount();
  const size = (width: number, height: number) => report!([{ contentRect: { width, height } } as ResizeObserverEntry], {} as ResizeObserver);
  size(AREA.w, AREA.h); // die erste Meldung, so groß wie beim Öffnen
  expect(closes).toBe(0);
  size(AREA.h + 400, AREA.w); // das iPad dreht sich
  expect(closes).toBe(1);
});
