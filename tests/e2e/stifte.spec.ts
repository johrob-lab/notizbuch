import { expect, test as base, type Page } from '@playwright/test';
import { BLEISTIFT_OPACITY, type PenKind } from '../../src/ink/pens';
import { changeStoredSettings, openSeeded, queued } from './helpers/app';
import { colorAt, inkNear, pen, wheel } from './helpers/pointer';

// Die neuen Stifte auf der Schreibfläche. Bis die Werkzeugleiste den Stift wählen kann, wählt ihn jeder Test über die
// gespeicherte Werkzeugwahl und lädt die App neu.

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
const LIVE = 'canvas[data-layer="live"]';
const PREDICTION = 'canvas[data-layer="vorhersage"]';

/** Wählt den Stift über die gespeicherte Werkzeugwahl (alle Felder ausgeschrieben) und lädt neu. */
async function choosePen(page: Page, chosen: PenKind): Promise<void> {
  await changeStoredSettings(page, {
    ink: { tool: 'pen', pen: chosen, color: 'schwarz', width: 'mittel', eraserSize: 'mittel', eraserMode: 'strich', scribble: true },
  });
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
}

/** Die Seite, wie sie auf dem Gerät gespeichert ist. Ohne Netz bleibt sie in der Warteschlange und wird nicht hochgeladen. */
const savedPage = async (page: Page): Promise<string> => (await queued(page))[TAG] ?? '';

/** Die <path>-Elemente der Striche einer gespeicherten Seite. Die Linien des Hintergrunds haben keine `data-id`. */
const strokePaths = (svg: string): string[] => svg.match(/<path data-id=[^>]*>/g) ?? [];

const attr = (path: string, name: string): string | undefined => new RegExp(` ${name}="([^"]*)"`).exec(path)?.[1];

const strokeTools = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.map((s) => s.tool));

/** `n` Punkte in gleichen Abständen auf der Strecke von `from` nach `to`. */
const line = (from: [number, number], to: [number, number], n: number): [number, number][] =>
  Array.from({ length: n }, (_, i): [number, number] => [from[0] + ((to[0] - from[0]) * i) / (n - 1), from[1] + ((to[1] - from[1]) * i) / (n - 1)]);

/** Die Mittellinie aus `data-linie` (x y w je Punkt). */
function centreLine(path: string): { x: number; y: number; w: number }[] {
  const nums = (attr(path, 'data-linie') ?? '').trim().split(/\s+/).map(Number);
  const pts: { x: number; y: number; w: number }[] = [];
  for (let i = 0; i + 2 < nums.length; i += 3) pts.push({ x: nums[i], y: nums[i + 1], w: nums[i + 2] });
  return pts;
}

test('each pen writes its tool into the file', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  const pens: PenKind[] = ['fineliner', 'fueller', 'bleistift'];
  for (const [i, chosen] of pens.entries()) {
    await choosePen(page, chosen);
    await pen(page).stroke(line([200, 760 + 80 * i], [400, 780 + 80 * i], 12));
    await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(i + 1);
  }
  const svg = await savedPage(page);
  expect(svg).toContain('data-notizbuch="2"');
  const paths = strokePaths(svg);
  expect(paths.map((path) => attr(path, 'data-werkzeug')).sort()).toEqual(['bleistift', 'fineliner', 'fueller']);
  // Füllfeder und Bleistift sind Formen: Die Mittellinie mit der Breite je Punkt steht in `data-linie`.
  for (const path of paths) expect(attr(path, 'data-linie') !== undefined, path).toBe(attr(path, 'data-werkzeug') !== 'fineliner');
});

/**
 * Zwei gleich lange Striche mit der Füllfeder bei derselben Neigung, einer nach rechts unten, einer nach rechts oben, je 60
 * Punkte (damit die geglättete Richtung steht). Gibt die mittlere Breite beider aus `data-linie` zurück.
 */
async function twoDiagonals(page: Page, tilt: { tiltX: number; tiltY: number }): Promise<{ down: number; up: number }> {
  await openSeeded(page, DAY, { offline: true });
  await choosePen(page, 'fueller');
  const nib = pen(page, { ...tilt, pressure: 0.45 });
  await nib.stroke(line([200, 800], [320, 920], 60)); // nach rechts unten
  await nib.stroke(line([200, 1200], [320, 1080], 60)); // nach rechts oben, gleich lang
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(2);
  const lines = strokePaths(await savedPage(page)).map(centreLine);
  expect(lines.map((pts) => pts.length >= 30), 'beide mit mindestens 30 Punkten in data-linie').toEqual([true, true]);
  // Der Strich, der am weitesten nach unten läuft, zuerst.
  const drop = (pts: { y: number }[]) => pts[pts.length - 1].y - pts[0].y;
  const [down, up] = [...lines].sort((a, b) => drop(b) - drop(a));
  expect(drop(down)).toBeGreaterThan(0);
  expect(drop(up)).toBeLessThan(0);
  const mean = (pts: { w: number }[]) => pts.reduce((sum, p) => sum + p.w, 0) / pts.length;
  return { down: mean(down), up: mean(up) };
}

test('the fountain pen is wider along the pen than across it', async ({ page }) => {
  // Der Stift zeigt nach rechts unten wie bei einem Rechtshänder: Der Strich nach rechts unten läuft entlang der Feder.
  const { down, up } = await twoDiagonals(page, { tiltX: 40, tiltY: 40 });
  expect(down).toBeGreaterThan(2 * up);
});

test('held the other way, the fountain pen is wide on the other diagonal', async ({ page }) => {
  // Mit 40 und 40 zeigt der Stift dorthin, wo auch die feste Lage ohne Neigung hinzeigt. Hier zeigt er nach links unten
  // (linke Hand), und der Strich nach rechts oben läuft entlang der Feder: So zeigt sich, dass die Neigung ankommt.
  const { down, up } = await twoDiagonals(page, { tiltX: -40, tiltY: 40 });
  expect(up).toBeGreaterThan(2 * down);
});

test('a tap with the fountain pen leaves a dot', async ({ page }) => {
  await openSeeded(page, DAY);
  await choosePen(page, 'fueller');
  await pen(page).tap(400, 1053);
  await expect.poll(() => strokeTools(page)).toEqual(['fueller']);
  expect(await inkNear(page, [400, 1053])).toBeGreaterThan(0);
});

test('a pencil stroke is grey and see through', async ({ page }) => {
  await openSeeded(page, DAY);
  await choosePen(page, 'bleistift');
  // Hineingezoomt ist der Strich einige Bildpunkte breit: Die Proben auf seiner Mitte liegen ganz im Strich, nicht am Rand.
  await wheel(page, [350, 1010], { dy: -400, ctrl: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  await pen(page).stroke(line([250, 1010], [450, 1010], 60)); // zwischen zwei Linien des Notizfelds
  await expect.poll(() => strokeTools(page)).toEqual(['bleistift']);
  expect(await inkNear(page, [350, 1010])).toBeGreaterThan(0);
  const samples = [await colorAt(page, [300, 1010]), await colorAt(page, [350, 1010]), await colorAt(page, [400, 1010])];
  // Grau: alle drei Farbkanäle fast gleich.
  for (const c of samples) expect(Math.max(...c) - Math.min(...c), `Farbe ${c.join(', ')}`).toBeLessThan(30);
  // Durchscheinend: Das Papier hellt das Graphitgrau #4a4e55 auf (wo die Körnung deckt) oder scheint ganz durch.
  const grau = [0x4a, 0x4e, 0x55];
  expect(
    samples.some((c) => c.every((v, i) => v > grau[i] + 20)),
    samples.map((c) => c.join(', ')).join(' | '),
  ).toBe(true);
  // Auch die dunkelste Stelle auf der Mitte des Strichs, wo die Körnung ganz deckt, ist heller als das Graphitgrau selbst.
  const centre = await Promise.all(line([260, 1010], [440, 1010], 37).map((at) => colorAt(page, at)));
  const darkest = centre.reduce((a, b) => (a[0] + a[1] + a[2] <= b[0] + b[1] + b[2] ? a : b));
  expect(darkest[0] + darkest[1] + darkest[2], `dunkelste Stelle ${darkest.join(', ')} ist Tinte`).toBeLessThan(450);
  expect(darkest.every((v, i) => v > grau[i] + 20), `dunkelste Stelle ${darkest.join(', ')}`).toBe(true);
});

test('the live layers are opaque again after a pencil stroke', async ({ page }) => {
  await openSeeded(page, DAY);
  await choosePen(page, 'bleistift');
  const opacity = (selector: string) => page.evaluate((sel) => document.querySelector<HTMLCanvasElement>(sel)!.style.opacity, selector);
  const writer = pen(page);
  await writer.down(200, 1010);
  await writer.move(230, 1012);
  await writer.move(260, 1010);
  // Beim Schreiben scheinen Live- und Vorhersage-Ebene als Ganzes durch, so wie der fertige Strich.
  expect(await opacity(LIVE)).toBe(String(BLEISTIFT_OPACITY));
  expect(await opacity(PREDICTION)).toBe(String(BLEISTIFT_OPACITY));
  await writer.up(260, 1010);
  expect(await opacity(LIVE)).toBe('');
  expect(await opacity(PREDICTION)).toBe('');
  await expect.poll(() => strokeTools(page)).toEqual(['bleistift']);
});
