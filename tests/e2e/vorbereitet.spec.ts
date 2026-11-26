import { expect, test as base, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import { besprechungLayout } from '../../src/pages/layouts';
import { openSeeded, queued } from './helpers/app';
import { pen } from './helpers/pointer';

// Vorbereitete Punkte auf Seite 1 einer Besprechung: Sie kommen aus der Tagesnotiz (Abschnitt „Besprechungen (vorbereitet)“),
// stehen nur auf dem Bildschirm, lassen sich abhaken und lassen den Stift durch.

const test = base.extend<{ fixedToday: void; browserErrors: void }>({
  fixedToday: [
    async ({ page }, use) => {
      await page.clock.setFixedTime(new Date('2026-10-29T12:00:00+01:00'));
      await use();
    },
    { auto: true },
  ],
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

test.use({ serviceWorkers: 'block', viewport: { width: 1200, height: 1700 } });

const TODAY = '2026-10-29';
const BASE = `${TODAY} 0800 Abstimmung Beispiel 2027`;
const PAGE1 = `07 Anhänge/Notizbuch/2026/${BASE} S1.svg`;
const PAGE2 = `07 Anhänge/Notizbuch/2026/${BASE} S2.svg`;
const NOTE = `05 Daily Notes/${TODAY}.md`;
const TASK = '- [ ] Liste der Sperren prüfen';
const NOTE_TEXT = [
  '---',
  `date: ${TODAY}`,
  '---',
  `# ${TODAY}`,
  '',
  '## Besprechungen (vorbereitet)',
  '',
  '### 08:00 Abstimmung Beispiel 2027',
  'Quelle: Einladung',
  '**Sperren 2027**',
  TASK,
  '- [x] Termin fixiert',
  '- Hinweis ohne Kästchen',
  '',
].join('\n');

const hashOf = (n: number) => `#/besprechung/${encodeURIComponent(BASE)}/${n}`;
const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const card = (page: Page) => page.getByRole('region', { name: 'Vorbereitete Punkte' });

function pageText(n: number): string {
  const meta = { thema: 'Abstimmung Beispiel 2027', datum: TODAY, zeit: '08:00', ort: '', projekt: '', seitennr: String(n) };
  const layout = besprechungLayout(meta);
  return serializePage({ kind: 'besprechung', key: BASE, meta, strokes: [] }, layout.fields, layout.background());
}

const files = { [PAGE1]: pageText(1), [PAGE2]: pageText(2), [NOTE]: NOTE_TEXT };

test('shows the prepared points on page 1 and ticks one in the daily note', async ({ page }) => {
  await openSeeded(page, hashOf(1), { files });
  await expect(card(page)).toBeVisible();
  await expect(card(page).getByText('Sperren 2027')).toBeVisible();
  await expect(card(page).getByText('Hinweis ohne Kästchen')).toBeVisible();
  await expect(checkbox(page, 'Termin fixiert')).toBeChecked();
  if (process.env.SCREENSHOT) await page.screenshot({ path: process.env.SCREENSHOT });

  await checkbox(page, 'Liste der Sperren prüfen').click();
  await expect(checkbox(page, 'Liste der Sperren prüfen')).toBeChecked();
  const ticked = NOTE_TEXT.replace(TASK, '- [x] Liste der Sperren prüfen');
  await expect.poll(async () => (await queued(page))[NOTE]).toBe(ticked);
});

test('a pen stroke over the prepared points lands on the page', async ({ page }) => {
  await openSeeded(page, hashOf(1), { files });
  await expect(card(page)).toBeVisible();
  // Mitten durch die Zeile „Sperren 2027“ (oberste Linie des Schreibfelds), weit weg von den Kästchen.
  await pen(page).stroke([
    [500, 230],
    [600, 240],
    [700, 230],
  ]);
  await expect.poll(() => page.evaluate(() => window.__notizbuch.currentPage().strokes.length)).toBe(1);
  // Die Seite selbst bekommt nichts von den Punkten.
  await expect.poll(async () => (await queued(page))[PAGE1] ?? '').toContain('<path data-id=');
  expect((await queued(page))[PAGE1]).not.toContain('Sperren 2027');
});

test('page 2 and meetings without prepared points show nothing', async ({ page }) => {
  await openSeeded(page, hashOf(2), { files });
  await page.waitForFunction(() => window.__notizbuch?.currentPage?.().meta.seitennr === '2');
  await expect(card(page)).toHaveCount(0);
});

test('a long list goes on on page 2', async ({ page }) => {
  const many = Array.from({ length: 40 }, (_, i) => `- [ ] Punkt ${i + 1}`);
  const note = NOTE_TEXT.replace(TASK, many.join('\n'));
  await openSeeded(page, hashOf(1), { files: { ...files, [NOTE]: note } });
  await expect(card(page).getByText('weiter auf Seite 2')).toBeAttached();
  await expect(checkbox(page, 'Punkt 1')).toBeVisible();

  await page.evaluate((h) => void (window.location.hash = h), hashOf(2));
  await page.waitForFunction(() => window.__notizbuch?.currentPage?.().meta.seitennr === '2');
  await expect(checkbox(page, 'Punkt 40')).toBeVisible();
  await expect(card(page).getByText('weiter auf Seite 3')).toHaveCount(0);
});
