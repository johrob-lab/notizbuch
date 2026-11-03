import { expect, test as base, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import { besprechungLayout } from '../../src/pages/layouts';
import { openSeeded, savedSettings } from './helpers/app';
import { pen, viewOf } from './helpers/pointer';

// Das Vollbild: Ein Knopf blendet alle Leisten aus, die Seite füllt den Bildschirm. GitHub antwortet aus einem Repo im
// Speicher (tests/e2e/helpers/app.ts). Alles hier ist erfunden. Heute ist in allen Tests der 29.10.2026 (Wiener Zeit).

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
const NEXT_DAY = '#/tag/2026-10-30';
const ON = { vollbild: { an: true, werkzeuge: 'kreis' } };
/** Ein Strich im unteren Teil der Tagesseite (Feld „Notizen“). */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
const BASE = '2026-10-29 0800 Abstimmung Beispiel 2027';
const MEETING = `07 Anhänge/Notizbuch/2026/${BASE} S1.svg`;

const knopf = (page: Page) => page.getByRole('button', { name: 'Vollbild', exact: true });
const status = (page: Page) => page.getByTestId('status');

test('the Vollbild button hides the bars and the page fills the width', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator('.werkzeuge')).toBeVisible();
  await expect(page.locator('.monatsreiter')).toBeVisible();
  await knopf(page).click();

  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await expect(page.locator('.ansichten')).toBeHidden();
  await expect(page.locator('.werkzeuge')).toBeHidden();
  await expect(page.locator('.monatsreiter')).toBeHidden();
  await expect(knopf(page)).toBeHidden();
  const box = (await page.getByTestId('surface').boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(1200);
  await expect.poll(async () => ((await viewOf(page)).scale * 1000) | 0).toBe((((1200 - 32) / 1192) * 1000) | 0);
});

test('fullscreen stays on after a page change and a reload', async ({ page }) => {
  await openSeeded(page, DAY);
  await knopf(page).click();
  await expect(page.locator('.ansichten')).toBeHidden();
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: true, werkzeuge: 'kreis' });

  await page.evaluate((h) => void (window.location.hash = h), NEXT_DAY);
  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await expect(page.locator('.ansichten')).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await expect(page.locator('.ansichten')).toBeHidden();
  expect((await savedSettings(page))?.vollbild).toEqual({ an: true, werkzeuge: 'kreis' });
});

test('the settings page always shows the bar', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await expect(page.locator('.ansichten')).toBeHidden();
  await page.evaluate(() => void (window.location.hash = '#/einstellungen'));
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator('main#app')).not.toHaveClass(/vollbild/);
  await expect(knopf(page)).toHaveCount(0); // der Knopf gehört zu den Seiten
});

test('in fullscreen a notice stays visible and the status shows only when not saved', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { settings: { ...ON, tokenExpiry: '2026-11-08' }, offline: true });
  await expect(page.locator('.meldung', { hasText: 'Dein Zugang läuft am 08.11.2026 ab. Bitte rechtzeitig erneuern.' })).toBeVisible();
  await expect(page.locator('.ansichten')).toBeHidden();
  await pen(page).stroke(LINE);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveText('Wartet auf Netz · 1 Änderung');

  repo.offline = false;
  await page.evaluate(() => void window.dispatchEvent(new Event('online')));
  await expect.poll(() => repo.puts.length).toBeGreaterThan(0);
  await expect(status(page)).toHaveCount(0);
});

test('a meeting page hides its header form in fullscreen', async ({ page }) => {
  const layout = besprechungLayout({ thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', ort: '', projekt: '', seitennr: '1' });
  const text = serializePage(
    { kind: 'besprechung', key: BASE, meta: { thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', ort: '', projekt: '', seitennr: '1' }, strokes: [] },
    layout.fields,
    layout.background(),
  );
  await openSeeded(page, `#/besprechung/${encodeURIComponent(BASE)}/1`, { files: { [MEETING]: text } });
  await expect(page.locator('form.kopfdaten')).toBeVisible();
  await knopf(page).click();
  await expect(page.locator('form.kopfdaten')).toBeHidden();
  await expect(page.locator('.werkzeuge')).toBeHidden();
});

test('the tools for fullscreen can be chosen in the settings', async ({ page }) => {
  await openSeeded(page, DAY);
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.getByRole('group', { name: 'Werkzeuge im Vollbild' }).getByRole('radio', { name: 'Tab', exact: true }).check();
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: false, werkzeuge: 'tab' });
});
