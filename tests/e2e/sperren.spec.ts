import { readFile } from 'node:fs/promises';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import type { Stroke } from '../../src/ink/types';
import { EXCEL_KOPF } from '../../src/lib/sperrenExcel';
import { sperrenLayout } from '../../src/pages/layouts';
import { changeStoredSettings, localFiles, openSeeded, queued, savedSettings, shareRepos } from './helpers/app';
import { mouse, pen } from './helpers/pointer';

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und darauf, dass die App nie einen Dialog des
 * Browsers öffnet. Heute ist in allen Tests der 29.10.2026 (Wiener Zeit), die Seite Sept. und Okt. 2026 (IB-2026-09).
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
const SEITE = '#/sperren/IB-2026-09';
const FILE = '07 Anhänge/Notizbuch/2026/2026-09 Sperren IB.svg';
/** Ein Strich in Platz 1 des 3. Oktober (rechte Spalte): x 684 bis 840, y 272 bis 316, Seiteneinheiten. */
const PLATZ_1: [number, number][] = [
  [720, 294],
  [790, 298],
];
/** Ein Strich in Platz 3 desselben Tages: x 996 bis 1152. */
const PLATZ_3: [number, number][] = [
  [1030, 294],
  [1100, 298],
];

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const link = (page: Page | Locator, name: string) => page.getByRole('link', { name, exact: true });
const fachlinie = (page: Page) => page.getByRole('group', { name: 'Fachlinie', exact: true });
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const opened = (page: Page) => page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));

test('the Sperren button opens the current page of IB', async ({ page }) => {
  await openSeeded(page, DAY);
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe(SEITE);
  await expect(link(page, 'Sperren')).toHaveAttribute('aria-current', 'page');
});

test('a pen stroke in a day lands in that field', async ({ page }) => {
  await openSeeded(page, SEITE);
  await pen(page).stroke(PLATZ_1);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect.poll(async () => (await queued(page))[FILE] ?? '').toContain('data-feld="sperre-2026-10-03-1"');
  const text = (await queued(page))[FILE];
  expect(text).toContain('data-seite="sperren"');
  expect(text).toMatch(/data-feld="sperre-2026-10-03-1"[^]*<path/);
});

test('a pen stroke in the third place lands in the field of place 3', async ({ page }) => {
  await openSeeded(page, SEITE);
  await pen(page).stroke(PLATZ_3);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect.poll(async () => (await queued(page))[FILE] ?? '').toContain('data-feld="sperre-2026-10-03-3"');
});

test('the arrows step by two months and keep the Fachlinie', async ({ page }) => {
  await openSeeded(page, SEITE);
  await expect(page.getByRole('link', { name: 'Vorige zwei Monate' })).toBeVisible();
  await page.getByRole('link', { name: 'Nächste zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2026-11');
  await page.getByRole('link', { name: 'Nächste zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2027-01');
  await page.getByRole('link', { name: 'Vorige zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2026-11');
  await page.getByRole('link', { name: 'Vorige zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe(SEITE);
});

test('Lehne keeps the page', async ({ page }) => {
  await openSeeded(page, '#/sperren/IB-2027-01');
  await expect(link(fachlinie(page), 'IB')).toHaveAttribute('aria-current', 'page');
  await link(fachlinie(page), 'Lehne').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-01');
  await expect(link(fachlinie(page), 'Lehne')).toHaveAttribute('aria-current', 'page');
  await expect(link(fachlinie(page), 'IB')).not.toHaveAttribute('aria-current', 'page');
  await link(fachlinie(page), 'IB').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2027-01');
  await expect(link(fachlinie(page), 'IB')).toHaveAttribute('aria-current', 'page');
});

test('starting on Lehne, the arrows keep Lehne and IB keeps the page', async ({ page }) => {
  await openSeeded(page, '#/sperren/Lehne-2026-11');
  await expect(link(fachlinie(page), 'Lehne')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Nächste zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-01');
  await expect(link(fachlinie(page), 'Lehne')).toHaveAttribute('aria-current', 'page');
  await page.getByRole('link', { name: 'Vorige zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2026-11');
  await page.getByRole('link', { name: 'Nächste zwei Monate' }).click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-01');
  await link(fachlinie(page), 'IB').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/IB-2027-01');
  await expect(link(fachlinie(page), 'IB')).toHaveAttribute('aria-current', 'page');
});

test('the last opened page comes back, also after a reload', async ({ page }) => {
  await openSeeded(page, '#/sperren/Lehne-2027-03');
  await expect.poll(async () => (await savedSettings(page))?.sperren).toBe('Lehne-2027-03');
  await page.evaluate(() => (window.location.hash = '#/tag/2026-10-29'));
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-03');

  await page.evaluate(() => (window.location.hash = '#/tag/2026-10-29'));
  await page.reload();
  await opened(page);
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-03');
});

test('an old quarter key in the settings leads to the new page', async ({ page }) => {
  await openSeeded(page, DAY);
  await changeStoredSettings(page, { sperren: 'Lehne-2027-Q2' });
  await page.reload();
  await opened(page);
  await link(page, 'Sperren').click();
  await expect.poll(() => hash(page)).toBe('#/sperren/Lehne-2027-03');
});

test('an old address with a quarter key shows the new page', async ({ page }) => {
  await openSeeded(page, '#/sperren/IB-2027-Q4');
  await opened(page);
  await expect.poll(() => page.evaluate(() => window.__notizbuch.currentPage().key)).toBe('IB-2027-09');
});

test('the second window shows the page but saves nothing', async ({ context, page }) => {
  await openSeeded(page, DAY);
  const before = await savedSettings(page);
  const second = await context.newPage();
  await shareRepos(page, second);
  await second.goto('/notizbuch/#/sperren/Lehne-2027-07');
  await opened(second);
  await expect(second.getByText('Das Notizbuch ist schon in einem anderen Fenster offen.', { exact: true })).toBeVisible();
  await expect(second.getByRole('group', { name: 'Fachlinie', exact: true })).toBeVisible();
  // Die Leiste kennt den Schlüssel sofort, gespeichert wird nichts.
  await second.evaluate(() => (window.location.hash = '#/tag/2026-10-29'));
  await link(second, 'Sperren').click();
  await expect.poll(() => second.evaluate(() => window.location.hash)).toBe('#/sperren/Lehne-2027-07');
  await second.waitForTimeout(300);
  expect(await savedSettings(page)).toEqual(before);
});

/** Obere Kante und Höhe der Knöpfe einer Zeile. */
async function tops(page: Page, selector: string): Promise<number[]> {
  return page.locator(selector).evaluateAll((els) => els.filter((el) => (el as HTMLElement).offsetParent !== null).map((el) => Math.round(el.getBoundingClientRect().top)));
}

test('the bar stays one row on an iPad in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 1194, height: 1194 });
  await openSeeded(page, '#/sperren/IB-2027-01');
  const platzhalter = ['Index', 'Jahr', 'To-Dos'].map((name) => page.locator('header.topbar').getByRole('button', { name, exact: true }));
  for (const p of platzhalter) await expect(p).toBeVisible();
  const wide = (await page.locator('header.topbar').boundingBox())!.height;

  await page.setViewportSize({ width: 834, height: 1194 });
  for (const hash of ['#/sperren/IB-2027-01', DAY]) {
    await page.evaluate((h) => (window.location.hash = h), hash);
    await expect(link(page, 'Sperren')).toBeVisible();
    for (const p of platzhalter) await expect(p).toBeHidden();
    const buttons = await tops(page, 'header.topbar a.pill, header.topbar button.pill');
    expect(new Set(buttons).size, `Knöpfe in einer Zeile bei ${hash}`).toBe(1);
    expect((await page.locator('header.topbar').boundingBox())!.height).toBe(wide);
  }

  await page.evaluate(() => (window.location.hash = '#/sperren/IB-2027-01'));
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
    await openSeeded(page, '#/sperren/IB-2027-01');
    for (const hash of ['#/sperren/IB-2027-01', DAY]) {
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
  await page.evaluate(() => (window.location.hash = '#/sperren/IB-2027-01'));
  await expect(link(page, 'Sperren')).toHaveAttribute('aria-current', 'page');
  await expect(tabs).toHaveCount(0);
});

test('the Firmen-PC sees the page read-only', async ({ page }) => {
  await openSeeded(page, SEITE, { device: 'Firmen-PC' });
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
  await openSeeded(page, '#/sperren/IB-2027-01');
  await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: KEINE_LISTE })).toBeVisible();
});

test("download takes the list of the page's year", async ({ page }) => {
  await openSeeded(page, '#/sperren/IB-2027-01', {
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
  const repo = await openSeeded(page, '#/sperren/IB-2027-01');
  repo.offline = true;
  await page.getByRole('button', { name: DOWNLOAD, exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: NO_NETWORK })).toBeVisible();
});

// ---------- Excel-Stand ----------

test.describe('Excel-Stand', () => {
  const MAERZ = '#/sperren/IB-2027-03';
  const MAERZ_FILE = '07 Anhänge/Notizbuch/2027/2027-03 Sperren IB.svg';
  const EXCEL_2027 = '07 Anhänge/Notizbuch/2027/Sperren IB 2027 Excel.csv';
  const EXCEL_2028 = '07 Anhänge/Notizbuch/2028/Sperren IB 2028 Excel.csv';
  const LISTE_2027 = '07 Anhänge/Notizbuch/2027/Sperren IB 2027.csv';
  /** Ein Strich mitten in Platz 1 des 1. März: x 116 bis 272, y 184 bis 228. */
  const PLATZ_1_AM_1: [number, number][] = [
    [150, 206],
    [220, 210],
  ];
  /** Ein Strich mitten in Platz 2 des 3. März: x 272 bis 428, y 272 bis 316. */
  const PLATZ_2_AM_3: [number, number][] = [
    [310, 294],
    [380, 298],
  ];
  const ERSTE = 'Muster Abschnitt 1 / Gl. 2 08:00-14:00';

  type Feld = 'fachlinie' | 'datum' | 'abschnitt' | 'gleis' | 'von' | 'bis' | 'platz' | 'anzeigetext' | 'zeitraum' | 'hinweis' | 'stand';
  const SPALTE: Record<Feld, string> = {
    fachlinie: 'Fachlinie',
    datum: 'Datum',
    abschnitt: 'Abschnitt',
    gleis: 'Gleis',
    von: 'von',
    bis: 'bis',
    platz: 'Platz',
    anzeigetext: 'Anzeigetext',
    zeitraum: 'Zeitraum',
    hinweis: 'Hinweis Übernahme',
    stand: 'Stand',
  };

  /** Ein Excel-Stand wie vom Makro: BOM, Kopf, je Zeile 36 Werte, CRLF. Die Werte hier brauchen keine Anführungszeichen. */
  function excelCsv(zeilen: Partial<Record<Feld, string>>[]): string {
    const zeile = (z: Partial<Record<Feld, string>>) => {
      const werte = new Map(Object.entries({ fachlinie: 'IB', stand: '2026-11-26 09:40', ...z }).map(([f, v]) => [SPALTE[f as Feld], v]));
      return EXCEL_KOPF.split(';')
        .map((k) => werte.get(k) ?? '')
        .join(';');
    };
    return '\uFEFF' + [EXCEL_KOPF, ...zeilen.map(zeile)].join('\r\n') + '\r\n';
  }

  const ZEILEN_2027 = [
    // 1. März: Platz 1 steht grau da, die Zeile aus dem Notizbuch (Kennung im Hinweis) nicht.
    { datum: '2027-03-01', abschnitt: 'Muster Abschnitt 1', gleis: '2', von: '08:00', bis: '14:00', platz: '1', anzeigetext: 'Muster Abschnitt 1 / Gl. 2' },
    { datum: '2027-03-01', abschnitt: 'Muster Abschnitt 2', platz: '2', anzeigetext: 'Muster Abschnitt 2 / Gl. 1', hinweis: 'NB IB-2027-03-01-2 2026-11-25 19:05' },
    // 2. März: eine Zeile mit Zeitraum, die das Notizbuch an diesem Tag schon gültig hat (Liste der Abendroutine).
    { datum: '2027-03-02', abschnitt: 'Beispielstrecke Nord', von: '22:30', zeitraum: '02.03.2027 bis 04.03.2027' },
    // 3. März: drei Sperren für drei Plätze. Die Liste hat die erste nur als unsicher, das ändert nichts.
    { datum: '2027-03-03', abschnitt: 'Muster Abschnitt 3', platz: '1' },
    { datum: '2027-03-03', abschnitt: 'Muster Abschnitt 4', platz: '2' },
    { datum: '2027-03-03', abschnitt: 'Muster Abschnitt 5', platz: '3' },
    // Andere Seiten desselben Jahres.
    { datum: '2027-01-05', abschnitt: 'Muster Abschnitt 6', platz: '1' },
    { datum: '2027-11-02', abschnitt: 'Muster Abschnitt 7', platz: '1' },
  ];
  const LISTE = [
    'ID;Fachlinie;Datum;Abschnitt;Abschnitt gelesen;Gleis;von;bis;Betra-Nr.;Sperre;Status;Hinweis;Stand',
    'IB-2027-03-02-1;IB;2027-03-02;Beispielstrecke Nord;Beispielstrecke Nord;;22:30;;;;gültig;;2026-11-25 19:05',
    'IB-2027-03-03-1;IB;2027-03-03;Muster Abschnitt 3;Muster Abschnitt 3;;;;;;unsicher;;2026-11-25 19:05',
  ];
  const files = { [EXCEL_2027]: excelCsv(ZEILEN_2027), [LISTE_2027]: '\uFEFF' + LISTE.join('\r\n') + '\r\n' };

  const grau = (page: Page, feld: string) => page.locator(`.graue-sperren .grau[data-feld="${feld}"]`);
  const mehr = (page: Page, feld: string) => page.locator(`.graue-sperren .grau-mehr[data-feld="${feld}"]`);
  const stand = (page: Page) => page.locator('.kopf .excelstand');

  /** Wo ein Element liegt, in Seiteneinheiten: Die App rechnet Seite und Bildschirm, hier geht es zurück. */
  async function pageBox(page: Page, locator: Locator): Promise<[number, number, number, number]> {
    const box = (await locator.boundingBox())!;
    const view = await page.evaluate(() => ({ o: window.__notizbuch.toClient(0, 0), e: window.__notizbuch.toClient(1000, 1000) }));
    const sx = (view.e.x - view.o.x) / 1000;
    const sy = (view.e.y - view.o.y) / 1000;
    return [(box.x - view.o.x) / sx, (box.y - view.o.y) / sy, box.width / sx, box.height / sy].map((n) => Math.round(n)) as [number, number, number, number];
  }

  /** Die Seite mit einem Strich in Platz 1 des 1. März, wie ein anderes Gerät sie gespeichert hat. */
  function seiteMitStrich(): string {
    const layout = sperrenLayout('IB-2027-03');
    const strich: Stroke = {
      id: 'muster-strich',
      tool: 'kugel',
      color: 'blau',
      widthMm: 0.5,
      t: 1_795_000_000_000,
      w: 2,
      pts: PLATZ_1_AM_1.map(([x, y]) => ({ x, y, w: 2 })),
    };
    return serializePage({ kind: 'sperren', key: 'IB-2027-03', meta: {}, strokes: [strich] }, layout.fields, layout.background());
  }

  test('the agreed closures stand grey in their places, without those from the notebook or valid in it', async ({ page }) => {
    await openSeeded(page, MAERZ, { files });
    await expect(grau(page, 'sperre-2027-03-01-1')).toHaveText(ERSTE);
    await expect(stand(page)).toHaveText('Excel-Stand vom 26.11.2026, 09:40');
    // Die Zeile aus dem Notizbuch steht dort schon als Schrift, sie kommt nicht noch einmal grau.
    await expect(page.locator('.graue-sperren .grau', { hasText: 'Muster Abschnitt 2' })).toHaveCount(0);
    // Was die Liste der Abendroutine am 2. März gültig hat, auch nicht. Bis die Liste gelesen ist, stünde es grau da.
    await expect(page.locator('.graue-sperren [data-feld^="sperre-2027-03-02-"]')).toHaveCount(0);
    await expect(grau(page, 'sperre-2027-03-03-1')).toHaveText('Muster Abschnitt 3');
    // Das Grau liegt genau im Platz und nimmt keine Berührung an: Wer dort tippt oder schreibt, trifft die Schreibfläche.
    expect(await pageBox(page, grau(page, 'sperre-2027-03-01-1'))).toEqual([116, 184, 156, 44]);
    const box = (await grau(page, 'sperre-2027-03-01-1').boundingBox())!;
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-testid="surface"]') != null, [box.x + box.width / 2, box.y + box.height / 2]);
    expect(hit).toBe(true);
  });

  test('a pen stroke in place 1 lands on the page, and the grey moves on to place 2', async ({ page }) => {
    await openSeeded(page, MAERZ, { files });
    await expect(grau(page, 'sperre-2027-03-01-1')).toHaveText(ERSTE);
    await pen(page).stroke(PLATZ_1_AM_1);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await expect.poll(async () => (await queued(page))[MAERZ_FILE] ?? '').toMatch(/data-feld="sperre-2027-03-01-1"[^]*<path/);
    await expect(grau(page, 'sperre-2027-03-01-2')).toHaveText(ERSTE);
    await expect(grau(page, 'sperre-2027-03-01-1')).toHaveCount(0);
    // Die Datei der Seite bekommt nichts vom Grau.
    const saved = (await queued(page))[MAERZ_FILE];
    for (const text of ['Muster Abschnitt', 'Beispielstrecke', 'Gl. 2', '08:00', 'graue-sperren']) expect(saved).not.toContain(text);
  });

  test('a stroke read from the file pushes the grey on as well', async ({ page }) => {
    await openSeeded(page, MAERZ, { files: { ...files, [MAERZ_FILE]: seiteMitStrich() } });
    await expect.poll(() => strokeCount(page)).toBe(1);
    await expect(grau(page, 'sperre-2027-03-01-2')).toHaveText(ERSTE);
    await expect(grau(page, 'sperre-2027-03-01-1')).toHaveCount(0);
  });

  test('three closures with ink in place 2: grey in places 1 and 3 and +1 at place 3', async ({ page }) => {
    await openSeeded(page, MAERZ, { files });
    await expect(grau(page, 'sperre-2027-03-03-3')).toHaveText('Muster Abschnitt 5');
    await pen(page).stroke(PLATZ_2_AM_3);
    await expect(grau(page, 'sperre-2027-03-03-3')).toHaveText('Muster Abschnitt 4');
    await expect(grau(page, 'sperre-2027-03-03-1')).toHaveText('Muster Abschnitt 3');
    await expect(grau(page, 'sperre-2027-03-03-2')).toHaveCount(0);
    await expect(mehr(page, 'sperre-2027-03-03-3')).toHaveText('+1');
    // Oben rechts im Platz 3 (x 428 bis 584), weit weg von der Schrift in Platz 2.
    expect(await pageBox(page, mehr(page, 'sperre-2027-03-03-3'))).toEqual([554, 274, 26, 14]);
  });

  test('without a file the head says so and nothing is grey', async ({ page }) => {
    await openSeeded(page, MAERZ);
    await expect(stand(page)).toHaveText('Noch kein Excel-Stand für IB 2027');
    await expect(page.locator('.graue-sperren')).toHaveCount(0);
  });

  test('a broken file says so, nothing is grey, and a stroke is still saved', async ({ page }) => {
    const kaputt = excelCsv(ZEILEN_2027).replace('Fachlinie;Datum;', 'Fachlinie;Tag;');
    await openSeeded(page, MAERZ, { files: { ...files, [EXCEL_2027]: kaputt } });
    await expect(stand(page)).toHaveText('Der Excel-Stand für IB 2027 lässt sich nicht lesen.');
    await expect(page.locator('.graue-sperren')).toHaveCount(0);
    await pen(page).stroke(PLATZ_1_AM_1);
    await expect.poll(async () => (await queued(page))[MAERZ_FILE] ?? '').toMatch(/data-feld="sperre-2027-03-01-1"[^]*<path/);
  });

  test('a file that is not UTF-8 cannot be read either: the head says so and nothing is grey', async ({ page }) => {
    await openSeeded(page, MAERZ, { files, invalidUtf8: [EXCEL_2027] });
    await expect(stand(page)).toHaveText('Der Excel-Stand für IB 2027 lässt sich nicht lesen.');
    await expect(page.locator('.graue-sperren')).toHaveCount(0);
  });

  test('Lehne, May and the next year show only their own closures', async ({ page }) => {
    const datei2028 = excelCsv([{ datum: '2028-01-05', abschnitt: 'Beispielstrecke Süd', platz: '1', stand: '2026-11-27 07:15' }]);
    await openSeeded(page, '#/sperren/Lehne-2027-03', { files: { ...files, [EXCEL_2028]: datei2028 } });
    await expect(stand(page)).toHaveText('Noch kein Excel-Stand für Lehne 2027');
    await expect(page.locator('.graue-sperren')).toHaveCount(0);

    await page.evaluate(() => (window.location.hash = '#/sperren/IB-2027-05'));
    await expect(stand(page)).toHaveText('Excel-Stand vom 26.11.2026, 09:40');
    await expect(page.locator('.graue-sperren')).toHaveCount(0);

    await page.evaluate(() => (window.location.hash = '#/sperren/IB-2027-11'));
    await expect(grau(page, 'sperre-2027-11-02-1')).toHaveText('Muster Abschnitt 7');
    await page.getByRole('link', { name: 'Nächste zwei Monate' }).click();
    await expect.poll(() => hash(page)).toBe('#/sperren/IB-2028-01');
    await expect(stand(page)).toHaveText('Excel-Stand vom 27.11.2026, 07:15');
    await expect(page.locator('.graue-sperren .grau')).toHaveText(['Beispielstrecke Süd']);
    await expect(grau(page, 'sperre-2028-01-05-1')).toHaveText('Beispielstrecke Süd');
  });

  test('the Firmen-PC shows the grey the same way', async ({ page }) => {
    await openSeeded(page, MAERZ, { device: 'Firmen-PC', files });
    await expect(grau(page, 'sperre-2027-03-01-1')).toHaveText(ERSTE);
    await expect(grau(page, 'sperre-2027-03-03-2')).toHaveText('Muster Abschnitt 4');
    await expect(stand(page)).toHaveText('Excel-Stand vom 26.11.2026, 09:40');
  });
});
