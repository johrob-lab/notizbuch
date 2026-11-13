import { expect, test as base, type Page, type Route } from '@playwright/test';
import { calendarTargets, monatLayout, tagLayout, tapTargets, todayMarks, wocheLayout, type Layout } from '../../src/pages/layouts';
import { networkBack, openSeeded, queued, sendToBackground } from './helpers/app';
import { colorAt, inkNear, mouse, palm, pen, touch, viewOf } from './helpers/pointer';

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und hält die Uhr an: Heute ist in allen Tests
 * der 29.10.2026 (Wiener Zeit), damit nichts davon abhängt, an welchem Tag die Tests laufen.
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
const FILES = '07 Anhänge/Notizbuch/2026';
const TAG = `${FILES}/${TODAY} Tag.svg`;
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';
const SOON = 'kommt mit Stufe C';
/** Ein Strich im unteren Teil der Tagesseite (Feld „Notizen“). */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const go = (page: Page, next: string) => page.evaluate((h) => void (window.location.hash = h), next);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const strokeIds = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.map((s) => s.id));
const waitForPageOf = (page: Page, kind: string, key: string) =>
  page.waitForFunction(
    ([k, id]) => {
      const current = window.__notizbuch?.currentPage?.();
      return current?.kind === k && current.key === id;
    },
    [kind, key],
  );
const link = (page: Page, name: string | RegExp) => page.getByRole('link', { name, exact: typeof name === 'string' });
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
/** Stift und Handballen: Finger gelten erst 250 ms nach dem Abheben des Stifts wieder. */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);

/** Das Feld einer Seite (Seiteneinheiten). */
function fieldOf(layout: Layout, id: string): [number, number, number, number] {
  const field = layout.fields.find((f) => f.id === id);
  if (!field) throw new Error(`Kein Feld ${id}.`);
  return field.rect;
}

/** Die Mitte der Tippfläche eines Tages (Seiteneinheiten). */
function dayPoint(layout: Layout, day: string): [number, number] {
  const target = tapTargets(layout).find((t) => t.day === day);
  if (!target) throw new Error(`Kein Tag ${day} auf dieser Seite.`);
  const [x, y, w, h] = target.rect;
  return [x + w / 2, y + h / 2];
}

/** Die Mitte eines Tages im Monatskalender der Woche (Seiteneinheiten). */
function calendarPoint(layout: Layout, day: string): [number, number] {
  const target = calendarTargets(layout).find((t) => t.day === day);
  if (!target) throw new Error(`Kein Tag ${day} im Kalender dieser Seite.`);
  const [x, y, w, h] = target.rect;
  return [x + w / 2, y + h / 2];
}

/** Die Farbe der Grundebene an einem Ort der Seite stimmt (bis auf Rundung), sobald der Hintergrund gezeichnet ist. */
async function expectColor(page: Page, at: [number, number], want: [number, number, number]) {
  await expect
    .poll(async () => (await colorAt(page, at)).every((v, i) => Math.abs(v - want[i]) <= 2), { message: `Farbe bei ${at.join(', ')}` })
    .toBe(true);
}

/** Wie viele Striche in jedem Feld einer geschriebenen Datei stehen: `{ 'tag-2026-10-29': 1 }`. */
function strokesPerField(text: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of text.matchAll(/<g data-feld="([^"]+)"[^>]*>([\s\S]*?)<\/g>/g)) out[m[1]] = (m[2].match(/<path /g) ?? []).length;
  return out;
}

const PAPER: [number, number, number] = [255, 254, 250];
const HOLIDAY: [number, number, number] = [248, 239, 234];

// ---------- Blättern und Ansichten ----------

test('arrows move one day', async ({ page }) => {
  await openSeeded(page, DAY);
  await link(page, 'Nächster Tag').click();
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await link(page, 'Voriger Tag').click();
  await link(page, 'Voriger Tag').click();
  await waitForPageOf(page, 'tag', '2026-10-28');
  expect(await hash(page)).toBe('#/tag/2026-10-28');
});

test('arrows step by week or month and cross the end of the year', async ({ page }) => {
  await openSeeded(page, '#/woche/2027-W01');
  await link(page, 'Vorige Woche').click();
  await waitForPageOf(page, 'woche', '2026-W53');
  await link(page, 'Nächste Woche').click();
  await waitForPageOf(page, 'woche', '2027-W01');

  await link(page, 'Dezember 2027').click(); // die Reiter gehören zum Jahr der Seite
  await waitForPageOf(page, 'monat', '2027-12');
  await link(page, 'Nächster Monat').click();
  await waitForPageOf(page, 'monat', '2028-01');
  expect(await hash(page)).toBe('#/monat/2028-01');
  await link(page, 'Voriger Monat').click();
  await waitForPageOf(page, 'monat', '2027-12');
});

test('Monat, Woche and Tag show the date that is open', async ({ page }) => {
  await openSeeded(page, '#/tag/2026-11-04');
  await link(page, 'Woche').click();
  await waitForPageOf(page, 'woche', '2026-W45');
  await expect(link(page, 'Woche')).toHaveAttribute('aria-current', 'page');
  await link(page, 'Monat').click();
  await waitForPageOf(page, 'monat', '2026-11');
  await expect(link(page, 'Monat')).toHaveAttribute('aria-current', 'page');
  await expect(link(page, 'Woche')).not.toHaveAttribute('aria-current', 'page');
  // Heute liegt nicht im November: Der Tag ist der Erste.
  await link(page, 'Tag').click();
  await waitForPageOf(page, 'tag', '2026-11-01');
});

test('Heute opens today', async ({ page }) => {
  await openSeeded(page, '#/monat/2027-03');
  await link(page, 'Heute').click();
  await waitForPageOf(page, 'tag', TODAY);
  expect(await hash(page)).toBe(DAY);
});

test('Index is disabled', async ({ page }) => {
  await openSeeded(page, DAY);
  // Index, Jahr und To-Dos kommen erst mit Stufe C: ausgegraut, ohne Ziel, und ein Tipp sagt, wann.
  for (const name of ['Index', 'Jahr', 'To-Dos']) {
    const pill = button(page, name);
    await expect(pill).toHaveAttribute('aria-disabled', 'true');
    await expect(pill).toHaveAttribute('title', SOON);
    await pill.click({ force: true }); // für Playwright ist aria-disabled nicht klickbar, ein Finger tippt trotzdem
    await expect(page.getByRole('status').filter({ hasText: `${name} ${SOON}` })).toBeVisible();
  }
  expect(await hash(page)).toBe(DAY);
  // Die Ansichten, die es gibt, sind Links.
  await expect(link(page, 'Monat')).toHaveAttribute('href', '#/monat/2026-10');
  await expect(link(page, 'Woche')).toHaveAttribute('href', '#/woche/2026-W44');
  await expect(link(page, 'Tag')).toHaveAttribute('aria-current', 'page');
});

test('an address that is not a page opens today', async ({ page }) => {
  await openSeeded(page, '#/tag/2026-10-30');
  for (const bad of ['#/tag/2026-02-30', '#/woche/2027-W53', '#/monat/2026-13', '#/besprechung/x/1', '#/unsinn', '#']) {
    await go(page, bad);
    await waitForPageOf(page, 'tag', TODAY);
    await go(page, '#/tag/2026-10-30');
    await waitForPageOf(page, 'tag', '2026-10-30');
  }
});

test('the settings address shows the settings and keeps the bars', async ({ page }) => {
  await openSeeded(page, DAY);
  await link(page, 'Einstellungen').click();
  expect(await hash(page)).toBe('#/einstellungen');
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(link(page, 'Einstellungen')).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Einstellungen folgen.')).toHaveCount(0);
  await expect(page.getByTestId('surface')).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Monate' })).toHaveCount(0);
  await expect(page.getByTestId('status')).toHaveText('Gesichert');
  // Es gibt nichts zum Blättern.
  await expect(button(page, 'Vorige Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');
  await link(page, 'Tag').click();
  await waitForPageOf(page, 'tag', TODAY);
});

test('a meeting address opens the meeting page, with the top bar and the month tabs of its day', async ({ page }) => {
  await openSeeded(page, DAY);
  await go(page, `#/besprechung/${encodeURIComponent('2026-11-04 0800 Muster')}/1`);
  await waitForPageOf(page, 'besprechung', '2026-11-04 0800 Muster');
  await expect(page.getByTestId('surface')).toHaveCount(1);
  await expect(page.getByTestId('status')).toHaveText('Gesichert');
  await expect(page.locator('.reiter[aria-current="true"]')).toHaveText('NOV');
  // Die Pfeile blättern die Seiten der Besprechung (siehe besprechung.spec.ts). Diese Besprechung hat nur eine Seite, also sind beide grau.
  await expect(button(page, 'Vorige Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');
});

// ---------- Monatsreiter ----------

test('month tabs open a month, mark the current one and take no room from the page', async ({ page }) => {
  await openSeeded(page, DAY);
  const tabs = page.getByRole('navigation', { name: 'Monate' }).getByRole('link');
  await expect(tabs).toHaveText(['JAN', 'FEB', 'MÄR', 'APR', 'MAI', 'JUN', 'JUL', 'AUG', 'SEP', 'OKT', 'NOV', 'DEZ']);
  await expect(page.locator('.reiter[aria-current="true"]')).toHaveText('OKT');
  // Die Reiter schweben über dem Rand der Seite: Die Seite behält ihre ganze Breite.
  expect((await viewOf(page)).scale).toBeCloseTo((1200 - 32) / 1192, 3);

  await link(page, 'Dezember 2026').click();
  await waitForPageOf(page, 'monat', '2026-12');
  expect(await hash(page)).toBe('#/monat/2026-12');
  await expect(page.locator('.reiter[aria-current="true"]')).toHaveText('DEZ');
});

test('month tabs show the year of the page', async ({ page }) => {
  await openSeeded(page, '#/tag/2027-01-05');
  await expect(link(page, 'Januar 2027')).toHaveAttribute('aria-current', 'true');
  await expect(link(page, 'Januar 2026')).toHaveCount(0);
  await link(page, 'Juni 2027').click();
  await waitForPageOf(page, 'monat', '2027-06');
});

test('the month tabs of a week follow its Thursday: KW 01 whose Monday is in the old year shows January of the new year', async ({ page }) => {
  await openSeeded(page, '#/woche/2026-W01'); // Montag, 29.12.2025, bis Sonntag, 4.1.2026
  await waitForPageOf(page, 'woche', '2026-W01');
  await expect(link(page, 'Januar 2026')).toHaveAttribute('aria-current', 'true');
  await expect(link(page, 'Dezember 2025')).toHaveCount(0);
});

test('every button of the top bar and every tab is at least 44 points', async ({ page }) => {
  await openSeeded(page, DAY);
  const sizes = await page.locator('.topbar .pill, .reiter').evaluateAll((els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect();
      return { name: el.getAttribute('aria-label') ?? el.textContent, width: r.width, height: r.height };
    }),
  );
  expect(sizes).toHaveLength(11 + 12); // oben 2 Pfeile, Heute, 6 Ansichten, Vollbild und das Zahnrad, dazu 12 Reiter
  for (const s of sizes) {
    expect(s.width, `${s.name} breit genug`).toBeGreaterThanOrEqual(44);
    expect(s.height, `${s.name} hoch genug`).toBeGreaterThanOrEqual(44);
  }
});

// ---------- Tippen auf die Tageszahl ----------

test('tap on day 29 in month opens the day', async ({ page }) => {
  await openSeeded(page, MONTH);
  const [x, y] = dayPoint(monatLayout('2026-10'), '2026-10-29');
  await touch(page).tap(x, y);
  await waitForPageOf(page, 'tag', '2026-10-29');
  expect(await hash(page)).toBe(DAY);
});

test('tap on a day in the week opens the day', async ({ page }) => {
  await openSeeded(page, WEEK);
  const [x, y] = dayPoint(wocheLayout('2026-W44'), '2026-10-27');
  await touch(page).tap(x, y);
  await waitForPageOf(page, 'tag', '2026-10-27');
});

test('a tap outside the day numbers does nothing', async ({ page }) => {
  await openSeeded(page, MONTH);
  const layout = monatLayout('2026-10');
  const [x, y, w, h] = fieldOf(layout, 'tag-2026-10-29');
  await touch(page).tap(x + w / 2, y + h - 10); // unten im Feld, unter der Tippfläche
  const [gx, gy] = fieldOf(layout, 'monat');
  await touch(page).tap(gx + 100, gy + 100); // im Feld der Monatsziele
  await touch(page).tap(10, 10); // neben der Seite
  expect(await hash(page)).toBe(MONTH);
  expect(await strokeCount(page)).toBe(0);
});

test('the pen writes on a day number and never opens the day', async ({ page }) => {
  const repo = await openSeeded(page, MONTH);
  const [x, y] = dayPoint(monatLayout('2026-10'), '2026-10-29');
  await pen(page).stroke([
    [x - 30, y],
    [x, y + 10],
    [x + 30, y],
  ]);
  // Gleich danach liegt die Hand noch auf dem Bildschirm: Ein Finger zählt dann nicht, sondern erst nach einer kurzen Pause.
  await touch(page).tap(x, y);
  expect(await hash(page)).toBe(MONTH);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(strokesPerField(repo.puts[0].text)).toEqual({ 'tag-2026-10-29': 1 });

  await afterPalmWindow(page);
  await touch(page).tap(x, y);
  await waitForPageOf(page, 'tag', '2026-10-29');
});

test('a palm does not open a day, a finger drag only moves the page', async ({ page }) => {
  await openSeeded(page, MONTH);
  const [x, y] = dayPoint(monatLayout('2026-10'), '2026-10-29');
  await palm(page).tap(x, y);
  expect(await hash(page)).toBe(MONTH);

  const before = await viewOf(page);
  await touch(page).stroke([
    [x, y],
    [x - 60, y - 40],
  ]);
  expect(await hash(page)).toBe(MONTH);
  expect((await viewOf(page)).y).not.toBeCloseTo(before.y, 0);

  await touch(page).tap(x, y);
  await waitForPageOf(page, 'tag', '2026-10-29');
});

test('on the office PC a mouse click opens the day, and nothing can be written', async ({ page }) => {
  const repo = await openSeeded(page, MONTH, { device: 'Firmen-PC' });
  await expect(page.locator('.leiste')).toHaveCount(0); // keine Werkzeuge
  const [x, y] = dayPoint(monatLayout('2026-10'), '2026-10-29');
  await mouse(page).tap(x, y);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await mouse(page).stroke(LINE);
  await pen(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

test('the day numbers are links, too, and the keyboard opens them', async ({ page }) => {
  await openSeeded(page, MONTH);
  const days = page.getByRole('navigation', { name: 'Tage dieser Seite' }).getByRole('link');
  await expect(days).toHaveCount(31);
  await expect(link(page, 'Mo 26.10.2026, Nationalfeiertag')).toHaveAttribute('href', '#/tag/2026-10-26');
  // Der 29.10. hat im Mini-Vault einen Termin: Das steht im Namen dazu.
  const today = link(page, 'Do 29.10.2026, 1 Termin');
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(link(page, 'Mi 28.10.2026')).not.toHaveAttribute('aria-current', 'date');
  await today.focus();
  await page.keyboard.press('Enter');
  await waitForPageOf(page, 'tag', TODAY);
  // Eine Tagesseite hat keine Tageszahlen zum Antippen.
  await expect(page.getByRole('navigation', { name: 'Tage dieser Seite' })).toHaveCount(0);
});

// ---------- Feiertage und heute ----------

test('holiday is marked', async ({ page }) => {
  await openSeeded(page, MONTH);
  // Der Name steht in der Seite und, für Tastatur und Sprachausgabe, als Link.
  await expect(link(page, /Nationalfeiertag/)).toHaveCount(1);
  const layout = monatLayout('2026-10');
  const probe = (day: string): [number, number] => {
    const [x, y] = fieldOf(layout, `tag-${day}`);
    return [x + 30, y + 40]; // links neben der Tageszahl, über dem Namen
  };
  await expectColor(page, probe('2026-10-26'), HOLIDAY);
  await expectColor(page, probe('2026-10-27'), PAPER);
  await expectColor(page, probe('2026-10-29'), PAPER);
});

test('holidays are marked on the day and week pages, too', async ({ page }) => {
  await openSeeded(page, '#/tag/2026-10-26');
  await expectColor(page, [800, 42], HOLIDAY); // der Farbton hinter dem Kopf der Seite
  await go(page, '#/tag/2026-10-27');
  await waitForPageOf(page, 'tag', '2026-10-27');
  await expectColor(page, [800, 42], PAPER);

  await go(page, WEEK);
  await waitForPageOf(page, 'woche', '2026-W44');
  const layout = wocheLayout('2026-W44');
  const probe = (day: string): [number, number] => {
    const [x, y] = fieldOf(layout, `tag-${day}`);
    return [x + 350, y + 66]; // zwischen Kopfzeile und erster Linie
  };
  await expectColor(page, probe('2026-10-26'), HOLIDAY);
  await expectColor(page, probe('2026-10-27'), PAPER);
});

test('today is marked on the screen and never in the file', async ({ page }) => {
  const repo = await openSeeded(page, MONTH);
  const layout = monatLayout('2026-10');
  const marks = todayMarks(layout, TODAY);
  expect(marks).not.toBe('');
  // Auf dem Bildschirm: Am Rand des heutigen Tages liegt ein dunkler Rahmen, am Rand des Vortags nicht.
  const edge = (day: string): [number, number] => {
    const [x, y, , h] = fieldOf(layout, `tag-${day}`);
    return [x + 1, y + h / 2];
  };
  await expect.poll(() => inkNear(page, edge(TODAY), 4)).toBeGreaterThan(0);
  expect(await inkNear(page, edge('2026-10-28'), 4)).toBe(0);

  // In der Datei steht davon nichts: Sie soll morgen nicht mehr „heute“ sagen.
  await pen(page).stroke([
    [530, 700],
    [560, 710],
    [600, 700],
  ]);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).toContain(layout.background());
  expect(repo.puts[0].text).not.toContain(marks);
});

// ---------- Jede Seite mit ihren Feldern und ihrem Hintergrund ----------

type Kind = { name: string; hash: string; file: string; kind: string; key: string; layout: Layout; field: string; title: string };
const KINDS: Kind[] = [
  { name: 'day', hash: DAY, file: TAG, kind: 'tag', key: TODAY, layout: tagLayout(TODAY), field: 'notizen', title: 'Donnerstag, 29. Oktober 2026' },
  { name: 'week', hash: WEEK, file: `${FILES}/2026 KW44 Woche.svg`, kind: 'woche', key: '2026-W44', layout: wocheLayout('2026-W44'), field: 'tag-2026-10-29', title: 'Woche 44' },
  { name: 'month', hash: MONTH, file: `${FILES}/2026-10 Monat.svg`, kind: 'monat', key: '2026-10', layout: monatLayout('2026-10'), field: 'tag-2026-10-29', title: 'Oktober 2026' },
];

for (const k of KINDS) {
  test(`the ${k.name} page is written with its own fields and background`, async ({ page }) => {
    const repo = await openSeeded(page, k.hash);
    const [x, y, w, h] = fieldOf(k.layout, k.field);
    await pen(page).stroke([
      [x + w / 4, y + h / 2],
      [x + w / 2, y + h / 2 + 10],
      [x + (3 * w) / 4, y + h / 2],
    ]);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await sendToBackground(page);
    await expect.poll(() => repo.puts.length).toBe(1);

    const [put] = repo.puts;
    expect(put.path).toBe(k.file);
    expect(put.text).toContain(`data-seite="${k.kind}"`);
    expect(put.text).toContain(`data-schluessel="${k.key}"`);
    expect(put.text).toContain(k.layout.background());
    expect(put.text).toContain(k.title);
    // Der Strich steht in dem Feld, in dem er geschrieben wurde, und in keinem anderen.
    expect(strokesPerField(put.text)).toEqual({ [k.field]: 1 });
  });
}

test('switching pages never loses a stroke', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await pen(page).stroke(LINE);
  const [first] = await strokeIds(page);
  // Gleich weiter, ohne zu warten, und gleich wieder zurück.
  await link(page, 'Nächster Tag').click();
  await waitForPageOf(page, 'tag', '2026-10-30');
  await pen(page).stroke(LINE);
  const [second] = await strokeIds(page);
  await link(page, 'Woche').click();
  await waitForPageOf(page, 'woche', '2026-W44');
  await link(page, 'Heute').click();
  await waitForPageOf(page, 'tag', TODAY);
  expect(await strokeIds(page)).toEqual([first]);
  await link(page, 'Nächster Tag').click();
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeIds(page)).toEqual([second]);

  // Ein Seitenwechsel lädt nichts hoch: Beide Seiten sind gespeichert und warten. Verlässt man die App, gehen beide hoch.
  const both = [TAG, `${FILES}/2026-10-30 Tag.svg`].sort();
  await expect.poll(async () => Object.keys(await queued(page)).sort()).toEqual(both);
  expect(repo.puts).toEqual([]);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((p) => p.path).sort()).toEqual(both);
});

test('the status pill is in the top bar, once', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(page.getByTestId('status')).toHaveCount(1);
  await expect(page.locator('.topbar').getByTestId('status')).toHaveText('Gesichert');
  await link(page, 'Nächster Tag').click();
  await waitForPageOf(page, 'tag', '2026-10-30');
  await expect(page.getByTestId('status')).toHaveCount(1);
});

// ---------- Die Seite springt nicht ----------

/** Höhe der Leiste oben und Ort der Fläche. Beides darf sich nicht ändern, solange man schreibt. */
const barAndSurface = (page: Page) =>
  page.evaluate(() => ({
    bar: document.querySelector('.topbar')!.getBoundingClientRect().height,
    top: document.querySelector('[data-testid="surface"]')!.getBoundingClientRect().top,
  }));

test('the page does not move when the status text gets longer', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 }); // iPad im Hochformat: Hier ist die Leiste am engsten
  await openSeeded(page, DAY, { offline: true });
  const before = await barAndSurface(page);
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect(page.getByTestId('status')).toHaveText('Wartet auf Netz · 1 Änderung');
  expect(await barAndSurface(page)).toEqual(before);
});

test('a notice floats over the page and does not move it', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await openSeeded(page, DAY, { failWrites: true });
  const before = await barAndSurface(page);
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Abgleich hat nicht geklappt' })).toBeVisible();
  expect(await barAndSurface(page)).toEqual(before);
});

// ---------- Meldungen der Engine ----------

test('a save that fails is announced and the notice can be closed', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { failWrites: true });
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  const notice = page.getByRole('alert').filter({ hasText: 'Abgleich hat nicht geklappt: 2026-10-29 Tag.svg' });
  await expect(notice).toBeVisible();

  await button(page, 'Hinweis schließen').click();
  await expect(notice).toHaveCount(0);

  // Die Änderung ist nicht weg: Sie geht hoch, sobald GitHub wieder schreiben lässt.
  repo.failWrites = false;
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].path).toBe(TAG);
});

test('a conflict copy is announced', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  // Kein Netz: Der Strich bleibt in der Warteschlange.
  const offline = (route: Route) => route.abort('internetdisconnected');
  await page.route('https://api.github.com/**', offline);
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  // Ein anderes Gerät legt in der Zwischenzeit eine Fassung ab, die sich nicht mit der eigenen zusammenführen lässt.
  repo.commit(TAG, BROKEN);
  await page.unroute('https://api.github.com/**', offline);
  await networkBack(page);

  const copy = `${FILES}/${TODAY} Tag (Konflikt).svg`;
  const notice = page.getByRole('alert').filter({ hasText: `Konfliktkopie angelegt: ${TODAY} Tag (Konflikt).svg` });
  await expect(notice).toBeVisible();
  // Die Kopie geht im selben Abgleich hoch, aber nicht unbedingt vor der Meldung.
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([copy]);
  expect(repo.read(TAG)).toBe(BROKEN); // der fremde Stand bleibt
  expect(repo.read(copy)).toContain('<path data-id=');
  await button(page, 'Hinweis schließen').click();
  await expect(notice).toHaveCount(0);
});

test('the right column of the week writes goals, tasks and notes into their own fields', async ({ page }) => {
  const repo = await openSeeded(page, WEEK);
  const layout = wocheLayout('2026-W44');
  for (const id of ['ziele', 'aufgaben', 'notizen']) {
    const [x, y, w, h] = fieldOf(layout, id);
    await pen(page).stroke([[x + w / 4, y + h / 2], [x + w / 2, y + h / 2 + 10], [x + (3 * w) / 4, y + h / 2]]);
  }
  await expect.poll(() => strokeCount(page)).toBe(3);
  await sendToBackground(page);
  await expect.poll(() => strokesPerField(repo.puts.at(-1)?.text ?? '')).toEqual({ ziele: 1, aufgaben: 1, notizen: 1 });
  expect(repo.puts.at(-1)!.text).toContain('<g data-feld="aufgaben" data-datum="2026-10-26">');
});

test('a finger on a day in the month calendar of the week opens that day, a pale one too', async ({ page }) => {
  await openSeeded(page, WEEK);
  const layout = wocheLayout('2026-W44');
  await touch(page).tap(...calendarPoint(layout, '2026-10-14'));
  await waitForPageOf(page, 'tag', '2026-10-14');
  await go(page, WEEK);
  await waitForPageOf(page, 'woche', '2026-W44');
  await touch(page).tap(...calendarPoint(layout, '2026-11-05'));
  await waitForPageOf(page, 'tag', '2026-11-05');
});

test('the pen writes on the month calendar of the week and never opens a day', async ({ page }) => {
  const repo = await openSeeded(page, WEEK);
  const [x, y] = calendarPoint(wocheLayout('2026-W44'), '2026-10-14');
  await pen(page).stroke([[x - 15, y], [x, y + 8], [x + 15, y]]);
  expect(await hash(page)).toBe(WEEK);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(strokesPerField(repo.puts[0].text)).toEqual({ frei: 1 });
});

test('on the office PC a mouse click on the month calendar of the week opens the day', async ({ page }) => {
  await openSeeded(page, WEEK, { device: 'Firmen-PC' });
  await mouse(page).tap(...calendarPoint(wocheLayout('2026-W44'), '2026-10-14'));
  await waitForPageOf(page, 'tag', '2026-10-14');
});

test('the month calendar of the week is a list of links, too', async ({ page }) => {
  await openSeeded(page, WEEK);
  const list = page.getByRole('navigation', { name: 'Monatskalender' });
  await expect(list.getByRole('link')).toHaveCount(42);
  await expect(list.getByRole('link').first()).toHaveText('Mo 28.09.2026');
  await expect(list.getByRole('link', { name: 'Mo 26.10.2026, Nationalfeiertag', exact: true })).toHaveAttribute('href', '#/tag/2026-10-26');
  await expect(list.getByRole('link', { name: 'Do 29.10.2026', exact: true })).toHaveAttribute('aria-current', 'date');
  await expect(page.getByRole('navigation', { name: 'Tage dieser Seite' }).getByRole('link')).toHaveCount(7);
  await go(page, MONTH);
  await waitForPageOf(page, 'monat', '2026-10');
  await expect(page.getByRole('navigation', { name: 'Monatskalender' })).toHaveCount(0);
});

// Mit der Tastatur: Nach den sieben Tagen der Woche kommt der Knopf „Ganze Seite“ (nur ohne Werkzeugleiste, etwa am Firmen-PC),
// erst danach die 42 Tage des Monatskalenders. Sonst bräuchte man 42 Tabs mehr bis zur ganzen Seite.
test('on the office PC the tab key reaches "Ganze Seite" before the 42 days of the month calendar', async ({ page }) => {
  await openSeeded(page, WEEK, { device: 'Firmen-PC' });
  const week = page.getByRole('navigation', { name: 'Tage dieser Seite' }).getByRole('link');
  await expect(week).toHaveCount(7);
  await week.last().focus();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Ganze Seite' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('navigation', { name: 'Monatskalender' }).getByRole('link').first()).toBeFocused();
});

test('today is circled in the month calendar of the week, on the screen only', async ({ page }) => {
  const repo = await openSeeded(page, WEEK);
  const layout = wocheLayout('2026-W44');
  const [x29, y29] = calendarPoint(layout, TODAY);
  const [x28, y28] = calendarPoint(layout, '2026-10-28');
  await expect.poll(() => inkNear(page, [x29 + 16, y29], 3)).toBeGreaterThan(0);
  expect(await inkNear(page, [x28 + 16, y28], 3)).toBe(0);
  const [x, y, w, h] = fieldOf(layout, 'notizen');
  await pen(page).stroke([[x + w / 4, y + h / 2], [x + w / 2, y + h / 2 + 10], [x + (3 * w) / 4, y + h / 2]]);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).toContain(layout.background());
  expect(repo.puts[0].text).not.toContain('r="16"');
});
