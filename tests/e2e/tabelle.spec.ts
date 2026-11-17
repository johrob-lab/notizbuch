import { readFile } from 'node:fs/promises';
import { expect, test as base, type Page, type Route } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import type { Stroke } from '../../src/ink/types';
import { meetingLayout } from '../../src/pages/layouts';
import { localFiles, openSeeded, queued, sendToBackground } from './helpers/app';
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

// Der Knopf „Für Excel herunterladen“.

const DOWNLOAD = 'Für Excel herunterladen';
const CSV_NAME = `${BASE} Tabelle.csv`;
const CSV_PATH = `${FILES}/${CSV_NAME}`;
const JSON_PATH = `${FILES}/${BASE} Tabelle.json`;
const KOPF =
  'Besprechung;Datum;Seite;Zeile;Vorhaben;Schritt;Monat;Faktor1;Faktor2;Faktor3;Anzahl;wer;Fahrzeuge;Ressourcen;Material_EUR;Fremd_EUR;Bemerkung;Mass1;Einheit1;Mass2;Einheit2;Mass3;Einheit3;Unsicher';
const CSV = '\uFEFF' + KOPF + '\r\n' + 'Abstimmung Muster 2027;2026-10-29;1;2;Musterbrücke 4711;Vorarbeiten;3;50;2;;;KI;BCR 8;SAS ET 8;;;;;;;;;;\r\n';
const NOT_TYPED = 'Noch nicht abgetippt. Die CSV kommt mit der Abendroutine.';
const NO_NETWORK = 'Zum Herunterladen braucht die App Netz.';
const STALE = 'Stand der CSV: 29.10., 19:02. Neuere Striche kommen mit der nächsten Abendroutine dazu.';
const STORE = JSON.stringify({ format: 1, verarbeitet: '2026-10-29 19:02', seiten: { '1': { stand: 1000 } } });

test('on the office PC the button downloads the CSV byte for byte', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), {
    device: 'Firmen-PC',
    files: { [PAGE1]: tablePageText(1), [CSV_PATH]: CSV, [JSON_PATH]: STORE },
  });
  const download = page.waitForEvent('download');
  await button(page, DOWNLOAD).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(CSV_NAME);
  const path = await file.path();
  expect(await readFile(path)).toEqual(Buffer.from(CSV, 'utf8'));
});

test('on the iPad the button hands the CSV to the share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shared?: { name: string; bytes: number[] } };
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        const file = data.files![0];
        w.shared = { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] };
      },
    });
  });
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1), [CSV_PATH]: CSV, [JSON_PATH]: STORE } });
  await button(page, DOWNLOAD).click();
  await page.waitForFunction(() => 'shared' in window);
  const shared = await page.evaluate(() => (window as unknown as { shared: { name: string; bytes: number[] } }).shared);
  expect(shared.name).toBe(CSV_NAME);
  expect(Buffer.from(shared.bytes)).toEqual(Buffer.from(CSV, 'utf8'));
});

test('when the tap has expired the second tap shares the loaded CSV', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as unknown as { shared?: { name: string; bytes: number[] }; calls: number };
    w.calls = 0;
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        if (++w.calls === 1) throw new DOMException('Der Fingertipp ist abgelaufen.', 'NotAllowedError');
        const file = data.files![0];
        w.shared = { name: file.name, bytes: [...new Uint8Array(await file.arrayBuffer())] };
      },
    });
  });
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1), [CSV_PATH]: CSV, [JSON_PATH]: STORE } });
  await button(page, DOWNLOAD).click();
  await expect(page.getByRole('status').filter({ hasText: 'Die CSV ist geladen. Zum Teilen bitte noch einmal tippen.' })).toBeVisible();
  // Der zweite Tipp lädt nicht noch einmal: Ohne Netz teilt er trotzdem.
  repo.offline = true;
  await button(page, DOWNLOAD).click();
  await page.waitForFunction(() => 'shared' in window);
  const shared = await page.evaluate(() => (window as unknown as { shared: { name: string; bytes: number[] } }).shared);
  expect(shared.name).toBe(CSV_NAME);
  expect(Buffer.from(shared.bytes)).toEqual(Buffer.from(CSV, 'utf8'));
});

/** Mittag des 29.10.2026 in Wien, die feste Zeit aller Tests (siehe `fixedToday`), in Millisekunden. */
const NOON = Date.parse('2026-10-29T12:00:00+01:00');
const AGAIN = 'Die CSV ist geladen. Zum Teilen bitte noch einmal tippen.';
/** Dieselbe CSV, wie sie eine spätere Abendroutine schreibt (Std in Zeile 2 jetzt 60). */
const NEWER_CSV = CSV.replace(';Vorarbeiten;3;50;', ';Vorarbeiten;3;60;');

/** Das Teilen am iPad: Das erste Mal scheitert es wie nach einem abgelaufenen Fingertipp, danach merkt es sich jede Datei. */
async function shareFailingOnce(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { shares: number[][]; calls: number };
    w.shares = [];
    w.calls = 0;
    Object.defineProperty(navigator, 'canShare', { value: () => true, configurable: true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async (data: ShareData) => {
        if (++w.calls === 1) throw new DOMException('Der Fingertipp ist abgelaufen.', 'NotAllowedError');
        w.shares.push([...new Uint8Array(await data.files![0].arrayBuffer())]);
      },
    });
  });
}

/** Die geteilten Dateien als Text, Byte für Byte (ein BOM bleibt als erstes Zeichen stehen). */
const shares = async (page: Page): Promise<string[]> =>
  (await page.evaluate(() => (window as unknown as { shares: number[][] }).shares)).map((bytes) => Buffer.from(bytes).toString('utf8'));

test('just under a minute after the failed share the next tap still shares the loaded CSV', async ({ page }) => {
  await shareFailingOnce(page);
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1), [CSV_PATH]: CSV, [JSON_PATH]: STORE } });
  await button(page, DOWNLOAD).click();
  await expect(page.getByRole('status').filter({ hasText: AGAIN })).toBeVisible();
  // Inzwischen liegt eine neuere CSV auf GitHub, aber der geladene Text gilt noch: Der Tipp teilt ihn, ohne neu zu laden.
  repo.commit(CSV_PATH, NEWER_CSV);
  await page.clock.setFixedTime(NOON + 59_999);
  await button(page, DOWNLOAD).click();
  await expect.poll(() => shares(page)).toEqual([CSV]);
});

test('a minute after the failed share the next tap loads the CSV again', async ({ page }) => {
  await shareFailingOnce(page);
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: tablePageText(1), [CSV_PATH]: CSV, [JSON_PATH]: STORE } });
  await button(page, DOWNLOAD).click();
  await expect(page.getByRole('status').filter({ hasText: AGAIN })).toBeVisible();
  // Nach einer Minute ist der geladene Text verfallen: Der Tipp lädt die CSV neu und teilt den Stand, der jetzt auf GitHub liegt.
  repo.commit(CSV_PATH, NEWER_CSV);
  await page.clock.setFixedTime(NOON + 60_000);
  await button(page, DOWNLOAD).click();
  await expect.poll(() => shares(page)).toEqual([NEWER_CSV]);
});

test('without a CSV the button says it comes with the evening routine', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { device: 'Firmen-PC', files: { [PAGE1]: tablePageText(1) } });
  let downloads = 0;
  page.on('download', () => downloads++);
  await button(page, DOWNLOAD).click();
  await expect(page.getByText(NOT_TYPED, { exact: true })).toBeVisible();
  expect(downloads).toBe(0);
});

test('without network the button says so', async ({ page }) => {
  // Erst mit Netz öffnen, damit das Gerät eine Kopie der Seite hat, dann fällt das Netz weg.
  const repo = await openSeeded(page, hashOf(BASE, 1), { device: 'Firmen-PC', files: { [PAGE1]: tablePageText(1), [CSV_PATH]: CSV } });
  await expect(field(page, 'Art')).toHaveValue('tabelle');
  await expect.poll(async () => (await localFiles(page)).includes(PAGE1)).toBe(true);
  repo.offline = true;
  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await button(page, DOWNLOAD).click();
  await expect(page.getByText(NO_NETWORK, { exact: true })).toBeVisible();
});

test('a page with strokes newer than the CSV still downloads and says so', async ({ page }) => {
  const stroke = { ...rowStroke(), t: 2000 };
  await openSeeded(page, hashOf(BASE, 1), {
    device: 'Firmen-PC',
    files: { [PAGE1]: tablePageText(1, [stroke]), [CSV_PATH]: CSV, [JSON_PATH]: STORE },
  });
  await expect.poll(() => strokeCount(page)).toBe(1);
  const download = page.waitForEvent('download');
  await button(page, DOWNLOAD).click();
  expect((await download).suggestedFilename()).toBe(CSV_NAME);
  await expect(page.getByRole('status').filter({ hasText: STALE })).toBeVisible();
});

test('notes pages have no download button', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await expect(field(page, 'Art')).toHaveValue('');
  await expect(button(page, DOWNLOAD)).toHaveCount(0);
});
