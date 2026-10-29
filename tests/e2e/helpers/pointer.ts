import type { Page } from '@playwright/test';

// Synthetische Zeigerereignisse für die Schreibfläche. Playwright kann keinen Stift und keine zwei Finger, darum
// werden `PointerEvent`s gebaut und auf der obersten Ebene der Fläche abgeschickt. Orte sind Seiteneinheiten, den
// Weg zu Bildschirmkoordinaten kennt die App (`window.__notizbuch.toClient`).

export type Kind = 'pen' | 'touch' | 'mouse';
type Phase = 'down' | 'move' | 'up';
type Step = { kind: Kind; id: number; primary: boolean; phase: Phase; x: number; y: number };

const LIVE = 'canvas[data-layer="live"]';

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

export type Pointer = {
  /** Zeichnet einen Weg: aufsetzen am ersten Punkt, zu jedem weiteren bewegen, am letzten abheben. */
  stroke(points: [number, number][]): Promise<void>;
  tap(x: number, y: number): Promise<void>;
  down(x: number, y: number): Promise<void>;
  move(x: number, y: number): Promise<void>;
  up(x: number, y: number): Promise<void>;
  /** Tippt in die Mitte eines Elements außerhalb der Schreibfläche (zum Beispiel den Schnellwechsel). */
  tapOn(selector: string): Promise<void>;
  /** Setzt in der Mitte eines Elements außerhalb der Schreibfläche auf, zieht um `dx` und `dy` Bildschirmpunkte und hebt ab. */
  dragOn(selector: string, dx: number, dy: number): Promise<void>;
};

const BASE_ID: Record<Kind, number> = { mouse: 1, pen: 11, touch: 21 };

function pointer(page: Page, kind: Kind, n: number): Pointer {
  const id = BASE_ID[kind] + n;
  const step = (phase: Phase, [x, y]: [number, number]): Step => ({ kind, id, primary: n === 0, phase, x, y });
  const path = (points: [number, number][]): Step[] => [
    step('down', points[0]),
    ...points.slice(1).map((p) => step('move', p)),
    step('up', points[points.length - 1]),
  ];
  return {
    stroke: (points) => play(page, path(points)),
    tap: (x, y) => play(page, path([[x, y]])),
    down: (x, y) => play(page, [step('down', [x, y])]),
    move: (x, y) => play(page, [step('move', [x, y])]),
    up: (x, y) => play(page, [step('up', [x, y])]),
    tapOn: (selector) => dragElement(page, selector, kind, id, 0, 0),
    dragOn: (selector, dx, dy) => dragElement(page, selector, kind, id, dx, dy),
  };
}

/** Zeigerereignisse auf einem Element: aufsetzen in der Mitte, in vier Schritten um (dx, dy) ziehen, abheben. */
async function dragElement(page: Page, selector: string, kind: Kind, id: number, dx: number, dy: number): Promise<void> {
  await page.evaluate(
    ({ selector: sel, kind: pointerType, id: pointerId, dx: moveX, dy: moveY }) => {
      const el = document.querySelector(sel);
      if (!el) throw new Error(`Nichts gefunden für ${sel}.`);
      const r = el.getBoundingClientRect();
      const x0 = r.left + r.width / 2;
      const y0 = r.top + r.height / 2;
      const send = (type: string, f: number, buttons: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId,
            pointerType,
            isPrimary: true,
            pressure: 0.5,
            clientX: x0 + moveX * f,
            clientY: y0 + moveY * f,
            button: type === 'pointermove' ? -1 : 0,
            buttons,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      send('pointerdown', 0, 1);
      if (moveX || moveY) for (const f of [0.25, 0.5, 0.75, 1]) send('pointermove', f, 1);
      send('pointerup', 1, 0);
    },
    { selector, kind, id, dx, dy },
  );
}

/** Der Apple Pencil. */
export const pen = (page: Page): Pointer => pointer(page, 'pen', 0);
/** Ein Finger. `n` unterscheidet mehrere Finger zugleich (0 ist der erste). */
export const touch = (page: Page, n = 0): Pointer => pointer(page, 'touch', n);
/** Die Maus. */
export const mouse = (page: Page): Pointer => pointer(page, 'mouse', 0);

const finger = (n: number, phase: Phase, [x, y]: [number, number]): Step => ({ kind: 'touch', id: BASE_ID.touch + n, primary: n === 0, phase, x, y });

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
