import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { GestureFilter } from '../../src/ink/gestures';
import { watchCards, type Origin, type PageHand } from '../../src/ui/cardGestures';

// Die Karten liegen über der Schreibfläche und fangen Berührungen ab. Was ein Finger auf einer Karte tut, entscheidet
// `watchCards`: Die Seite bekommt jeden Finger, den die Karte nicht selbst braucht. Hier prüfen wir die Entscheidung mit
// einer künstlichen Fläche; der echte Weg durch den Browser (Zeigerfang, `touch-action`) ist in tests/e2e/tag.spec.ts.

type Kind = 'touch' | 'pen' | 'mouse';

let stage: HTMLElement;
let host: HTMLElement;
let frame: HTMLElement;
let scroller: HTMLElement;
let header: HTMLElement;
let control: HTMLButtonElement;
let filter: GestureFilter;
let handed: { id: number; from: Origin; at: { x: number; y: number } }[];
/** Die Finger, die die künstliche Fläche gerade hat (angenommene und solche, die schon auf dem Papier lagen). */
let live: Set<number>;
let accept: boolean;
let stop: () => void;
let clicks: number;

/** Der Rahmen mit einer Karte: oben ein Streifen, der nicht scrollt, darunter eine Liste, die scrollen kann (500 hoch in 200). */
function build() {
  stage = document.createElement('div');
  host = document.createElement('div');
  frame = document.createElement('div');
  const card = document.createElement('section');
  header = document.createElement('h3');
  scroller = document.createElement('div');
  control = document.createElement('button');
  scroller.style.overflowY = 'auto';
  Object.defineProperty(scroller, 'scrollHeight', { value: 500, configurable: true });
  Object.defineProperty(scroller, 'clientHeight', { value: 200, configurable: true });
  scroller.scrollTop = 0;
  scroller.append(control);
  card.append(header, scroller);
  frame.append(card);
  stage.append(host, frame);
  document.body.append(stage);
  clicks = 0;
  control.addEventListener('click', () => clicks++);
}

function send(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  o: { id?: number; kind?: Kind; t: number; x: number; y: number; size?: number },
): PointerEvent {
  const ev = new PointerEvent(type, {
    pointerId: o.id ?? 1,
    pointerType: o.kind ?? 'touch',
    clientX: o.x,
    clientY: o.y,
    width: o.size ?? 1,
    height: o.size ?? 1,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'timeStamp', { value: o.t });
  target.dispatchEvent(ev);
  return ev;
}

function click(target: Element, t: number, x: number, y: number): MouseEvent {
  const ev = new MouseEvent('click', { clientX: x, clientY: y, bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'timeStamp', { value: t });
  target.dispatchEvent(ev);
  return ev;
}

function touchMove(target: Element): Event {
  const ev = new Event('touchmove', { bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

beforeEach(() => {
  build();
  filter = new GestureFilter();
  handed = [];
  live = new Set();
  accept = true;
  const surface: PageHand = {
    get fingersDown() {
      return live.size > 0;
    },
    adopt(e, from) {
      if (!accept) return false;
      live.add(e.pointerId);
      handed.push({ id: e.pointerId, from: { ...from }, at: { x: e.clientX, y: e.clientY } });
      return true;
    },
  };
  // Wie die echte Fläche: Ein Finger, den sie hat, geht mit seinem Ende wieder.
  for (const type of ['pointerup', 'pointercancel']) stage.addEventListener(type, (e) => live.delete((e as PointerEvent).pointerId));
  stop = watchCards({ stage, host, frame, surface: () => surface, filter });
});

afterEach(() => {
  stop();
  stage.remove();
});

// ---------- Welcher Finger gehört der Seite ----------

test('a finger on a card that does not move stays with the card, so a tap still ticks', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(control, 'pointermove', { t: 1010, x: 103, y: 102 });
  send(control, 'pointerup', { t: 1050, x: 103, y: 102 });
  expect(handed).toEqual([]);
});

test('a second finger on a card hands both to the page, the first with the place and time where it landed', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(control, 'pointermove', { id: 1, t: 1010, x: 103, y: 101 });
  expect(handed).toEqual([]);
  send(header, 'pointerdown', { id: 2, t: 1050, x: 160, y: 40 });
  expect(handed).toEqual([
    { id: 1, from: { clientX: 100, clientY: 100, timeStamp: 1000 }, at: { x: 103, y: 101 } },
    { id: 2, from: { clientX: 160, clientY: 40, timeStamp: 1050 }, at: { x: 160, y: 40 } },
  ]);
});

test('a finger that lands on the paper while one lies on a card takes the card finger along', () => {
  send(header, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(host, 'pointerdown', { id: 2, t: 1040, x: 400, y: 600 });
  expect(handed.map((h) => h.id)).toEqual([1]);
  expect(handed[0].from).toEqual({ clientX: 100, clientY: 100, timeStamp: 1000 });
});

test('a finger on the paper alone is none of the cards business', () => {
  send(host, 'pointerdown', { id: 1, t: 1000, x: 400, y: 600 });
  send(host, 'pointermove', { id: 1, t: 1010, x: 440, y: 640 });
  expect(handed).toEqual([]);
});

test('a finger on a card while the page already has a finger belongs to the page at once', () => {
  live.add(99); // ein Finger liegt auf dem Papier
  send(header, 'pointerdown', { id: 2, t: 1000, x: 100, y: 100 });
  expect(handed.map((h) => h.id)).toEqual([2]);
});

test('a drag sideways is handed over once it passes the tap distance, not before', () => {
  send(header, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(header, 'pointermove', { t: 1010, x: 109, y: 100 });
  expect(handed).toEqual([]);
  send(header, 'pointermove', { t: 1020, x: 112, y: 101 });
  expect(handed).toHaveLength(1);
  expect(handed[0].from).toEqual({ clientX: 100, clientY: 100, timeStamp: 1000 });
  expect(handed[0].at).toEqual({ x: 112, y: 101 });
});

test('a drag up and down on something that does not scroll goes to the page', () => {
  send(header, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(header, 'pointermove', { t: 1010, x: 101, y: 60 });
  expect(handed).toHaveLength(1);
});

test('a drag up and down in a list that can scroll that way stays with the list', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(control, 'pointermove', { t: 1010, x: 101, y: 60 }); // der Finger geht nach oben: Die Liste scrollt nach unten, das kann sie
  send(control, 'pointermove', { t: 1020, x: 101, y: 20 });
  expect(handed).toEqual([]);
});

test('a drag in a list that is at its end in that direction goes to the page', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(control, 'pointermove', { t: 1010, x: 101, y: 140 }); // nach unten: Die Liste müsste nach oben scrollen, steht aber schon oben
  expect(handed).toHaveLength(1);

  send(control, 'pointerup', { t: 1020, x: 101, y: 140 });
  scroller.scrollTop = 300; // ganz unten
  send(control, 'pointerdown', { id: 2, t: 2000, x: 100, y: 100 });
  send(control, 'pointermove', { id: 2, t: 2010, x: 101, y: 60 }); // nach oben: Die Liste müsste weiter nach unten, am Ende geht das nicht
  expect(handed.map((h) => h.id)).toEqual([1, 2]);
});

test('a drag sideways in a list that can scroll goes to the page', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(control, 'pointermove', { t: 1010, x: 140, y: 110 });
  expect(handed).toHaveLength(1);
});

test('a finger that stays with the list is not handed over later, however far it goes', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(control, 'pointermove', { t: 1010, x: 101, y: 60 });
  send(control, 'pointermove', { t: 1020, x: 300, y: 61 });
  expect(handed).toEqual([]);
});

test('a finger the page does not take is not offered again', () => {
  const adopt = vi.fn(() => false);
  stop();
  stop = watchCards({ stage, host, frame, surface: () => ({ fingersDown: false, adopt }), filter });
  send(header, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(header, 'pointermove', { t: 1010, x: 140, y: 100 });
  send(header, 'pointermove', { t: 1020, x: 180, y: 100 });
  expect(adopt).toHaveBeenCalledTimes(1);
});

test('a finger that lifted is forgotten: the next one starts fresh', () => {
  send(header, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(header, 'pointerup', { id: 1, t: 1040, x: 100, y: 100 });
  send(header, 'pointerdown', { id: 2, t: 2000, x: 300, y: 100 });
  expect(handed).toEqual([]);
});

test('without a surface nothing is handed over and nothing breaks', () => {
  stop();
  stop = watchCards({ stage, host, frame, surface: () => null, filter });
  send(header, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(header, 'pointerdown', { id: 2, t: 1010, x: 200, y: 100 });
  send(header, 'pointermove', { id: 1, t: 1020, x: 140, y: 100 });
  expect(handed).toEqual([]);
});

// ---------- Das Verhalten des Browsers ----------

test('the browser may not scroll while the page owns a finger, and may when the card scrolls', () => {
  send(header, 'pointerdown', { t: 1000, x: 100, y: 100 });
  expect(touchMove(header).defaultPrevented).toBe(false); // noch gehört der Finger niemandem
  send(header, 'pointermove', { t: 1010, x: 140, y: 100 });
  expect(touchMove(header).defaultPrevented).toBe(true);

  send(header, 'pointerup', { t: 1020, x: 140, y: 100 });
  send(control, 'pointerdown', { id: 2, t: 2000, x: 100, y: 100 });
  send(control, 'pointermove', { id: 2, t: 2010, x: 101, y: 60 });
  expect(touchMove(control).defaultPrevented).toBe(false); // die Liste scrollt selbst
});

test('a touch move that can not be cancelled is left alone', () => {
  send(header, 'pointerdown', { t: 1000, x: 100, y: 100 });
  send(header, 'pointermove', { t: 1010, x: 140, y: 100 });
  const ev = new Event('touchmove', { bubbles: true, cancelable: false });
  header.dispatchEvent(ev);
  expect(ev.defaultPrevented).toBe(false);
});

// ---------- Handballen und Stift ----------

test('a palm on a card is not handed over, and the click it makes is dropped', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100, size: 150 });
  send(control, 'pointermove', { t: 1010, x: 160, y: 100, size: 150 });
  send(control, 'pointerup', { t: 1050, x: 160, y: 100, size: 150 });
  expect(handed).toEqual([]);
  const ev = click(control, 1055, 160, 100);
  expect(ev.defaultPrevented).toBe(true);
  expect(clicks).toBe(0);
});

test('a finger that taps right after a palm is not held off, and its click goes through', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100, size: 150 });
  send(control, 'pointerup', { id: 1, t: 1050, x: 100, y: 100, size: 150 });
  send(control, 'pointerdown', { id: 2, t: 1200, x: 100, y: 100 });
  send(control, 'pointerup', { id: 2, t: 1240, x: 100, y: 100 });
  click(control, 1245, 100, 100);
  expect(clicks).toBe(1);
});

test('the click of a palm is only dropped for a moment and only where the palm was', () => {
  send(control, 'pointerdown', { t: 1000, x: 100, y: 100, size: 150 });
  send(control, 'pointerup', { t: 1050, x: 100, y: 100, size: 150 });
  click(control, 1100, 400, 400); // ein Klick weit weg bleibt
  click(control, 1110, 0, 0); // ein Klick von der Tastatur (er hat keinen Ort) auch
  expect(clicks).toBe(2);
  click(control, 3000, 100, 100); // und später gilt der Handballen nicht mehr
  expect(clicks).toBe(3);
});

test('a touch while the pen lies on the page is a palm', () => {
  filter.penDown(1000); // der Stift schreibt auf dem Papier
  send(control, 'pointerdown', { t: 1010, x: 100, y: 100 });
  send(control, 'pointerup', { t: 1050, x: 100, y: 100 });
  click(control, 1055, 100, 100);
  expect(clicks).toBe(0);
});

test('the pen on a card closes the gate for hands while it lies there and for the pause after it', () => {
  send(control, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 100, y: 100 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1010)).toBe(false);
  send(control, 'pointerup', { id: 7, kind: 'pen', t: 1040, x: 100, y: 100 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1200)).toBe(false);
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1300)).toBe(true);
});

test('a pen that is taken away by the system opens the gate again', () => {
  send(control, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 100, y: 100 });
  send(control, 'pointercancel', { id: 7, kind: 'pen', t: 1040, x: 100, y: 100 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1300)).toBe(true);
});

test('fingers that lay on a card before the pen came down were the hand, they do not move the page afterwards', () => {
  send(header, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(host, 'pointerdown', { id: 7, kind: 'pen', t: 1100, x: 400, y: 600 });
  send(host, 'pointerup', { id: 7, kind: 'pen', t: 1140, x: 400, y: 600 });
  send(header, 'pointermove', { id: 1, t: 2000, x: 160, y: 100 });
  expect(handed).toEqual([]);
});

test('a finger that lay on a card before the pen came down on the paper is a palm when it lifts: the click it makes is dropped', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(host, 'pointerdown', { id: 7, kind: 'pen', t: 1100, x: 400, y: 600 });
  send(control, 'pointerup', { id: 1, t: 1150, x: 100, y: 100 }); // der Finger hebt ab, solange der Stift aufliegt
  const ev = click(control, 1155, 100, 100);
  expect(ev.defaultPrevented).toBe(true);
  expect(clicks).toBe(0);
});

test('the same when the pen came down on a card, and when the finger lifts only after the pen is gone', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(header, 'pointerdown', { id: 7, kind: 'pen', t: 1100, x: 160, y: 40 });
  send(header, 'pointerup', { id: 7, kind: 'pen', t: 1140, x: 160, y: 40 });
  send(control, 'pointerup', { id: 1, t: 1500, x: 100, y: 100 });
  click(control, 1505, 100, 100);
  expect(clicks).toBe(0);
});

test('a finger that lifted before the pen came down made its click already, and later fingers tap as usual', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(control, 'pointerup', { id: 1, t: 1040, x: 100, y: 100 });
  click(control, 1045, 100, 100);
  expect(clicks).toBe(1);
  send(host, 'pointerdown', { id: 7, kind: 'pen', t: 1100, x: 400, y: 600 });
  send(host, 'pointerup', { id: 7, kind: 'pen', t: 1140, x: 400, y: 600 });
  send(control, 'pointerdown', { id: 2, t: 1600, x: 100, y: 100 });
  send(control, 'pointerup', { id: 2, t: 1640, x: 100, y: 100 });
  click(control, 1645, 100, 100);
  expect(clicks).toBe(2);
});

test('a palm that lay under the pen does not spoil the tap of the next finger', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(host, 'pointerdown', { id: 7, kind: 'pen', t: 1100, x: 400, y: 600 });
  send(host, 'pointerup', { id: 7, kind: 'pen', t: 1140, x: 400, y: 600 });
  send(control, 'pointerup', { id: 1, t: 1200, x: 100, y: 100 });
  click(control, 1205, 100, 100); // verworfen
  send(control, 'pointerdown', { id: 2, t: 1700, x: 100, y: 100 });
  send(control, 'pointerup', { id: 2, t: 1740, x: 100, y: 100 });
  click(control, 1745, 100, 100);
  expect(clicks).toBe(1);
});

// ---------- Der Stift hebt ab, wo auch immer ----------

/** Etwas außerhalb der Bühne, wie die Leiste oben. */
function outside(): HTMLElement {
  const bar = document.createElement('header');
  document.body.append(bar);
  return bar;
}

test('a pen that went down on a card and is lifted outside the stage opens the gate again', () => {
  const bar = outside();
  send(control, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 100, y: 100 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1010)).toBe(false);
  send(bar, 'pointerup', { id: 7, kind: 'pen', t: 1040, x: 5, y: 5 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1100)).toBe(false); // die Pause nach dem Stift gilt wie sonst
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1300)).toBe(true);
  bar.remove();
});

test('a pen that the system takes away outside the stage opens the gate again', () => {
  const bar = outside();
  send(header, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 160, y: 40 });
  send(bar, 'pointercancel', { id: 7, kind: 'pen', t: 1040, x: 5, y: 5 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1300)).toBe(true);
  bar.remove();
});

test('a pen that is lifted on the card or on the paper is reported to the gate once', () => {
  const up = vi.spyOn(filter, 'penUp');
  send(control, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 100, y: 100 });
  send(control, 'pointerup', { id: 7, kind: 'pen', t: 1040, x: 100, y: 100 });
  expect(up).toHaveBeenCalledTimes(1);
  send(host, 'pointerdown', { id: 8, kind: 'pen', t: 2000, x: 400, y: 600 }); // auf dem Papier meldet es die Fläche selbst
  send(host, 'pointerup', { id: 8, kind: 'pen', t: 2040, x: 400, y: 600 });
  expect(up).toHaveBeenCalledTimes(1);
});

test('a pen that is still down when the cards go does not keep the gate shut', () => {
  send(control, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 100, y: 100 });
  expect(filter.acceptTouch({ width: 1, height: 1 }, 1010)).toBe(false);
  stop();
  expect(filter.acceptTouch({ width: 1, height: 1 }, performance.now() + 300)).toBe(true);
});

test('after stop a pen outside the stage is none of the cards business', () => {
  const bar = outside();
  send(control, 'pointerdown', { id: 7, kind: 'pen', t: 1000, x: 100, y: 100 });
  stop();
  const up = vi.spyOn(filter, 'penUp');
  send(bar, 'pointerup', { id: 7, kind: 'pen', t: 1040, x: 5, y: 5 });
  expect(up).not.toHaveBeenCalled();
  bar.remove();
});

test('the mouse is none of the gates business: a click after a palm tap is not dropped by a mouse press in between', () => {
  send(control, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100, size: 150 });
  send(control, 'pointerup', { id: 1, t: 1050, x: 100, y: 100, size: 150 });
  send(control, 'pointerdown', { id: 9, kind: 'mouse', t: 1100, x: 100, y: 100 });
  send(control, 'pointerup', { id: 9, kind: 'mouse', t: 1110, x: 100, y: 100 });
  click(control, 1112, 100, 100);
  expect(clicks).toBe(1);
});

// ---------- Aufräumen ----------

test('after stop nothing is watched any more', () => {
  stop();
  send(header, 'pointerdown', { id: 1, t: 1000, x: 100, y: 100 });
  send(header, 'pointerdown', { id: 2, t: 1010, x: 200, y: 100 });
  expect(handed).toEqual([]);
  send(control, 'pointerdown', { id: 3, t: 2000, x: 100, y: 100, size: 150 });
  send(control, 'pointerup', { id: 3, t: 2040, x: 100, y: 100, size: 150 });
  click(control, 2045, 100, 100);
  expect(clicks).toBe(1);
});
