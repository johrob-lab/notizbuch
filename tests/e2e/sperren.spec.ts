import { readFile } from 'node:fs/promises';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { localFiles, openSeeded, queued, savedSettings, shareRepos } from './helpers/app';
import { mouse, pen } from './helpers/pointer';

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und darauf, dass die App nie einen Dialog des
 * Browsers öffnet. Heute ist in allen Tests der 29.10.2026 (Wiener Zeit), das 4. Quartal 2026.
 */
const test = base.extend<{ browserErrors: void; noBrowserDialogs: void; fixedToday: void }>({
  browserErrors: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const watch = (page: Page) => page.on('pageerror', (error) => errors.push(error.message));
      for (const page of context.pages()) watch(page);
      context.on('page', watch);
      await use();
      expect(errors, 'unbehandelte Fehler im Browser').toEqual([]);
    },
    { auto: true },
  ],
  noBrowserDialogs: [
    async ({ context }, use) => {
      const dialogs: string[] = [];
      const watch = (page: Page) =>
        page.on('dialog', (dialog) => {
          dialogs.push(`${dialog.type()}: ${dialog.message()}`);
          void dialog.dismiss();
        });
      for (const page of context.pages()) watch(page);
      context.on('page', watch);
      await use();
      expect(dialogs, 'Dialoge des Browsers').toEqual([]);
    },
    { auto: true },
  ],
  fixedToday: [
    async ({ context }, use) => {
      await context.clock.setFixedTime(new Date('2026-10-29T12:00:00+01:00'));
      await use();
    },
    { auto: true },
  ],
});

// Die Anfragen an GitHub laufen über page.route. Ein Service Worker würde sie am Test vorbei beantworten.
test.use({ serviceWorkers: 'block', viewport: { width: 1200, height: 1700 } });

const DAY = '#/tag/2026-10-29';
const Q4 = '#/sperren/IB-2026-Q4';
const FILE = '07 Anhänge/Notizbuch/2026/2026-Q4 Sperren IB.svg';
/** Ein Strich in Platz 1 des 3. Oktober: x 116 bis 259, y 184 + 2 · 44 bis + 44, Seiteneinheiten. */
const PLATZ_1: [number, number][] = [
  [150, 294],
  [220, 298],
];

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const link = (page: Page | Locator, name: string) => page.getByRole('link', { name, exact: true });
const fachlinie = (page: Page) => page.getByRole('group', { name: 'Fachlinie', exact: true });
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const opened = (page: Page) => page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));

test('the Sperren button opens the current quarter of IB', async ({ page }) => {
  await openSeeded(page, DAY);
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe(Q4);
  await expect(link(page, 'Sperren')).toHaveAttribute('aria-current', 'page');
});

test('a pen stroke in a day lands in that field', async ({ page }) => {
  await openSeeded(page, Q4);
  await pen(page).stroke(PLATZ_1);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect.poll(async () => (await queued(page))[FILE] ?? '').toContain('data-feld="sperre-2026-10-03-1"');
  const text = (await queued(page))[FILE];
  expect(text).toContain('data-seite="sperren"');
  expect(text).toMatch(/data-feld="sperre-2026-10-03-1"[^]*<path/);
});

test('the arrows step by quarter and keep the Fachlinie', async ({ page }) => {
  await openSeeded(page, Q4);
  await expect(page.getByRole('link', { name: 'Voriges Quartal' })).toBeVisible();
  await page.getByRole('link', { name: 'Nächstes Quartal' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2027-Q1');
  await page.getByRole('link', { name: 'Voriges Quartal' }).click();
  await expect.poll(() => hash(page)).toBe(Q4);
});

test('Lehne keeps the quarter', async ({ page }) => {
  await openSeeded(page, '#/sperren/IB-2027-Q1');
  await expect(link(fachlinie(page), 'IB')).toHaveAttribute('aria-current', 'page');
  await link(fachlinie(page), 'Lehne').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-Q1');
  await expect(link(fachlinie(page), 'Lehne')).toHaveAttribute('aria-current', 'page');
  await expect(link(fachlinie(page), 'IB')).not.toHaveAttribute('aria-current', 'page');
  await link(fachlinie(page), 'IB').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2027-Q1');
  await expect(link(fachlinie(page), 'IB')).toHaveAttribute('aria-current', 'page');
});

test('starting on Lehne, the arrows keep Lehne and IB keeps the quarter', async ({ page }) => {
  await openSeeded(page, '#/sperren/Lehne-2026-Q4');
  await expect(link(fachlinie(page), 'Lehne')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Nächstes Quartal' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-Q1');
  await expect(link(fachlinie(page), 'Lehne')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Voriges Quartal' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2026-Q4');
  await page.getByRole('link', { name: 'Nächstes Quartal' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-Q1');
  await link(fachlinie(page), 'IB').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2027-Q1');
  await expect(link(fachlinie(page), 'IB')).toHaveAttribute('aria-current', 'page');
});

test('the last opened quarter comes back, also after a reload', async ({ page }) => {
  await openSeeded(page, '#/sperren/Lehne-2027-Q2');
  await expect.poll(async () => (await savedSettings(page))?.sperren).toBe('Lehne-2027-Q2');
  await page.evaluate(() => (window.location.hash = '#/tag/2026-10-29'));
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-Q2');

  await page.evaluate(() => (window.location.hash = '#/tag/2026-10-29'));
  await page.reload();
  await opened(page);
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-Q2');
});

test('the second window shows the quarter but saves nothing', async ({ context, page }) => {
  await openSeeded(page, DAY);
  const before = await savedSettings(page);
  const second = await context.newPage();
  await shareRepos(page, second);
  await second.goto('/notizbuch/#/sperren/Lehne-2027-Q3');
  await opened(second);
  await expect(second.getByText('Das Notizbuch ist schon in einem anderen Fenster offen.', { exact: true })).toBeVisible();
  await expect(second.getByRole('group', { name: 'Fachlinie', exact: true })).toBeVisible();
  // Die Leiste kennt den Schlüssel sofort, gespeichert wird nichts.
  await second.evaluate(() => (window.location.hash = '#/tag/2026-10-29'));
  await link(second, 'Sperren').click();
  await expect.poll(() => second.evaluate(() => window.location.hash)).toBe('#/sperren/Lehne-2027-Q3');
  await second.waitForTimeout(300);
  expect(await savedSettings(page)).toEqual(before);
});

/** Obere Kante und Höhe der Knöpfe einer Zeile. */
async function tops(page: Page, selector: string): Promise<number[]> {
  return page.locator(selector).evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => Math.round(el.getBoundingClientRect().top)));
}

test('the bar stays one row on an iPad in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 1194 });
  await openSeeded(page, '#/sperren/IB-2027-Q1');
  const platzhalter = ['Index', 'Jahr', 'To-Dos'].map((name) => page.locator('header.topbar').getByRole('button', { name, exact: true }));
  for (const p of platzhalter) await expect(p).toBeVisible();
  const wide = (await page.locator('header.topbar').boundingBox())!.height;

  await page.setViewportSize({ width: 834, height: 1194 });
  for (const hash of ['#/sperren/IB-2027-Q1', DAY]) {
    await page.evaluate((h) => (window.location.hash = h), hash);
    await expect(link(page, 'Sperren')).toBeVisible();
    for (const p of platzhalter) await expect(p).toBeHidden();
    const buttons = await tops(page, 'header.topbar a.pill, header.topbar button.pill');
    expect(new Set(buttons).size, `Knöpfe in einer Zeile bei ${hash}`).toBe(1);
    expect((await page.locator('header.topbar').boundingBox())!.height).toBe(wide);
  }

  await page.evaluate(() => (window.location.hash = '#/sperren/IB-2027-Q1'));
  const kopf = page.locator('.kopf');
  const edges = await Promise.all(
    [kopf.getByRole('link', { name: 'IB', exact: true }), kopf.getByRole('link', { name: 'Lehne', exact: true }), kopf.getByRole('button', { name: 'Für Excel herunterladen', exact: true })].map(async (el) =>
      Math.round((await el.boundingBox())!.y),
    ),
  );
  expect(new Set(edges).size).toBe(1);
});

for (const width of [960, 1100, 1101]) {
  test(`the bar fits at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await openSeeded(page, '#/sperren/IB-2027-Q1');
    for (const hash of ['#/sperren/IB-2027-Q1', DAY]) {
      await page.evaluate((h) => (window.location.hash = h), hash);
      await expect(link(page, 'Sperren')).toBeVisible();
      const m = await page.evaluate(() => {
        const bar = document.querySelector('header.topbar')!;
        const items = [...bar.querySelectorAll<HTMLElement>('a.pill, button.pill')].filter((el) => el.offsetParent !== null);
        const status = bar.querySelector<HTMLElement>('.status');
        const right = (el: Element) => Math.round(el.getBoundingClientRect().right);
        const next = status?.nextElementSibling as HTMLElement | null;
        return {
          viewport: document.documentElement.clientWidth,
          scroll: document.documentElement.scrollWidth,
          ends: items.map(right),
          statusRight: status ? Math.round(status.getBoundingClientRect().left + status.scrollWidth) : 0,
          nextLeft: next ? Math.round(next.getBoundingClientRect().left) : 99999,
          rows: new Set(items.map((el) => Math.round(el.getBoundingClientRect().top))).size,
        };
      });
      for (const end of m.ends) expect(end, `Knopf endet im Fenster bei ${hash}`).toBeLessThanOrEqual(m.viewport);
      expect(m.scroll, `kein Querscrollen bei ${hash}`).toBeLessThanOrEqual(m.viewport);
      expect(m.statusRight, `Stand endet links vom nächsten Knopf bei ${hash}`).toBeLessThanOrEqual(m.nextLeft);
      expect(m.rows).toBe(1);
      if (width === 1101) for (const name of ['Index', 'Jahr', 'To-Dos']) await expect(page.locator('header.topbar').getByRole('button', { name, exact: true })).toBeVisible();
    }
  });
}

test('no month tabs on the Sperren page', async ({ page }) => {
  await openSeeded(page, DAY);
  const tabs = page.locator('nav[aria-label="Monate"]');
  await expect(tabs).toHaveCount(1);
  await page.evaluate(() => (window.location.hash = '#/sperren/IB-2027-Q1'));
  await expect(link(page, 'Sperren')).toHaveAttribute('aria-current', 'page');
  await expect(tabs).toHaveCount(0);
});

test('the Firmen-PC sees the page read-only', async ({ page }) => {
  await openSeeded(page, Q4, { device: 'Firmen-PC' });
  await expect(page.locator('.leiste')).toHaveCount(0);
  await expect(link(fachlinie(page), 'IB')).toBeVisible();
  await expect(link(fachlinie(page), 'Lehne')).toBeVisible();
  await mouse(page).stroke(PLATZ_1);
  await pen(page).stroke(PLATZ_1);
  expect(await strokeCount(page)).toBe(0);
  expect(await queued(page)).toEqual({});
  expect(await localFiles(page)).not.toContain(FILE);
});

const DOWNLOAD = 'Für Excel herunterladen';
const KEINE_LISTE = 'Noch keine Liste für IB 2027. Sie kommt mit der Abendroutine, sobald Sperren gelesen sind.';
const NO_NETWORK = 'Zum Herunterladen braucht die App Netz.';
const LISTE_KOPF = 'Fachlinie;Abschnitt;Von;Bis;Bemerkung';
const csvOf = (jahr: number) => `\uFEFF${LISTE_KOPF}\r\nIB;Muster Abschnitt 1;${jahr}-03-01;${jahr}-03-04;Beispiel ${jahr}\r\n`;

test('download without a list says so', async ({ page }) => {
  await openSeeded(page, '#/sperren/IB-2027-Q1');
  await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: KEINE_LISTE })).toBeVisible();
});

test("download takes the list of the page's year", async ({ page }) => {
  await openSeeded(page, '#/sperren/IB-2027-Q1', {
    device: 'Firmen-PC',
    files: {
      '07 Anhänge/Notizbuch/2027/Sperren IB 2027.csv': csvOf(2027),
      '07 Anhänge/Notizbuch/2026/Sperren IB 2026.csv': csvOf(2026),
    },
  });
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe('Sperren IB 2027.csv');
  expect(await readFile((await file.path())!)).toEqual(Buffer.from(csvOf(2027), 'utf8'));
});

test('download offline says so', async ({ page }) => {
  const repo = await openSeeded(page, '#/sperren/IB-2027-Q1');
  repo.offline = true;
  await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: NO_NETWORK })).toBeVisible();
});
