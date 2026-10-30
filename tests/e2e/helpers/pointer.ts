import type { Page } from '@playwright/test';

// Synthetische Zeigerereignisse für die Schreibfläche. Playwright kann keinen Stift und keine zwei Finger, darum
// werden `PointerEvent`s gebaut und auf der obersten Ebene der Fläche abgeschickt. Orte sind Seiteneinheiten, den
// Weg zu Bildschirmkoordinaten kennt die App (`window.__notizbuch.toClient`).

export type Kind = 'pen' | 'touch' | 'mouse';
type Phase = 'down' | 'move' | 'up';
type Step = { kind: Kind; id: number; primary: boolean; phase: Phase; x: number; y: number; size: number };

const LIVE = 'canvas[data-layer="live"]';
/** So groß ist die Auflagefläche eines Fingers im Test (ein Handballen ist größer als 120). */
const FINGER_SIZE = 1;
const PALM_SIZE = 150;

/**
 * Spielt die Schritte in der Reihenfolge ab, alle in einem Aufruf: Zwischen zwei Ereignissen vergeht keine Wartezeit.
 * Alle Orte werden vorab in Bildschirmkoordinaten umgerechnet. Der Finger bewegt sich also über den Bildschirm,
 * auch wenn die Seite unter ihm wandert.
 */
async function play(page: Page, steps: Step[]): Promise<void> {
  await page.evaluate(
    ({ steps: list, target }) => {
      const surface = document.querySelector(target);
      if (!surface) throw new Error('Keine Schreibfläche gefunden.');
      const placed = list.map((s) => ({ s, at: window.__notizbuch.toClient(s.x, s.y) }));
      for (const { s, at } of placed) {
        surface.dispatchEvent(
          new PointerEvent(`pointer${s.phase}`, {
            pointerId: s.id,
            pointerType: s.kind,
            isPrimary: s.primary,
            pressure: 0.5,
            width: s.size,
            height: s.size,
            clientX: at.x,
            clientY: at.y,
            button: s.phase === 'move' ? -1 : 0,
            buttons: s.phase === 'up' ? 0 : 1,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    },
    { steps, target: LIVE },
  );
}

type OnElementEvent = { type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel'; x: number; y: number };

/** Schickt Zeigerereignisse an ein Element außerhalb der Schreibfläche. Orte sind Bildschirmkoordinaten. */
async function sendOn(page: Page, selector: string, kind: Kind, id: number, size: number, events: OnElementEvent[]): Promise<void> {
  await page.evaluate(
    ({ selector: sel, kind: pointerType, id: pointerId, size: contact, events: list }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Nichts gefunden für ${sel}.`);
      for (const ev of list) {
        el.dispatchEvent(
          new PointerEvent(ev.type, {
            pointerId,
            pointerType,
            isPrimary: true,
            pressure: 0.5,
            width: contact,
            height: contact,
            clientX: ev.x,
            clientY: ev.y,
            button: ev.type === 'pointermove' ? -1 : 0,
            buttons: ev.type === 'pointerdown' || ev.type === 'pointermove' ? 1 : 0,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    },
    { selector, kind, id, size, events },
  );
}

/** Die Mitte eines Elements in Bildschirmkoordinaten. */
export function centerOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error(`Nichts gefunden für ${sel}.`);
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }, selector);
}

export type Pointer = {
  /** Zeichnet einen Weg: aufsetzen am ersten Punkt, zu jedem weiteren bewegen, am letzten abheben. */
  stroke(points: [number, number][]): Promise<void>;
  tap(x: number, y: number): Promise<void>;
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(x: number, y: number): Promise<void>;
  /** Tippt in die Mitte eines Elements außerhalb der Schreibfläche (zum Beispiel den Schnellwechsel). */
  tapOn(selector: string): Promise<void>;
  /**
   * Setzt in der Mitte eines Elements außerhalb der Schreibfläche auf, zieht um `dx` und `dy` Bildschirmpunkte und hebt ab
   * (mit `cancel` bricht das System die Berührung stattdessen ab).
   */
  dragOn(selector: string, dx: number, dy: number, o?: { cancel?: boolean }): Promise<void>;
  /** Einzelne Ereignisse an ein Element außerhalb der Schreibfläche, an Orten in Bildschirmkoordinaten. */
  downOn(selector: string, x: number, y: number): Promise<void>;
  moveOn(selector: string, x: number, y: number): Promise<void>;
  upOn(selector: string, x: number, y: number): Promise<void>;
};

const BASE_ID: Record<Kind, number> = { mouse: 1, pen: 11, touch: 21 };

function pointer(page: Page, kind: Kind, n: number, size = FINGER_SIZE): Pointer {
  const id = BASE_ID[kind] + n;
  const step = (phase: Phase, [x, y]: [number, number]): Step => ({ kind, id, primary: n === 0, phase, x, y, size });
  const path = (points: [number, number][]): Step[] => [
    step('down', points[0]),
    ...points.slice(1).map((p) => step('move', p)),
    step('up', points[points.length - 1]),
  ];
  const on = (selector: string, events: OnElementEvent[]) => sendOn(page, selector, kind, id, size, events);
  return {
    stroke: (points) => play(page, path(points)),
    tap: (x, y) => play(page, path([[x, y]])),
    down: (x, y) => play(page, [step('down', [x, y])]),
    move: (x, y) => play(page, [step('move', [x, y])]),
    up: (x, y) => play(page, [step('up', [x, y])]),
    async tapOn(selector) {
      const c = await centerOf(page, selector);
      await on(selector, [
        { type: 'pointerdown', ...c },
        { type: 'pointerup', ...c },
      ]);
    },
    async dragOn(selector, dx, dy, o = {}) {
      const c = await centerOf(page, selector);
      const at = (f: number) => ({ x: c.x + dx * f, y: c.y + dy * f });
      await on(selector, [
        { type: 'pointerdown', ...c },
        ...(dx || dy ? [0.25, 0.5, 0.75, 1].map((f): OnElementEvent => ({ type: 'pointermove', ...at(f) })) : []),
        { type: o.cancel ? 'pointercancel' : 'pointerup', ...at(1) },
      ]);
    },
    downOn: (selector, x, y) => on(selector, [{ type: 'pointerdown', x, y }]),
    moveOn: (selector, x, y) => on(selector, [{ type: 'pointermove', x, y }]),
    upOn: (selector, x, y) => on(selector, [{ type: 'pointerup', x, y }]),
  };
}

/** Der Apple Pencil. */
export const pen = (page: Page): Pointer => pointer(page, 'pen', 0);
/** Ein Finger. `n` unterscheidet mehrere Finger zugleich (0 ist der erste). */
export const touch = (page: Page, n = 0): Pointer => pointer(page, 'touch', n);
/** Die Maus. */
export const mouse = (page: Page): Pointer => pointer(page, 'mouse', 0);
/** Ein Handballen: eine Berührung mit sehr großer Auflagefläche (150, erlaubt sind für einen Finger bis 120). */
export const palm = (page: Page): Pointer => pointer(page, 'touch', 0, PALM_SIZE);

const finger = (n: number, phase: Phase, [x, y]: [number, number]): Step => ({
  kind: 'touch',
  id: BASE_ID.touch + n,
  primary: n === 0,
  phase,
  x,
  y,
  size: FINGER_SIZE,
});

/** Zwei Finger setzen gleichzeitig auf und heben ohne Bewegung wieder ab, alles in einem Zug. */
export function twoFingerTap(page: Page, a: [number, number], b: [number, number]): Promise<void> {
  return play(page, [finger(0, 'down', a), finger(1, 'down', b), finger(0, 'up', a), finger(1, 'up', b)]);
}

/** Zwei Finger setzen auf `from` auf, ziehen in vier Schritten gleichzeitig nach `to` und heben ab. */
export function pinch(page: Page, from: [[number, number], [number, number]], to: [[number, number], [number, number]]): Promise<void> {
  const mid = (n: 0 | 1, f: number): [number, number] => [from[n][0] + (to[n][0] - from[n][0]) * f, from[n][1] + (to[n][1] - from[n][1]) * f];
  const moves = [0.25, 0.5, 0.75, 1].flatMap((f) => [finger(0, 'move', mid(0, f)), finger(1, 'move', mid(1, f))]);
  return play(page, [finger(0, 'down', from[0]), finger(1, 'down', from[1]), ...moves, finger(0, 'up', to[0]), finger(1, 'up', to[1])]);
}

/**
 * Ein Mausrad-Ereignis an einem Ort der Seite. Mit `ctrl` zoomt es, sonst blättert es. Rückgabe ist der Ort des
 * Ereignisses in Bildschirmkoordinaten, wie die App ihn sieht: Der Browser rundet ihn bei Mausereignissen auf ganze Punkte.
 */
export function wheel(page: Page, at: [number, number], o: { dx?: number; dy?: number; ctrl?: boolean }): Promise<{ x: number; y: number }> {
  return page.evaluate(
    ({ at: [x, y], o: opts, target }) => {
      const surface = document.querySelector(target)!;
      const c = window.__notizbuch.toClient(x, y);
      const ev = new WheelEvent('wheel', { clientX: c.x, clientY: c.y, deltaX: opts.dx ?? 0, deltaY: opts.dy ?? 0, ctrlKey: !!opts.ctrl, bubbles: true, cancelable: true });
      surface.dispatchEvent(ev);
      return { x: ev.clientX, y: ev.clientY };
    },
    { at, o, target: LIVE },
  );
}

/** Wo die Seite auf dem Bildschirm liegt: Ort des Seitenursprungs und Maßstab (Bildschirmpunkte je Seiteneinheit). */
export function viewOf(page: Page): Promise<{ x: number; y: number; scale: number }> {
  return page.evaluate(() => {
    const a = window.__notizbuch.toClient(0, 0);
    const b = window.__notizbuch.toClient(1000, 0);
    return { x: a.x, y: a.y, scale: (b.x - a.x) / 1000 };
  });
}

/**
 * Wie viele Bildpunkte rund um einen Ort der Seite dunkel sind, auf der Grundebene (dort liegen fertige Striche).
 * Papier ist fast weiß, Tinte ist dunkel oder kräftig gefärbt. `radius` in Bildschirmpunkten.
 */
export function inkNear(page: Page, at: [number, number], radius = 6): Promise<number> {
  return page.evaluate(
    ({ at: [x, y], radius: r }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-layer="grund"]')!;
      const box = canvas.getBoundingClientRect();
      const c = window.__notizbuch.toClient(x, y);
      const k = canvas.width / box.width;
      const left = Math.max(0, Math.round((c.x - box.left - r) * k));
      const top = Math.max(0, Math.round((c.y - box.top - r) * k));
      const size = Math.max(1, Math.round(2 * r * k));
      const data = canvas.getContext('2d')!.getImageData(left, top, size, size).data;
      let dark = 0;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i + 3] > 128 && data[i] + data[i + 1] + data[i + 2] < 450) dark++;
      }
      return dark;
    },
    { at, radius },
  );
}

/** Die Farbe der Grundebene an einem Ort der Seite als `[rot, grün, blau]` (0 bis 255), dort liegen Papier, Hintergrund und Striche. */
export function colorAt(page: Page, at: [number, number]): Promise<[number, number, number]> {
  return page.evaluate(
    ({ at: [x, y] }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('canvas[data-layer="grund"]')!;
      const box = canvas.getBoundingClientRect();
      const c = window.__notizbuch.toClient(x, y);
      const k = canvas.width / box.width;
      const [r, g, b] = canvas.getContext('2d')!.getImageData(Math.round((c.x - box.left) * k), Math.round((c.y - box.top) * k), 1, 1).data;
      return [r, g, b] as [number, number, number];
    },
    { at },
  );
}
