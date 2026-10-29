import { h, render } from 'preact';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GestureFilter } from '../../src/ink/gestures';
import { QuickSwitch } from '../../src/ui/QuickSwitch';
import type { Tool } from '../../src/ui/Toolbar';

// Der Schnellwechsel teilt das Tor gegen Handballen mit der Schreibfläche: Er nimmt keine Hand an, solange der Stift
// aufliegt, und der Stift auf ihm eröffnet die Pause für die Seite. Die Zeit der Ereignisse gibt der Test vor.

type Kind = 'pen' | 'touch' | 'mouse';

/** Der Knopf liegt unten rechts in einer Fläche von 800 x 600; seine Mitte ist (728, 528). */
const MIDDLE = { x: 728, y: 528 };

let host: HTMLDivElement;
let button: HTMLButtonElement;
let filter: GestureFilter;
let toggles: number;
let moves: [number, number][];

function rect(left: number, top: number, width: number, height: number): DOMRect {
  return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
}

function mount(tool: Tool = 'pen') {
  host = document.createElement('div');
  document.body.append(host);
  render(
    h(QuickSwitch, {
      tool,
      filter,
      onToggle: () => {
        toggles++;
      },
      onMove: (pos) => {
        moves.push(pos);
      },
    }),
    host,
  );
  button = host.querySelector('button')!;
  // happy-dom rechnet keine Größen aus: Fläche und Knopf bekommen feste Maße.
  host.getBoundingClientRect = () => rect(0, 0, 800, 600);
  button.getBoundingClientRect = () => rect(700, 500, 56, 56);
  Object.defineProperty(button, 'offsetParent', { get: () => host, configurable: true });
}

function send(type: string, o: { kind: Kind; t: number; x?: number; y?: number; size?: number; id?: number }): void {
  const ev = new PointerEvent(type, {
    pointerId: o.id ?? 7,
    pointerType: o.kind,
    clientX: o.x ?? MIDDLE.x,
    clientY: o.y ?? MIDDLE.y,
    width: o.size ?? 1,
    height: o.size ?? 1,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'timeStamp', { value: o.t });
  button.dispatchEvent(ev);
}

/** Ein Finger setzt auf der Mitte auf, zieht um (dx, dy) und hebt ab (oder wird abgebrochen). */
function drag(t: number, dx: number, dy: number, o: { size?: number; end?: 'pointerup' | 'pointercancel' } = {}): void {
  const kind = { kind: 'touch' as const, size: o.size };
  send('pointerdown', { ...kind, t });
  send('pointermove', { ...kind, t: t + 10, x: MIDDLE.x + dx / 2, y: MIDDLE.y + dy / 2 });
  send('pointermove', { ...kind, t: t + 20, x: MIDDLE.x + dx, y: MIDDLE.y + dy });
  send(o.end ?? 'pointerup', { ...kind, t: t + 30, x: MIDDLE.x + dx, y: MIDDLE.y + dy });
}

/** Wo der Knopf laut seinem Stil liegt, als Anteile der freien Fläche. */
function place(): [number, number] {
  const part = (css: string) => Number(/\+ ([\d.]+) \*/.exec(css)![1]);
  return [part(button.style.left), part(button.style.top)];
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  filter = new GestureFilter();
  toggles = 0;
  moves = [];
});

afterEach(() => {
  render(null, host);
  host.remove();
});

test('a tap with the pen toggles, and the gate hears the pen go down and up', () => {
  mount();
  const down = vi.spyOn(filter, 'penDown');
  const up = vi.spyOn(filter, 'penUp');
  send('pointerdown', { kind: 'pen', t: 1000 });
  expect(down).toHaveBeenCalledWith(1000);
  expect(toggles).toBe(0);
  send('pointerup', { kind: 'pen', t: 1040 });
  expect(up).toHaveBeenCalledWith(1040);
  expect(toggles).toBe(1);
});

test('a pen that is taken away by the system does not toggle, but the gate hears that it is up', () => {
  mount();
  const up = vi.spyOn(filter, 'penUp');
  send('pointerdown', { kind: 'pen', t: 1000 });
  send('pointercancel', { kind: 'pen', t: 1040 });
  expect(toggles).toBe(0);
  expect(up).toHaveBeenCalledWith(1040);
});

test('right after the pen was on the button, a hand on the page is held off for the pause', () => {
  mount();
  send('pointerdown', { kind: 'pen', t: 1000 });
  send('pointerup', { kind: 'pen', t: 1040 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1100)).toBe(false);
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1300)).toBe(true);
});

test('a finger moves the button and reports the new place when it lets go', async () => {
  mount();
  drag(1000, -300, -200);
  await settle();
  expect(moves).toHaveLength(1);
  const [fx, fy] = moves[0];
  expect(fx).toBeCloseTo((MIDDLE.x - 300 - 28 - 16) / 712, 5);
  expect(fy).toBeCloseTo((MIDDLE.y - 200 - 28 - 16) / 512, 5);
  expect(toggles).toBe(0);
});

test('a finger follows along while it is down', async () => {
  mount();
  const rest = place();
  send('pointerdown', { kind: 'touch', t: 1000 });
  send('pointermove', { kind: 'touch', t: 1010, x: MIDDLE.x - 200, y: MIDDLE.y - 100 });
  await settle();
  expect(place()[0]).toBeLessThan(rest[0]);
  expect(place()[1]).toBeLessThan(rest[1]);
  expect(moves).toEqual([]);
});

test('a finger tap does nothing', async () => {
  mount();
  send('pointerdown', { kind: 'touch', t: 1000 });
  send('pointerup', { kind: 'touch', t: 1040 });
  await settle();
  expect(toggles).toBe(0);
  expect(moves).toEqual([]);
});

test('a finger is ignored while the pen is down', async () => {
  mount();
  const rest = button.style.left;
  filter.penDown(900); // der Stift liegt irgendwo auf der Seite
  drag(1000, -300, -200);
  await settle();
  expect(moves).toEqual([]);
  expect(button.style.left).toBe(rest);
});

test('a finger is ignored for the pause after the pen, and accepted after it', async () => {
  mount();
  filter.penDown(900);
  filter.penUp(1000);
  drag(1100, -300, -200); // 100 ms nach dem Stift
  await settle();
  expect(moves).toEqual([]);

  drag(1400, -300, -200);
  await settle();
  expect(moves).toHaveLength(1);
});

test('a hand that landed while the pen was down or in the pause stays rejected, even when it only moves later', async () => {
  mount();
  const rest = place();
  const later = { x: MIDDLE.x - 200, y: MIDDLE.y - 100 };

  filter.penDown(900);
  send('pointerdown', { kind: 'touch', t: 1000 }); // der Handballen liegt auf dem Knopf, während geschrieben wird
  filter.penUp(1100);
  send('pointermove', { kind: 'touch', t: 1500, ...later }); // erst lange nach der Pause bewegt er sich
  send('pointerup', { kind: 'touch', t: 1510, ...later });
  await settle();
  expect(place()).toEqual(rest);
  expect(moves).toEqual([]);

  filter.penDown(2000);
  filter.penUp(2100);
  send('pointerdown', { kind: 'touch', t: 2200 }); // 100 ms nach dem Stift
  send('pointermove', { kind: 'touch', t: 2600, ...later }); // die Pause ist vorbei
  send('pointerup', { kind: 'touch', t: 2610, ...later });
  await settle();
  expect(place()).toEqual(rest);
  expect(moves).toEqual([]);
});

test('a wide contact is a palm and is ignored, a contact of 120 is still a finger', async () => {
  mount();
  const rest = button.style.left;
  drag(1000, -300, -200, { size: 150 });
  await settle();
  expect(moves).toEqual([]);
  expect(button.style.left).toBe(rest);

  drag(2000, -300, -200, { size: 120 });
  await settle();
  expect(moves).toHaveLength(1);
});

test('a finger drag that the system cancels puts the button back and tells nobody', async () => {
  mount();
  const rest = place();
  send('pointerdown', { kind: 'touch', t: 1000 });
  send('pointermove', { kind: 'touch', t: 1010, x: MIDDLE.x - 200, y: MIDDLE.y - 100 });
  await settle();
  expect(place()).not.toEqual(rest);
  send('pointercancel', { kind: 'touch', t: 1020, x: MIDDLE.x - 200, y: MIDDLE.y - 100 });
  await settle();
  expect(place()).toEqual(rest);
  expect(moves).toEqual([]);
});

test('when the pen comes down in the middle of a finger drag, the drag was the hand and is taken back', async () => {
  mount();
  const rest = place();
  send('pointerdown', { kind: 'touch', t: 1000 });
  send('pointermove', { kind: 'touch', t: 1010, x: MIDDLE.x - 100, y: MIDDLE.y - 100 });
  await settle();
  expect(place()).not.toEqual(rest);

  filter.penDown(1020); // der Stift setzt auf der Seite auf
  send('pointermove', { kind: 'touch', t: 1030, x: MIDDLE.x - 300, y: MIDDLE.y - 200 });
  await settle();
  expect(place()).toEqual(rest);
  send('pointerup', { kind: 'touch', t: 1040, x: MIDDLE.x - 300, y: MIDDLE.y - 200 });
  await settle();
  expect(place()).toEqual(rest);
  expect(moves).toEqual([]);
});

test('a mouse does nothing', async () => {
  mount();
  const rest = place();
  send('pointerdown', { kind: 'mouse', t: 1000 });
  send('pointermove', { kind: 'mouse', t: 1010, x: MIDDLE.x - 200, y: MIDDLE.y - 100 });
  send('pointerup', { kind: 'mouse', t: 1020, x: MIDDLE.x - 200, y: MIDDLE.y - 100 });
  await settle();
  expect(place()).toEqual(rest);
  expect(toggles).toBe(0);
  expect(moves).toEqual([]);
});

test('the keyboard toggles through a click without a pointer, a click that follows a pointer does not', () => {
  mount();
  button.click(); // detail 0
  expect(toggles).toBe(1);
  button.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
  expect(toggles).toBe(1);
});

test('it shows the tool that is in use', () => {
  mount('eraser');
  expect(button.dataset.tool).toBe('eraser');
});
