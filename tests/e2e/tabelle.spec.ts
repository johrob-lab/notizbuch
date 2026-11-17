import { expect, test as base, type Page, type Route } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import type { Stroke } from '../../src/ink/types';
import { meetingLayout } from '../../src/pages/layouts';
import { openSeeded, queued, sendToBackground } from './helpers/app';
import { mouse, pen } from './helpers/pointer';

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
const BASE = '2026-10-29 0800 Abstimmung Muster 2027';
const THEMA = 'Abstimmung Muster 2027';
const FILES = '07 Anhänge/Notizbuch/2026';
const PAGE1 = `${FILES}/${BASE} S1.svg`;
const PAGE2 = `${FILES}/${BASE} S2.svg`;
const QUESTION = 'Auf der Seite steht schon etwas. Art trotzdem ändern?';
/** Ein Strich in Zeile 3 der Tabelle (y 360 liegt zwischen 344 und 392). */
const ROW_3: [number, number][] = [
  [300, 360],
  [420, 370],
];

const hashOf = (base: string, n: number) => `#/besprechung/${encodeURIComponent(base)}/${n}`;
const hash = (page: Page) => page.evaluate(() => window.location.hash);
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);

/** Eine Seite der Besprechung als Datei, so wie die App sie schreibt, mit der Art, die die Kopfangabe nennt. */
function pageText(n: number, art = '', strokes: Stroke[] = []): string {
  const full: Record<string, string> = { thema: THEMA, datum: TODAY, zeit: '08:00', ort: '', projekt: '', seitennr: String(n) };
  if (art) full.art = art;
  const layout = meetingLayout(full);
  return serializePage({ kind: 'besprechung', key: BASE, meta: full, strokes }, layout.fields, layout.background());
}

/** Ein Strich in Zeile 3, wie ihn ein anderes Gerät geschrieben hätte. */
function rowStroke(): Stroke {
  return { id: 'a1', tool: 'kugel', color: 'schwarz', widthMm: 0.2, t: 1000, w: 1.2, pts: [{ x: 300, y: 360, w: 1.2 }, { x: 420, y: 370, w: 1.2 }] };
}

const tablePageText = (n: number, strokes: Stroke[] = []) => pageText(n, 'tabelle', strokes);

async function queuedText(page: Page, path: string): Promise<string> {
  return (await queued(page))[path] ?? '';
}

test('an empty notes page becomes a table page through the Art field', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  const art = field(page, 'Art');
  await expect(art.locator('option')).toHaveText(['Notizen', 'Tabelle Arbeitsvorbereitung']);
  await expect(art).toHaveValue('');
  await art.selectOption({ label: 'Tabelle Arbeitsvorbereitung' });
  await expect(page.getByRole('dialog')).toHaveCount(0); // keine Rückfrage
  await expect.poll(() => queuedText(page, PAGE1)).toContain('data-art="tabelle"');
  const text = await queuedText(page, PAGE1);
  expect(text).toContain('data-notizbuch="3"');
  expect(text).toContain('data-tabelle="1"');
});

test('a stroke on a table page lands in its row', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1) } });
  await expect(field(page, 'Art')).toHaveValue('tabelle');
  await pen(page).stroke(ROW_3);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect.poll(() => queuedText(page, PAGE1)).toContain('<g data-feld="zeile-03"');
});

test('changing the Art of a page with strokes asks first', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1, [rowStroke()]) } });
  const art = field(page, 'Art');
  await expect(art).toHaveValue('tabelle');
  await expect.poll(() => strokeCount(page)).toBe(1);

  await art.selectOption({ label: 'Notizen' });
  const dialog = page.getByRole('dialog', { name: QUESTION });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveText(['Abbrechen', 'Ändern']);

  // Abbrechen: Das Feld zeigt wieder die Tabelle, und die Datei bleibt.
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(art).toHaveValue('tabelle');
  await expect(art.locator('option:checked')).toHaveText('Tabelle Arbeitsvorbereitung');
  expect(await queued(page)).toEqual({});
  expect(repo.read(PAGE1)).toContain('data-art="tabelle"');

  // Ändern: Die Seite ist wieder eine Notizseite, der Strich bleibt.
  await art.selectOption({ label: 'Notizen' });
  await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'Ändern', exact: true }).click();
  await expect.poll(() => queuedText(page, PAGE1)).toContain('<g data-feld="besprechung"');
  const text = await queuedText(page, PAGE1);
  expect(text).toContain('data-notizbuch="1"');
  expect(text).not.toContain('data-art="tabelle"');
  expect(await strokeCount(page)).toBe(1);
});

test('plus page on a table page makes another table page', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1) } });
  await button(page, '+ Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 2));
  await expect(field(page, 'Art')).toHaveValue('tabelle');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((p) => p.path)).toContain(PAGE2);
  const text = repo.puts.find((p) => p.path === PAGE2)?.text ?? '';
  expect(text).toContain('data-art="tabelle"');
  expect(text).toContain('data-notizbuch="3"');
});
