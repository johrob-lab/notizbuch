import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';
import { bringToForeground, localFiles, networkBack, openSeeded, queued, savedSettings, sendToBackground, shareRepos } from './helpers/app';
import { pen } from './helpers/pointer';

// Ein Fenster je Gerät darf schreiben (Web Lock `notizbuch-aktiv`). Jedes weitere Fenster derselben Origin liest nur: Es zeigt
// einen Hinweis, hat weder Stift noch Kästchen noch Eingabefelder, die schreiben, und lädt nie hoch. Zwei Seiten in einem
// Browserkontext teilen sich IndexedDB und Web Locks, genau wie zwei Fenster auf dem iPad. Alles hier ist erfunden.

/** Jede Seite des Kontexts wird auf unbehandelte Fehler und Dialoge des Browsers geprüft. Die Uhr steht fest. */
const test = base.extend<{ watchPages: void; fixedToday: void }>({
  watchPages: [
    async ({ context }, use) => {
      const errors: string[] = [];
      const dialogs: string[] = [];
      const watch = (page: Page) => {
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('dialog', (dialog) => {
          dialogs.push(`${dialog.type()}: ${dialog.message()}`);
          void dialog.dismiss();
        });
      };
      for (const page of context.pages()) watch(page);
      context.on('page', watch);
      await use();
      expect(errors, 'unbehandelte Fehler im Browser').toEqual([]);
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
const NOTE = '05 Daily Notes/2026-10-29.md';
const TAG = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const BASE = '2026-11-04 0800 Muster';
const MEETING = `#/besprechung/${encodeURIComponent(BASE)}/1`;
const NAME1 = 'Liste Planobjekte ergänzen (fällig 30.10.)';
const HINT = 'Das Notizbuch ist schon in einem anderen Fenster offen.';
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];

const hint = (page: Page) => page.getByText(HINT, { exact: true });
const opened = (page: Page) => page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const group = (page: Page, name: string) => page.getByRole('group', { name });

/** Ein weiteres Fenster des Geräts: dieselbe IndexedDB, dieselbe Sperre, dieselben Repos im Speicher. */
async function secondWindow(context: BrowserContext, first: Page, hash: string): Promise<Page> {
  const second = await context.newPage();
  await shareRepos(first, second);
  await second.goto(`/notizbuch/${hash}`);
  return second;
}

// ---------- Das zweite Fenster ----------

test('a second window says so, shows the page, and cannot tick, edit, add or draw', async ({ context, page }) => {
  const repo = await openSeeded(page, DAY);
  const second = await secondWindow(context, page, DAY);
  await opened(second);
  await expect(hint(second)).toBeVisible();
  await expect(hint(page)).toHaveCount(0);

  // Gelesen wird die Notiz, wie sie ist
  const task = second.getByRole('checkbox', { name: NAME1, exact: true });
  await expect(task).toBeVisible();
  await expect(task).toBeDisabled();
  await expect(task).not.toBeChecked();
  // Nichts davon schreibt: keine Stifte, kein Feld zum Ergänzen, keine neue Besprechung, kein Termin, der eine Seite anlegen würde
  await expect(second.getByRole('button', { name: /^Bearbeiten:/ })).toHaveCount(0);
  await expect(second.getByRole('textbox', { name: 'Ergänzung' })).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Hinzufügen' })).toHaveCount(0);
  await expect(second.getByRole('button', { name: '+ Besprechung' })).toBeDisabled();
  await expect(second.getByRole('button', { name: /Abstimmung Beispiel 2027/ })).toBeDisabled();
  // Weder Werkzeuge noch Schnellwechsel, und der Stand des Abgleichs gehört dem anderen Fenster
  await expect(second.getByRole('toolbar', { name: 'Werkzeuge' })).toHaveCount(0);
  await expect(second.getByTestId('quick-switch')).toHaveCount(0);
  await expect(second.getByTestId('status')).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('Gesichert');

  // Auch erzwungene Eingaben schreiben nichts
  await task.click({ force: true });
  await pen(second).stroke(LINE);
  expect(await strokeCount(second)).toBe(0);
  await sendToBackground(second);
  await bringToForeground(second);
  await networkBack(second);
  await second.waitForTimeout(500);
  expect(await queued(second)).toEqual({});
  expect(repo.puts).toEqual([]);
  expect(repo.deletes).toEqual([]);
  await expect(task).not.toBeChecked();
});

test('the first window keeps working while the second one reads', async ({ context, page }) => {
  const repo = await openSeeded(page, DAY);
  const second = await secondWindow(context, page, DAY);
  await opened(second);
  await expect(hint(second)).toBeVisible();

  await page.getByRole('checkbox', { name: NAME1, exact: true }).check();
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect.poll(() => [...new Set(repo.puts.map((p) => p.path))].sort()).toEqual([NOTE, TAG].sort());
  await expect(page.getByTestId('status')).toHaveText('Gesichert');
  expect(repo.puts.every((p) => p.message.endsWith('(iPad)'))).toBe(true);
  await expect(hint(page)).toHaveCount(0);
});

test('the second window never uploads what the first one has queued', async ({ context, page }) => {
  const repo = await openSeeded(page, DAY);
  await pen(page).stroke(LINE); // wartet in der Warteschlange, die Wartezeit für Handschrift läuft
  expect(Object.keys(await queued(page))).toEqual([TAG]);
  const second = await secondWindow(context, page, DAY);
  await opened(second);
  await expect(hint(second)).toBeVisible();

  await sendToBackground(second); // ein aktives Fenster würde jetzt sofort hochladen
  await networkBack(second);
  await bringToForeground(second);
  await second.waitForTimeout(700);
  expect(repo.puts).toEqual([]);
  expect(Object.keys(await queued(second))).toEqual([TAG]);

  await sendToBackground(page); // das erste Fenster lädt hoch, genau einmal
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([TAG]);
  await second.waitForTimeout(300);
  expect(repo.puts).toHaveLength(1);
});

test('a second window reads a file from GitHub but keeps no copy of it', async ({ context, page }) => {
  const friday = [
    '---',
    'date: 2026-10-30',
    'tags: [daily]',
    '---',
    '# 2026-10-30',
    '',
    '## Morgenbriefing (automatisch)',
    '',
    '- [ ] Aufgabe vom Freitag %%todo:AAMkFR1%%',
    '',
  ].join('\n');
  await openSeeded(page, DAY, { files: { '05 Daily Notes/2026-10-30.md': friday } });
  await expect.poll(() => localFiles(page)).toEqual(expect.arrayContaining([NOTE, '04 Ressourcen/Kalender/Termine.md']));
  // Das erste Fenster hat den Freitag nie geöffnet. Das zweite liest ihn von GitHub, zeigt ihn und merkt sich nichts davon.
  const before = await localFiles(page);
  const second = await secondWindow(context, page, '#/tag/2026-10-30');
  await opened(second);
  await expect(hint(second)).toBeVisible();
  await expect(second.getByRole('checkbox', { name: 'Aufgabe vom Freitag', exact: true })).toBeVisible();
  await second.waitForTimeout(500);
  expect(await localFiles(page)).toEqual(before);
  expect(await queued(page)).toEqual({});
});

test('a meeting page in the second window can be read but its header cannot be changed', async ({ context, page }) => {
  const repo = await openSeeded(page, DAY);
  const second = await secondWindow(context, page, MEETING);
  await opened(second);
  await expect(hint(second)).toBeVisible();
  for (const label of ['Thema', 'Datum', 'Zeit', 'Ort', 'Projekt']) await expect(second.getByLabel(label, { exact: true })).toBeDisabled();
  await expect(second.getByRole('button', { name: '+ Seite' })).toHaveCount(0);
  await expect(second.getByRole('button', { name: 'Seite löschen' })).toHaveCount(0);
  await expect(second.getByRole('toolbar', { name: 'Werkzeuge' })).toHaveCount(0);
  await pen(second).stroke(LINE);
  expect(await strokeCount(second)).toBe(0);
  await sendToBackground(second);
  await second.waitForTimeout(300);
  expect(repo.puts).toEqual([]);
  expect(await queued(second)).toEqual({});
});

test('the settings in the second window can be read but not changed', async ({ context, page }) => {
  await openSeeded(page, DAY);
  const before = await savedSettings(page);
  const second = await secondWindow(context, page, DAY);
  await opened(second);
  await second.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await expect(second.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(hint(second)).toBeVisible();
  for (const name of ['Glättung', 'Vorhersage', 'Gerät']) {
    const radios = group(second, name).getByRole('radio');
    for (let i = 0; i < (await radios.count()); i++) await expect(radios.nth(i)).toBeDisabled();
  }
  await expect(second.getByRole('button', { name: 'Zugang ändern' })).toBeDisabled();
  // Erzwungen geht es auch nicht
  await group(second, 'Glättung').getByRole('radio', { name: 'stark' }).click({ force: true });
  await second.waitForTimeout(300);
  expect(await savedSettings(page)).toEqual(before);
});

// ---------- Wer das Schloss hat ----------

test('a reload keeps the only window active', async ({ page }) => {
  await openSeeded(page, DAY);
  for (let i = 0; i < 3; i++) {
    await page.reload();
    await opened(page);
    await expect(hint(page)).toHaveCount(0);
    await expect(page.getByRole('checkbox', { name: NAME1, exact: true })).toBeEnabled();
  }
});

test('when the first window is closed, the next one that opens is active', async ({ context, page }) => {
  await openSeeded(page, DAY);
  const second = await secondWindow(context, page, DAY);
  await opened(second);
  await expect(hint(second)).toBeVisible();

  await page.close();
  // Der Browser gibt die Sperre frei, sobald das Fenster zu ist. Ein Fenster, das nicht aktiv ist, merkt es erst beim Neuladen.
  await expect(async () => {
    await second.reload();
    await opened(second);
    await expect(hint(second)).toHaveCount(0, { timeout: 1000 });
  }).toPass({ timeout: 15_000 });
  await expect(second.getByRole('checkbox', { name: NAME1, exact: true })).toBeEnabled();
  await expect(second.getByTestId('status')).toHaveText('Gesichert');
});

test('without Web Locks every window works as before', async ({ context, page }) => {
  await context.addInitScript(() => {
    Object.defineProperty(Navigator.prototype, 'locks', { value: undefined, configurable: true });
  });
  const repo = await openSeeded(page, DAY);
  const second = await secondWindow(context, page, DAY);
  await opened(second);
  await expect(hint(page)).toHaveCount(0);
  await expect(hint(second)).toHaveCount(0);
  await expect(second.getByRole('checkbox', { name: NAME1, exact: true })).toBeEnabled();
  await second.getByRole('checkbox', { name: NAME1, exact: true }).check();
  await sendToBackground(second);
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([NOTE]);
});
