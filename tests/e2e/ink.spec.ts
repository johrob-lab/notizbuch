import { expect, test as base, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import type { Stroke } from '../../src/ink/types';
import { bringToForeground, lastHead, openSeeded, queued, savedSettings, sendToBackground } from './helpers/app';
import { inkNear, mouse, pen, pinch, touch, twoFingerTap, viewOf, wheel } from './helpers/pointer';

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
/** Ein Strich im unteren Teil der Seite. */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';

const currentStrokes = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const strokeIds = async (page: Page) => (await currentStrokes(page)).map((s) => s.id);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Stift und Handballen: Finger gelten erst 250 ms nach dem Abheben des Stifts wieder. */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);

function stroke(id: string, t: number, y: number): Stroke {
  return {
    id,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t,
    w: 1.2,
    pts: [
      { x: 100, y, w: 1.2 },
      { x: 160, y: y + 20, w: 1.2 },
    ],
  };
}

function pageWith(...strokes: Stroke[]): string {
  return serializePage({ kind: 'tag', key: '2026-10-29', meta: {}, strokes }, [], '');
}

// ---------- Stift ----------

test('pen draws a stroke', async ({ page }) => {
  await openSeeded(page, DAY);
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  const [s] = await currentStrokes(page);
  expect(s).toMatchObject({ tool: 'kugel', color: 'schwarz', widthMm: 0.2 });
  expect(s.pts).toHaveLength(3);
  expect(await page.evaluate(() => window.__notizbuch.currentPage())).toMatchObject({ kind: 'tag', key: '2026-10-29' });
  // Das Ergebnis steht auch auf dem Bildschirm: am Anfang des Strichs ist Tinte, sonst nirgends.
  expect(await inkNear(page, [200, 1000], 4)).toBeGreaterThan(0);
  expect(await inkNear(page, [600, 300], 4)).toBe(0);
});

test('toolbar sets color and width', async ({ page }) => {
  await openSeeded(page, DAY);
  await button(page, 'Rot (offen)').click();
  await button(page, 'Breit (0,4 mm)').click();
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect((await currentStrokes(page))[0]).toMatchObject({ color: 'rot', widthMm: 0.4 });

  await button(page, 'Radierer').click();
  await button(page, 'Blau').click();
  await expect(button(page, 'Kugelschreiber')).toHaveAttribute('aria-pressed', 'true');
  await expect(button(page, 'Radierer')).toHaveAttribute('aria-pressed', 'false');
});

test('touch does not draw', async ({ page }) => {
  await openSeeded(page, DAY);
  const before = await viewOf(page);
  await touch(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  // Der Finger war nicht wirkungslos, er hat die Seite verschoben.
  expect((await viewOf(page)).x).not.toBeCloseTo(before.x, 0);
  expect(await queued(page)).toEqual({});
});

test('mouse does not draw on the iPad either', async ({ page }) => {
  await openSeeded(page, DAY);
  const before = await viewOf(page);
  await mouse(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  expect((await viewOf(page)).x).not.toBeCloseTo(before.x, 0);
});

test('readOnly mouse never draws', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { device: 'Firmen-PC' });
  const before = await viewOf(page);
  await mouse(page).stroke(LINE);
  await pen(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  // Ansehen geht: Die Maus verschiebt die Seite. Werkzeuge gibt es nicht.
  expect((await viewOf(page)).x).not.toBeCloseTo(before.x, 0);
  await expect(button(page, 'Radierer')).toHaveCount(0);
  await expect(page.getByTestId('quick-switch')).toHaveCount(0);
  await sendToBackground(page);
  await page.waitForTimeout(300);
  expect(await queued(page)).toEqual({});
  expect(repo.puts).toEqual([]);
});

test('touch is ignored while the pen is down', async ({ page }) => {
  await openSeeded(page, DAY);
  const p = pen(page);
  await p.down(200, 1000);
  await p.move(260, 1020);
  const before = await viewOf(page);
  // Die Hand liegt neben dem Stift auf dem Bildschirm.
  await touch(page).stroke([
    [600, 800],
    [500, 700],
  ]);
  expect(await viewOf(page)).toEqual(before);
  await p.up(260, 1020);
  await expect.poll(() => strokeCount(page)).toBe(1);
});

// ---------- Finger und Maus: Ansicht ----------

test('finger drag pans, two fingers zoom', async ({ page }) => {
  await openSeeded(page, DAY);
  const start = await viewOf(page);

  await touch(page).stroke([
    [600, 800],
    [500, 700],
  ]);
  const panned = await viewOf(page);
  expect(panned.x - start.x).toBeCloseTo(-100 * start.scale, 0);
  expect(panned.y - start.y).toBeCloseTo(-100 * start.scale, 0);
  expect(panned.scale).toBeCloseTo(start.scale, 5);

  // Zwei Finger ziehen auseinander: doppelt so weit, doppelter Maßstab, und der Punkt zwischen ihnen bleibt stehen.
  const middle = await page.evaluate(() => window.__notizbuch.toClient(600, 800));
  await pinch(
    page,
    [
      [500, 800],
      [700, 800],
    ],
    [
      [400, 800],
      [800, 800],
    ],
  );
  const zoomed = await viewOf(page);
  expect(zoomed.scale / panned.scale).toBeCloseTo(2, 2);
  const after = await page.evaluate(() => window.__notizbuch.toClient(600, 800));
  expect(after.x).toBeCloseTo(middle.x, 0);
  expect(after.y).toBeCloseTo(middle.y, 0);
  expect(await strokeCount(page)).toBe(0);
});

test('mouse drag pans, wheel scrolls, ctrl wheel zooms', async ({ page }) => {
  await openSeeded(page, DAY);
  const start = await viewOf(page);

  await mouse(page).stroke([
    [600, 800],
    [550, 750],
  ]);
  const dragged = await viewOf(page);
  expect(dragged.x - start.x).toBeCloseTo(-50 * start.scale, 0);
  expect(dragged.y - start.y).toBeCloseTo(-50 * start.scale, 0);

  await wheel(page, [600, 800], { dy: 120 });
  const scrolled = await viewOf(page);
  expect(scrolled.y - dragged.y).toBeCloseTo(-120, 0);
  expect(scrolled.x).toBeCloseTo(dragged.x, 0);

  const under = await page.evaluate(() => window.__notizbuch.toClient(600, 800));
  const cursor = await wheel(page, [600, 800], { dy: -200, ctrl: true });
  const zoomed = await viewOf(page);
  const factor = zoomed.scale / scrolled.scale;
  expect(factor).toBeCloseTo(Math.exp(0.5), 2);
  // Der Ort unter dem Zeiger bleibt stehen, alles andere wächst von ihm weg.
  const after = await page.evaluate(() => window.__notizbuch.toClient(600, 800));
  expect(after.x).toBeCloseTo(cursor.x + (under.x - cursor.x) * factor, 0);
  expect(after.y).toBeCloseTo(cursor.y + (under.y - cursor.y) * factor, 0);
});

test('zoom stays between 0.3 and 10 times the width of the page', async ({ page }) => {
  await openSeeded(page, DAY);
  // Die Seite füllt die Breite des Bildschirms bis auf 16 px Rand: so viele Bildschirmpunkte je Seiteneinheit.
  const fit = (1200 - 32) / 1192;
  await wheel(page, [600, 800], { dy: -100_000, ctrl: true });
  expect((await viewOf(page)).scale).toBeCloseTo(fit * 10, 3);
  await wheel(page, [600, 800], { dy: 100_000, ctrl: true });
  expect((await viewOf(page)).scale).toBeCloseTo(fit * 0.3, 3);
});

test('a page with many points keeps its ink while a finger moves it and afterwards', async ({ page }) => {
  // 9000 Punkte: Über 8000 zeigt eine Geste nur ein Bild der Seite und zeichnet erst am Ende scharf neu.
  const strokes = Array.from({ length: 90 }, (_, i): Stroke => ({
    id: `s${i}`,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t: 1000 + i,
    w: 1.2,
    pts: Array.from({ length: 100 }, (_, j) => ({ x: 100 + j * 8, y: 100 + i * 14 + (j % 2) * 3, w: 1.2 })),
  }));
  await openSeeded(page, DAY, { files: { [TAG]: pageWith(...strokes) } });
  expect(await strokeCount(page)).toBe(90);
  const frame = () => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  const row: [number, number] = [300, 100 + 40 * 14];
  expect(await inkNear(page, row, 8)).toBeGreaterThan(0);

  const finger = touch(page);
  await finger.down(600, 800);
  await finger.move(600, 900);
  await frame();
  // Mitten in der Geste: Die Seite ist 100 Seiteneinheiten tiefer gerutscht, die Tinte mit ihr.
  expect(await inkNear(page, [300, 100 + 40 * 14 + 100], 8)).toBeGreaterThan(0);
  await finger.up(600, 900);
  await frame();
  expect(await inkNear(page, [300, 100 + 40 * 14 + 100], 8)).toBeGreaterThan(0);
  expect(await strokeCount(page)).toBe(90);
});

// ---------- Rückgängig, Radierer ----------

test('two-finger tap undoes', async ({ page }) => {
  await openSeeded(page, DAY);
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);
  const before = await viewOf(page);
  await twoFingerTap(page, [400, 800], [500, 800]);
  expect(await strokeCount(page)).toBe(0);
  expect(await viewOf(page)).toEqual(before);
  await expect(button(page, 'Wiederholen')).toBeEnabled();
});

test('eraser removes the stroke', async ({ page }) => {
  await openSeeded(page, DAY);
  await pen(page).stroke(LINE);
  await pen(page).stroke([
    [200, 600],
    [320, 600],
  ]);
  await expect.poll(() => strokeCount(page)).toBe(2);
  await button(page, 'Radierer').click();
  await expect(button(page, 'Radierer')).toHaveAttribute('aria-pressed', 'true');
  // Quer über die untere Linie, die obere bleibt stehen.
  await pen(page).stroke([
    [260, 960],
    [260, 1060],
  ]);
  expect(await strokeCount(page)).toBe(1);
  expect((await currentStrokes(page))[0].pts[0].y).toBeCloseTo(600, 0);
  // Das Bild folgt im nächsten Bildwechsel.
  await expect.poll(() => inkNear(page, [200, 1000], 4)).toBe(0);
  expect(await inkNear(page, [200, 600], 4)).toBeGreaterThan(0);
});

test('undo brings back erased strokes in their place', async ({ page }) => {
  await openSeeded(page, DAY);
  await pen(page).stroke([
    [200, 600],
    [320, 600],
  ]);
  await pen(page).stroke(LINE);
  const [first, second] = await strokeIds(page);
  await button(page, 'Radierer').click();
  await pen(page).stroke([
    [260, 560],
    [260, 640],
  ]);
  expect(await strokeIds(page)).toEqual([second]);

  await button(page, 'Rückgängig').click();
  expect(await strokeIds(page)).toEqual([first, second]);
  await button(page, 'Wiederholen').click();
  expect(await strokeIds(page)).toEqual([second]);
  await button(page, 'Rückgängig').click();
  await button(page, 'Rückgängig').click(); // nimmt den zweiten Strich selbst zurück
  expect(await strokeIds(page)).toEqual([first]);
  await button(page, 'Rückgängig').click();
  expect(await strokeIds(page)).toEqual([]);
  await expect(button(page, 'Rückgängig')).toBeDisabled();
});

// ---------- Schnellwechsel ----------

test('quick switch toggles eraser with pen tap', async ({ page }) => {
  await openSeeded(page, DAY);
  const eraser = button(page, 'Radierer');
  await pen(page).stroke(LINE);
  await pen(page).tapOn('[data-testid="quick-switch"]');
  await expect(eraser).toHaveAttribute('aria-pressed', 'true');
  await pen(page).stroke([
    [260, 960],
    [260, 1060],
  ]);
  expect(await strokeCount(page)).toBe(0);
  await pen(page).tapOn('[data-testid="quick-switch"]');
  await expect(eraser).toHaveAttribute('aria-pressed', 'false');
  await expect(button(page, 'Kugelschreiber')).toHaveAttribute('aria-pressed', 'true');
});

test('quick switch ignores finger taps and moves with a finger', async ({ page }) => {
  await openSeeded(page, DAY);
  const quick = page.getByTestId('quick-switch');
  await touch(page).tapOn('[data-testid="quick-switch"]');
  await expect(button(page, 'Radierer')).toHaveAttribute('aria-pressed', 'false');

  const before = (await quick.boundingBox())!;
  await touch(page).dragOn('[data-testid="quick-switch"]', -300, -200);
  const after = (await quick.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(-300, 0);
  expect(after.y - before.y).toBeCloseTo(-200, 0);
  await expect(button(page, 'Radierer')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(async () => (await savedSettings(page))?.quickSwitchPos).toBeDefined();

  // Nach dem Neuladen liegt der Knopf noch dort.
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  const reloaded = (await quick.boundingBox())!;
  expect(reloaded.x).toBeCloseTo(after.x, 0);
  expect(reloaded.y).toBeCloseTo(after.y, 0);
});

// ---------- Speichern ----------

test('strokes persist across reload before sync', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { offline: true });
  await pen(page).stroke(LINE);
  await expect.poll(async () => Object.keys(await queued(page))).toEqual([TAG]);

  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect.poll(() => inkNear(page, [200, 1000], 4)).toBeGreaterThan(0);
  await expect(page.getByTestId('status')).toHaveText('Wartet auf Netz · 1 Änderung');
  expect(repo.puts).toEqual([]);
});

test('a finished stroke is queued at once, undo and redo are written too', async ({ page }) => {
  await openSeeded(page, DAY);
  const queuedText = async () => (await queued(page))[TAG] ?? '';
  await pen(page).stroke(LINE);
  await expect.poll(queuedText).toContain('<path');

  await button(page, 'Rückgängig').click();
  await expect.poll(queuedText).not.toContain('<path');
  await button(page, 'Wiederholen').click();
  await expect.poll(queuedText).toContain('<path');
});

test('a stroke is uploaded when the app goes to the background', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await pen(page).stroke(LINE);
  await expect.poll(async () => Object.keys(await queued(page))).toEqual([TAG]);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const [put] = repo.puts;
  expect(put.path).toBe(TAG);
  expect(put.message).toBe('Notizbuch: 2026-10-29 Tag.svg (iPad)');
  expect(put.text).toContain('data-seite="tag"');
  expect(put.text).toContain('data-schluessel="2026-10-29"');
  expect(put.text).toContain('<path');
  await expect(page.getByTestId('status')).toHaveText('Gesichert');
});

test('unreadable page stays unchanged', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { files: { [TAG]: BROKEN } });
  await expect(page.getByText('Diese Seite lässt sich nicht lesen und wird nicht verändert.')).toBeVisible();
  await expect(button(page, 'Radierer')).toHaveCount(0);
  await pen(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  await sendToBackground(page);
  await page.waitForTimeout(300);
  expect(await queued(page)).toEqual({});
  expect(repo.puts).toEqual([]);
  expect(repo.read(TAG)).toBe(BROKEN);
});

test('a change from another device shows up and the next stroke keeps it', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { files: { [TAG]: pageWith(stroke('a', 1000, 300)) } });
  expect(await strokeIds(page)).toEqual(['a']);
  // Die Abfrage nach fremden Änderungen merkt sich beim ersten Mal nur den Stand.
  await expect.poll(() => lastHead(page)).not.toBeNull();

  // Ein anderes Gerät hat einen Strich ergänzt, der früher begonnen wurde als der erste. In der Datei steht er hinten,
  // aber die Reihenfolge der Seite folgt der Zeit.
  repo.commit(TAG, pageWith(stroke('a', 1000, 300), stroke('b', 500, 400)));
  await bringToForeground(page);
  await expect.poll(() => strokeIds(page)).toEqual(['b', 'a']);

  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).toContain('data-id="a"');
  expect(repo.puts[0].text).toContain('data-id="b"');
  expect(repo.puts[0].text.match(/<path/g)).toHaveLength(3);
  expect(repo.unhandled).toEqual([]);
});

test('a page that another device breaks is locked and never written', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { files: { [TAG]: pageWith(stroke('a', 1000, 300)) } });
  expect(await strokeIds(page)).toEqual(['a']);
  await expect.poll(() => lastHead(page)).not.toBeNull();

  repo.commit(TAG, BROKEN);
  await bringToForeground(page);
  await expect(page.getByText('Diese Seite lässt sich nicht lesen und wird nicht verändert.')).toBeVisible();
  await expect(button(page, 'Radierer')).toHaveCount(0);
  await expect(page.getByTestId('quick-switch')).toHaveCount(0);

  await pen(page).stroke(LINE);
  expect(await strokeIds(page)).toEqual(['a']);
  await sendToBackground(page);
  await page.waitForTimeout(300);
  expect(await queued(page)).toEqual({});
  expect(repo.puts).toEqual([]);
  expect(repo.read(TAG)).toBe(BROKEN);
});
