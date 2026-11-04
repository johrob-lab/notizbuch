import { expect, test as base, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import { besprechungLayout } from '../../src/pages/layouts';
import { openSeeded, savedSettings, shareRepos } from './helpers/app';
import { centerOf, mouse, palm, pen, touch, viewOf } from './helpers/pointer';

// Das Vollbild: Ein Knopf blendet alle Leisten aus, die Seite füllt den Bildschirm. GitHub antwortet aus einem Repo im
// Speicher (tests/e2e/helpers/app.ts). Alles hier ist erfunden. Heute ist in allen Tests der 29.10.2026 (Wiener Zeit).

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

const DAY = '#/tag/2026-10-29';
const NEXT_DAY = '#/tag/2026-10-30';
const ON = { vollbild: { an: true, werkzeuge: 'kreis' } };
/** Ein Strich im unteren Teil der Tagesseite (Feld „Notizen“). */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
const BASE = '2026-10-29 0800 Abstimmung Beispiel 2027';
const MEETING = `07 Anhänge/Notizbuch/2026/${BASE} S1.svg`;

const knopf = (page: Page) => page.getByRole('button', { name: 'Vollbild', exact: true });
const status = (page: Page) => page.getByTestId('status');

const TAG = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';
const UNREADABLE = 'Diese Seite lässt sich nicht lesen und wird nicht verändert.';
const OTHER_WINDOW = 'Das Notizbuch ist schon in einem anderen Fenster offen.';
/** Das Rad: der Schnellwechsel im Vollbild. */
const QUICK = '[data-testid="quick-switch"]';
const SCHUTZ = '.ring-schutz';
/** So lange liegt der Stift auf dem Rad, bis der Ring aufgeht (`HOLD_MS` in src/ui/QuickSwitch.tsx). */
const HOLD_MS = 400;
/** Ohne Schreiben (Firmen-PC, Seite nicht lesbar, Fenster liest nur) bietet der Ring nur das. */
const ONLY_VIEW = ['Voriger Tag', 'Heute', 'Nächster Tag', 'Ganze Seite', 'Vollbild aus'];

/** Ein Knopf im Ring, als Selektor für die Zeigerereignisse. */
const im = (label: string) => `.ring-knopf[aria-label="${label}"]`;
const ring = (page: Page) => page.locator('.ring-knopf');
const ringLabels = (page: Page) => ring(page).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const pageKey = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().key);
const waitForPageOf = (page: Page, key: string) => page.waitForFunction((day) => window.__notizbuch?.currentPage?.().key === day, key);
/** Stift und Handballen: Finger gelten erst 250 ms nach dem Abheben des Stifts wieder (siehe `GestureFilter`). */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);

type Kind = 'pen' | 'touch' | 'mouse';
type At = { x: number; y: number };
type Ev = At & { type: 'pointerdown' | 'pointermove' | 'pointerup' };

/**
 * Zeigerereignisse wie auf dem Bildschirm: Jedes geht an das Element, das an seinem Ort zuoberst liegt (Ring, Schutzfeld, Rad oder
 * Fläche), nicht an ein ausgesuchtes. So zeigt sich, ob etwas über der Seite liegt. Orte in Bildschirmkoordinaten, Kennungen wie in
 * helpers/pointer.ts.
 */
async function onScreen(page: Page, kind: Kind, events: Ev[]): Promise<void> {
  await page.evaluate(
    ({ pointerType, pointerId, list }) => {
      for (const ev of list) {
        const el = document.elementFromPoint(ev.x, ev.y);
        if (!el) throw new Error(`Nichts bei ${ev.x}, ${ev.y}.`);
        el.dispatchEvent(
          new PointerEvent(ev.type, {
            pointerId,
            pointerType,
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
    },
    { pointerType: kind, pointerId: { mouse: 1, pen: 11, touch: 21 }[kind], list: events },
  );
}

/** Die Klasse des Elements, das an diesem Ort zuoberst liegt. */
const topmost = (page: Page, at: At) => page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.getAttribute('class') ?? null, at);

/** Ein Tipp in die Mitte eines Elements, auf das, was dort zuoberst liegt. Liegt etwas anderes darüber, scheitert der Test. */
async function tapTop(page: Page, kind: Kind, selector: string): Promise<void> {
  const c = await centerOf(page, selector);
  const onTop = await page.evaluate(({ sel, x, y }) => document.querySelector(sel)!.contains(document.elementFromPoint(x, y)), { sel: selector, ...c });
  expect(onTop, `${selector} liegt zuoberst`).toBe(true);
  await onScreen(page, kind, [
    { type: 'pointerdown', ...c },
    { type: 'pointerup', ...c },
  ]);
}

/** Ein Strich an Orten der Seite (Seiteneinheiten), auf das, was dort zuoberst liegt: aufsetzen, zu jedem Punkt, am letzten abheben. */
async function strokeTop(page: Page, kind: Kind, points: [number, number][]): Promise<void> {
  const at = await page.evaluate((list) => list.map(([x, y]) => window.__notizbuch.toClient(x, y)), points);
  await onScreen(page, kind, [
    { type: 'pointerdown', ...at[0] },
    ...at.slice(1).map((p): Ev => ({ type: 'pointermove', ...p })),
    { type: 'pointerup', ...at[at.length - 1] },
  ]);
}

/** Der Stift liegt auf dem Rad, bis der Ring offen ist, und hebt dann ab. */
async function holdWheel(page: Page): Promise<void> {
  const c = await centerOf(page, QUICK);
  await pen(page).downOn(QUICK, c.x, c.y);
  await expect(ring(page).first()).toBeVisible();
  await pen(page).upOn(QUICK, c.x, c.y);
}

test('the Vollbild button hides the bars and the page fills the width', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator('.werkzeuge')).toBeVisible();
  await expect(page.locator('.monatsreiter')).toBeVisible();
  await knopf(page).click();

  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await expect(page.locator('.ansichten')).toBeHidden();
  await expect(page.locator('.werkzeuge')).toBeHidden();
  await expect(page.locator('.monatsreiter')).toBeHidden();
  await expect(knopf(page)).toBeHidden();
  const box = (await page.getByTestId('surface').boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.y).toBe(0);
  expect(box.width).toBe(1200);
  await expect.poll(async () => ((await viewOf(page)).scale * 1000) | 0).toBe((((1200 - 32) / 1192) * 1000) | 0);
});

test('fullscreen stays on after a page change and a reload', async ({ page }) => {
  await openSeeded(page, DAY);
  await knopf(page).click();
  await expect(page.locator('.ansichten')).toBeHidden();
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: true, werkzeuge: 'kreis' });

  await page.evaluate((h) => void (window.location.hash = h), NEXT_DAY);
  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await expect(page.locator('.ansichten')).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  await expect(page.locator('.ansichten')).toBeHidden();
  expect((await savedSettings(page))?.vollbild).toEqual({ an: true, werkzeuge: 'kreis' });
});

test('the settings page always shows the bar', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await expect(page.locator('.ansichten')).toBeHidden();
  await page.evaluate(() => void (window.location.hash = '#/einstellungen'));
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator('main#app')).not.toHaveClass(/vollbild/);
  await expect(knopf(page)).toHaveCount(0); // der Knopf gehört zu den Seiten
});

test('in fullscreen a notice stays visible and the status shows only when not saved', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { settings: { ...ON, tokenExpiry: '2026-11-08' }, offline: true });
  await expect(page.locator('.meldung', { hasText: 'Dein Zugang läuft am 08.11.2026 ab. Bitte rechtzeitig erneuern.' })).toBeVisible();
  await expect(page.locator('.ansichten')).toBeHidden();
  await pen(page).stroke(LINE);
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(status(page)).toBeVisible();
  await expect(status(page)).toHaveText('Wartet auf Netz · 1 Änderung');

  repo.offline = false;
  await page.evaluate(() => void window.dispatchEvent(new Event('online')));
  await expect.poll(() => repo.puts.length).toBeGreaterThan(0);
  await expect(status(page)).toHaveCount(0);
});

test('a meeting page hides its header form in fullscreen', async ({ page }) => {
  const layout = besprechungLayout({ thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', ort: '', projekt: '', seitennr: '1' });
  const text = serializePage(
    { kind: 'besprechung', key: BASE, meta: { thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', ort: '', projekt: '', seitennr: '1' }, strokes: [] },
    layout.fields,
    layout.background(),
  );
  await openSeeded(page, `#/besprechung/${encodeURIComponent(BASE)}/1`, { files: { [MEETING]: text } });
  await expect(page.locator('form.kopfdaten')).toBeVisible();
  await knopf(page).click();
  await expect(page.locator('form.kopfdaten')).toBeHidden();
  await expect(page.locator('.werkzeuge')).toBeHidden();
});

test('the tools for fullscreen can be chosen in the settings', async ({ page }) => {
  await openSeeded(page, DAY);
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.getByRole('group', { name: 'Werkzeuge im Vollbild' }).getByRole('radio', { name: 'Tab', exact: true }).check();
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: false, werkzeuge: 'tab' });
});

// ---------- Das Werkzeugrad ----------

test('a pen tap on the wheel switches pen and eraser', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  const wheel = page.getByTestId('quick-switch');
  await expect(wheel).toHaveAttribute('aria-label', 'Werkzeug wechseln');
  await expect(wheel).toHaveAttribute('data-tool', 'pen');
  await pen(page).tapOn(QUICK);
  await expect(wheel).toHaveAttribute('data-tool', 'eraser');
  await pen(page).tapOn(QUICK);
  await expect(wheel).toHaveAttribute('data-tool', 'pen');
  await expect(ring(page)).toHaveCount(0);
});

test('holding the pen on the wheel opens the ring and switches nothing', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  const wheel = page.getByTestId('quick-switch');
  const c = await centerOf(page, QUICK);
  const stylus = pen(page);
  await stylus.downOn(QUICK, c.x, c.y);
  await stylus.moveOn(QUICK, c.x + 3, c.y - 2); // ein wenig Zittern zählt nicht
  await expect(ring(page).first()).toBeVisible();
  await stylus.upOn(QUICK, c.x + 3, c.y - 2);
  await expect(wheel).toHaveAttribute('data-tool', 'pen');
  await expect(page.locator(im('Kugelschreiber'))).toHaveAttribute('aria-pressed', 'true');
  await expect(ring(page)).toHaveCount(18); // der Ring bleibt offen: innen 4 Farben und 3 Breiten, außen 11 Knöpfe
});

test('a finger tap on the wheel opens the ring, a colour applies and closes it', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  const wheel = page.getByTestId('quick-switch');
  const rest = (await wheel.boundingBox())!;
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
  expect(await wheel.boundingBox()).toEqual(rest); // der Tipp verschiebt das Rad nicht

  await tapTop(page, 'touch', im('Rot (offen)'));
  await expect(ring(page)).toHaveCount(0);
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  await expect.poll(async () => ((await savedSettings(page))?.ink as { color?: string } | undefined)?.color).toBe('rot');
  expect((await savedSettings(page))?.quickSwitchPos).toBeUndefined();
  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect((await page.evaluate(() => window.__notizbuch.currentPage().strokes))[0]).toMatchObject({ color: 'rot' });
});

test('undo keeps the ring open', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await holdWheel(page);
  await expect(page.locator(im('Wiederholen'))).toBeDisabled();

  await tapTop(page, 'pen', im('Rückgängig'));
  expect(await strokeCount(page)).toBe(0);
  await expect(page.locator(im('Rückgängig'))).toBeDisabled();
  await expect(page.locator(im('Wiederholen'))).toBeEnabled();
  await tapTop(page, 'pen', im('Wiederholen'));
  expect(await strokeCount(page)).toBe(1);
  await expect(ring(page)).toHaveCount(18);
});

test('a tap next to the ring closes it and draws nothing', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();

  // Das Papier neben dem Ring liegt unter dem Schutzfeld: Der Stift trifft das Schutzfeld, nicht die Fläche.
  const paper = await page.evaluate(() => window.__notizbuch.toClient(200, 1000));
  expect(await topmost(page, paper)).toBe('ring-schutz');
  await onScreen(page, 'pen', [
    { type: 'pointerdown', ...paper },
    { type: 'pointerup', ...paper },
  ]);
  await expect(ring(page)).toHaveCount(0);
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  expect(await strokeCount(page)).toBe(0);

  // Jetzt liegt dort wieder das Papier, und der Stift schreibt.
  expect(await topmost(page, paper)).not.toBe('ring-schutz');
  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
});

test('a hand resting beside the ring does not close it, the pen still picks a colour', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();

  // Die Hand landet neben dem Ring, bevor der Stift einen Knopf erreicht: auf dem Schutzfeld über dem Papier.
  const hand = await page.evaluate(() => window.__notizbuch.toClient(200, 1000));
  expect(await topmost(page, hand)).toBe('ring-schutz');
  await onScreen(page, 'touch', [{ type: 'pointerdown', ...hand }]);
  await expect(ring(page)).toHaveCount(18);
  await tapTop(page, 'pen', im('Rot (offen)'));
  await expect(ring(page)).toHaveCount(0);
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  // Die Hand hebt ab, wo jetzt wieder das Papier liegt.
  await onScreen(page, 'touch', [{ type: 'pointerup', ...hand }]);
  await expect.poll(async () => ((await savedSettings(page))?.ink as { color?: string } | undefined)?.color).toBe('rot');
  expect(await strokeCount(page)).toBe(0);

  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect((await page.evaluate(() => window.__notizbuch.currentPage().strokes))[0]).toMatchObject({ color: 'rot' });
});

test('the ring stays on the screen when the wheel sits in a corner', async ({ page }) => {
  await openSeeded(page, DAY, { settings: { ...ON, quickSwitchPos: [0, 0] } });
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
  const boxes = await ring(page).evaluateAll((els) => els.map((el) => el.getBoundingClientRect().toJSON() as DOMRect));
  expect(boxes).toHaveLength(18);
  const { width, height } = page.viewportSize()!;
  for (const b of boxes) {
    expect(b.left).toBeGreaterThanOrEqual(0);
    expect(b.top).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(width);
    expect(b.bottom).toBeLessThanOrEqual(height);
    expect(b.width).toBeGreaterThanOrEqual(44);
    expect(b.height).toBeGreaterThanOrEqual(44);
  }
});

test('next and today in the ring change the page', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
  // Unten im Ring liest man ‹ Heute › von links nach rechts.
  const back = (await page.locator(im('Voriger Tag')).boundingBox())!;
  const forward = (await page.locator(im('Nächster Tag')).boundingBox())!;
  expect(back.x + back.width).toBeLessThanOrEqual(forward.x);
  await tapTop(page, 'touch', im('Nächster Tag'));
  await waitForPageOf(page, '2026-10-30');
  await expect(page).toHaveURL(/#\/tag\/2026-10-30$/);
  await expect(ring(page)).toHaveCount(0);

  await touch(page).tapOn(QUICK);
  await tapTop(page, 'touch', im('Heute'));
  await waitForPageOf(page, '2026-10-29');
  await expect(page).toHaveURL(/#\/tag\/2026-10-29$/);

  await touch(page).tapOn(QUICK);
  await tapTop(page, 'touch', im('Voriger Tag'));
  await waitForPageOf(page, '2026-10-28');
});

test('Vollbild aus in the ring brings the bars back', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await expect(page.locator('.ansichten')).toBeHidden();
  await touch(page).tapOn(QUICK);
  await tapTop(page, 'touch', im('Vollbild aus'));
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator('.werkzeuge')).toBeVisible();
  await expect(page.locator('main#app')).not.toHaveClass(/vollbild/);
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: false, werkzeuge: 'kreis' });

  // Ohne Vollbild ist das Rad wieder der Schnellwechsel von vorher: Ein Fingertipp öffnet nichts.
  await touch(page).tapOn(QUICK);
  await expect(ring(page)).toHaveCount(0);
});

test('on the office PC the ring only has paging and Vollbild aus', async ({ page }) => {
  await openSeeded(page, DAY, { device: 'Firmen-PC', settings: ON });
  // Das Rad wechselt hier kein Werkzeug: Es heißt nach dem, was es bietet.
  const wheel = page.getByTestId('quick-switch');
  await expect(wheel).toHaveAttribute('aria-label', 'Blättern und Ansicht');
  await expect(wheel).toHaveAttribute('title', 'Blättern und Ansicht');
  await expect(wheel).not.toHaveAttribute('data-tool');
  await wheel.click();
  await expect(ring(page).first()).toBeVisible();
  expect(await ringLabels(page)).toEqual(ONLY_VIEW);
  await expect(page.locator(im('Kugelschreiber'))).toHaveCount(0);
  // Auch dieser Ring liest sich unten ‹ Heute › von links nach rechts, Heute ganz unten.
  const back = (await page.locator(im('Voriger Tag')).boundingBox())!;
  const today = (await page.locator(im('Heute')).boundingBox())!;
  const forward = (await page.locator(im('Nächster Tag')).boundingBox())!;
  expect(back.x + back.width).toBeLessThanOrEqual(forward.x);
  expect(back.x + back.width).toBeLessThanOrEqual(today.x);
  expect(today.x + today.width).toBeLessThanOrEqual(forward.x);
  expect(today.y).toBeGreaterThan(Math.max(back.y, forward.y));

  await page.locator(im('Vollbild aus')).click();
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: false, werkzeuge: 'kreis' });
});

test('a palm on the wheel while the pen is down opens nothing', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  const c = await centerOf(page, QUICK);
  const hand = touch(page);
  const writer = pen(page);
  await hand.downOn(QUICK, c.x, c.y); // die Hand liegt schon auf dem Rad, dann setzt der Stift auf der Seite auf
  await writer.down(200, 1000);
  await writer.move(260, 1020);
  await hand.upOn(QUICK, c.x, c.y);
  await touch(page, 1).tapOn(QUICK); // noch eine Berührung, während der Stift schreibt
  await writer.up(260, 1020);
  await expect(ring(page)).toHaveCount(0);
  await expect.poll(() => strokeCount(page)).toBe(1); // geschrieben ist trotzdem

  await afterPalmWindow(page);
  await palm(page).tapOn(QUICK); // eine große Auflagefläche ist ein Handballen, auch nach der Pause
  await expect(ring(page)).toHaveCount(0);
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
});

// ---------- Was beim Ring nie schiefgehen darf ----------

test('the ring closes when the screen size changes', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await touch(page).tapOn(QUICK);
  await expect(ring(page).first()).toBeVisible();
  await page.setViewportSize({ width: 1700, height: 1200 }); // das iPad dreht sich
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  await expect(ring(page)).toHaveCount(0);
  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
});

test('after paging in the ring the next page takes the pen', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await holdWheel(page);
  await tapTop(page, 'pen', im('Nächster Tag'));
  await waitForPageOf(page, '2026-10-30');
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  const paper = await page.evaluate(() => window.__notizbuch.toClient(200, 1000));
  expect(await topmost(page, paper)).not.toBe('ring-schutz');
  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect(await pageKey(page)).toBe('2026-10-30');
});

test('a stroke that ends on the wheel opens nothing', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  const wheel = page.getByTestId('quick-switch');
  const c = await centerOf(page, QUICK);
  const writer = pen(page);
  await writer.down(200, 1000);
  await writer.move(260, 1020);
  // Der Strich endet über dem Rad. Ohne Zeigerfang landen seine letzten Ereignisse dort, und der Stift ruht dort länger als
  // HOLD_MS. Dass dabei nichts aufgeht, lässt sich nur nach dieser Zeit sagen.
  await writer.moveOn(QUICK, c.x, c.y);
  await page.waitForTimeout(HOLD_MS + 200);
  await writer.moveOn(QUICK, c.x + 2, c.y);
  await writer.upOn(QUICK, c.x + 2, c.y);
  await expect(ring(page)).toHaveCount(0);
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  await expect(wheel).toHaveAttribute('data-tool', 'pen');
});

test('an unreadable page still lets you leave fullscreen', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON, files: { [TAG]: BROKEN } });
  await expect(page.getByText(UNREADABLE)).toBeVisible();
  await expect(page.getByTestId('quick-switch')).toHaveAttribute('aria-label', 'Blättern und Ansicht');
  await pen(page).tapOn(QUICK); // ohne Schreiben öffnet auch der Stifttipp den Ring
  await expect(ring(page).first()).toBeVisible();
  expect(await ringLabels(page)).toEqual(ONLY_VIEW);
  await tapTop(page, 'pen', im('Vollbild aus'));
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: false, werkzeuge: 'kreis' });
});

test('a window that only reads can leave fullscreen without saving', async ({ context, page }) => {
  await openSeeded(page, DAY, { settings: ON });
  const second = await context.newPage();
  const errors: string[] = [];
  second.on('pageerror', (error) => errors.push(error.message));
  await shareRepos(page, second);
  await second.goto(`/notizbuch/${DAY}`);
  await second.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(second.locator('main#app')).toHaveClass(/vollbild/);
  await expect(second.getByText(OTHER_WINDOW, { exact: true })).toBeVisible();
  await expect(second.locator('.ansichten')).toBeHidden();

  await pen(second).tapOn(QUICK); // das Fenster schreibt nicht: Der Stifttipp öffnet den Ring
  await expect(ring(second).first()).toBeVisible();
  expect(await ringLabels(second)).toEqual(ONLY_VIEW);
  await tapTop(second, 'pen', im('Vollbild aus'));
  await expect(second.locator('.ansichten')).toBeVisible();
  await expect(second.locator('main#app')).not.toHaveClass(/vollbild/);

  // Gespeichert hat das zweite Fenster nichts. Was das erste danach speichert (der Radierer), ist da, das Vollbild bleibt an.
  await pen(page).tapOn(QUICK);
  await expect.poll(async () => ((await savedSettings(page))?.ink as { tool?: string } | undefined)?.tool).toBe('eraser');
  expect((await savedSettings(page))?.vollbild).toEqual({ an: true, werkzeuge: 'kreis' });
  await expect(page.locator('main#app')).toHaveClass(/vollbild/);
  expect(errors, 'unbehandelte Fehler im zweiten Fenster').toEqual([]);
});

// ---------- Die Lasche ----------

const TAB = { vollbild: { an: true, werkzeuge: 'tab' } };
const GRIFF = 'button.lasche';
const LEISTE = '.lasche-leiste';
const LASCHE_KNOPF = '.lasche-knopf';
const laBtn = (label: string) => `${LASCHE_KNOPF}[aria-label="${label}"]`;
const laLabels = (page: Page) => page.locator(LASCHE_KNOPF).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')));

test('the tab sits at the left edge and opens and closes', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  const handle = page.locator(GRIFF);
  await expect(handle).toHaveAttribute('aria-label', 'Werkzeuge');
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  const box = (await handle.boundingBox())!;
  expect(box.x).toBeLessThanOrEqual(8);
  const stage = (await page.locator('.buehne').boundingBox())!;
  expect(Math.abs(box.y + box.height / 2 - (stage.y + stage.height / 2))).toBeLessThanOrEqual(stage.height * 0.1);
  await expect(page.locator(LEISTE)).toHaveCount(0);

  await touch(page).tapOn(GRIFF);
  await expect(page.locator(LEISTE)).toBeVisible();
  await expect(page.locator(LEISTE)).toHaveAttribute('role', 'toolbar');
  await expect(page.locator(LEISTE)).toHaveAttribute('aria-label', 'Werkzeuge im Vollbild');
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  expect((await handle.boundingBox())!.x).toBeLessThanOrEqual(8);
  await touch(page).tapOn(GRIFF);
  await expect(page.locator(LEISTE)).toHaveCount(0);
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
});

test('a choice in the tab applies and keeps it open', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  await expect(page.locator(LEISTE)).toBeVisible();
  await touch(page).tapOn(laBtn('Blau'));
  await expect.poll(async () => ((await savedSettings(page))?.ink as { color?: string } | undefined)?.color).toBe('blau');
  await expect(page.locator(LEISTE)).toBeVisible();
  await expect(page.locator(laBtn('Blau'))).toHaveAttribute('aria-pressed', 'true');
  // Die Wahl zum Werkzeug wechselt mit ihm: Beim Radierer gibt es Größe und Art.
  await touch(page).tapOn(laBtn('Radierer'));
  await expect(page.locator(laBtn('Blau'))).toHaveCount(0);
  await expect(page.locator(LEISTE)).toBeVisible();
});

test('the tab shows the groups top to bottom', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  expect(await laLabels(page)).toEqual([
    'Kugelschreiber', 'Fineliner', 'Füllfeder', 'Radierer',
    'Schwarz', 'Blau', 'Rot (offen)', 'Grün (erledigt)',
    ...(await page.locator(`${LASCHE_KNOPF}[data-gruppe="breite"]`).evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') as string))),
    'Rückgängig', 'Wiederholen',
    'Voriger Tag', 'Heute', 'Nächster Tag',
    'Ganze Seite', 'Vollbild aus',
  ]);
});

test('writing on the page leaves the tab open', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  await expect(page.locator(LEISTE)).toBeVisible();
  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect(page.locator(LEISTE)).toBeVisible();
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
});

test('the quick switch stays in tab mode', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  const wheel = page.getByTestId('quick-switch');
  await expect(wheel).toHaveAttribute('aria-label', 'Werkzeug wechseln');
  await expect(wheel).toHaveAttribute('data-tool', 'pen');
  await pen(page).tapOn(QUICK);
  await expect(wheel).toHaveAttribute('data-tool', 'eraser');
  await afterPalmWindow(page);
  await touch(page).tapOn(QUICK); // ein Fingertipp öffnet hier nichts
  await expect(ring(page)).toHaveCount(0);
  await expect(wheel).toHaveAttribute('data-tool', 'eraser');
  await pen(page).tapOn(QUICK);
  await expect(wheel).toHaveAttribute('data-tool', 'pen');
});

test('a palm on the tab while the pen is down does nothing', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  const c = await centerOf(page, GRIFF);
  const hand = touch(page);
  const writer = pen(page);
  await hand.downOn(GRIFF, c.x, c.y); // die Hand liegt schon auf dem Griff, dann setzt der Stift auf der Seite auf
  await writer.down(200, 1000);
  await writer.move(260, 1020);
  await hand.upOn(GRIFF, c.x, c.y);
  await touch(page, 1).tapOn(GRIFF); // noch eine Berührung, während der Stift schreibt
  await writer.up(260, 1020);
  await expect(page.locator(LEISTE)).toHaveCount(0);
  await expect.poll(() => strokeCount(page)).toBe(1);

  await afterPalmWindow(page);
  await palm(page).tapOn(GRIFF); // eine große Auflagefläche ist ein Handballen
  await expect(page.locator(LEISTE)).toHaveCount(0);
  await touch(page).tapOn(GRIFF);
  await expect(page.locator(LEISTE)).toBeVisible();

  // Dasselbe auf einem Knopf der Leiste: Während der Stift schreibt, wählt die Hand nichts.
  const blue = await centerOf(page, laBtn('Blau'));
  await writer.down(200, 1000);
  await touch(page).downOn(laBtn('Blau'), blue.x, blue.y);
  await touch(page).upOn(laBtn('Blau'), blue.x, blue.y);
  await writer.up(200, 1000);
  await afterPalmWindow(page);
  await palm(page).tapOn(laBtn('Blau'));
  expect(((await savedSettings(page))?.ink as { color?: string } | undefined)?.color).not.toBe('blau');
});

test('on the office PC the tab only has paging and Vollbild aus', async ({ page }) => {
  await openSeeded(page, DAY, { device: 'Firmen-PC', settings: TAB });
  await expect(page.getByTestId('quick-switch')).toHaveCount(0);
  await page.locator(GRIFF).click();
  await expect(page.locator(LEISTE)).toBeVisible();
  expect(await laLabels(page)).toEqual(ONLY_VIEW);
  await page.locator(laBtn('Vollbild aus')).click();
  await expect(page.locator('.ansichten')).toBeVisible();
  await expect(page.locator(GRIFF)).toHaveCount(0);
  await expect.poll(async () => (await savedSettings(page))?.vollbild).toEqual({ an: false, werkzeuge: 'tab' });
});

test('paging in the tab changes the page and keeps the tab open', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  await mouse(page).tapOn(laBtn('Nächster Tag'));
  await waitForPageOf(page, '2026-10-30');
  await expect(page.locator(LEISTE)).toBeVisible();
});

test('every button in the tab is at least 44 points', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll('button.lasche, .lasche-knopf')].map((el) => {
      const r = el.getBoundingClientRect();
      return [r.width, r.height];
    }),
  );
  expect(sizes.length).toBeGreaterThan(10);
  for (const [w, h] of sizes) {
    expect(w).toBeGreaterThanOrEqual(44);
    expect(h).toBeGreaterThanOrEqual(44);
  }
});

test('a tall strip scrolls and the tab does not block the page', async ({ page }) => {
  await page.setViewportSize({ width: 1200, height: 500 });
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  const strip = page.locator(LEISTE);
  expect(await strip.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  expect(await strip.evaluate((el) => getComputedStyle(el).overflowY)).toBe('auto');
  expect((await topmost(page, { x: 600, y: 250 })) ?? '').not.toContain('lasche');
});

// ---------- Eine Hand, die schon lag, bevor der Stift schrieb ----------

/** Die Hand liegt auf `selector`, der Stift schreibt einen Strich, 300 ms später hebt die Hand ab: Sie war die Hand. */
async function restingHand(page: Page, selector: string): Promise<void> {
  const c = await centerOf(page, selector);
  const hand = touch(page);
  await hand.downOn(selector, c.x, c.y);
  await pen(page).stroke(LINE);
  await afterPalmWindow(page);
  await hand.upOn(selector, c.x, c.y);
}

test('a hand resting on the handle while the pen wrote does not toggle the tab', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await restingHand(page, GRIFF);
  await expect(page.locator(LEISTE)).toHaveCount(0);
  await touch(page).tapOn(GRIFF); // ein Fingertipp danach geht wie sonst
  await expect(page.locator(LEISTE)).toBeVisible();
});

test('a hand resting on a tab button while the pen wrote does nothing', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  await restingHand(page, laBtn('Rückgängig'));
  expect(await strokeCount(page)).toBe(1);
  await expect(page.locator(LEISTE)).toBeVisible();
  await restingHand(page, laBtn('Nächster Tag'));
  expect(await pageKey(page)).toBe('2026-10-29');
});

test('a finger held longer than a tap does not press a tab button', async ({ page }) => {
  await openSeeded(page, DAY, { settings: TAB });
  await touch(page).tapOn(GRIFF);
  const c = await centerOf(page, laBtn('Blau'));
  await touch(page).downOn(laBtn('Blau'), c.x, c.y);
  await page.waitForTimeout(700);
  await touch(page).upOn(laBtn('Blau'), c.x, c.y);
  await expect(page.locator(laBtn('Blau'))).toHaveAttribute('aria-pressed', 'false');
});

test('a hand resting on the wheel while the pen wrote does not open the ring', async ({ page }) => {
  await openSeeded(page, DAY, { settings: ON });
  await restingHand(page, QUICK);
  await expect(ring(page)).toHaveCount(0);
  await expect(page.locator(SCHUTZ)).toHaveCount(0);
  await strokeTop(page, 'pen', LINE);
  await expect.poll(() => strokeCount(page)).toBe(2);
});
