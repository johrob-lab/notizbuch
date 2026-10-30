import { expect, test } from 'vitest';
import { clampView, GestureFilter, gestureView, isFingerTap, isTwoFingerTap, zoomAround, type View } from '../../src/ink/gestures';

type Ev = Parameters<typeof isTwoFingerTap>[0][number];

// Kurzschreibweise für die Ereignisse eines Fingers: d = aufgesetzt, m = bewegt, u = abgehoben.
const d = (id: number, t: number, x = 100, y = 100): Ev => ({ id, type: 'down', x, y, t });
const u = (id: number, t: number, x = 100, y = 100): Ev => ({ id, type: 'up', x, y, t });
const m = (id: number, t: number, o: { dx?: number; dy?: number } = {}): Ev => ({
  id,
  type: 'move',
  x: 100 + (o.dx ?? 0),
  y: 100 + (o.dy ?? 0),
  t,
});

// ---------- Tests aus dem Brief ----------

test('palm rejection', () => {
  const g = new GestureFilter();
  g.penDown(1000);
  expect(g.acceptTouch({}, 1100)).toBe(false);
  g.penUp(2000);
  expect(g.acceptTouch({}, 2200)).toBe(false);
  expect(g.acceptTouch({}, 2300)).toBe(true);
  expect(g.acceptTouch({ width: 150, height: 40 }, 9000)).toBe(false);
});

test('two finger tap', () => {
  expect(isTwoFingerTap([d(1, 0), d(2, 50), u(1, 200), u(2, 220)])).toBe(true);
  expect(isTwoFingerTap([d(1, 0), d(2, 50), m(1, 100, { dx: 30 }), u(1, 200), u(2, 220)])).toBe(false);
  expect(isTwoFingerTap([d(1, 0), d(2, 50), u(1, 400), u(2, 420)])).toBe(false);
});

// ---------- Handballen ----------

test('touch is accepted when no pen was ever used', () => {
  // Beim Start der App gibt es noch kein Stiftende: Das darf keinen Finger aussperren.
  expect(new GestureFilter().acceptTouch({}, 0)).toBe(true);
  expect(new GestureFilter().acceptTouch({ width: 20, height: 20 }, 5)).toBe(true);
});

test('touch is ignored for 250 ms after the pen, not longer', () => {
  const g = new GestureFilter();
  g.penDown(1000);
  g.penUp(2000);
  expect(g.acceptTouch({}, 2249)).toBe(false);
  expect(g.acceptTouch({}, 2250)).toBe(true);
});

test('touch is ignored while the pen is down, however long that takes', () => {
  const g = new GestureFilter();
  g.penDown(0);
  expect(g.acceptTouch({}, 60_000)).toBe(false);
  g.penUp(60_001);
  expect(g.acceptTouch({}, 60_100)).toBe(false);
  expect(g.acceptTouch({}, 60_400)).toBe(true);
});

test('a contact area over 120 px is a palm, 120 px is still a finger', () => {
  const g = new GestureFilter();
  expect(g.acceptTouch({ width: 120, height: 120 }, 10)).toBe(true);
  expect(g.acceptTouch({ width: 121, height: 10 }, 10)).toBe(false);
  expect(g.acceptTouch({ width: 10, height: 121 }, 10)).toBe(false);
});

// ---------- Zwei-Finger-Tipp ----------

test('two finger tap needs the second finger within 150 ms', () => {
  expect(isTwoFingerTap([d(1, 0), d(2, 150), u(1, 200), u(2, 220)])).toBe(true);
  expect(isTwoFingerTap([d(1, 0), d(2, 151), u(1, 200), u(2, 220)])).toBe(false);
});

test('two finger tap needs both fingers up within 300 ms of the first touch', () => {
  expect(isTwoFingerTap([d(1, 0), d(2, 50), u(1, 250), u(2, 300)])).toBe(true);
  expect(isTwoFingerTap([d(1, 0), d(2, 50), u(1, 250), u(2, 301)])).toBe(false);
});

test('two finger tap allows less than 10 px of movement for each finger', () => {
  expect(isTwoFingerTap([d(1, 0), d(2, 50), m(2, 100, { dx: 6, dy: 6 }), u(1, 200), u(2, 220)])).toBe(true);
  expect(isTwoFingerTap([d(1, 0), d(2, 50), m(2, 100, { dx: 8, dy: 8 }), u(1, 200), u(2, 220)])).toBe(false);
});

test('two finger tap counts the place where the finger lifts, too', () => {
  expect(isTwoFingerTap([d(1, 0), d(2, 50), u(1, 200, 140, 100), u(2, 220)])).toBe(false);
});

test('two finger tap with a finger that moved and came back is no tap', () => {
  // Wer auf dem Weg weit weg war, hat geschoben, auch wenn der Finger am Ende wieder dort liegt.
  expect(isTwoFingerTap([d(1, 0), d(2, 50), m(1, 100, { dx: 40 }), m(1, 150), u(1, 200), u(2, 220)])).toBe(false);
});

test('one finger, three fingers and unfinished touches are no two finger tap', () => {
  expect(isTwoFingerTap([])).toBe(false);
  expect(isTwoFingerTap([d(1, 0), u(1, 100)])).toBe(false);
  expect(isTwoFingerTap([d(1, 0), d(2, 20), d(3, 40), u(1, 100), u(2, 110), u(3, 120)])).toBe(false);
  expect(isTwoFingerTap([d(1, 0), d(2, 50), u(1, 200)])).toBe(false);
});

test('two quick taps one after the other are no two finger tap', () => {
  // Die Finger lagen nie gleichzeitig auf: Das sind zwei Einzeltipps.
  expect(isTwoFingerTap([d(1, 0), u(1, 50), d(2, 100), u(2, 120)])).toBe(false);
});

test('two finger tap is not fooled by an up without a down', () => {
  expect(isTwoFingerTap([u(1, 10), u(2, 20)])).toBe(false);
  expect(isTwoFingerTap([d(1, 0), u(1, 100), u(2, 120)])).toBe(false);
});

// ---------- Tipp mit einem Finger oder der Maus ----------

test('one finger tap: one pointer, down and up close in place and time', () => {
  expect(isFingerTap([d(1, 0), u(1, 120)])).toBe(true);
  expect(isFingerTap([d(1, 0), m(1, 50, { dx: 3, dy: -4 }), u(1, 150, 105, 100)])).toBe(true);
  // die Maus hat dieselbe Form, nur eine andere id
  expect(isFingerTap([d(7, 0, 400, 300), u(7, 80, 400, 300)])).toBe(true);
});

test('a tap may take up to 500 ms, a press that takes longer is no tap', () => {
  expect(isFingerTap([d(1, 1000), u(1, 1500)])).toBe(true);
  expect(isFingerTap([d(1, 1000), u(1, 1501)])).toBe(false);
});

test('a finger that moves 10 px or more is panning, not tapping, even if it comes back', () => {
  expect(isFingerTap([d(1, 0), m(1, 50, { dx: 9, dy: 0 }), u(1, 100, 109, 100)])).toBe(true);
  expect(isFingerTap([d(1, 0), m(1, 50, { dx: 10 }), u(1, 100)])).toBe(false);
  expect(isFingerTap([d(1, 0), m(1, 50, { dy: -12 }), m(1, 80), u(1, 100)])).toBe(false);
  // der Ort beim Abheben zählt auch
  expect(isFingerTap([d(1, 0), u(1, 100, 100, 110)])).toBe(false);
});

test('two pointers are no one finger tap, neither together nor one after the other', () => {
  expect(isFingerTap([d(1, 0), d(2, 20), u(1, 100), u(2, 110)])).toBe(false);
  expect(isFingerTap([d(1, 0), u(1, 50), d(2, 100), u(2, 150)])).toBe(false);
  expect(isFingerTap([d(1, 0), d(2, 20), u(2, 100), u(1, 110)])).toBe(false);
});

test('unfinished or odd sequences are no tap', () => {
  expect(isFingerTap([])).toBe(false);
  expect(isFingerTap([d(1, 0)])).toBe(false);
  expect(isFingerTap([d(1, 0), m(1, 30)])).toBe(false);
  expect(isFingerTap([u(1, 10)])).toBe(false);
  expect(isFingerTap([m(1, 10), u(1, 20)])).toBe(false);
  expect(isFingerTap([d(1, 0), u(1, 50), u(1, 60)])).toBe(false);
  expect(isFingerTap([d(1, 0), d(1, 10), u(1, 50)])).toBe(false);
  expect(isFingerTap([d(1, 0), u(1, 50), m(1, 60)])).toBe(false);
});

// ---------- Verschieben und Zoomen ----------

const V: View = { s: 1, x: 100, y: 50 };
const LIMITS = { min: 0.3, max: 10 };
const at = (x: number, y: number) => ({ x, y });

test('one finger pans by the way it moved, but only after 10 px', () => {
  expect(gestureView(V, [at(200, 200)], [at(205, 205)], LIMITS, false)).toBeNull();
  expect(gestureView(V, [at(200, 200)], [at(250, 180)], LIMITS, false)).toEqual({ s: 1, x: 150, y: 30 });
  // Ist die Geste einmal im Gang, gibt es keine tote Zone mehr.
  expect(gestureView(V, [at(200, 200)], [at(202, 201)], LIMITS, true)).toEqual({ s: 1, x: 102, y: 51 });
});

test('two fingers zoom around the point between them', () => {
  const v = gestureView(V, [at(300, 400), at(500, 400)], [at(200, 400), at(600, 400)], LIMITS, false)!;
  expect(v.s).toBeCloseTo(2);
  // Die Stelle der Seite, die zwischen den Fingern lag, liegt dort noch.
  const page = { x: (400 - V.x) / V.s, y: (400 - V.y) / V.s };
  expect(page.x * v.s + v.x).toBeCloseTo(400);
  expect(page.y * v.s + v.y).toBeCloseTo(400);
});

test('two fingers moving together pan without zooming', () => {
  const v = gestureView(V, [at(300, 400), at(500, 400)], [at(350, 430), at(550, 430)], LIMITS, false)!;
  expect(v.s).toBeCloseTo(1);
  expect(v.x).toBeCloseTo(150);
  expect(v.y).toBeCloseTo(80);
});

test('two fingers that hardly moved leave the view alone', () => {
  expect(gestureView(V, [at(300, 400), at(500, 400)], [at(304, 402), at(497, 401)], LIMITS, false)).toBeNull();
  // Auch ein Abstand, der sich um 10 px ändert, ist eine Bewegung.
  expect(gestureView(V, [at(300, 400), at(500, 400)], [at(300, 400), at(510, 400)], LIMITS, false)).not.toBeNull();
});

test('a third finger does not count', () => {
  const two = gestureView(V, [at(300, 400), at(500, 400)], [at(200, 400), at(600, 400)], LIMITS, false);
  const three = gestureView(V, [at(300, 400), at(500, 400), at(10, 10)], [at(200, 400), at(600, 400), at(900, 900)], LIMITS, false);
  expect(three).toEqual(two);
});

test('zoom stays within the limits', () => {
  const far = gestureView(V, [at(400, 400), at(401, 400)], [at(0, 400), at(800, 400)], LIMITS, true)!;
  expect(far.s).toBe(10);
  const close = gestureView(V, [at(0, 400), at(800, 400)], [at(400, 400), at(401, 400)], LIMITS, true)!;
  expect(close.s).toBe(0.3);
});

test('zoomAround keeps the page point under the cursor', () => {
  const v = zoomAround(V, at(300, 200), 2, LIMITS);
  expect(v.s).toBe(2);
  expect(((300 - v.x) / v.s)).toBeCloseTo((300 - V.x) / V.s);
  expect(((200 - v.y) / v.s)).toBeCloseTo((200 - V.y) / V.s);
  expect(zoomAround(V, at(300, 200), 1000, LIMITS).s).toBe(10);
});

test('clampView keeps 60 px of the page on the screen', () => {
  const size = { w: 1000, h: 800 };
  const page = { w: 1192, h: 1590 };
  expect(clampView({ s: 1, x: -5000, y: -5000 }, size, page)).toEqual({ s: 1, x: 60 - 1192, y: 60 - 1590 });
  expect(clampView({ s: 1, x: 5000, y: 5000 }, size, page)).toEqual({ s: 1, x: 940, y: 740 });
  expect(clampView({ s: 0.5, x: 10, y: 20 }, size, page)).toEqual({ s: 0.5, x: 10, y: 20 });
});
