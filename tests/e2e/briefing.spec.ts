import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { openSeeded, queued } from './helpers/app';
import { viewOf } from './helpers/pointer';
import { touchscreen } from './helpers/touch';

// „Briefing durchgehen“: Die Karte „Morgenbriefing“ der Tagesseite füllt die Bühne und wird mit „Fertig“ wieder zur Karte. Es
// bleibt dieselbe Karte, mit allem, was in ihr offen und getippt ist. GitHub antwortet aus dem erfundenen Mini-Vault in
// tests/fixtures/vault/. Heute ist in allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit).

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und darauf, dass die App nie einen Dialog des
 * Browsers öffnet (`window.confirm` blockiert das iPad): Rückfragen und Eingaben kommen von der App selbst.
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

const VAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vault');
const NOTE_TEXT = readFileSync(join(VAULT_DIR, '05 Daily Notes', '2026-10-29.md'), 'utf8');

const TODAY = '2026-10-29';
const DAY = `#/tag/${TODAY}`;
const NOTE = '05 Daily Notes/2026-10-29.md';
const TAG_PAGE = `07 Anhänge/Notizbuch/2026/${TODAY} Tag.svg`;

/** Die erste Aufgabe des Morgenbriefings im Mini-Vault, genau wie in der Datei, und die Namen der ersten beiden Kästchen. */
const TASK1 = '- [ ] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%';
const NAME1 = 'Liste Planobjekte ergänzen (fällig 30.10.)';
const NAME2 = 'Urlaube im Plan nachziehen';
/** Im Mini-Vault zugeklappt, bis jemand ihn aufklappt. */
const EVENING = 'Abendüberblick (automatisch)';

/** Die Pause nach dem Stift (250 ms), in der eine Berührung als Hand gilt. */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const pencil = (page: Page, name: string) => button(page, `Bearbeiten: ${name}`);
const section = (page: Page, name: string) => button(page, name);
const briefing = (page: Page) => page.getByRole('region', { name: 'Morgenbriefing', exact: true });
/** Die anderen beiden Karten, auch wenn sie unsichtbar sind (dann fehlen sie in der Liste der Rollen). */
const otherCards = (page: Page) => [page.locator('section[aria-label="Kalender"]'), page.locator('section[aria-label="Besprechungen"]')];
const editField = (page: Page) => page.getByLabel('Text bearbeiten', { exact: true });
const addField = (page: Page) => page.getByLabel('Ergänzung', { exact: true });
/** Die Ebene der Karten: Ihr `transform` (am Element gesetzt) sagt, wo die Seite gerade liegt. */
const layerTransform = (page: Page) => page.locator('.karten').evaluate((el) => (el as HTMLElement).style.transform);
/** Die Karte hat nichts mehr zu tun: Alles, was sie schreiben wollte, steht in der Warteschlange. */
const settled = (page: Page) => expect(briefing(page)).toHaveAttribute('aria-busy', 'false');

async function queuedText(page: Page, path: string): Promise<string> {
  return (await queued(page))[path] ?? '';
}

async function opened(page: Page) {
  const repo = await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  return repo;
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, 'sichtbar').not.toBeNull();
  return box!;
}

/** Wie weit zwei Rechtecke auseinanderliegen: die größte Abweichung einer Kante, in Bildschirmpunkten. */
const offBy = (a: Box, b: Box): number =>
  Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.x + a.width - (b.x + b.width)), Math.abs(a.y + a.height - (b.y + b.height)));

/** Ob sich zwei Rechtecke überdecken (Ränder, die sich nur berühren, zählen nicht). */
const overlap = (a: Box, b: Box): boolean => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

type At = { x: number; y: number };
type Ev = At & { type: 'pointerdown' | 'pointermove' | 'pointerup' };

/**
 * Zeigerereignisse des Stifts wie auf dem Bildschirm: Jedes geht an das Element, das an seinem Ort zuoberst liegt (die große Karte
 * oder die Fläche), nicht an ein ausgesuchtes. So zeigt sich, ob etwas über der Seite liegt. Orte in Bildschirmkoordinaten.
 */
async function penOnScreen(page: Page, points: At[]): Promise<void> {
  const events: Ev[] = [
    { type: 'pointerdown', ...points[0] },
    ...points.slice(1).map((p): Ev => ({ type: 'pointermove', ...p })),
    { type: 'pointerup', ...points[points.length - 1] },
  ];
  await page.evaluate((list) => {
    for (const ev of list) {
      const el = document.elementFromPoint(ev.x, ev.y);
      if (!el) throw new Error(`Nichts bei ${ev.x}, ${ev.y}.`);
      el.dispatchEvent(
        new PointerEvent(ev.type, {
          pointerId: 11,
          pointerType: 'pen',
          isPrimary: true,
          pressure: 0.5,
          width: 1,
          height: 1,
          clientX: ev.x,
          clientY: ev.y,
          button: ev.type === 'pointermove' ? -1 : 0,
          buttons: ev.type === 'pointerup' ? 0 : 1,
          bubbles: true,
          cancelable: true,
          composed: true,
        }),
      );
    }
  }, events);
}

/** Zwei Bilder des Browsers abwarten: Was die Seite bei einer Geste verschiebt, steht dann an der Ebene der Karten. */
const twoFrames = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));

test('Briefing durchgehen fills the stage and Fertig brings the card back', async ({ page }) => {
  await opened(page);
  const card = briefing(page);
  const frame = page.locator('.karten-rahmen');
  const small = await boxOf(card);

  await button(page, 'Briefing durchgehen').click();
  await expect(button(page, 'Fertig')).toBeVisible();
  await expect(button(page, 'Briefing durchgehen')).toHaveCount(0);
  await expect.poll(async () => offBy(await boxOf(card), await boxOf(frame))).toBeLessThanOrEqual(1);
  // Die anderen Karten sind unsichtbar, aber noch da. Leiste und Werkzeugleiste bleiben.
  for (const other of otherCards(page)) {
    await expect(other).toHaveCount(1);
    await expect(other).toBeHidden();
  }
  await expect(page.locator('header.topbar')).toBeVisible();
  await expect(page.getByRole('toolbar')).toBeVisible();

  await button(page, 'Fertig').click();
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
  await expect(button(page, 'Fertig')).toHaveCount(0);
  await expect.poll(async () => offBy(await boxOf(card), small)).toBeLessThanOrEqual(1);
  for (const other of otherCards(page)) await expect(other).toBeVisible();
});

test('ticking in the big briefing writes the line once', async ({ page }) => {
  await opened(page);
  await button(page, 'Briefing durchgehen').click();
  await expect(button(page, 'Fertig')).toBeVisible();
  await checkbox(page, NAME1).check();
  await expect(checkbox(page, NAME1)).toBeChecked();
  await settled(page);
  const ticked = NOTE_TEXT.replace(TASK1, TASK1.replace('[ ]', '[x]'));
  await expect.poll(() => queuedText(page, NOTE)).toBe(ticked);

  await button(page, 'Fertig').click();
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
  await expect(checkbox(page, NAME1)).toBeChecked();
  await settled(page);
  expect(await queuedText(page, NOTE)).toBe(ticked);
});

test('open sections, an open edit field and typed text survive the switch', async ({ page }) => {
  await opened(page);
  const evening = section(page, EVENING);
  await expect(evening).toHaveAttribute('aria-expanded', 'false');
  await evening.click();
  await pencil(page, NAME2).click();
  await editField(page).fill('Urlaube bis Freitag nachziehen');
  await addField(page).fill('Notiz offen');
  const allThere = async () => {
    await expect(evening).toHaveAttribute('aria-expanded', 'true');
    await expect(briefing(page).getByText('nichts', { exact: true })).toBeVisible(); // der Inhalt des aufgeklappten Abschnitts
    await expect(editField(page)).toHaveValue('Urlaube bis Freitag nachziehen');
    await expect(addField(page)).toHaveValue('Notiz offen');
  };
  await allThere();

  await button(page, 'Briefing durchgehen').click();
  await expect(button(page, 'Fertig')).toBeVisible();
  await allThere();

  await button(page, 'Fertig').click();
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
  await allThere();
  // Es wurde weder abgeschickt noch gespeichert.
  await settled(page);
  expect(await queued(page)).toEqual({});
});

test.describe('with a touch screen', () => {
  test.use({ hasTouch: true });

  test('a pen stroke on the big briefing draws nothing and a finger drag does not move the page', async ({ page }) => {
    await opened(page);
    // Ein Strich im Feld Notizen unter der Karte (Seiteneinheiten), umgerechnet auf den Bildschirm, solange die Seite dort liegt.
    const points = await page.evaluate(() =>
      [
        [200, 900],
        [260, 920],
        [320, 900],
      ].map(([x, y]) => window.__notizbuch.toClient(x, y)),
    );
    await button(page, 'Briefing durchgehen').click();
    await expect(button(page, 'Fertig')).toBeVisible();
    const onTop = await page.evaluate((at) => document.querySelector('section[aria-label="Morgenbriefing"]')!.contains(document.elementFromPoint(at.x, at.y)), points[0]);
    expect(onTop, 'die große Karte liegt dort zuoberst').toBe(true);

    await penOnScreen(page, points);
    expect(await strokeCount(page)).toBe(0);
    await afterPalmWindow(page); // auch die Zeit, in der ein Strich in der Warteschlange stünde
    expect(Object.keys(await queued(page))).not.toContain(TAG_PAGE);

    // Ein Finger seitwärts über die Karte, etwas schräg: Eine Seite, die ihn bekäme, ginge mit ihm nach unten.
    const layer = await layerTransform(page);
    const view = await viewOf(page);
    const box = await boxOf(briefing(page));
    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await (await touchscreen(page)).swipe([x, y], [x + 120, y + 40]);
    await twoFrames(page);
    expect(await layerTransform(page)).toBe(layer);
    expect(await viewOf(page)).toEqual(view);

    // Zur Probe: Ohne Großansicht schreibt derselbe Strich auf die Seite.
    await button(page, 'Fertig').click();
    await expect(button(page, 'Briefing durchgehen')).toBeVisible();
    await penOnScreen(page, points);
    expect(await strokeCount(page)).toBe(1);
  });
});

test('Escape closes the big briefing', async ({ page }) => {
  await opened(page);
  await button(page, 'Briefing durchgehen').click();
  await button(page, 'Fertig').focus();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
  await expect(briefing(page)).not.toHaveClass(/\bgross\b/);

  // Steht der Fokus in einem Textfeld, bleibt sie offen.
  await button(page, 'Briefing durchgehen').click();
  await addField(page).focus();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Fertig')).toBeVisible();
  await expect(briefing(page)).toHaveClass(/\bgross\b/);
  // Im Feld zum Bearbeiten bricht Escape nur die Bearbeitung ab. Danach steht der Fokus auf dem Stift, und Escape schließt.
  await pencil(page, NAME2).click();
  await expect(editField(page)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(editField(page)).toHaveCount(0);
  await expect(pencil(page, NAME2)).toBeFocused();
  await expect(briefing(page)).toHaveClass(/\bgross\b/);
  await page.keyboard.press('Escape');
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
});

test('Escape also closes the big briefing after a box was ticked with the mouse', async ({ page }) => {
  await opened(page);
  await button(page, 'Briefing durchgehen').click();
  await checkbox(page, NAME1).click(); // ein echter Mausklick: Danach hat das Kästchen den Fokus
  await expect(checkbox(page, NAME1)).toBeChecked();
  await expect(checkbox(page, NAME1)).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
  await expect(briefing(page)).not.toHaveClass(/\bgross\b/);
  await expect(checkbox(page, NAME1)).toBeChecked();
});

test('flipping to another day closes it', async ({ page }) => {
  await opened(page);
  await button(page, 'Briefing durchgehen').click();
  await expect(button(page, 'Fertig')).toBeVisible();
  await page.getByRole('link', { name: 'Nächster Tag', exact: true }).click();
  await expect.poll(() => hash(page)).toBe('#/tag/2026-10-30');
  await expect(button(page, 'Briefing durchgehen')).toBeVisible();
  await expect(button(page, 'Fertig')).toHaveCount(0);
  await expect(briefing(page)).not.toHaveClass(/\bgross\b/);
});

// ---------- Was die App zum Bedienen zeigt, bleibt über der großen Karte ----------

/** Liegt an der Mitte des Elements das Element selbst (oder etwas in ihm) zuoberst? */
async function onTop(locator: Locator): Promise<boolean> {
  const box = await boxOf(locator);
  return locator.evaluate((el, at) => el.contains(document.elementFromPoint(at.x, at.y)), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Die Meldung, die die Leiste oben zeigt, wenn der Zugang bald abläuft (heute ist der 29.10.2026). */
const EXPIRY = 'Dein Zugang läuft am 08.11.2026 ab. Bitte rechtzeitig erneuern.';

test('outside fullscreen the month tabs stay above the big briefing, and nothing of the card lies under them', async ({ page }) => {
  await opened(page);
  await button(page, 'Briefing durchgehen').click();
  await expect(button(page, 'Fertig')).toBeVisible();
  const strip = await boxOf(page.locator('nav.monatsreiter'));
  for (const target of [button(page, 'Fertig'), pencil(page, NAME1), button(page, 'Hinzufügen')]) {
    const box = await boxOf(target);
    expect(box.x + box.width, 'links vom Streifen der Monatsreiter').toBeLessThanOrEqual(strip.x);
  }
  const october = page.getByRole('link', { name: 'Oktober 2026', exact: true });
  expect(await onTop(october), 'der Reiter liegt über der Karte').toBe(true);
  await october.click();
  await expect.poll(() => hash(page)).toBe('#/monat/2026-10');
});

for (const werkzeuge of ['kreis', 'tab'] as const) {
  test(`in fullscreen the message in the top bar and the ${werkzeuge === 'kreis' ? 'wheel' : 'tab'} stay above the big briefing`, async ({ page }) => {
    await openSeeded(page, DAY, { settings: { vollbild: { an: true, werkzeuge }, tokenExpiry: '2026-11-08' } });
    await expect(checkbox(page, NAME1)).toBeVisible();
    const message = page.locator('.meldung', { hasText: EXPIRY });
    await expect(message).toBeVisible();
    await button(page, 'Briefing durchgehen').click();
    await expect(button(page, 'Fertig')).toBeVisible();
    // Im Vollbild füllt die große Karte das ganze Fenster. Im Tab des Browsers rückt sie oben nicht unter einen Glaseffekt.
    expect(offBy(await boxOf(briefing(page)), { x: 0, y: 0, ...page.viewportSize()! })).toBeLessThanOrEqual(1);
    await expect(briefing(page)).toHaveCSS('padding-top', '8px');
    expect(await onTop(message), 'die Meldung liegt über der Karte').toBe(true);
    expect(overlap(await boxOf(message), await boxOf(button(page, 'Fertig'))), 'die Meldung liegt nicht auf „Fertig“').toBe(false);

    // Ein echter Mausklick: Playwright klickt nur, wenn an der Stelle das Rad oder die Lasche zuoberst liegt.
    if (werkzeuge === 'kreis') {
      await page.getByTestId('quick-switch').click();
      const ring = page.getByRole('group', { name: 'Werkzeugrad', exact: true });
      await expect(ring).toBeVisible();
      expect(await onTop(ring.getByRole('button', { name: 'Vollbild aus', exact: true })), 'der Ring liegt über der Karte').toBe(true);
    } else {
      const handle = page.getByRole('button', { name: 'Werkzeuge', exact: true });
      await handle.click();
      await expect(handle).toHaveAttribute('aria-expanded', 'true');
      const strip = page.getByRole('toolbar', { name: 'Werkzeuge im Vollbild', exact: true });
      await expect(strip).toBeVisible();
      expect(await onTop(strip.getByRole('button', { name: 'Vollbild aus', exact: true })), 'die Leiste der Lasche liegt über der Karte').toBe(true);
    }
  });
}

test('as an app from the home screen in fullscreen, the big briefing starts below the glass of iPadOS', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'standalone', { get: () => true, configurable: true }));
  await openSeeded(page, DAY, { settings: { vollbild: { an: true, werkzeuge: 'kreis' } } });
  await expect(page.locator('html')).toHaveClass(/heimbildschirm/);
  await expect(checkbox(page, NAME1)).toBeVisible();
  await button(page, 'Briefing durchgehen').click();
  // Wie die Leiste oben dort: 24 Punkte tiefer als im Tab des Browsers.
  await expect(briefing(page)).toHaveCSS('padding-top', '32px');
  expect((await boxOf(button(page, 'Fertig'))).y).toBeGreaterThanOrEqual(32);
});
