import { expect, test as base, type Page } from '@playwright/test';
import { DEFAULT_FUELLER, DEFAULT_PEN_ANGLE, nibShape, penAngle, pressureFactor, type FuellerSettings, type PenKind } from '../../src/ink/pens';
import { serializePage } from '../../src/ink/svg';
import { INK, MM, WIDTH_MM } from '../../src/ink/types';
import type { InkPrefs } from '../../src/lib/settings';
import { bringToForeground, changeStoredSettings, lastHead, openSeeded, queued, savedSettings, sendToBackground } from './helpers/app';
import { centerOf, inkNear, mouse, onPixelCentre, palm, pen, touch, viewOf, wheel, type PathPoint } from './helpers/pointer';
import { touchscreen } from './helpers/touch';

// Die Füllfeder mit ihren Einstellungen auf der Schreibfläche, ihre Spitze, wenn der Stift über der Seite schwebt, und ihr
// Regler-Fenster. Jeder Test wählt Stift und Einstellungen über die gespeicherte Werkzeugwahl und lädt die App neu.

/** Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben (zum Beispiel eine Ausnahme beim Zeichnen). */
const test = base.extend<{ browserErrors: void }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect(errors, 'unbehandelte Fehler im Browser').toEqual([]);
    },
    { auto: true },
  ],
});

// Die Anfragen an GitHub laufen über page.route. Ein Service Worker würde sie am Test vorbei beantworten.
// Die Seite ist hoch genug, dass die ganze Papierseite auf den Bildschirm passt: Pixelproben brauchen sichtbare Orte.
test.use({ serviceWorkers: 'block', viewport: { width: 1200, height: 1700 } });

const DAY = '#/tag/2026-10-29';
const TAG = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const TIP = 'div.spitze';
/** So lang ist die Spitze beim Schweben auf dem Bildschirm mindestens (Punkte). */
const TIP_MIN = 8;
/** Nennbreite „mittel“ in Seiteneinheiten. */
const NOM_W = WIDTH_MM.mittel * MM;
/** › in der Leiste oben: der nächste Tag. */
const NEXT_DAY = 'a[aria-label="Nächster Tag"]';
/** Der Anfang einer Datei, die sich nicht lesen lässt, wie ein anderes Gerät sie hinterlassen könnte. */
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';
const UNREADABLE = 'Diese Seite lässt sich nicht lesen und wird nicht verändert.';

/** Die ganze Werkzeugwahl, alle Felder ausgeschrieben: der Stift `chosen`, schwarz, mittel, mit den Einstellungen `fueller`. */
const inkWith = (fueller: FuellerSettings, chosen: PenKind = 'fueller'): InkPrefs => ({
  tool: 'pen',
  pen: chosen,
  color: 'schwarz',
  width: 'mittel',
  eraserSize: 'mittel',
  eraserMode: 'strich',
  scribble: true,
  fueller,
});

/** Wählt die Füllfeder mit den Einstellungen `fueller` über die gespeicherte Werkzeugwahl und lädt neu. `more`: weitere Einstellungen. */
async function choose(page: Page, fueller: FuellerSettings, more: Record<string, unknown> = {}): Promise<void> {
  await changeStoredSettings(page, { ink: inkWith(fueller), ...more });
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
}

/** Die Seite, wie sie auf dem Gerät gespeichert ist. Ohne Netz bleibt sie in der Warteschlange und wird nicht hochgeladen. */
const savedPage = async (page: Page): Promise<string> => (await queued(page))[TAG] ?? '';

/** Die <path>-Elemente der Striche einer gespeicherten Seite. Die Linien des Hintergrunds haben keine `data-id`. */
const strokePaths = (svg: string): string[] => svg.match(/<path data-id=[^>]*>/g) ?? [];

const attr = (path: string, name: string): string | undefined => new RegExp(` ${name}="([^"]*)"`).exec(path)?.[1];

/** Die Mittellinie aus `data-linie`: x, y und Breite je Punkt. */
function pointsOf(path: string): { x: number; y: number; w: number }[] {
  const nums = (attr(path, 'data-linie') ?? '').trim().split(/\s+/).map(Number);
  return Array.from({ length: Math.floor(nums.length / 3) }, (_, i) => ({ x: nums[3 * i], y: nums[3 * i + 1], w: nums[3 * i + 2] }));
}

/** Die Breite je Punkt aus `data-linie`. */
const widthsOf = (path: string): number[] => pointsOf(path).map((p) => p.w);

/** Die Breiten, die mehr als 2 % vom Mittel abweichen. Leer heißt: überall dieselbe Breite. */
function uneven(widths: number[]): number[] {
  const mean = widths.reduce((sum, w) => sum + w, 0) / widths.length;
  return widths.filter((w) => Math.abs(w / mean - 1) > 0.02);
}

const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);

/** `n` Punkte in gleichen Abständen auf der Strecke von `from` nach `to`. */
const line = (from: [number, number], to: [number, number], n: number): [number, number][] =>
  Array.from({ length: n }, (_, i): [number, number] => [from[0] + ((to[0] - from[0]) * i) / (n - 1), from[1] + ((to[1] - from[1]) * i) / (n - 1)]);

/** Ein Ort der Seite in Bildschirmkoordinaten. */
const clientOf = (page: Page, [x, y]: [number, number]) => page.evaluate(([px, py]) => window.__notizbuch.toClient(px, py), [x, y]);

const tipCount = (page: Page) => page.locator(TIP).count();

/**
 * Die Spitze beim Schweben: Mitte (Bildschirmkoordinaten), Länge und Breite (Punkte), Drehung der langen Achse, Deckkraft,
 * Farbe, und ob sie Zeiger durchlässt und vor der Sprachausgabe verborgen ist.
 */
const tipOf = (page: Page) =>
  page.evaluate((selector) => {
    const el = document.querySelector<HTMLElement>(selector);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    const m = new DOMMatrix(style.transform);
    return {
      x: box.left + box.width / 2,
      y: box.top + box.height / 2,
      long: parseFloat(style.width),
      short: parseFloat(style.height),
      angle: Math.atan2(m.b, m.a),
      opacity: style.opacity,
      colour: style.backgroundColor,
      pointerEvents: style.pointerEvents,
      ariaHidden: el.getAttribute('aria-hidden'),
    };
  }, TIP);

/** Wie weit (Grad) zwei Richtungen einer Achse auseinanderliegen. Eine Ellipse sieht um 180 Grad gedreht gleich aus. */
function axisApart(a: number, b: number): number {
  const d = (((a - b) % Math.PI) + Math.PI) % Math.PI;
  return (Math.min(d, Math.PI - d) * 180) / Math.PI;
}

/** Wählt einen Knopf der Werkzeugleiste und sagt, ob die Spitze davor und gleich danach (ohne Wartezeit) zu sehen ist. */
const chooseInToolbar = (page: Page, label: string) =>
  page.evaluate(
    ({ selector, name }) => {
      const before = document.querySelector(selector) !== null;
      document.querySelector<HTMLButtonElement>(`.werkzeuge button[aria-label="${name}"]`)!.click();
      return { before, after: document.querySelector(selector) !== null };
    },
    { selector: TIP, name: label },
  );

/** Wie lange (ms) die Spitze von jetzt an noch zu sehen ist, wenn nichts mehr geschieht. Im Browser gemessen. */
const tipStays = (page: Page) =>
  page.evaluate(
    (selector) =>
      new Promise<number>((done) => {
        const start = performance.now();
        const poll = () => (document.querySelector(selector) ? setTimeout(poll, 5) : done(performance.now() - start));
        poll();
      }),
    TIP,
  );

/** Was `installHover` im Browser anlegt. */
type Hovering = { __hover(): void };

/**
 * Legt im Browser `window.__hover()` an: eine Schwebe-Meldung des Stifts über `at` (Seiteneinheiten) an die Fläche, die gerade
 * offen ist. So lassen sich Meldungen im Takt des Browsers schicken, ohne Umweg über Playwright.
 */
const installHover = (page: Page, at: [number, number]) =>
  page.evaluate(([x, y]) => {
    const live = document.querySelector('canvas[data-layer="live"]')!;
    const c = window.__notizbuch.toClient(x, y);
    const init = { pointerId: 11, pointerType: 'pen', isPrimary: true, pressure: 0, clientX: c.x, clientY: c.y, button: -1, buttons: 0 };
    (window as unknown as Hovering).__hover = () => live.dispatchEvent(new PointerEvent('pointermove', { ...init, bubbles: true, cancelable: true, composed: true }));
  }, at);

const waitForPageOf = (page: Page, key: string) => page.waitForFunction((day) => window.__notizbuch?.currentPage?.().key === day, key);

/**
 * Wie viele Bildpunkte rund um einen Ort der Seite auf der Live- oder der Vorhersage-Ebene mehr als halb decken. Dort steht
 * der Strich, solange er entsteht. `radius` in Bildschirmpunkten.
 */
function liveCoverNear(page: Page, at: [number, number], radius: number): Promise<number> {
  return page.evaluate(
    ({ at: [x, y], radius: r }) => {
      const layers = ['live', 'vorhersage'].map((name) => document.querySelector<HTMLCanvasElement>(`canvas[data-layer="${name}"]`)!);
      const box = layers[0].getBoundingClientRect();
      const c = window.__notizbuch.toClient(x, y);
      const k = layers[0].width / box.width;
      const left = Math.max(0, Math.round((c.x - box.left - r) * k));
      const top = Math.max(0, Math.round((c.y - box.top - r) * k));
      const size = Math.max(1, Math.round(2 * r * k));
      const data = layers.map((canvas) => canvas.getContext('2d')!.getImageData(left, top, size, size).data);
      let covered = 0;
      for (let i = 3; i < data[0].length; i += 4) if (data.some((d) => d[i] > 128)) covered++;
      return covered;
    },
    { at, radius },
  );
}

test('a new stroke uses the stored settings', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Runde Spitze ohne Verjüngung: überall dieselbe Breite.
  await choose(page, { schaerfe: 0, druck: 0.25, rundung: 1, stabil: 0.14 });
  await pen(page).stroke(line([200, 800], [400, 860], 40));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  const even = widthsOf(strokePaths(await savedPage(page))[0]);
  expect(even.length, 'Punkte in data-linie').toBeGreaterThan(20);
  expect(uneven(even), `Breiten ${even.join(' ')}`).toEqual([]);

  // Flache, scharfe Spitze: spitze Enden, breite Mitte.
  await choose(page, { schaerfe: 1, druck: 0.25, rundung: 0, stabil: 0.14 });
  await pen(page).stroke(line([200, 1000], [400, 1060], 40));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(2);
  const sharp = widthsOf(strokePaths(await savedPage(page))[1]);
  const middle = sharp[Math.floor(sharp.length / 2)];
  expect(sharp[0], `Breiten ${sharp.join(' ')}`).toBeLessThan(middle / 2);
  expect(sharp[sharp.length - 1], `Breiten ${sharp.join(' ')}`).toBeLessThan(middle / 2);
});

// Jeder Regler kommt aus der gespeicherten Wahl beim Strich an, nicht nur die Schärfe: je zwei Striche auf demselben Weg, einer
// mit dem Regler ganz links, einer ganz rechts. Die Schärfe ist dabei 0, damit keine Verjüngung an den Enden mitspielt.

/**
 * Wählt die Füllfeder mit den Reglern `fueller`, schreibt den Weg `points` und gibt die gespeicherte Mittellinie des neuen Strichs
 * zurück. `count` ist, wie viele Striche die Seite danach hat: Der neue ist der letzte.
 */
async function writeWith(page: Page, fueller: FuellerSettings, points: PathPoint[], count: number): Promise<{ x: number; y: number; w: number }[]> {
  await choose(page, fueller);
  await pen(page).stroke(points);
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(count);
  return pointsOf(strokePaths(await savedPage(page))[count - 1]);
}

test('the stored roundness reaches the stroke', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Ein Halbkreis oben herum, von links nach rechts, mit gleichem Druck: Die Richtung dreht um 180 Grad, kommt also einmal
  // entlang und einmal quer zur Feder.
  const arc = (cy: number): PathPoint[] =>
    Array.from({ length: 61 }, (_, i): PathPoint => [300 + 80 * Math.cos(Math.PI * (1 + i / 60)), cy + 80 * Math.sin(Math.PI * (1 + i / 60))]);
  const round = (await writeWith(page, { ...DEFAULT_FUELLER, schaerfe: 0, rundung: 1 }, arc(900), 1)).map((p) => p.w);
  expect(round.length, 'Punkte in data-linie').toBeGreaterThan(40);
  expect(uneven(round), `runde Spitze, Breiten ${round.join(' ')}`).toEqual([]);
  const flat = (await writeWith(page, { ...DEFAULT_FUELLER, schaerfe: 0, rundung: 0 }, arc(1150), 2)).map((p) => p.w);
  expect(Math.max(...flat) / Math.min(...flat), `flache Spitze, Breiten ${flat.join(' ')}`).toBeGreaterThanOrEqual(1.3);
});

test('the stored pressure sensitivity reaches the stroke', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Eine Gerade, der Druck steigt gleichmäßig von 0,2 auf 0,9.
  const rising = (y: number): PathPoint[] => line([200, y], [400, y + 60], 40).map(([x, py], i): PathPoint => [x, py, 0.2 + (0.7 * i) / 39]);
  const deaf = (await writeWith(page, { ...DEFAULT_FUELLER, schaerfe: 0, druck: 0 }, rising(800), 1)).map((p) => p.w);
  expect(deaf.length, 'Punkte in data-linie').toBeGreaterThan(20);
  expect(uneven(deaf), `ohne Druckempfindlichkeit, Breiten ${deaf.join(' ')}`).toEqual([]);
  const keen = (await writeWith(page, { ...DEFAULT_FUELLER, schaerfe: 0, druck: 1 }, rising(1000), 2)).map((p) => p.w);
  expect(Math.max(...keen) / Math.min(...keen), `volle Druckempfindlichkeit, Breiten ${keen.join(' ')}`).toBeGreaterThanOrEqual(1.5);
});

test('the stored stabilisation reaches the stroke', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Eine waagrechte Gerade mit Zittern quer dazu: jeder Punkt abwechselnd eine Einheit darüber und darunter, alle 4 Einheiten
  // einer. Die Füllfeder glättet nach der Strecke: Bei 0 % reicht das (2,5 σ, 3,75 Bildschirmpunkte) nicht bis zum Nachbarpunkt,
  // bei 100 % (30 Bildschirmpunkte) über mehrere Punkte.
  const jagged = (y: number): PathPoint[] => Array.from({ length: 101 }, (_, i): PathPoint => [200 + 4 * i, y + (i % 2 ? 1 : -1)]);
  /** Wie weit die gespeicherten Punkte im Mittel von der Geraden bei `y` abweichen (Seiteneinheiten). */
  const offLine = (pts: { y: number }[], y: number): number => pts.reduce((sum, p) => sum + Math.abs(p.y - y), 0) / pts.length;
  const rough = offLine(await writeWith(page, { ...DEFAULT_FUELLER, schaerfe: 0, stabil: 0 }, jagged(900), 1), 900);
  const calm = offLine(await writeWith(page, { ...DEFAULT_FUELLER, schaerfe: 0, stabil: 1 }, jagged(1100), 2), 1100);
  expect(rough, 'bei 0 % bleibt das Zittern').toBeGreaterThan(0.8);
  expect(calm, `Abweichung bei 100 %, bei 0 % ${rough}`).toBeLessThanOrEqual(0.7 * rough);
});

test('the speed of the pen reaches the stroke', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Runde Spitze ohne Druckempfindlichkeit: Die Breite hängt nur noch am Tempo. Dieselbe Gerade einmal langsam (0,1 Bildschirmpunkte
  // je ms, so zieht die Hilfe ohne Angabe) und einmal schnell (1,2). Die Fläche gibt die Zeiten der Ereignisse an die Füllfeder: In
  // der Mitte ist der schnelle Strich halb so breit.
  await choose(page, { ...DEFAULT_FUELLER, druck: 0, rundung: 1 });
  await pen(page).stroke(line([200, 900], [500, 900], 101));
  await pen(page, { speed: 1.2 }).stroke(line([200, 1100], [500, 1100], 101));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(2);
  const [slow, fast] = strokePaths(await savedPage(page)).map(widthsOf);
  const middle = (widths: number[]) => widths[Math.floor(widths.length / 2)];
  expect(middle(slow), `langsam, Breiten ${slow.join(' ')}`).toBeCloseTo(NOM_W, 1);
  expect(middle(fast) / middle(slow), `schnell, Breiten ${fast.join(' ')}`).toBeCloseTo(0.5, 1);
});

test('old strokes keep their shape when the settings change', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await pen(page, { tiltX: 40, tiltY: 40 }).stroke(line([200, 800], [400, 900], 40));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  const [before] = strokePaths(await savedPage(page));

  // Ganz andere Einstellungen und neu laden. Ein neuer Strich schreibt die Seite neu, der alte steht darin wie vorher.
  await choose(page, { schaerfe: 0, druck: 1, rundung: 1, stabil: 1 });
  await pen(page).stroke(line([200, 1000], [400, 1100], 40));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(2);
  const old = strokePaths(await savedPage(page)).find((path) => attr(path, 'data-id') === attr(before, 'data-id'));
  expect(old, 'der alte Strich').toBeDefined();
  expect(attr(old!, 'data-linie')).toBe(attr(before, 'data-linie'));
});

/** Drei kleine Schleifen ab `from` (Seiteneinheiten) mit Radius `r`, `n` Punkte je Schleife. */
const loops = ([x0, y0]: [number, number], r: number, n: number): [number, number][] =>
  Array.from({ length: 3 * n + 1 }, (_, i): [number, number] => {
    const a = (2 * Math.PI * i) / n;
    return [x0 + r * (0.45 * a - Math.sin(a)), y0 + 1.3 * r * (Math.cos(a) - 1)];
  });

test('zoomed in, the page shows exactly the stroke and the pieces that the file holds', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await changeStoredSettings(page, { ink: { ...inkWith(DEFAULT_FUELLER), eraserMode: 'stueck' } });
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  // Weit hineingezoomt liegen die Punkte nur etwa 0,1 Einheiten auseinander.
  await wheel(page, [440, 1010], { dy: -800, ctrl: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  expect((await viewOf(page)).scale, 'Bildschirmpunkte je Seiteneinheit').toBeGreaterThan(6);
  const shown = () => page.evaluate(() => window.__notizbuch.currentPage().strokes.map((s) => s.pts));
  const saved = async () => strokePaths(await savedPage(page)).map(pointsOf);

  // Nach dem Abheben zeigt die Seite genau die Punkte, die in der Datei stehen: Neu geladen sieht der Strich gleich aus.
  await pen(page, { tiltX: 40, tiltY: 40 }).stroke(loops([420, 1012], 1, 60));
  await expect.poll(async () => (await saved()).length).toBe(1);
  expect((await shown())[0].length, 'Punkte').toBeGreaterThan(100);
  expect(await saved()).toEqual(await shown());

  // Ebenso die Stücke, wenn der Radierer die mittlere Schleife durchschneidet.
  await toolbarButton(page, 'Radierer').click();
  await pen(page).stroke(line([424.2, 1007], [424.2, 1013], 7));
  await expect.poll(async () => (await saved()).length).toBeGreaterThan(1);
  expect(await saved()).toEqual(await shown());
});

/** Was die Grundebene seit `recordBase` zum Bauen ihrer Pfade aufgerufen hat. */
type BaseRecord = { __base: string[] };

/**
 * Schreibt ab jetzt mit, womit die Grundebene (fertige Striche) ihre Pfade baut: je Aufruf der Buchstabe wie in der Datei (M, L, Q,
 * Z) und die Zahlen in Seiteneinheiten, auf zwei Nachkommastellen gerundet wie in der Datei. Jeder neue Pfad (`beginPath`) beginnt
 * mit `|`.
 */
const recordBase = (page: Page) =>
  page.evaluate(() => {
    const calls: string[] = [];
    (window as unknown as BaseRecord).__base = calls;
    const proto = CanvasRenderingContext2D.prototype;
    const letters = { beginPath: '|', moveTo: 'M', lineTo: 'L', quadraticCurveTo: 'Q', closePath: 'Z' } as const;
    for (const [name, letter] of Object.entries(letters)) {
      const original = proto[name as keyof typeof letters] as (this: CanvasRenderingContext2D, ...args: number[]) => void;
      Object.defineProperty(proto, name, {
        configurable: true,
        writable: true,
        value(this: CanvasRenderingContext2D, ...args: number[]) {
          if (this.canvas.dataset.layer === 'grund') calls.push(letter, ...args.map((v) => String(Math.round(v * 100) / 100 + 0)));
          return original.apply(this, args);
        },
      });
    }
  });

test('zoomed in, a finished stroke is drawn with the curves of the file', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Runde Spitze ohne Verjüngung: Kein Punkt ist dünner als ein Bildpunkt, die Fläche füllt also genau den Umriss der Datei.
  await choose(page, { schaerfe: 0, druck: 0.25, rundung: 1, stabil: 0.14 });
  await wheel(page, [440, 1010], { dy: -800, ctrl: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  expect((await viewOf(page)).scale, 'Bildschirmpunkte je Seiteneinheit').toBeGreaterThan(6);
  await recordBase(page);
  await pen(page, { tiltX: 40, tiltY: 40 }).stroke(loops([420, 1012], 1, 60));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  const d = attr(strokePaths(await savedPage(page))[0], 'd') ?? '';
  expect(d).toContain(' Q ');
  // Die Grundebene hat den fertigen Strich mit genau den Kurven der Datei gezeichnet ...
  const drawn = (await page.evaluate(() => (window as unknown as BaseRecord).__base)).join(' ');
  expect(drawn).toContain(d);
  // ... und in dem Pfad, mit dem sie ihn füllt, keine einzige Gerade. Nur dieser Pfad zählt: Papier und andere Striche haben eigene.
  const own = drawn.split('|').filter((path) => path.includes(d));
  expect(own.filter((path) => path.includes('L'))).toEqual([]);
});

test('the ends taper only after lifting the pen', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, { schaerfe: 1, druck: 0.25, rundung: 0.33, stabil: 0.14 });
  // Hineingezoomt ist die Linie gut zehn Bildpunkte breit.
  await wheel(page, [440, 1010], { dy: -800, ctrl: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  const pts = line([400, 1010], [480, 1010], 41); // zwischen zwei Linien des Notizfelds
  const writer = pen(page);
  // Aufsetzen und alle Bewegungen in einem Aufruf, ohne Abheben: So zieht der Stift den Weg gleichmäßig langsam (Zeiten der Hilfe).
  // Mit einem Aufruf je Punkt hinge das Tempo und damit die Breite davon ab, wie lange jeder Aufruf dauert.
  await writer.stroke(pts, { lift: false });
  // Beim Schreiben ist das Ende so breit wie die Mitte: Die Verjüngung am Ende kommt erst beim Abheben.
  const end = pts[pts.length - 1];
  const whileWriting = { middle: await liveCoverNear(page, pts[20], 3), end: await liveCoverNear(page, end, 3) };
  expect(whileWriting.middle, 'Mitte beim Schreiben').toBeGreaterThan(20);
  expect(whileWriting.end, `beim Schreiben ${JSON.stringify(whileWriting)}`).toBeGreaterThanOrEqual(0.9 * whileWriting.middle);
  await writer.up(...end);
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  // Nach dem Abheben ist der letzte Punkt schmal.
  const widths = widthsOf(strokePaths(await savedPage(page))[0]);
  const middle = widths[Math.floor(widths.length / 2)];
  expect(widths[widths.length - 1], `Breiten ${widths.join(' ')}`).toBeLessThan(middle / 2);
});

test('a tap still leaves a dot', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  // Der Punkt ist so breit wie die Linie, bei ganzer Seitenbreite etwa ein Bildpunkt: getippt wird auf die Mitte eines Bildpunkts.
  const at = await onPixelCentre(page, [400, 1053]);
  expect(await inkNear(page, at), 'vorher ohne Tinte').toBe(0);
  await pen(page).tap(...at);
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  expect(await inkNear(page, at)).toBeGreaterThan(0);
  // Auch mit scharfer Spitze läuft ein Tipp nicht spitz aus: ein runder Punkt so breit wie die Linie bei diesem Druck.
  const full = NOM_W * pressureFactor(DEFAULT_FUELLER.druck, 0.5);
  for (const w of widthsOf(strokePaths(await savedPage(page))[0])) expect(w).toBeCloseTo(full, 1);
});

test('only the fountain pen hovering shows the tip', async ({ page }) => {
  const at: [number, number] = [400, 1000];
  // Am Firmen-PC wird nicht geschrieben, also gibt es auch keine Spitze.
  await openSeeded(page, DAY, { device: 'Firmen-PC', settings: { ink: inkWith(DEFAULT_FUELLER) } });
  await pen(page).hover(...at);
  expect(await tipCount(page), 'Firmen-PC').toBe(0);
  await changeStoredSettings(page, { device: 'iPad' });
  await choose(page, DEFAULT_FUELLER);

  // Maus und Finger zeigen keine Spitze, auch ohne gedrückte Taste.
  await mouse(page).hover(...at);
  await touch(page).hover(...at);
  expect(await tipCount(page), 'Maus und Finger').toBe(0);

  // Der Stift mit der Füllfeder: die Spitze dort, wo er aufsetzen würde, halb durchsichtig in der Tintenfarbe.
  await pen(page).hover(...at);
  await expect(page.locator(TIP)).toBeVisible();
  const where = await clientOf(page, at);
  const tip = (await tipOf(page))!;
  expect(Math.hypot(tip.x - where.x, tip.y - where.y), 'Abstand der Mitte vom Stift').toBeLessThanOrEqual(2);
  const black = [1, 3, 5].map((i) => parseInt(INK.schwarz.slice(i, i + 2), 16));
  expect({ opacity: tip.opacity, colour: tip.colour, pointerEvents: tip.pointerEvents, ariaHidden: tip.ariaHidden }).toEqual({
    opacity: '0.45',
    colour: `rgb(${black.join(', ')})`,
    pointerEvents: 'none',
    ariaHidden: 'true',
  });
  // In normaler Größe ist die Feder kürzer als 8 Punkte: Die Spitze ist dann 8 Punkte lang, beide Achsen im selben Verhältnis.
  const shape = nibShape(DEFAULT_FUELLER, NOM_W, DEFAULT_PEN_ANGLE);
  expect(shape.long * (await viewOf(page)).scale).toBeLessThan(TIP_MIN);
  expect(tip.long).toBeCloseTo(TIP_MIN, 1);
  expect(tip.short).toBeCloseTo((TIP_MIN * shape.short) / shape.long, 1);
  // Hineingezoomt ist sie so groß wie die Feder auf der Seite.
  await wheel(page, at, { dy: -800, ctrl: true });
  await pen(page).hover(...at);
  const { scale } = await viewOf(page);
  expect(shape.long * scale).toBeGreaterThan(TIP_MIN);
  const zoomed = (await tipOf(page))!;
  expect(zoomed.long).toBeCloseTo(shape.long * scale, 1);
  expect(zoomed.short).toBeCloseTo(shape.short * scale, 1);

  // Ein anderer Stift blendet sie sofort aus, mit ihm zeigt das Schweben keine. Ebenso der Radierer.
  await pen(page).hover(...at);
  expect(await chooseInToolbar(page, 'Kugelschreiber'), 'Kugelschreiber gewählt').toEqual({ before: true, after: false });
  await pen(page).hover(...at);
  expect(await tipCount(page), 'Kugelschreiber').toBe(0);
  await page.locator('.werkzeuge button[aria-label="Füllfeder"]').click();
  await pen(page).hover(...at);
  expect(await chooseInToolbar(page, 'Radierer'), 'Radierer gewählt').toEqual({ before: true, after: false });
  await pen(page).hover(...at);
  expect(await tipCount(page), 'Radierer').toBe(0);
});

test('the tip turns like the last stroke and goes away on touch and leave', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  const at: [number, number] = [300, 1000];
  const nib = pen(page, { tiltX: -40, tiltY: 40 });
  // Vor dem ersten Strich steht die Feder wie bei einem Rechtshänder.
  await nib.hover(...at);
  expect(axisApart((await tipOf(page))!.angle, DEFAULT_PEN_ANGLE + Math.PI / 2), 'vor dem ersten Strich').toBeLessThanOrEqual(3);
  // Nach einem Strich mit anderer Neigung steht sie wie bei diesem Strich, obwohl das Schweben keine Neigung meldet.
  await nib.stroke(line([200, 800], [400, 860], 30));
  await expect.poll(() => strokeCount(page)).toBe(1);
  await nib.hover(...at);
  expect(axisApart((await tipOf(page))!.angle, penAngle(-40, 40)! + Math.PI / 2), 'nach dem Strich').toBeLessThanOrEqual(3);

  // Aufsetzen blendet sie aus, die Linie übernimmt.
  await nib.down(...at);
  expect(await tipCount(page), 'nach dem Aufsetzen').toBe(0);
  await nib.up(...at);
  // Verlässt der Stift die Fläche, ist sie weg.
  await nib.hover(...at);
  expect(await tipCount(page), 'beim Schweben').toBe(1);
  await nib.leave();
  expect(await tipCount(page), 'nach dem Verlassen').toBe(0);
  // Kommt keine Schwebe-Meldung mehr, geht sie nach 300 ms von selbst.
  await nib.hover(...at);
  const stays = await tipStays(page);
  expect(stays, 'so lange stand die Spitze noch (ms)').toBeGreaterThan(150);
  expect(stays, 'so lange stand die Spitze noch (ms)').toBeLessThan(500);
});

test('the tip stays while the pen keeps hovering and goes 300 ms after the last report', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await installHover(page, [400, 1000]);
  // Schwebe-Meldungen bei 0, 200 und 400 ms, dann keine mehr. Alles im Browser gemessen: wann gemeldet wurde, ob die Spitze
  // 50 ms nach der letzten Meldung (450 ms) noch steht, und wann sie ging. Ging sie zwischendurch, stünde das in `gone`.
  const run = await page.evaluate(
    (selector) =>
      new Promise<{ hovers: number[]; check: number; shown: boolean; gone: number[] }>((done) => {
        const surface = document.querySelector('[data-testid="surface"]')!;
        const t0 = performance.now();
        const gone: number[] = [];
        const watch = new MutationObserver((records) => {
          for (const r of records) for (const node of r.removedNodes) if (node instanceof Element && node.matches(selector)) gone.push(performance.now() - t0);
        });
        watch.observe(surface, { childList: true });
        const hovers: number[] = [];
        const hover = () => {
          (window as unknown as Hovering).__hover();
          hovers.push(performance.now() - t0);
        };
        const finish = (check: number, shown: boolean) => {
          if (document.querySelector(selector)) return void setTimeout(() => finish(check, shown), 5);
          watch.disconnect();
          done({ hovers, check, shown, gone });
        };
        hover();
        setTimeout(() => {
          hover();
          setTimeout(() => {
            hover();
            setTimeout(() => finish(performance.now() - t0, document.querySelector(selector) !== null), 50);
          }, 200);
        }, 200);
      }),
    TIP,
  );
  const report = JSON.stringify(run);
  const [, second, last] = run.hovers;
  // Damit der Test etwas sagt: Keine Pause zwischen zwei Meldungen war so lang wie die Haltezeit.
  expect(Math.max(second, last - second), report).toBeLessThan(300);
  // Bei 450 ms steht sie noch, länger als 300 ms nach der ersten Meldung: Jede Meldung hat die Zeit neu gestartet.
  expect(run.shown, report).toBe(true);
  expect(run.check, report).toBeGreaterThan(300);
  // Sie ging genau einmal, erst nach dieser Prüfung, und spätestens 350 ms nach der letzten Meldung (nach Plan bei 750 ms).
  expect(run.gone, report).toHaveLength(1);
  expect(run.gone[0] - last, report).toBeGreaterThan(250);
  expect(run.gone[0] - last, report).toBeLessThanOrEqual(350);
});

test('turning the page takes the tip along', async ({ page }) => {
  await openSeeded(page, DAY);
  await choose(page, DEFAULT_FUELLER);
  await installHover(page, [400, 1000]);
  // Schweben und gleich danach mit › blättern, alles im Browser gemessen ab der Schwebe-Meldung: wann die alte Fläche aus der
  // Seite ist und ob dann noch eine Spitze zu sehen ist, und wann die alte Fläche ihre Spitze selbst entfernt hat. Das tut sie
  // beim Abbau, den Preact einen Augenblick nach dem Entfernen ausführt.
  const turn = await page.evaluate(
    ({ selector, next }) =>
      new Promise<{ before: boolean; gone: number; shown: boolean; removed: number | null }>((done) => {
        const surface = document.querySelector('[data-testid="surface"]')!;
        const start = performance.now();
        (window as unknown as Hovering).__hover();
        const tip = document.querySelector(selector);
        document.querySelector<HTMLAnchorElement>(next)!.click();
        const removed = (gone: number, shown: boolean) => {
          const ms = performance.now() - start;
          if (tip?.parentNode === null || ms > 1000) return done({ before: tip !== null, gone, shown, removed: tip?.parentNode === null ? ms : null });
          setTimeout(() => removed(gone, shown), 5);
        };
        const away = () => {
          if (surface.isConnected) return void requestAnimationFrame(away);
          removed(performance.now() - start, tip?.isConnected === true || document.querySelector(selector) !== null);
        };
        away();
      }),
    { selector: TIP, next: NEXT_DAY },
  );
  const report = JSON.stringify(turn);
  expect(turn.before, report).toBe(true);
  // Die alte Fläche ist schneller weg als die Haltezeit von 300 ms, und mit ihr ist keine Spitze mehr zu sehen.
  expect(turn.gone, report).toBeLessThan(300);
  expect(turn.shown, report).toBe(false);
  // Sie hat ihre Spitze auch selbst entfernt, lange bevor die Haltezeit sie entfernt hätte: Der Abbau räumt sie weg.
  expect(turn.removed, report).not.toBeNull();
  expect(turn.removed!, report).toBeLessThan(250);
  await waitForPageOf(page, '2026-10-30');
  expect(await tipCount(page), 'auf der neuen Seite').toBe(0);
});

test('the tip keeps the direction of the last stroke on the next page', async ({ page }) => {
  await openSeeded(page, DAY);
  await choose(page, DEFAULT_FUELLER);
  const nib = pen(page, { tiltX: -40, tiltY: 40 });
  await nib.stroke(line([200, 800], [400, 860], 30));
  await expect.poll(() => strokeCount(page)).toBe(1);
  // Die neue Seite baut ihre eigene Fläche. Die Spitze steht trotzdem wie beim letzten Strich, nicht wie bei einem Rechtshänder.
  await page.locator(NEXT_DAY).click();
  await waitForPageOf(page, '2026-10-30');
  await nib.hover(300, 1000);
  await expect(page.locator(TIP)).toBeVisible();
  expect(axisApart((await tipOf(page))!.angle, penAngle(-40, 40)! + Math.PI / 2), 'nach dem Blättern').toBeLessThanOrEqual(3);
});

test('hovering measures the surface once, not with every report', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await installHover(page, [400, 1000]);
  // Wo die Fläche auf dem Bildschirm liegt, zu messen, erzwingt ein Layout. Gezählt wird bei 20 Schwebe-Meldungen hintereinander.
  const measured = await page.evaluate(() => {
    const surface = document.querySelector<HTMLElement>('[data-testid="surface"]')!;
    const measure = surface.getBoundingClientRect.bind(surface);
    let count = 0;
    surface.getBoundingClientRect = () => {
      count++;
      return measure();
    };
    for (let i = 0; i < 20; i++) (window as unknown as Hovering).__hover();
    delete (surface as { getBoundingClientRect?: unknown }).getBoundingClientRect;
    return count;
  });
  expect(measured, 'Messungen bei 20 Schwebe-Meldungen').toBeLessThanOrEqual(1);
  // Die Spitze steht trotzdem dort, wo der Stift ist.
  const where = await clientOf(page, [400, 1000]);
  const tip = (await tipOf(page))!;
  expect(Math.hypot(tip.x - where.x, tip.y - where.y), 'Abstand der Mitte vom Stift').toBeLessThanOrEqual(2);
});

test('the tip goes at once when the page can no longer be written', async ({ page }) => {
  // Mit Netz und einer Datei der Seite: Ein anderes Gerät macht sie kaputt, und die App merkt es, wenn sie in den Vordergrund kommt.
  const empty = serializePage({ kind: 'tag', key: '2026-10-29', meta: {}, strokes: [] }, [], '');
  const repo = await openSeeded(page, DAY, { files: { [TAG]: empty }, settings: { ink: inkWith(DEFAULT_FUELLER) } });
  await expect.poll(() => lastHead(page)).not.toBeNull();
  await installHover(page, [400, 1000]);
  // Der Stift schwebt weiter, alle 50 ms eine Meldung. In dem Moment, in dem die Seite zeigt, dass sie sich nicht lesen lässt
  // (dann ist sie gesperrt), wird festgehalten, ob die Spitze noch steht. Ohne Meldung dazwischen ginge sie erst nach 300 ms.
  await page.evaluate(
    ({ selector, text }) => {
      const w = window as unknown as Hovering & { __tipWhenLocked?: boolean };
      const timer = setInterval(w.__hover, 50);
      w.__hover();
      const watch = new MutationObserver(() => {
        if (!document.body.textContent?.includes(text)) return;
        w.__tipWhenLocked = document.querySelector(selector) !== null;
        watch.disconnect();
        clearInterval(timer);
      });
      watch.observe(document.body, { childList: true, subtree: true, characterData: true });
    },
    { selector: TIP, text: UNREADABLE },
  );
  expect(await tipCount(page), 'beim Schweben').toBe(1);
  repo.commit(TAG, BROKEN);
  await bringToForeground(page);
  await expect(page.getByText(UNREADABLE)).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as { __tipWhenLocked?: boolean }).__tipWhenLocked), 'Spitze, als die Seite gesperrt wurde').toBe(false);
  expect(await tipCount(page)).toBe(0);
});

// ---------- Das Regler-Fenster ----------

const PANEL = '.fueller-fenster';
const SHIELD = '.fueller-schutz';
const QUICK = '[data-testid="quick-switch"]';
const SLIDER_NAMES = ['Schärfe der Spitze', 'Druckempfindlichkeit', 'Rundung der Spitze', 'Strich-Stabilisierung'];
/** Neben dem Fenster: ein Ort im Notizfeld, weit unter dem Fenster an der Werkzeugleiste. */
const BESIDE: [number, number] = [200, 1000];

type Regler = keyof FuellerSettings;
/** Die Zeile eines Reglers mit Name, Wert und dem Feld, das Stift, Finger und Maus annimmt. */
const row = (key: Regler) => `${PANEL} [data-regler="${key}"]`;
const field = (key: Regler) => `${row(key)} .fueller-feld`;
const slider = (page: Page, key: Regler) => page.locator(`${row(key)} input[type="range"]`);
const valueText = (page: Page, key: Regler) => page.locator(`${row(key)} .fueller-wert`);
const previewOf = (page: Page) => page.locator(`${PANEL} .fueller-vorschau path`).getAttribute('d');
const toolbarButton = (page: Page, label: string) => page.locator(`.werkzeuge button[aria-label="${label}"]`);
const savedFueller = async (page: Page) => ((await savedSettings(page))?.ink as InkPrefs | undefined)?.fueller;
/** Stift und Handballen: Finger gelten erst 250 ms nach dem Abheben des Stifts wieder (siehe `GestureFilter`). */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);

/** Öffnet das Fenster mit einem zweiten Tipp auf die Füllfeder in der Werkzeugleiste: Sie ist schon gewählt. */
async function openFromToolbar(page: Page): Promise<void> {
  await toolbarButton(page, 'Füllfeder').click();
  await expect(page.locator(PANEL)).toBeVisible();
}

/** Das Fenster steht in der Mitte der Bühne. */
async function expectCentred(page: Page): Promise<void> {
  const panel = page.locator(PANEL);
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-at', 'mitte');
  const box = (await panel.boundingBox())!;
  const stage = (await page.locator('.buehne').boundingBox())!;
  expect(Math.abs(box.x + box.width / 2 - (stage.x + stage.width / 2)), 'waagrecht').toBeLessThanOrEqual(1);
  expect(Math.abs(box.y + box.height / 2 - (stage.y + stage.height / 2)), 'senkrecht').toBeLessThanOrEqual(1);
}

/** Linker und rechter Rand und Mitte des Felds eines Reglers, in Bildschirmkoordinaten. */
const fieldBox = (page: Page, key: Regler) =>
  page.locator(field(key)).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { left: r.left + 1, right: r.right - 1, x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });

/** Der Stift tippt einen Regler ganz links (0 %) oder ganz rechts (100 %) an. */
async function penOnSlider(page: Page, key: Regler, end: 'left' | 'right'): Promise<void> {
  const box = await fieldBox(page, key);
  await pen(page).downOn(field(key), box[end], box.y);
  await pen(page).upOn(field(key), box[end], box.y);
}

type Kind = 'pen' | 'touch' | 'mouse';
type At = { x: number; y: number };
type ScreenEvent = At & { type: 'pointerdown' | 'pointermove' | 'pointerup' };

/**
 * Zeigerereignisse wie auf dem Bildschirm: Jedes geht an das Element, das an seinem Ort zuoberst liegt (Schutzfeld, Fenster oder
 * Fläche), nicht an ein ausgesuchtes. So zeigt sich, ob etwas über der Seite liegt. Orte in Bildschirmkoordinaten.
 */
async function onScreen(page: Page, kind: Kind, events: ScreenEvent[]): Promise<void> {
  await page.evaluate(
    ({ pointerType, pointerId, list }) => {
      for (const ev of list) {
        const el = document.elementFromPoint(ev.x, ev.y);
        if (!el) throw new Error(`Nichts bei ${ev.x}, ${ev.y}.`);
        el.dispatchEvent(
          new PointerEvent(ev.type, {
            pointerId,
            pointerType,
            isPrimary: true,
            pressure: 0.5,
            width: 1,
            height: 1,
            clientX: ev.x,
            clientY: ev.y,
            button: ev.type === 'pointermove' ? -1 : 0,
            buttons: ev.type === 'pointerup' ? 0 : 1,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }
    },
    { pointerType: kind, pointerId: { mouse: 1, pen: 11, touch: 21 }[kind], list: events },
  );
}

/** Die Klasse des Elements, das an diesem Ort zuoberst liegt. */
const topmost = (page: Page, at: At) => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('class') ?? null, at);

/** Der Stift schwebt über einem Ort (Bildschirmkoordinaten): `pointermove` ohne Taste und Druck an das, was dort zuoberst liegt. */
const hoverOnScreen = (page: Page, at: At) =>
  page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) throw new Error(`Nichts bei ${x}, ${y}.`);
    const init = { pointerId: 11, pointerType: 'pen', isPrimary: true, pressure: 0, clientX: x, clientY: y, button: -1, buttons: 0 };
    el.dispatchEvent(new PointerEvent('pointermove', { ...init, bubbles: true, cancelable: true, composed: true }));
  }, at);

/** Fenster und Schutzfeld sind weg, auf dem Papier liegt nichts mehr, und ein Strich des Stifts schreibt dort. */
async function writesAgain(page: Page, y: number): Promise<void> {
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator(SHIELD)).toHaveCount(0);
  const points = await page.evaluate((list) => list.map(([x, py]) => window.__notizbuch.toClient(x, py)), line([200, y], [320, y + 20], 8));
  expect(await topmost(page, points[0]), 'zuoberst auf dem Papier').not.toBe('fueller-schutz');
  const before = await strokeCount(page);
  await onScreen(page, 'pen', [
    { type: 'pointerdown', ...points[0] },
    ...points.slice(1).map((p): ScreenEvent => ({ type: 'pointermove', ...p })),
    { type: 'pointerup', ...points[points.length - 1] },
  ]);
  await expect.poll(() => strokeCount(page)).toBe(before + 1);
}

test('a second tap on the fountain pen opens the panel in the toolbar, the ring and the tab', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  // Die erste Wahl wählt nur.
  await toolbarButton(page, 'Füllfeder').click();
  await expect(toolbarButton(page, 'Füllfeder')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(PANEL)).toHaveCount(0);

  // Der zweite Tipp öffnet das Fenster unter dem Knopf. Der Knopf bleibt gewählt.
  await toolbarButton(page, 'Füllfeder').click();
  const panel = page.getByRole('dialog', { name: 'Füllfeder' });
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute('data-at', 'leiste');
  await expect(page.locator(`${PANEL} .fueller-titel`)).toHaveText('Füllfeder');
  await expect(toolbarButton(page, 'Füllfeder')).toHaveAttribute('aria-pressed', 'true');
  const button = (await toolbarButton(page, 'Füllfeder').boundingBox())!;
  const box = (await panel.boundingBox())!;
  expect(box.y, 'unter dem Knopf').toBeGreaterThanOrEqual(button.y + button.height);
  expect(box.y, 'gleich unter dem Knopf').toBeLessThan(button.y + button.height + 30);
  expect(box.x, 'unter dem Knopf').toBeLessThanOrEqual(button.x + button.width / 2);
  expect(box.x + box.width, 'unter dem Knopf').toBeGreaterThanOrEqual(button.x + button.width / 2);

  // Die Vorschau in der Tintenfarbe, darunter vier Regler von 0 bis 100 mit Namen und Wert, jeder mindestens 44 Punkte hoch.
  const path = page.locator(`${PANEL} .fueller-vorschau path`);
  expect(await path.getAttribute('d')).toMatch(/^M -?[\d.]+ -?[\d.]+ Q /);
  expect(await path.getAttribute('fill')).toBe(INK.schwarz);
  const sliders = page.locator(`${PANEL} input[type="range"]`);
  expect(await sliders.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(SLIDER_NAMES);
  expect(await sliders.evaluateAll((els) => els.map((el) => ['min', 'max', 'step'].map((a) => el.getAttribute(a))))).toEqual(Array(4).fill(['0', '100', '1']));
  expect(await sliders.evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value))).toEqual(['100', '25', '33', '14']);
  expect(await page.locator(`${PANEL} .fueller-name`).allTextContents()).toEqual(SLIDER_NAMES);
  expect(await page.locator(`${PANEL} .fueller-wert`).allTextContents()).toEqual(['Scharf', '25 %', '33 %', '14 %']);
  const heights = await page.locator(`${PANEL} .fueller-feld, ${PANEL} input[type="range"]`).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
  expect(heights).toHaveLength(8);
  for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);

  // Im Rad: Der Ring schließt wie bei jeder Wahl, das Fenster steht in der Mitte der Bühne.
  await choose(page, DEFAULT_FUELLER, { vollbild: { an: true, werkzeuge: 'kreis' } });
  await touch(page).tapOn(QUICK);
  await expect(page.locator('.ring-knopf').first()).toBeVisible();
  await touch(page).tapOn('.ring-knopf[aria-label="Füllfeder"]');
  await expect(page.locator('.ring-knopf')).toHaveCount(0);
  await expectCentred(page);

  // In der Lasche: Sie bleibt offen, das Fenster steht in der Mitte der Bühne.
  await choose(page, DEFAULT_FUELLER, { vollbild: { an: true, werkzeuge: 'tab' } });
  await touch(page).tapOn('button.lasche');
  await touch(page).tapOn('.lasche-knopf[aria-label="Füllfeder"]');
  await expectCentred(page);
  await expect(page.locator('.lasche-leiste')).toHaveCount(1);
  expect(await savedFueller(page)).toEqual(DEFAULT_FUELLER);
});

test('moving a slider changes the preview and the next stroke', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await openFromToolbar(page);
  const start = await previewOf(page);

  // Rundung ganz nach rechts: Wert und Vorschau ändern sich sofort.
  await penOnSlider(page, 'rundung', 'right');
  await expect(valueText(page, 'rundung')).toHaveText('100 %');
  await expect(slider(page, 'rundung')).toHaveValue('100');
  const round = await previewOf(page);
  expect(round).not.toBe(start);
  // Schärfe ganz nach links: runde Enden.
  await penOnSlider(page, 'schaerfe', 'left');
  await expect(valueText(page, 'schaerfe')).toHaveText('Rund');
  await expect(slider(page, 'schaerfe')).toHaveValue('0');
  expect(await previewOf(page)).not.toBe(round);

  // Das Fenster zu, dann schreibt der Stift mit den neuen Reglern: runde Spitze ohne Verjüngung, überall dieselbe Breite.
  const beside = await clientOf(page, BESIDE);
  await onScreen(page, 'pen', [
    { type: 'pointerdown', ...beside },
    { type: 'pointerup', ...beside },
  ]);
  await expect(page.locator(SHIELD)).toHaveCount(0);
  await pen(page).stroke(line([200, 800], [400, 860], 40));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  const widths = widthsOf(strokePaths(await savedPage(page))[0]);
  expect(widths.length, 'Punkte in data-linie').toBeGreaterThan(20);
  expect(uneven(widths), `Breiten ${widths.join(' ')}`).toEqual([]);
});

test('a tap next to the panel closes it and writes nothing', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  const beside = await clientOf(page, BESIDE);

  // Der Stift schwebt neben dem Fenster und über ihm: Die Fläche darunter hört davon nichts, sie zeigt keine Spitze.
  await openFromToolbar(page);
  expect(await topmost(page, beside), 'neben dem Fenster liegt das Schutzfeld').toBe('fueller-schutz');
  for (const at of [beside, await centerOf(page, PANEL)]) await hoverOnScreen(page, at);
  expect(await tipCount(page), 'Spitze unter dem Fenster').toBe(0);

  // Stift und Maus: Das Fenster geht beim Aufsetzen, das Schutzfeld erst beim Abheben, damit auch das Ende nichts darunter trifft.
  for (const kind of ['pen', 'mouse'] as const) {
    if (kind === 'mouse') await openFromToolbar(page);
    await onScreen(page, kind, [{ type: 'pointerdown', ...beside }]);
    await expect(page.locator(PANEL), kind).toHaveCount(0);
    await expect(page.locator(SHIELD), kind).toHaveCount(1);
    await onScreen(page, kind, [{ type: 'pointerup', ...beside }]);
    await expect(page.locator(SHIELD), kind).toHaveCount(0);
    if (kind === 'pen') {
      // Gegenprobe: Ohne Fenster zeigt das Schweben dort die Spitze.
      await hoverOnScreen(page, beside);
      expect(await tipCount(page), 'Spitze ohne Fenster').toBe(1);
    }
  }

  // Ein Finger schließt es beim Abheben, wenn das Tor ihn als Finger annimmt.
  await afterPalmWindow(page);
  await openFromToolbar(page);
  await onScreen(page, 'touch', [{ type: 'pointerdown', ...beside }]);
  await expect(page.locator(PANEL)).toBeVisible();
  await onScreen(page, 'touch', [{ type: 'pointerup', ...beside }]);
  await expect(page.locator(SHIELD)).toHaveCount(0);

  // Keiner dieser Tipps hat geschrieben. Jetzt liegt dort wieder das Papier, und der Stift schreibt.
  expect(await strokeCount(page)).toBe(0);
  expect(await savedPage(page)).toBe('');
  await writesAgain(page, 1000);
});

test('a hand next to the panel or on a slider changes nothing', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await openFromToolbar(page);
  const beside = await clientOf(page, BESIDE);
  const druck = await fieldBox(page, 'druck');
  const rundung = await fieldBox(page, 'rundung');

  // Der Stift schiebt die Druckempfindlichkeit, die Hand liegt neben dem Fenster und auf der Rundung.
  await pen(page).downOn(field('druck'), druck.right, druck.y);
  await expect(slider(page, 'druck')).toHaveValue('100');
  await touch(page).downOn(SHIELD, beside.x, beside.y);
  await touch(page, 1).downOn(field('rundung'), rundung.left, rundung.y);
  expect(await slider(page, 'rundung').inputValue(), 'Hand auf der Rundung').toBe('33');
  await touch(page, 1).moveOn(field('rundung'), rundung.left + 20, rundung.y);
  await pen(page).moveOn(field('druck'), druck.x, druck.y);
  await pen(page).upOn(field('druck'), druck.x, druck.y);
  await afterPalmWindow(page);
  await touch(page).upOn(SHIELD, beside.x, beside.y);
  await touch(page, 1).upOn(field('rundung'), rundung.left + 20, rundung.y);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(slider(page, 'druck')).toHaveValue('50');
  await expect(slider(page, 'rundung')).toHaveValue('33');

  // Ein Handballen (große Auflage) schließt das Fenster nicht und schiebt keinen Regler, auch nach der Pause des Stifts.
  await palm(page).downOn(SHIELD, beside.x, beside.y);
  await palm(page).upOn(SHIELD, beside.x, beside.y);
  await palm(page).downOn(field('rundung'), rundung.left, rundung.y);
  expect(await slider(page, 'rundung').inputValue(), 'Handballen auf der Rundung').toBe('33');
  await palm(page).upOn(field('rundung'), rundung.left, rundung.y);
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(slider(page, 'rundung')).toHaveValue('33');

  // Ein Finger auf einem Regler, der schon lag, als der Stift aufsetzte, war die Hand: Was er geschoben hat, gilt nicht.
  await touch(page).downOn(field('rundung'), rundung.right, rundung.y);
  await expect(slider(page, 'rundung')).toHaveValue('100');
  await pen(page).downOn(field('druck'), druck.left, druck.y);
  await expect(slider(page, 'rundung')).toHaveValue('33');
  await pen(page).upOn(field('druck'), druck.left, druck.y);
  await afterPalmWindow(page);
  await touch(page).upOn(field('rundung'), rundung.right, rundung.y);
  await expect(slider(page, 'rundung')).toHaveValue('33');
  await expect(slider(page, 'druck')).toHaveValue('0');
  await expect.poll(() => savedFueller(page)).toEqual({ ...DEFAULT_FUELLER, druck: 0 });
});

test('the settings survive a reload', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await openFromToolbar(page);
  // Mit der Tastatur ein Schritt nach rechts, und ein Wert direkt gesetzt, wie es Hilfen der Bedienung tun.
  await slider(page, 'stabil').press('ArrowRight');
  await slider(page, 'druck').fill('60');
  await expect(valueText(page, 'stabil')).toHaveText('15 %');
  await expect(valueText(page, 'druck')).toHaveText('60 %');
  const changed = { ...DEFAULT_FUELLER, druck: 0.6, stabil: 0.15 };
  await expect.poll(() => savedFueller(page)).toEqual(changed);

  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await openFromToolbar(page);
  await expect(slider(page, 'druck')).toHaveValue('60');
  await expect(valueText(page, 'druck')).toHaveText('60 %');
  await expect(slider(page, 'stabil')).toHaveValue('15');
  await expect(valueText(page, 'stabil')).toHaveText('15 %');
  await expect(slider(page, 'schaerfe')).toHaveValue('100');
});

test('the panel never stays over the page', async ({ page }) => {
  await openSeeded(page, DAY);
  await choose(page, DEFAULT_FUELLER);

  // Blättern mit › in der Leiste oben.
  await openFromToolbar(page);
  await page.getByRole('link', { name: 'Nächster Tag' }).click();
  await waitForPageOf(page, '2026-10-30');
  await writesAgain(page, 800);

  // Das Vollbild geht an (Knopf in der Leiste oben).
  await openFromToolbar(page);
  await page.getByRole('button', { name: 'Vollbild', exact: true }).click();
  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await writesAgain(page, 900);

  // Das Vollbild geht aus: Die Lasche liegt unter dem Schutzfeld, mit der Tastatur erreicht man sie trotzdem.
  await choose(page, DEFAULT_FUELLER, { vollbild: { an: true, werkzeuge: 'tab' } });
  await touch(page).tapOn('button.lasche');
  await touch(page).tapOn('.lasche-knopf[aria-label="Füllfeder"]');
  await expect(page.locator(PANEL)).toBeVisible();
  await page.locator('.lasche-knopf[aria-label="Vollbild aus"]').press('Enter');
  await expect(page.locator('main#app')).not.toHaveClass(/vollbild/);
  await writesAgain(page, 1000);

  // Ein anderes Werkzeug. Wieder die Füllfeder: Das wählt sie nur.
  await openFromToolbar(page);
  await toolbarButton(page, 'Radierer').click();
  await expect(page.locator(PANEL)).toHaveCount(0);
  await toolbarButton(page, 'Füllfeder').click();
  await writesAgain(page, 1100);

  // Die App geht in den Hintergrund.
  await openFromToolbar(page);
  await sendToBackground(page);
  await expect(page.locator(PANEL)).toHaveCount(0);
  await bringToForeground(page);
  await writesAgain(page, 1200);
});

test('Escape closes the panel, and the toolbar button says whether it is open', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  const button = toolbarButton(page, 'Füllfeder');
  // Die gewählte Füllfeder öffnet und schließt ihr Fenster: Ihr Knopf sagt, ob es offen ist.
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await openFromToolbar(page);
  await expect(button).toHaveAttribute('aria-expanded', 'true');

  // Escape, während der Fokus noch auf dem Knopf steht (wie nach Enter auf ihm).
  await button.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(page.locator(SHIELD)).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');

  // Mit Enter wieder auf, Escape auf einem Regler: zu, und der Regler bleibt, wie er war.
  await button.press('Enter');
  await expect(page.locator(PANEL)).toBeVisible();
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await slider(page, 'druck').press('Escape');
  await expect(page.locator(PANEL)).toHaveCount(0);
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  expect(await savedFueller(page)).toEqual(DEFAULT_FUELLER);
  // Escape schreibt nichts, und danach liegt wieder das Papier oben.
  expect(await strokeCount(page)).toBe(0);
  expect(await savedPage(page)).toBe('');
  await writesAgain(page, 1000);

  // Ist ein anderer Stift gewählt, wählt ein Tipp auf die Füllfeder nur: Dann sagt ihr Knopf nichts über ein Fenster.
  await toolbarButton(page, 'Kugelschreiber').click();
  await expect(button).not.toHaveAttribute('aria-expanded');
});

test('a touch is held back on the shield, not in the panel', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, DEFAULT_FUELLER);
  await openFromToolbar(page);
  /** Ob `touchstart` an diesem Element verhindert wird: Dann blättert der Browser nicht und macht aus der Berührung keinen Klick. */
  const heldBack = (selector: string) =>
    page.evaluate((sel) => {
      const ev = new Event('touchstart', { bubbles: true, cancelable: true });
      document.querySelector(sel)!.dispatchEvent(ev);
      return ev.defaultPrevented;
    }, selector);
  expect(await heldBack(field('rundung')), 'auf einem Regler').toBe(false);
  expect(await heldBack(`${PANEL} .fueller-vorschau`), 'auf der Vorschau').toBe(false);
  expect(await heldBack(PANEL), 'im Fenster').toBe(false);
  expect(await heldBack(SHIELD), 'auf dem Schutzfeld').toBe(true);
  await expect(page.locator(PANEL)).toBeVisible();
});

test.describe('with a touch screen', () => {
  // So niedrig, dass das Fenster an der Werkzeugleiste höher ist, als die Bühne Platz hat.
  test.use({ hasTouch: true, viewport: { width: 1200, height: 420 } });

  test('a finger scrolls a panel that is taller than the stage', async ({ page }) => {
    await openSeeded(page, DAY, { offline: true });
    await choose(page, DEFAULT_FUELLER);
    await openFromToolbar(page);
    const panel = page.locator(PANEL);
    expect(await panel.evaluate((el) => el.scrollHeight - el.clientHeight), 'so viel ist das Fenster zu hoch (Punkte)').toBeGreaterThan(40);
    // Ein Finger zieht auf der Vorschau nach oben, wie man eine Liste blättert. Das Fenster blättert, es bleibt offen.
    const preview = (await page.locator(`${PANEL} .fueller-vorschau`).boundingBox())!;
    const x = preview.x + preview.width / 2;
    const y = preview.y + preview.height / 2;
    await (await touchscreen(page)).swipe([x, y], [x, y - 60]);
    await expect.poll(() => panel.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await expect(panel).toBeVisible();
    expect(await savedFueller(page)).toEqual(DEFAULT_FUELLER);
  });
});
