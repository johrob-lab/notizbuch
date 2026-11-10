import { expect, test as base, type Page } from '@playwright/test';
import { dailyNotePath } from '../../src/lib/filenames';
import { tagLayout, wocheLayout, type Layout } from '../../src/pages/layouts';
import { bringToForeground, lastHead, openSeeded, sendToBackground, type OpenOptions, type RepoMock } from './helpers/app';
import { pen } from './helpers/pointer';

/**
 * Geburtstage und Jahrestage in Woche, Monat und auf der Tagesseite. Sie stehen nur auf dem Bildschirm: Die Tests lesen sie aus
 * dem Hintergrund, den die Fläche zeigt (`screenBackground`), aus der Liste „Tage dieser Seite“ und aus der Karte „Kalender“, und
 * sie prüfen, dass die hochgeladene Seite nichts davon enthält. Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben,
 * und hält die Uhr an: Heute ist in allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit). Alle Namen, Termine und Prioritäten sind
 * erfunden.
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

const TODAY = '2026-10-29';
const DAY = `#/tag/${TODAY}`;
const WEEK = '#/woche/2026-W44';
const MONTH = '#/monat/2026-10';
const DAY_FILE = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const WEEK_FILE = '07 Anhänge/Notizbuch/2026/2026 KW44 Woche.svg';
const TERMINE = '04 Ressourcen/Kalender/Termine.md';
const GEBURTSTAGE = '04 Ressourcen/Kalender/Geburtstage.md';
const NOTE = dailyNotePath(TODAY);
const TAG = tagLayout('2026-10-29');
const WOCHE = wocheLayout('2026-W44');

/** Zwei Termine am Donnerstag, 29.10., und einer am Dienstag, 27.10. (ganztägig). */
const TERMINE_TEXT = [
  '# Termine',
  '- 2026-10-27 ganztägig | Schulung Beispiel |  | Outlook',
  '- 2026-10-29 14:00 bis 15:00 | Runde Werkstatt | Raum 2 | Outlook',
  '- 2026-10-29 09:30 bis 10:00 | Zahnarzt | Beispielhausen | Google',
  '',
].join('\n');

/** Ein Geburtstag am Dienstag, 27.10., ein Geburtstag und ein Jahrestag heute und ein Geburtstag an Allerheiligen, 01.11. */
const GEBURTSTAGE_TEXT = [
  '# Geburtstage',
  '- 2026-10-27 | Erika Muster | Geburtstag | Google',
  '- 2026-10-29 | Max Beispiel | Geburtstag | Google',
  '- 2026-10-29 | Anna und Ben Beispiel | Jahrestag | Outlook',
  '- 2026-11-01 | Paul Beispiel | Geburtstag | Google',
  '',
].join('\n');

/** Die Datei, bevor ein anderes Gerät die übrigen Einträge dazuschreibt: heute steht noch nichts darin. */
const GEBURTSTAGE_VORHER = ['# Geburtstage', '- 2026-10-27 | Erika Muster | Geburtstag | Google', ''].join('\n');

/** Eine Tagesnotiz, wie sie die Abendroutine schreibt: unter `## Handschrift` der Block `### Prioritäten` mit diesen Zeilen. */
const note = (day: string, ...lines: string[]): string =>
  ['---', `date: ${day}`, '---', `# ${day}`, '', '## Handschrift', '', '### Prioritäten', `Quelle: [[${day} Tag.svg]]`, ...lines, ''].join('\n');

/** Termine und Tagesnotiz wie in agenda.spec.ts, ohne Geburtstage. `Geburtstage.md` liegt nicht im Mini-Vault. */
const AGENDA = { [TERMINE]: TERMINE_TEXT, [NOTE]: note(TODAY, 'Sperren 2027 abstimmen') };
const FILES = { ...AGENDA, [GEBURTSTAGE]: GEBURTSTAGE_TEXT };

/** Der heutige Tag in der Karte „Kalender“, mit allem aus `FILES`. */
const TODAY_IN_CALENDAR = 'Do 29.10.2026, heute, Geburtstag von Max Beispiel, Jahrestag von Anna und Ben Beispiel, 2 Termine';

/** Leer, solange keine Seite gelesen ist (der Testzugang fehlt dann). */
const screenBackground = (page: Page) => page.evaluate(() => window.__notizbuch?.screenBackground() ?? '');
const strokes = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes);
const dayList = (page: Page) => page.getByRole('navigation', { name: 'Tage dieser Seite' });
const dayLink = (page: Page, name: RegExp) => dayList(page).getByRole('link', { name });
const undo = (page: Page) => page.getByRole('button', { name: 'Rückgängig', exact: true });
const calendar = (page: Page) => page.getByRole('region', { name: 'Kalender' });
const waitForPageOf = (page: Page, kind: string, key: string) =>
  page.waitForFunction(
    ([k, id]) => {
      const current = window.__notizbuch?.currentPage?.();
      return current?.kind === k && current.key === id;
    },
    [kind, key],
  );

/** Wie oft die App diese Datei bei GitHub angefragt hat. */
const asked = (repo: RepoMock, path: string): number =>
  repo.requests.filter((request) => decodeURIComponent(request) === `GET /repos/${repo.name}/contents/${path}`).length;

/** Ein Feld der Seite (Seiteneinheiten). */
function fieldOf(layout: Layout, id: string): [number, number, number, number] {
  const field = layout.fields.find((f) => f.id === id);
  if (!field) throw new Error(`Kein Feld ${id}.`);
  return field.rect;
}

/** Ein Strich quer durch die Mitte eines Feldes. */
function strokeAcross(layout: Layout, id: string): [number, number][] {
  const [x, y, w, h] = fieldOf(layout, id);
  return [
    [x + w / 4, y + h / 2],
    [x + w / 2, y + h / 2 + 10],
    [x + (3 * w) / 4, y + h / 2],
  ];
}

test('the week shows birthdays first and counts them in the day list, only on the screen', async ({ page }) => {
  const repo = await openSeeded(page, WEEK, { files: FILES });
  await expect(dayLink(page, /29\.10\.2026, 1 Geburtstag, 1 Jahrestag, 2 Termine, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  await expect(dayLink(page, /27\.10\.2026, 1 Geburtstag, 1 Termin$/)).toHaveAttribute('href', '#/tag/2026-10-27');
  await expect(dayLink(page, /01\.11\.2026, Allerheiligen, 1 Geburtstag$/)).toHaveAttribute('href', '#/tag/2026-11-01');
  // Termine und Geburtstage kommen aus zwei Dateien: Erst wenn beide gelesen sind, steht beides auf dem Bildschirm.
  await expect.poll(() => screenBackground(page)).toContain('Schulung Beispiel');
  await expect.poll(() => screenBackground(page)).toContain('🎂 Max Beispiel');
  const shown = await screenBackground(page);
  expect(shown).toContain('♥ Anna und Ben Beispiel');
  expect(shown).toContain('🎂 Paul Beispiel');
  // Am 27.10. passen Geburtstag und Termin in die erste Zeile, der Geburtstag zuerst. Am 29.10. schiebt der Platz die Termine
  // in „ +N“, dort lässt sich die Reihenfolge nicht sehen.
  expect(shown).toContain('🎂 Erika Muster');
  expect(shown.indexOf('🎂 Erika Muster')).toBeLessThan(shown.indexOf('Schulung Beispiel'));

  // In die Datei kommt nur, was zur Seite gehört.
  await pen(page).stroke(strokeAcross(WOCHE, 'tag-2026-10-28'));
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const [put] = repo.puts;
  expect(put.path).toBe(WEEK_FILE);
  expect(put.text).toContain(WOCHE.background());
  expect(put.text).not.toContain('Max Beispiel');
  expect(put.text).not.toContain('🎂');
});

test('the month shows birthdays first', async ({ page }) => {
  const repo = await openSeeded(page, MONTH, { files: FILES });
  await expect(dayLink(page, /29\.10\.2026, 1 Geburtstag, 1 Jahrestag, 2 Termine$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  await expect.poll(() => screenBackground(page)).toContain('🎂 Max Beispiel');
  // Am 27.10. steht der Geburtstag in der ersten Zeile des Kästchens, der Termin (gekürzt) in der zweiten.
  await expect.poll(() => screenBackground(page)).toContain('Schulung');
  const shown = await screenBackground(page);
  expect(shown).toContain('🎂 Erika Muster');
  expect(shown.indexOf('🎂 Erika Muster')).toBeLessThan(shown.indexOf('Schulung'));
  // Der Monat liest keine Tagesnotizen, auch nicht wegen der Geburtstage.
  expect(repo.requests.filter((request) => decodeURIComponent(request).includes('/05 Daily Notes/'))).toEqual([]);
});

test('the day page shows the birthdays in its head and in the calendar card, only on the screen', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { files: FILES });
  // Im Kopf rechtsbündig, in der Zeile unter dem Datum.
  await expect.poll(() => screenBackground(page)).toContain('🎂 Max Beispiel');
  expect(await screenBackground(page)).toContain('text-anchor="end"');
  // In der Karte „Kalender“ haben Tage mit Geburtstag einen Punkt (Klasse `geburtstag`), auch der Nachbartag 01.11. im Raster.
  const card = calendar(page);
  await expect(card.getByRole('link', { name: TODAY_IN_CALENDAR, exact: true })).toHaveClass(/geburtstag/);
  await expect(card.getByRole('link', { name: 'So 01.11.2026, Geburtstag von Paul Beispiel', exact: true })).toHaveClass(/geburtstag/);
  const plain = card.getByRole('link', { name: 'Mi 28.10.2026', exact: true });
  await expect(plain).toBeVisible();
  await expect(plain).not.toHaveClass(/geburtstag/);

  // In die Datei kommt nur, was zur Seite gehört.
  await pen(page).stroke(strokeAcross(TAG, 'notizen'));
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const [put] = repo.puts;
  expect(put.path).toBe(DAY_FILE);
  expect(put.text).toContain(TAG.background());
  expect(put.text).not.toContain('Max Beispiel');
});

test.describe('without Geburtstage.md or with a broken one the pages load as before', () => {
  const cases: { name: string; options: OpenOptions }[] = [
    { name: 'without the file', options: { files: AGENDA } },
    // Die Datei liegt im Repo, aber ihre Bytes sind kein UTF-8: Die App kann sie nicht lesen.
    { name: 'with a file that is not UTF-8', options: { files: FILES, invalidUtf8: [GEBURTSTAGE] } },
  ];
  for (const c of cases) {
    test(c.name, async ({ page }) => {
      const repo = await openSeeded(page, DAY, c.options);
      // Gefragt ist nach der Datei. Dann bekommt die App einen Augenblick für die Antwort.
      await expect.poll(() => asked(repo, GEBURTSTAGE)).toBeGreaterThan(0);
      await page.waitForTimeout(300);
      expect(await screenBackground(page)).toBe(TAG.background());
      const today = calendar(page).getByRole('link', { name: 'Do 29.10.2026, heute, 2 Termine', exact: true });
      await expect(today).toBeVisible();
      await expect(today).not.toHaveClass(/geburtstag/);

      await page.evaluate((h) => void (window.location.hash = h), WEEK);
      await waitForPageOf(page, 'woche', '2026-W44');
      await expect(dayLink(page, /29\.10\.2026, 2 Termine, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-29');
    });
  }
});

test('a new birthday from another device shows up on the open day page without rebuilding it', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { files: { ...AGENDA, [GEBURTSTAGE]: GEBURTSTAGE_VORHER } });
  // Die Datei ist gelesen: Der 27.10. hat im Kalender seinen Geburtstag, heute steht keiner im Kopf.
  await expect(calendar(page).getByRole('link', { name: 'Di 27.10.2026, Geburtstag von Erika Muster, 1 Termin', exact: true })).toBeVisible();
  expect(await screenBackground(page)).toBe(TAG.background());
  await expect.poll(() => lastHead(page)).not.toBeNull();
  await pen(page).stroke(strokeAcross(TAG, 'notizen'));
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  await expect(undo(page)).toBeEnabled();
  // Ein Merkzeichen an der Ebene, die den Stift annimmt: Eine neu gebaute Fläche hätte neue Ebenen ohne das Zeichen.
  const layer = page.locator('canvas[data-layer="live"]');
  await layer.evaluate((el) => (el.dataset.probe = 'vorher'));

  repo.commit(GEBURTSTAGE, GEBURTSTAGE_TEXT);
  await sendToBackground(page);
  await bringToForeground(page); // zurück in der App: Sie fragt GitHub nach fremden Änderungen
  await expect.poll(() => screenBackground(page)).toContain('🎂 Max Beispiel');
  await expect(calendar(page).getByRole('link', { name: TODAY_IN_CALENDAR, exact: true })).toBeVisible();
  expect(await strokes(page)).toHaveLength(1);
  await expect(undo(page)).toBeEnabled();
  await expect(layer).toHaveAttribute('data-probe', 'vorher');
});
