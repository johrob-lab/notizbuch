import { expect, test as base, type Page } from '@playwright/test';
import { DEFAULT_FUELLER, DEFAULT_PEN_ANGLE, nibShape, penAngle, pressureFactor, type FuellerSettings, type PenKind } from '../../src/ink/pens';
import { INK, MM, WIDTH_MM } from '../../src/ink/types';
import type { InkPrefs } from '../../src/lib/settings';
import { changeStoredSettings, openSeeded, queued } from './helpers/app';
import { inkNear, mouse, onPixelCentre, pen, touch, viewOf, wheel } from './helpers/pointer';

// Die Füllfeder mit ihren Einstellungen auf der Schreibfläche und ihre Spitze, wenn der Stift über der Seite schwebt. Jeder
// Test wählt Stift und Einstellungen über die gespeicherte Werkzeugwahl und lädt die App neu.

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

/** Wählt die Füllfeder mit den Einstellungen `fueller` über die gespeicherte Werkzeugwahl und lädt neu. */
async function choose(page: Page, fueller: FuellerSettings): Promise<void> {
  await changeStoredSettings(page, { ink: inkWith(fueller) });
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
}

/** Die Seite, wie sie auf dem Gerät gespeichert ist. Ohne Netz bleibt sie in der Warteschlange und wird nicht hochgeladen. */
const savedPage = async (page: Page): Promise<string> => (await queued(page))[TAG] ?? '';

/** Die <path>-Elemente der Striche einer gespeicherten Seite. Die Linien des Hintergrunds haben keine `data-id`. */
const strokePaths = (svg: string): string[] => svg.match(/<path data-id=[^>]*>/g) ?? [];

const attr = (path: string, name: string): string | undefined => new RegExp(` ${name}="([^"]*)"`).exec(path)?.[1];

/** Die Breite je Punkt aus `data-linie` (dort stehen x, y und Breite je Punkt). */
const widthsOf = (path: string): number[] =>
  (attr(path, 'data-linie') ?? '')
    .trim()
    .split(/\s+/)
    .map(Number)
    .filter((_, i) => i % 3 === 2);

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
  const mean = even.reduce((sum, w) => sum + w, 0) / even.length;
  expect(even.filter((w) => Math.abs(w / mean - 1) > 0.02), `Breiten ${even.join(' ')}`).toEqual([]);

  // Flache, scharfe Spitze: spitze Enden, breite Mitte.
  await choose(page, { schaerfe: 1, druck: 0.25, rundung: 0, stabil: 0.14 });
  await pen(page).stroke(line([200, 1000], [400, 1060], 40));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(2);
  const sharp = widthsOf(strokePaths(await savedPage(page))[1]);
  const middle = sharp[Math.floor(sharp.length / 2)];
  expect(sharp[0], `Breiten ${sharp.join(' ')}`).toBeLessThan(middle / 2);
  expect(sharp[sharp.length - 1], `Breiten ${sharp.join(' ')}`).toBeLessThan(middle / 2);
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

test('the ends taper only after lifting the pen', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await choose(page, { schaerfe: 1, druck: 0.25, rundung: 0.33, stabil: 0.14 });
  // Hineingezoomt ist die Linie gut zehn Bildpunkte breit.
  await wheel(page, [440, 1010], { dy: -800, ctrl: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  const pts = line([400, 1010], [480, 1010], 41); // zwischen zwei Linien des Notizfelds
  const writer = pen(page);
  await writer.down(...pts[0]);
  for (const q of pts.slice(1)) await writer.move(...q);
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
