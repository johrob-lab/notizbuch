import type { Page } from '@playwright/test';

// Echte Berührungen. Playwright kann nur einen Tipp (`page.touchscreen`), mehrere Finger gleichzeitig gehen über das
// DevTools-Protokoll (`Input.dispatchTouchEvent`). Diese Berührungen laufen durch dieselbe Eingabekette wie ein Finger auf
// dem iPad: Zeigerereignisse, Berührungsereignisse, `touch-action`, Zeigerfang. Die künstlichen Zeigerereignisse aus
// `pointer.ts` tun das nicht, mit ihnen lässt sich darum nicht prüfen, was der Browser mit einer Geste macht, die auf einer
// Karte beginnt (blättern, zoomen, abbrechen).

export type Pt = [x: number, y: number];

type Finger = { at: Pt; radius: number };

export type Touchscreen = {
  /** Ein Finger setzt auf. `radius` ist die halbe Breite der Auflagefläche (ein Handballen hat 80 und mehr). */
  down(id: number, at: Pt, o?: { radius?: number }): Promise<void>;
  /** Die genannten Finger gehen an neue Orte, alle in einem Schritt. */
  move(to: Record<number, Pt>): Promise<void>;
  /** Die genannten Finger heben ab. */
  up(...ids: number[]): Promise<void>;
  /** Ein Finger zieht in Schritten von `from` nach `to`. */
  swipe(from: Pt, to: Pt, steps?: number): Promise<void>;
  /** Zwei Finger ziehen in Schritten gleichzeitig von `from` nach `to`. */
  pinch(from: [Pt, Pt], to: [Pt, Pt], steps?: number): Promise<void>;
  /** Zwei Finger tippen zugleich und heben sofort wieder ab. */
  twoFingerTap(a: Pt, b: Pt): Promise<void>;
  /** Ein Tipp mit einem Finger, mit einer Auflagefläche nach Wunsch. */
  tap(at: Pt, o?: { radius?: number }): Promise<void>;
};

const lerp = (a: Pt, b: Pt, f: number): Pt => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];

export async function touchscreen(page: Page): Promise<Touchscreen> {
  const cdp = await page.context().newCDPSession(page);
  const fingers = new Map<number, Finger>();
  // Das Protokoll will bei jedem Aufsetzen und Bewegen alle Finger, die gerade aufliegen.
  const points = () => [...fingers].map(([id, { at: [x, y], radius }]) => ({ id, x, y, radiusX: radius, radiusY: radius, force: 0.5 }));
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', touchPoints: ReturnType<typeof points>) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints });

  const screen: Touchscreen = {
    async down(id, at, o = {}) {
      fingers.set(id, { at, radius: o.radius ?? 1 });
      await send('touchStart', points());
    },
    async move(to) {
      for (const [id, at] of Object.entries(to)) {
        const finger = fingers.get(Number(id));
        if (finger) finger.at = at;
      }
      await send('touchMove', points());
    },
    async up(...ids) {
      const leaving = points().filter((p) => ids.includes(p.id));
      for (const id of ids) fingers.delete(id);
      await send('touchEnd', leaving);
    },
    async swipe(from, to, steps = 6) {
      await screen.down(0, from);
      for (let i = 1; i <= steps; i++) await screen.move({ 0: lerp(from, to, i / steps) });
      await screen.up(0);
    },
    async pinch(from, to, steps = 6) {
      await screen.down(0, from[0]);
      await screen.down(1, from[1]);
      for (let i = 1; i <= steps; i++) await screen.move({ 0: lerp(from[0], to[0], i / steps), 1: lerp(from[1], to[1], i / steps) });
      await screen.up(0, 1);
    },
    async twoFingerTap(a, b) {
      await screen.down(0, a);
      await screen.down(1, b);
      await screen.up(0, 1);
    },
    async tap(at, o) {
      await screen.down(0, at, o);
      await screen.up(0);
    },
  };
  return screen;
}
