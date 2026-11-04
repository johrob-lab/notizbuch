import { expect, test as base, type Page } from '@playwright/test';
import { BLEISTIFT_OPACITY, DEFAULT_FUELLER, type PenKind } from '../../src/ink/pens';
import { StrokeBuilder } from '../../src/ink/stroke';
import { serializePage } from '../../src/ink/svg';
import { INK, PAPER, type WidthName } from '../../src/ink/types';
import { changeStoredSettings, openSeeded, queued, savedSettings } from './helpers/app';
import { colorAt, inkNear, onPixelCentre, pen, touch, wheel } from './helpers/pointer';

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
async function choosePen(page: Page, chosen: PenKind, width: WidthName = 'mittel'): Promise<void> {
  await changeStoredSettings(page, {
    ink: { tool: 'pen', pen: chosen, color: 'schwarz', width, eraserSize: 'mittel', eraserMode: 'strich', scribble: true, fueller: DEFAULT_FUELLER },
  });
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
}

/** `#rrggbb` als `[rot, grün, blau]`. */
const rgb = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

/** So sieht der fertige Bleistift auf dem Papier aus, wo die Körnung deckt: Graphitgrau mit der Deckkraft des Bleistifts. */
const pencilOnPaper = (): number[] => rgb(INK.grau).map((v, i) => BLEISTIFT_OPACITY * v + (1 - BLEISTIFT_OPACITY) * rgb(PAPER)[i]);

const describe = (c: number[]): string => c.map(Math.round).join(', ');

/**
 * Die Farben, wie man sie auf dem Bildschirm sieht (alle Ebenen übereinander, jede mit ihrer Deckkraft), im Rechteck
 * zwischen zwei Orten der Seite: ein Bildschirmfoto, das der Browser zurück in Bildpunkte liest.
 */
async function shownColours(page: Page, from: [number, number], to: [number, number]): Promise<number[][]> {
  const [a, b] = await page.evaluate(
    ([x0, y0, x1, y1]) => [window.__notizbuch.toClient(x0, y0), window.__notizbuch.toClient(x1, y1)],
    [...from, ...to],
  );
  const png = await page.screenshot({ clip: { x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y } });
  return page.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const out: number[][] = [];
    for (let i = 0; i < d.length; i += 4) out.push([d[i], d[i + 1], d[i + 2]]);
    return out;
  }, png.toString('base64'));
}

/** Die dunkelste Farbe einer Liste. */
const darkestOf = (colours: number[][]): number[] => colours.reduce((a, b) => (a[0] + a[1] + a[2] <= b[0] + b[1] + b[2] ? a : b));

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
  const pens: PenKind[] = ['fineliner', 'fueller'];
  for (const [i, chosen] of pens.entries()) {
    await choosePen(page, chosen);
    await pen(page).stroke(line([200, 760 + 80 * i], [400, 780 + 80 * i], 12));
    await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(i + 1);
  }
  const svg = await savedPage(page);
  expect(svg).toContain('data-notizbuch="2"');
  const paths = strokePaths(svg);
  expect(paths.map((path) => attr(path, 'data-werkzeug')).sort()).toEqual(['fineliner', 'fueller']);
  // Die Füllfeder ist eine Form: Die Mittellinie mit der Breite je Punkt steht in `data-linie`.
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
  // Der Punkt ist so breit wie die Linie, bei ganzer Seitenbreite etwa ein Bildpunkt: getippt wird auf die Mitte eines Bildpunkts.
  const at = await onPixelCentre(page, [400, 1053]);
  await pen(page).tap(...at);
  await expect.poll(() => strokeTools(page)).toEqual(['fueller']);
  expect(await inkNear(page, at)).toBeGreaterThan(0);
});

/**
 * Wie viele Bildpunkte rund um einen Ort der Seite auf der Live-Ebene mehr als halb decken. Dort steht beim Schreiben, was
 * schon fest ist. `radius` in Bildschirmpunkten.
 */
function liveInkNear(page: Page, at: [number, number], radius: number): Promise<number> {
  return page.evaluate(
    ({ at: [x, y], radius: r, selector }) => {
      const canvas = document.querySelector<HTMLCanvasElement>(selector)!;
      const box = canvas.getBoundingClientRect();
      const c = window.__notizbuch.toClient(x, y);
      const k = canvas.width / box.width;
      const left = Math.max(0, Math.round((c.x - box.left - r) * k));
      const top = Math.max(0, Math.round((c.y - box.top - r) * k));
      const size = Math.max(1, Math.round(2 * r * k));
      const data = canvas.getContext('2d')!.getImageData(left, top, size, size).data;
      let covered = 0;
      for (let i = 3; i < data.length; i += 4) if (data[i] > 128) covered++;
      return covered;
    },
    { at, radius, selector: LIVE },
  );
}

test.describe('in portrait on the iPad', () => {
  // So groß wie das iPad im Hochformat, zwei Bildpunkte je Punkt: Bei ganzer Seite ist ein Bildpunkt etwa 0,74 Seiteneinheiten.
  test.use({ viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2 });

  test('a thin fountain pen line stays visible at full page', async ({ page }) => {
    await openSeeded(page, DAY, { offline: true });
    await choosePen(page, 'fueller', 'fein');
    // Ein fester Abstrich entlang der Feder, breiter als ein Bildpunkt, und gleich danach ein leichter Aufstrich quer zur Feder.
    const down = line([200, 820], [300, 920], 40);
    const up = line([300, 920], [400, 820], 40).slice(1);
    // Proben auf dem Aufstrich, wo er schon ganz fein ist, weit weg vom Abstrich und vom Ende.
    const probes = [0.5, 0.6, 0.7, 0.8].map((f) => up[Math.round(f * (up.length - 1))]);
    /** Die Proben, an denen `count` keinen Bildpunkt mit Tinte findet. */
    const blank = async (count: (at: [number, number]) => Promise<number>) => {
      const out: [number, number][] = [];
      for (const at of probes) if ((await count(at)) === 0) out.push(at);
      return out;
    };
    expect(await blank((at) => inkNear(page, at, 3)), 'vorher ohne Tinte').toEqual(probes);
    const firm = pen(page, { pressure: 0.9 });
    const light = pen(page, { pressure: 0.05 });
    await firm.down(...down[0]);
    for (const q of down.slice(1)) await firm.move(...q);
    for (const q of up) await light.move(...q);
    const whileWriting = await blank((at) => liveInkNear(page, at, 3));
    await light.up(...up[up.length - 1]);
    await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
    const finished = await blank((at) => inkNear(page, at, 3));
    expect({ whileWriting, finished }, 'Proben ohne Tinte').toEqual({ whileWriting: [], finished: [] });
    // In der Datei stehen die echten Breiten: Der Aufstrich ist dort ein Fünftel Bildpunkt breit, der Abstrich mehr als einer.
    const widths = centreLine(strokePaths(await savedPage(page))[0]).map((p) => p.w);
    expect(Math.min(...widths)).toBeLessThanOrEqual(0.2);
    expect(Math.max(...widths)).toBeGreaterThan(0.74);
  });
});

/** Ein waagerechter Bleistiftstrich, wie ihn frühere Versionen der App gespeichert haben. */
function pencilPage(): string {
  const b = new StrokeBuilder({ pen: 'bleistift', color: 'schwarz', widthMm: 0.4, sigma: 1, t: 5000, minDist: 0.5 });
  for (let i = 0; i < 40; i++) b.add(250 + i * 5, 1010, 0.6, 20, 30);
  return serializePage({ kind: 'tag', key: '2026-10-29', meta: {}, strokes: [b.stroke()] }, [], '');
}

test('a page with pencil strokes is still drawn grey and grainy', async ({ page }) => {
  await openSeeded(page, DAY, { files: { [TAG]: pencilPage() } });
  expect(await strokeTools(page)).toEqual(['bleistift']);
  // Hineingezoomt ist der Strich einige Bildpunkte breit: Die Proben auf seiner Mitte liegen ganz im Strich, nicht am Rand.
  await wheel(page, [350, 1010], { dy: -400, ctrl: true });
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(done)));
  expect(await inkNear(page, [350, 1010])).toBeGreaterThan(0);
  const samples = await Promise.all(line([260, 1010], [440, 1010], 37).map((at) => colorAt(page, at)));
  // Grau: alle drei Farbkanäle fast gleich, auch die dunkelste Stelle.
  const darkest = darkestOf(samples);
  expect(Math.max(...darkest) - Math.min(...darkest), `Farbe ${describe(darkest)}`).toBeLessThan(30);
  // Durchscheinend und körnig: Wo die Körnung deckt, ist es Graphitgrau mit der Deckkraft des Bleistifts, dazwischen scheint das Papier durch.
  const want = pencilOnPaper();
  expect(darkest.every((v, i) => Math.abs(v - want[i]) <= 3), `dunkelste Stelle ${describe(darkest)}, erwartet ${describe(want)}`).toBe(true);
  expect(samples.some((c) => c.every((v, i) => v > want[i] + 20)), 'Stellen ohne Körnung').toBe(true);
});

// Die Wahl des Stifts in Leiste, Rad, Lasche und Schnellwechsel.

const QUICK = '[data-testid="quick-switch"]';
const NAMES = { kugel: 'Kugelschreiber', fineliner: 'Fineliner', fueller: 'Füllfeder' };
const COLOUR_LABELS = ['Schwarz', 'Blau', 'Rot (offen)', 'Grün (erledigt)'];
const ring = (page: Page) => page.locator('.ring-knopf');

/** Ein Knopf der Werkzeugleiste. */
const tool = (page: Page, label: string) => page.locator(`.werkzeuge button[aria-label="${label}"]`);
const savedPen = async (page: Page) => ((await savedSettings(page))?.ink as { pen?: string } | undefined)?.pen;
const lastColour = async (page: Page): Promise<string | undefined> => {
  const paths = strokePaths(await savedPage(page));
  return attr(paths[paths.length - 1] ?? '', 'data-farbe');
};

test('the toolbar shows four tools and no pencil', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  const toolGroup = page.locator('.werkzeuge [role="group"][aria-label="Werkzeug"] button');
  expect(await toolGroup.evaluateAll((els) => els.map((el) => [el.getAttribute('aria-label'), el.getAttribute('title')]))).toEqual(
    [...Object.values(NAMES), 'Radierer'].map((name) => [name, name]),
  );
  await expect(tool(page, 'Kugelschreiber')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.werkzeuge [aria-label="Farbe"]')).toBeVisible();
  const separators = await page.locator('.werkzeuge .sep').count();

  await expect(tool(page, 'Bleistift')).toHaveCount(0);
  for (const label of COLOUR_LABELS) await expect(tool(page, label)).toHaveCount(1);
  await expect(page.locator('.werkzeuge [aria-label="Breite"] button')).toHaveCount(3);
  expect(separators).toBeGreaterThan(0);
  for (const box of await toolGroup.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width))) expect(box).toBeGreaterThanOrEqual(44);
});

test('the colour stays when you switch pens', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await tool(page, 'Blau').click();
  await tool(page, 'Füllfeder').click();
  await pen(page).stroke(line([200, 800], [400, 820], 12));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(1);
  expect(await lastColour(page)).toBe('blau');

  await tool(page, 'Fineliner').click();
  await expect(tool(page, 'Blau')).toHaveAttribute('aria-pressed', 'true');
  await pen(page).stroke(line([200, 1000], [400, 1020], 12));
  await expect.poll(async () => strokePaths(await savedPage(page)).length).toBe(2);
  expect(await lastColour(page)).toBe('blau');
});

test('the toolbar stays on one line at 834 points, also with the eraser', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await openSeeded(page, DAY, { offline: true });
  const height = () => page.locator('.werkzeuge').evaluate((el) => el.getBoundingClientRect().height);
  expect(await height()).toBeLessThanOrEqual(46);
  await tool(page, 'Radierer').click();
  await expect(page.locator('.werkzeuge [aria-label="Radierart"] button')).toHaveCount(2);
  expect(await height()).toBeLessThanOrEqual(46);
  await tool(page, 'Füllfeder').click();
  expect(await height()).toBeLessThanOrEqual(46);
});

test('a pen tap on the quick switch goes between the last pen and the eraser', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await tool(page, 'Füllfeder').click();
  const quick = page.getByTestId('quick-switch');
  const icon = (selector: string) => page.locator(`${selector} svg path`).first().getAttribute('d');
  // Das Symbol des Schnellwechsels ist das des gewählten Stifts.
  expect(await icon(QUICK)).toBe(await icon('.werkzeuge button[aria-label="Füllfeder"]'));
  expect(await icon(QUICK)).not.toBe(await icon('.werkzeuge button[aria-label="Kugelschreiber"]'));

  await pen(page).tapOn(QUICK);
  await expect(quick).toHaveAttribute('data-tool', 'eraser');
  await expect(tool(page, 'Radierer')).toHaveAttribute('aria-pressed', 'true');
  await pen(page).tapOn(QUICK);
  await expect(quick).toHaveAttribute('data-tool', 'pen');
  await expect(tool(page, 'Füllfeder')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => savedPen(page)).toBe('fueller');
});

const ringLabels = (page: Page) => ring(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const ringButton = (label: string) => `.ring-knopf[aria-label="${label}"]`;

test('the ring has 11 outer buttons with Heute at the bottom', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true, settings: { vollbild: { an: true, werkzeuge: 'kreis' } } });
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
  // Mit Kugelschreiber: 4 Farben und 3 Breiten innen, 11 Knöpfe außen.
  await expect(ring(page)).toHaveCount(4 + 3 + 11);
  const all = await ringLabels(page);
  for (const name of [...Object.values(NAMES), 'Radierer', 'Heute']) expect(all, name).toContain(name);

  expect(all).not.toContain('Bleistift');
  await touch(page).tapOn(ringButton('Füllfeder'));
  await expect(ring(page)).toHaveCount(0); // eine Wahl schließt den Ring
  await expect.poll(() => savedPen(page)).toBe('fueller');

  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
  await expect(ring(page)).toHaveCount(4 + 3 + 11);
  const labels = await ringLabels(page);
  for (const colour of COLOUR_LABELS) expect(labels).toContain(colour);
  expect(labels.filter((l) => l?.includes(' mm)'))).toHaveLength(3);
  await expect(page.locator(ringButton('Füllfeder'))).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(ringButton('Kugelschreiber'))).toHaveAttribute('aria-pressed', 'false');

  // Heute liegt unten: tiefer als jeder andere Knopf.
  const boxes = await ring(page).evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { label: el.getAttribute('aria-label'), x: r.x + r.width / 2, y: r.y + r.height / 2 };
    }),
  );
  const today = boxes.find((b) => b.label === 'Heute')!;
  for (const b of boxes) expect(b.y, b.label ?? '').toBeLessThanOrEqual(today.y + 1);
  for (const b of boxes) expect(b.y, b.label ?? '').toBeGreaterThan(0);
});

test('the tab shows the four tools', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true, settings: { vollbild: { an: true, werkzeuge: 'tab' } } });
  await touch(page).tapOn('button.lasche');
  await expect(page.locator('.lasche-leiste')).toBeVisible();
  const group = page.locator('.lasche-knopf[data-gruppe="werkzeug"]');
  expect(await group.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual([...Object.values(NAMES), 'Radierer']);
  await touch(page).tapOn('.lasche-knopf[aria-label="Füllfeder"]');
  await expect(page.locator('.lasche-knopf[aria-label="Füllfeder"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => savedPen(page)).toBe('fueller');
  await expect(page.locator('.lasche-knopf[aria-label="Bleistift"]')).toHaveCount(0);
  await expect(page.locator('.lasche-knopf[data-gruppe="farbe"]')).toHaveCount(4);
  await expect(page.locator('.lasche-knopf[data-gruppe="breite"]')).toHaveCount(3);
});

test('the chosen pen survives a reload', async ({ page }) => {
  await openSeeded(page, DAY, { offline: true });
  await tool(page, 'Fineliner').click();
  await expect.poll(() => savedPen(page)).toBe('fineliner');
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(tool(page, 'Fineliner')).toHaveAttribute('aria-pressed', 'true');
  await expect(tool(page, 'Kugelschreiber')).toHaveAttribute('aria-pressed', 'false');
});

test('a page from a newer version shows the note with a reload button and is never written', async ({ page }) => {
  const newer = `<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="3" data-seite="tag" data-key="2026-10-29"></svg>`;
  const repo = await openSeeded(page, DAY, { files: { [TAG]: newer } });
  await expect(page.getByText('Diese Seite stammt aus einer neueren Version der App. Bitte neu laden.')).toBeVisible();
  // Der Knopf liegt in einem Hinweis ohne Zeigerereignisse: Er muss trotzdem klickbar sein und die App neu laden.
  const reloaded = page.waitForEvent('load');
  await page.getByRole('button', { name: 'Neu laden' }).click({ timeout: 3000 });
  await reloaded;
  await expect(page.getByRole('button', { name: 'Neu laden' })).toBeVisible();
  await pen(page).stroke(line([200, 760], [400, 780], 12));
  await page.waitForTimeout(500);
  expect(await savedPage(page)).toBe('');
  expect((await queued(page))[TAG]).toBeUndefined();
  expect(repo.puts.filter((put) => put.path === TAG)).toEqual([]);
});
