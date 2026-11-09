import { expect, test as base, type Page } from '@playwright/test';
import { PAGE_GAP } from '../../src/ink/chain';
import { serializePage } from '../../src/ink/svg';
import { PAGE_H, type Stroke } from '../../src/ink/types';
import { bringToForeground, lastHead, openSeeded, queued, sendToBackground } from './helpers/app';
import { inkNear, mouse, pen, touch, viewOf } from './helpers/pointer';

/**
 * Weiterscrollen: Über und unter der offenen Tages-, Wochen- und Monatsseite hängen ihre Nachbarn. Wer mit dem Finger
 * hinüberschiebt und loslässt, während ein Nachbar die Mitte des Bildschirms bedeckt, hat ihn offen, mit neuer Adresse und
 * ohne neuen Eintrag im Verlauf. Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und hält die Uhr an: Heute
 * ist in allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit). Alle Striche sind erfunden.
 */
const test = base.extend<{ browserErrors: void; fixedToday: void }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect(errors, 'unbehandelte Fehler im Browser').toEqual([]);
    },
    { auto: true },
  ],
  fixedToday: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(new Date('2026-10-29T12:00:00+01:00'));
      await use();
    },
    { auto: true },
  ],
});

// Die Anfragen an GitHub laufen über page.route. Ein Service Worker würde sie am Test vorbei beantworten.
test.use({ serviceWorkers: 'block', viewport: { width: 1200, height: 1700 } });

const DAY = '#/tag/2026-10-29';
const tagFile = (day: string) => `07 Anhänge/Notizbuch/2026/${day} Tag.svg`;
/** Ein Strich im Feld Notizen der Tagesseite. */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
/** Hier hat die Tagesseite weder Linien noch Schrift, die dunkel sind: Tinte dort stammt von einem Strich. */
const CLEAN: [number, number] = [600, 300];
/** So weit vor und hinter der Hälfte des Spalts lässt der Finger los (Seiteneinheiten). */
const MISS = 8;
/** So viel Abstand hält der Finger beim Schieben vom Rand der Fläche (Bildschirmpunkte). */
const MARGIN = 40;

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const historyLength = (page: Page) => page.evaluate(() => window.history.length);
/** `null`, solange keine Seite gelesen ist (der Testzugang fehlt dann). */
const neighbors = (page: Page) => page.evaluate(() => window.__notizbuch?.neighbors?.() ?? null);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const waitForPageOf = (page: Page, kind: string, key: string) =>
  page.waitForFunction(
    ([k, id]) => {
      const current = window.__notizbuch?.currentPage?.();
      return current?.kind === k && current.key === id;
    },
    [kind, key],
  );
/** Stift und Handballen: Finger gelten erst 250 ms nach dem Abheben des Stifts wieder. */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);
/** Wie viele Striche eine Datei hat. Die Linien des Hintergrunds sind auch <path>-Elemente, aber ohne `data-id`. */
const strokesIn = (text: string) => (text.match(/<path data-id=/g) ?? []).length;

/** Ein erfundener Strich mit dem Kugelschreiber quer durch `at` (Seiteneinheiten). */
function strokeThrough(id: string, [x, y]: [number, number]): Stroke {
  return {
    id,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t: 1000,
    w: 1.2,
    pts: [
      { x: x - 30, y: y - 10, w: 1.2 },
      { x: x + 30, y: y + 10, w: 1.2 },
    ],
  };
}

/** Die Datei einer Tagesseite mit diesen Strichen. */
const dayWith = (day: string, ...strokes: Stroke[]) => serializePage({ kind: 'tag', key: day, meta: {}, strokes }, [], '');

/** Die Fläche, die Ansicht und wo die Mitte der Fläche liegt: so viele Seiteneinheiten unter dem Oberrand der offenen Seite. */
async function middleOf(page: Page) {
  const box = (await page.getByTestId('surface').boundingBox())!;
  const view = await viewOf(page);
  return { box, view, y: (box.y + box.height / 2 - view.y) / view.scale };
}

/**
 * Schiebt die Seite mit einem Finger, bis die Mitte der Fläche `target` Seiteneinheiten unter dem Oberrand der offenen Seite
 * liegt (darüber negativ, auf dem Nachbarn darunter mehr als `PAGE_H`), und hebt ab. Die Strecke kommt aus der Ansicht und der
 * Größe der Fläche. Jeder Zug bleibt in der Fläche; reicht einer nicht, folgen weitere, und erst der letzte kommt ans Ziel.
 */
async function scrollUntil(page: Page, target: number) {
  for (let i = 0; i < 5; i++) {
    const { box, view, y } = await middleOf(page);
    const dy = (y - target) * view.scale; // so weit muss der Finger auf dem Bildschirm, nach unten positiv
    const room = box.height - 2 * MARGIN;
    const step = Math.max(-room, Math.min(room, dy));
    const x = box.x + box.width / 2;
    const from = dy < 0 ? box.y + box.height - MARGIN : box.y + MARGIN;
    const onPage = (screenY: number): [number, number] => [(x - view.x) / view.scale, (screenY - view.y) / view.scale];
    await touch(page).stroke([onPage(from), onPage(from + step / 2), onPage(from + step)]);
    if (step === dy) return;
  }
  throw new Error(`Die Mitte kam nicht bis ${target}.`);
}

/** Bis hierher geschoben, bedeckt der Nachbar darunter die Mitte: Er wird beim Loslassen zur offenen Seite. */
const PAST_BELOW = PAGE_H + PAGE_GAP / 2 + MISS;
/** Bis hierher geschoben, liegt die Mitte noch im Spalt vor seiner Hälfte: Die Seite bleibt offen. */
const SHORT_OF_BELOW = PAGE_H + PAGE_GAP / 2 - MISS;
/** Dasselbe wie `PAST_BELOW` nach oben. */
const PAST_ABOVE = -PAGE_GAP / 2 - MISS;

test('scrolling down past the middle opens the next day where it stands', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 }); // es gibt noch keine Dateien
  const entries = await historyLength(page);

  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await historyLength(page)).toBe(entries); // die Adresse wechselt ohne neuen Eintrag im Verlauf
});

test('releasing before the middle keeps the page', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const entries = await historyLength(page);

  await scrollUntil(page, SHORT_OF_BELOW);
  // Die Mitte liegt im Spalt unter der Seite, aber noch vor seiner Hälfte: Es bleibt beim 29.10., und die Seite bleibt stehen.
  const { y } = await middleOf(page);
  expect(y).toBeGreaterThan(PAGE_H);
  expect(y).toBeLessThan(PAGE_H + PAGE_GAP / 2);
  await page.waitForTimeout(300);
  expect(await hash(page)).toBe(DAY);
  expect(await historyLength(page)).toBe(entries);
  expect(await page.evaluate(() => window.__notizbuch.currentPage().key)).toBe('2026-10-29');
  expect((await middleOf(page)).y).toBeCloseTo(y, 3);
});

test('scrolling up opens the day before', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const entries = await historyLength(page);

  await scrollUntil(page, PAST_ABOVE);
  expect(await hash(page)).toBe('#/tag/2026-10-28');
  await waitForPageOf(page, 'tag', '2026-10-28');
  expect(await historyLength(page)).toBe(entries);
});

test('weeks and months scroll to the next week and month', async ({ page }) => {
  await openSeeded(page, '#/woche/2026-W44');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/woche/2026-W45');
  await waitForPageOf(page, 'woche', '2026-W45');

  await page.evaluate(() => {
    window.location.hash = '#/monat/2026-10';
  });
  await waitForPageOf(page, 'monat', '2026-10');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/monat/2026-11');
  await waitForPageOf(page, 'monat', '2026-11');
});

test('a stroke goes into the page that is open', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);

  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(0);
  // Der 29.10. hängt jetzt darüber, mit seinem Strich.
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);

  await sendToBackground(page);
  const both = [tagFile('2026-10-29'), tagFile('2026-10-30')];
  await expect.poll(() => repo.puts.map((put) => put.path).sort()).toEqual(both);
  for (const put of repo.puts) expect(strokesIn(put.text), put.path).toBe(1);
});

test('the preview shows what the neighbour has', async ({ page }) => {
  const next = dayWith('2026-10-30', strokeThrough('a', CLEAN), strokeThrough('b', [600, 1000]));
  await openSeeded(page, DAY, { files: { [tagFile('2026-10-30')]: next } });
  expect(await inkNear(page, CLEAN, 4)).toBe(0); // die eigene Seite hat dort nichts
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 2 });

  // Kurz vor der Hälfte des Spalts ist der obere Teil des 30.10. zu sehen, mit seinem Strich.
  await scrollUntil(page, SHORT_OF_BELOW);
  const below: [number, number] = [CLEAN[0], CLEAN[1] + PAGE_H + PAGE_GAP];
  await expect.poll(() => inkNear(page, below, 4)).toBeGreaterThan(0);
  expect(await hash(page)).toBe(DAY);
});

test('a change from another device shows in the preview, and the neighbour is only read', async ({ page }) => {
  const file = tagFile('2026-10-30');
  const repo = await openSeeded(page, DAY, { files: { [file]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  await expect.poll(() => lastHead(page)).not.toBeNull();

  // Ein anderes Gerät ergänzt den Strich 'b' auf dem 30.10.
  repo.commit(file, dayWith('2026-10-30', strokeThrough('a', CLEAN), strokeThrough('b', [600, 1000])));
  await bringToForeground(page);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 2 });
  expect(await queued(page)).toEqual({}); // keine Datei geschrieben, auch die des Nachbarn nicht
  expect(repo.puts).toEqual([]);
});

test('a long drag stops where 60 points of the next day are left, and letting go opens it', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const { box, view } = await middleOf(page);
  const x = box.x + box.width / 2;
  const onPage = (screenY: number): [number, number] => [(x - view.x) / view.scale, (screenY - view.y) / view.scale];
  // Die Maus darf beim Ziehen aus dem Fenster laufen: Sie zieht hier dreimal so weit, wie die Fläche hoch ist.
  const drag = mouse(page);
  const from = box.y + box.height - MARGIN;
  await drag.stroke([onPage(from), onPage(from - 3 * box.height)], { lift: false });
  // Die Kette endet am Unterrand des 30.10.: Von ihm bleiben 60 Punkte oben auf der Fläche.
  const chainEnd = await page.evaluate((y) => window.__notizbuch.toClient(0, y).y, 2 * PAGE_H + PAGE_GAP);
  expect(chainEnd - box.y).toBeCloseTo(60, 3);
  await drag.up(...onPage(from));
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
});

test('there is still exactly one surface with three canvases', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');

  const canvases = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((c) => ({
      inSurface: c.closest('[data-testid="surface"]') !== null,
      sized: c.width > 0 && c.height > 0,
    })),
  );
  expect(canvases).toEqual(Array.from({ length: 3 }, () => ({ inSurface: true, sized: true })));
});
