import { expect, test as base, type Page } from '@playwright/test';
import { weekDays } from '../../src/lib/dates';
import { dailyNotePath } from '../../src/lib/filenames';
import { monatLayout, tapTargets, todayMarks, wocheLayout, type Layout } from '../../src/pages/layouts';
import { bringToForeground, lastHead, openSeeded, sendToBackground, type RepoMock } from './helpers/app';
import { pen } from './helpers/pointer';

/**
 * Termine und Prioritäten in Woche und Monat. Sie stehen nur auf dem Bildschirm: Die Tests lesen sie aus dem Hintergrund, den
 * die Fläche zeigt (`screenBackground`), und aus der Liste „Tage dieser Seite“, und sie prüfen, dass die hochgeladene Seite
 * nichts davon enthält. Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und hält die Uhr an: Heute ist in
 * allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit). Alle Termine und Prioritäten sind erfunden.
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
const WEEK = '#/woche/2026-W44';
const MONTH = '#/monat/2026-10';
const WEEK_FILE = '07 Anhänge/Notizbuch/2026/2026 KW44 Woche.svg';
const TERMINE = '04 Ressourcen/Kalender/Termine.md';
const NOTE = dailyNotePath(TODAY);
const WOCHE = wocheLayout('2026-W44');
const MONAT = monatLayout('2026-10');

/** Zwei Termine am Donnerstag, 29.10., und einer am Dienstag, 27.10. (ganztägig). */
const TERMINE_TEXT = [
  '# Termine',
  '- 2026-10-27 ganztägig | Schulung Beispiel |  | Outlook',
  '- 2026-10-29 14:00 bis 15:00 | Runde Werkstatt | Raum 2 | Outlook',
  '- 2026-10-29 09:30 bis 10:00 | Zahnarzt | Beispielhausen | Google',
  '',
].join('\n');

/** Eine Tagesnotiz, wie sie die Abendroutine schreibt: unter `## Handschrift` der Block `### Prioritäten` mit diesen Zeilen. */
const note = (day: string, ...lines: string[]): string =>
  ['---', `date: ${day}`, '---', `# ${day}`, '', '## Handschrift', '', '### Prioritäten', `Quelle: [[${day} Tag.svg]]`, ...lines, ''].join('\n');

const FILES = { [TERMINE]: TERMINE_TEXT, [NOTE]: note(TODAY, 'Sperren 2027 abstimmen') };

/** Leer, solange keine Seite gelesen ist (der Testzugang fehlt dann). */
const screenBackground = (page: Page) => page.evaluate(() => window.__notizbuch?.screenBackground() ?? '');
const strokes = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes);
const dayList = (page: Page) => page.getByRole('navigation', { name: 'Tage dieser Seite' });
const dayLink = (page: Page, name: RegExp) => dayList(page).getByRole('link', { name });
const undo = (page: Page) => page.getByRole('button', { name: 'Rückgängig', exact: true });
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

/** Das Feld eines Tages (Seiteneinheiten). */
function fieldOf(layout: Layout, id: string): [number, number, number, number] {
  const field = layout.fields.find((f) => f.id === id);
  if (!field) throw new Error(`Kein Feld ${id}.`);
  return field.rect;
}

/** Ein Strich quer durch die Mitte eines Feldes, unter der Kopfzeile. */
function strokeAcross(layout: Layout, id: string): [number, number][] {
  const [x, y, w, h] = fieldOf(layout, id);
  return [
    [x + w / 4, y + h / 2],
    [x + w / 2, y + h / 2 + 10],
    [x + (3 * w) / 4, y + h / 2],
  ];
}

test('the week shows the appointments and priorities of each day, only on the screen', async ({ page }) => {
  const repo = await openSeeded(page, WEEK, { files: FILES });
  await expect(dayLink(page, /29\.10\.2026, 2 Termine, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  await expect(dayLink(page, /27\.10\.2026, 1 Termin$/)).toHaveAttribute('href', '#/tag/2026-10-27');
  await expect.poll(() => screenBackground(page)).toContain('09:30 Zahnarzt');
  expect(await screenBackground(page)).toContain('▸ Sperren 2027 abstimmen');

  // Über die Zeilen schreibt der Stift wie sonst. In die Datei kommt nur, was zur Seite gehört.
  await pen(page).stroke(strokeAcross(WOCHE, 'tag-2026-10-28'));
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const [put] = repo.puts;
  expect(put.path).toBe(WEEK_FILE);
  expect(put.text).toContain(WOCHE.background());
  expect(put.text).not.toContain('Zahnarzt');
  expect(put.text).not.toContain('Sperren 2027');
});

test('the month shows the appointments, not the priorities', async ({ page }) => {
  const repo = await openSeeded(page, MONTH, { files: FILES });
  await expect(dayLink(page, /29\.10\.2026, 2 Termine$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  await expect(dayLink(page, /27\.10\.2026, 1 Termin$/)).toHaveAttribute('href', '#/tag/2026-10-27');
  await expect.poll(() => screenBackground(page)).toContain('09:30 Zahnarzt');
  expect(await screenBackground(page)).not.toContain('▸');
  // Der Monat liest keine Tagesnotizen: Das wären bis zu 31 Anfragen für jede Monatsseite.
  expect(repo.requests.filter((request) => decodeURIComponent(request).includes('/05 Daily Notes/'))).toEqual([]);
});

test('a change from another device shows up without rebuilding the page', async ({ page }) => {
  const repo = await openSeeded(page, WEEK, { files: FILES });
  await expect.poll(() => screenBackground(page)).toContain('09:30 Zahnarzt');
  await expect.poll(() => lastHead(page)).not.toBeNull();
  await pen(page).stroke(strokeAcross(WOCHE, 'tag-2026-10-28'));
  await expect.poll(async () => (await strokes(page)).length).toBe(1);
  await expect(undo(page)).toBeEnabled();
  // Ein Merkzeichen an der Ebene, die den Stift annimmt: Eine neu gebaute Fläche hätte neue Ebenen ohne das Zeichen.
  const layer = page.locator('canvas[data-layer="live"]');
  await layer.evaluate((el) => (el.dataset.probe = 'vorher'));

  repo.commit(TERMINE, `${TERMINE_TEXT}- 2026-10-29 11:00 bis 12:00 | Neu am Donnerstag | Raum 3 | Outlook\n`);
  await sendToBackground(page);
  await bringToForeground(page); // zurück in der App: Sie fragt GitHub nach fremden Änderungen
  await expect.poll(() => screenBackground(page)).toContain('11:00 Neu am Donnerstag');
  await expect(dayLink(page, /29\.10\.2026, 3 Termine, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  expect(await strokes(page)).toHaveLength(1);
  await expect(undo(page)).toBeEnabled();
  await expect(layer).toHaveAttribute('data-probe', 'vorher');
});

test('a stroke in progress goes on when new priorities come in', async ({ page }) => {
  const repo = await openSeeded(page, WEEK, { files: FILES });
  await expect.poll(() => screenBackground(page)).toContain('▸ Sperren 2027 abstimmen');
  await expect.poll(() => lastHead(page)).not.toBeNull();
  const [x, y, , h] = fieldOf(WOCHE, 'tag-2026-10-30');
  const row = y + h / 2;
  // Der Stift setzt auf und schreibt, ohne abzuheben.
  await pen(page).stroke(
    [
      [x + 100, row],
      [x + 150, row + 5],
      [x + 200, row],
    ],
    { lift: false },
  );

  // Die Abendroutine hat am Donnerstag eine zweite Priorität abgetippt, schon erledigt.
  repo.commit(NOTE, note(TODAY, 'Sperren 2027 abstimmen', '- [x] Plan schicken'));
  await bringToForeground(page); // die App fragt GitHub nach fremden Änderungen
  await expect.poll(() => screenBackground(page)).toContain('✓ Plan schicken');
  await expect(dayLink(page, /29\.10\.2026, 2 Termine, 2 Prioritäten$/)).toHaveAttribute('href', '#/tag/2026-10-29');

  // Der Strich geht weiter und endet dort, wo der Stift abhebt.
  await pen(page).move(x + 300, row + 5);
  await pen(page).move(x + 400, row);
  await pen(page).up(x + 400, row);
  const done = await strokes(page);
  expect(done).toHaveLength(1);
  expect(Math.min(...done[0].pts.map((p) => p.x))).toBeLessThan(x + 120);
  expect(Math.max(...done[0].pts.map((p) => p.x))).toBeGreaterThan(x + 380);
  await expect(undo(page)).toBeEnabled();
});

test('without Termine.md and without notes week and month still load', async ({ page }) => {
  const repo = await openSeeded(page, WEEK, { omit: [TERMINE, NOTE] });
  // Gefragt ist nach Termine.md und allen sieben Tagesnotizen. Dann bekommt die App einen Augenblick für die Antworten.
  const wanted = [TERMINE, ...weekDays('2026-W44').map(dailyNotePath)];
  await expect.poll(() => wanted.filter((path) => asked(repo, path) === 0)).toEqual([]);
  await page.waitForTimeout(300);
  await expect(dayList(page).getByRole('link')).toHaveText(tapTargets(WOCHE).map((t) => t.label));
  expect(await screenBackground(page)).toBe(WOCHE.background() + todayMarks(WOCHE, TODAY));

  await page.evaluate((h) => void (window.location.hash = h), MONTH);
  await waitForPageOf(page, 'monat', '2026-10');
  await expect.poll(() => asked(repo, TERMINE)).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(300);
  await expect(dayList(page).getByRole('link')).toHaveText(tapTargets(MONAT).map((t) => t.label));
  expect(await screenBackground(page)).toBe(MONAT.background() + todayMarks(MONAT, TODAY));
});

test('without network the week shows what this device already has', async ({ page }) => {
  const repo = await openSeeded(page, WEEK, { files: FILES });
  await expect(dayLink(page, /29\.10\.2026, 2 Termine, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  // Kein Netz mehr. Zum Monat und zurück: Die Woche liest alles neu, jetzt aus den Kopien auf dem Gerät.
  repo.offline = true;
  await page.evaluate((h) => void (window.location.hash = h), MONTH);
  await waitForPageOf(page, 'monat', '2026-10');
  await page.evaluate((h) => void (window.location.hash = h), WEEK);
  await waitForPageOf(page, 'woche', '2026-W44');
  await expect(dayLink(page, /29\.10\.2026, 2 Termine, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  await expect.poll(() => screenBackground(page)).toContain('▸ Sperren 2027 abstimmen');
  expect(await screenBackground(page)).toContain('09:30 Zahnarzt');
});

test('a note that cannot be read leaves only that day empty', async ({ page }) => {
  const tuesday = dailyNotePath('2026-10-27');
  const repo = await openSeeded(page, WEEK, { files: { ...FILES, [tuesday]: note('2026-10-27', '- [x] Plan schicken') }, invalidUtf8: [NOTE] });
  // Die lesbare Notiz vom Dienstag zählt. Die vom Donnerstag lässt sich nicht lesen: Dort stehen nur die Termine.
  await expect(dayLink(page, /27\.10\.2026, 1 Termin, 1 Priorität$/)).toHaveAttribute('href', '#/tag/2026-10-27');
  await expect.poll(() => asked(repo, NOTE)).toBeGreaterThan(0);
  await page.waitForTimeout(300);
  await expect(dayLink(page, /29\.10\.2026, 2 Termine$/)).toHaveAttribute('href', '#/tag/2026-10-29');
  const shown = await screenBackground(page);
  expect(shown).toContain('Schulung Beispiel');
  expect(shown).toContain('✓ Plan schicken');
  expect(shown).toContain('09:30 Zahnarzt');
  expect(shown).not.toContain('▸');
});
