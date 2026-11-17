import { expect, test as base, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import { meetingLayout } from '../../src/pages/layouts';
import { openSeeded } from './helpers/app';

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und darauf, dass die App nie einen Dialog des
 * Browsers öffnet (`window.confirm` blockiert das iPad): Die Rückfrage kommt von der App selbst. Heute ist in allen
 * Tests der 29.10.2026 (Wiener Zeit).
 */
const test = base.extend<{ browserErrors: void; noBrowserDialogs: void; fixedToday: void }>({
  browserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await use();
      expect(errors, 'unbehandelte Fehler im Browser').toEqual([]);
    },
    { auto: true },
  ],
  noBrowserDialogs: [
    async ({ page }, use) => {
      const dialogs: string[] = [];
      page.on('dialog', (dialog) => {
        dialogs.push(`${dialog.type()}: ${dialog.message()}`);
        void dialog.dismiss();
      });
      await use();
      expect(dialogs, 'Dialoge des Browsers').toEqual([]);
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

const TODAY = '2026-10-29';
const DAY = `#/tag/${TODAY}`;
const LIST = '#/besprechungen';
const ROOT = '07 Anhänge/Notizbuch';
const HINT = 'Ohne Netz siehst du nur die Besprechungen auf diesem Gerät.';

const NOV = '2026-11-03 0900 Abstimmung Muster 2028';
const OCT = '2026-10-29 0800 Abstimmung Beispiel 2027';
const OLD = '2025-03-04 1400 Baustelle Beispiel';

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const link = (page: Page, name: string) => page.getByRole('link', { name, exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** Der Pfad einer Seite einer Besprechung im Repo: Der Ordner ist das Jahr aus dem Namen. */
const pathOf = (base: string, n: number) => `${ROOT}/${base.slice(0, 4)}/${base} S${n}.svg`;

/** Eine Seite einer Besprechung als Datei, so wie die App sie schreibt (Kopfdaten und der Hintergrund, der sie zeigt). */
function pageText(base: string, n: number): string {
  const meta = { thema: base.slice(16), datum: base.slice(0, 10), zeit: `${base.slice(11, 13)}:${base.slice(13, 15)}`, ort: '', projekt: '', seitennr: String(n) };
  const layout = meetingLayout(meta);
  return serializePage({ kind: 'besprechung', key: base, meta, strokes: [] }, layout.fields, layout.background());
}

/** Das Repo mit den drei Besprechungen, einer Konfliktkopie und der Tagesseite. */
function repoFiles(): Record<string, string> {
  return {
    [pathOf(NOV, 1)]: pageText(NOV, 1),
    [pathOf(NOV, 2)]: pageText(NOV, 2),
    [pathOf(OCT, 1)]: pageText(OCT, 1),
    [pathOf(OLD, 1)]: pageText(OLD, 1),
    [`${ROOT}/2026/${OCT} S1 (Konflikt).svg`]: pageText(OCT, 1),
    [`${ROOT}/2026/2026-10-29 Tag.svg`]: pageText(OCT, 1),
  };
}

/** Auf der Tagesseite „+ Besprechung“: Thema und Zeit eintragen und anlegen. Die neue Seite öffnet sich, zurück geht es zur Tagesseite. */
async function addMeeting(page: Page, thema: string, zeit: string) {
  await button(page, '+ Besprechung').click();
  const question = page.getByRole('dialog', { name: 'Neue Besprechung' });
  await question.getByLabel('Thema').fill(thema);
  await question.getByLabel('Zeit').fill(zeit);
  await question.getByRole('button', { name: 'Anlegen' }).click();
  await expect.poll(() => hash(page)).toContain('#/besprechung/');
}

test('the button opens all meetings, the newest on top', async ({ page }) => {
  await openSeeded(page, DAY, { files: repoFiles() });
  await link(page, 'Besprechungen').click();
  expect(await hash(page)).toBe(LIST);

  await expect(page.getByRole('heading', { level: 2 })).toHaveText(['November 2026', 'Oktober 2026', 'März 2025']);
  const first = link(page, 'Di 03.11. · 09:00 · Abstimmung Muster 2028 · 2 Seiten');
  await expect(first).toBeVisible();
  await expect(link(page, 'Do 29.10. · 08:00 · Abstimmung Beispiel 2027')).toBeVisible();
  await expect(link(page, 'Di 04.03. · 14:00 · Baustelle Beispiel')).toBeVisible();
  await expect(page.locator('section.besprechungen a')).toHaveCount(3);

  await first.click();
  await expect.poll(() => hash(page)).toBe(`#/besprechung/${encodeURIComponent(NOV)}/1`);
});

test('a meeting made offline on this device is listed with the hint', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { files: repoFiles() });
  // Das Anlegen braucht kein Netz. Ginge es hier nicht, würde die Besprechung online angelegt und das Netz danach abgeschaltet.
  repo.offline = true;
  await addMeeting(page, 'Nur hier', '10:00');
  await page.evaluate((h) => void (window.location.hash = h), DAY);
  await link(page, 'Besprechungen').click();

  await expect(link(page, 'Do 29.10. · 10:00 · Nur hier')).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: HINT })).toBeVisible();
  await expect(page.getByText('Besprechungen werden geladen')).toHaveCount(0);
  // Was nur im Repo liegt, kennt dieses Gerät nicht.
  await expect(page.locator('section.besprechungen a')).toHaveCount(1);
  await expect(page.getByText('Abstimmung')).toHaveCount(0);
});

test('with network the new meeting and the repo meetings are both there, without hint', async ({ page }) => {
  await openSeeded(page, DAY, { files: repoFiles() });
  await addMeeting(page, 'Nur hier', '10:00');
  await page.evaluate((h) => void (window.location.hash = h), DAY);
  await link(page, 'Besprechungen').click();

  await expect(link(page, 'Do 29.10. · 10:00 · Nur hier')).toBeVisible();
  await expect(link(page, 'Di 03.11. · 09:00 · Abstimmung Muster 2028 · 2 Seiten')).toBeVisible();
  await expect(link(page, 'Di 04.03. · 14:00 · Baustelle Beispiel')).toBeVisible();
  await expect(page.getByText('Besprechungen werden geladen')).toHaveCount(0);
  await expect(page.getByText(HINT)).toHaveCount(0);
});

test('without meetings the list says so', async ({ page }) => {
  await openSeeded(page, DAY);
  await link(page, 'Besprechungen').click();
  await expect(page.getByText('Noch keine Besprechungen')).toBeVisible();
  await expect(page.getByText(HINT)).toHaveCount(0);
});

test('on the list the arrows are off, Heute leads to today and there is no Vollbild', async ({ page }) => {
  await openSeeded(page, DAY, { files: repoFiles() });
  await link(page, 'Besprechungen').click();
  await expect(page.getByRole('heading', { level: 2, name: 'November 2026' })).toBeVisible();
  await expect(button(page, 'Vorige Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(link(page, 'Besprechungen')).toHaveAttribute('aria-current', 'page');
  await expect(button(page, 'Vollbild')).toHaveCount(0);
  await link(page, 'Heute').click();
  expect(await hash(page)).toBe(`#/tag/${TODAY}`);
});

test('at 834 points the bar stays on one line and the button says Bespr.', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1112 });
  await openSeeded(page, DAY);
  const bar = page.locator('.topbar');
  await expect(link(page, 'Besprechungen')).toBeVisible();
  await expect(link(page, 'Besprechungen')).toHaveJSProperty('innerText', 'Bespr.');
  // Der Stand ist ein kurzer Text und steht in der Mitte der Zeile, darum zählen die Knöpfe und Blöcke mit festen 44 Punkten.
  const tops = await bar.evaluate((el) => [...el.children].filter((child) => !child.classList.contains('status')).map((child) => (child as HTMLElement).offsetTop));
  expect(new Set(tops).size, `Oberkanten ${tops}`).toBe(1);
  expect((await bar.boundingBox())!.height, 'eine Zeile').toBeLessThan(70);
  expect(await bar.evaluate((el) => el.scrollWidth <= el.clientWidth), 'nichts ragt über den Rand').toBe(true);

  await page.setViewportSize({ width: 1194, height: 1590 });
  await expect(link(page, 'Besprechungen')).toHaveJSProperty('innerText', 'Besprechungen');
});

test('on the office PC the list opens meetings to read', async ({ page }) => {
  await openSeeded(page, DAY, { files: repoFiles(), device: 'Firmen-PC' });
  await link(page, 'Besprechungen').click();
  const first = link(page, 'Di 03.11. · 09:00 · Abstimmung Muster 2028 · 2 Seiten');
  await expect(first).toBeVisible();
  await first.click();
  await expect.poll(() => hash(page)).toBe(`#/besprechung/${encodeURIComponent(NOV)}/1`);
});
