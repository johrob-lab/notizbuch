import { expect, test as base, type Page } from '@playwright/test';
import { changeStoredSettings, openSeeded, queued, shareRepos } from './helpers/app';
import { mockClaude, pngSize } from './helpers/claude';
import { centerOf, pen, touch, viewOf } from './helpers/pointer';
import { touchscreen, type Pt } from './helpers/touch';

// „Frag Claude“: der Knopf rechts außen in der Werkzeugleiste, im Rad und in der Lasche, und das Fenster, das über der Seite liegt
// und beim Blättern offen bleibt. GitHub antwortet aus einem Repo im Speicher (tests/e2e/helpers/app.ts), Claude aus
// tests/e2e/helpers/claude.ts: Es geht keine Anfrage ins Netz. Alles hier ist erfunden, auch der Schlüssel. Heute ist in allen
// Tests der 29.10.2026 (Wiener Zeit).

/** Jede Seite des Kontexts wird auf unbehandelte Fehler geprüft. Die Uhr steht fest, auch im zweiten Fenster. */
const test = base.extend<{ browserErrors: void; fixedToday: void }>({
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

const KI_KEY = 'sk-ant-test-0000';
const WITH_KEY = { settings: { kiKey: KI_KEY } };
const DAY = '#/tag/2026-10-29';
const BASE = '2026-10-29 0800 Abstimmung Beispiel 2027';
const MEETING = `#/besprechung/${encodeURIComponent(BASE)}/1`;
const FENSTER = '.frag-fenster';
const KNOPF = '.frag-claude';
/** Das Rad: der Schnellwechsel im Vollbild. */
const QUICK = '[data-testid="quick-switch"]';
const OTHER_WINDOW = 'Das Notizbuch ist schon in einem anderen Fenster offen.';
/** Ein Strich im unteren Teil der Tagesseite (Feld „Notizen“), weit weg vom Fenster. */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
/** So groß ist ein Handballen, der aufliegt (halbe Breite der Auflage): Das Tor nimmt bis 120 Punkte Breite als Finger. */
const PALM_RADIUS = 100;

const askButton = (page: Page) => page.getByRole('button', { name: 'Frag Claude', exact: true });
const askWindow = (page: Page) => page.locator(FENSTER);
const fragen = (page: Page) => askWindow(page).getByRole('button', { name: 'Fragen', exact: true });
const answers = (page: Page) => askWindow(page).locator('.frag-antwort');
const costs = (page: Page) => askWindow(page).locator('.frag-kosten');
const errorLine = (page: Page) => askWindow(page).locator('.frag-fehler');
const pageSwitch = (page: Page) => page.locator('.frag-seite');
const field = (page: Page) => page.locator('#frag-feld');
const link = (page: Page, name: string) => page.getByRole('link', { name, exact: true });
const go = (page: Page, hash: string) => page.evaluate((h) => void (window.location.hash = h), hash);
const opened = (page: Page) => page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
const waitForPageOf = (page: Page, key: string) => page.waitForFunction((k) => window.__notizbuch?.currentPage?.().key === k, key);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const box = async (page: Page, selector: string) => (await page.locator(selector).boundingBox())!;

async function toSettingsAndBack(page: Page): Promise<void> {
  await link(page, 'Einstellungen').click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await link(page, 'Tag').click();
  await opened(page);
}

test('Frag Claude is only there on the iPad with a key', async ({ page }) => {
  await mockClaude(page);
  await openSeeded(page, DAY);
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible();
  await expect(askButton(page)).toHaveCount(0);
  await expect(askWindow(page)).toHaveCount(0);

  await changeStoredSettings(page, { kiKey: KI_KEY });
  await page.reload();
  await opened(page);
  const inBar = page.locator('.leiste').getByRole('button', { name: 'Frag Claude', exact: true });
  await expect(inBar).toHaveCount(1);
  await expect(askButton(page)).toHaveCount(1);
  await expect(inBar).toHaveAttribute('title', 'Frag Claude');
  const bar = await box(page, '.leiste');
  const button = (await inBar.boundingBox())!;
  expect(button.x + button.width).toBeGreaterThanOrEqual(bar.x + bar.width - 13);

  await changeStoredSettings(page, { device: 'Firmen-PC' });
  await page.reload();
  await opened(page);
  await expect(askButton(page)).toHaveCount(0);
  await expect(askWindow(page)).toHaveCount(0);
});

test('the second window has no Frag Claude', async ({ context, page }) => {
  await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await expect(askButton(page)).toHaveCount(1);
  const second = await context.newPage();
  await mockClaude(second);
  await shareRepos(page, second);
  await second.goto(`/notizbuch/${DAY}`);
  await opened(second);
  await expect(second.getByText(OTHER_WINDOW, { exact: true })).toBeVisible();
  await expect(askButton(second)).toHaveCount(0);
  await expect(second.locator(FENSTER)).toHaveCount(0);
});

test('the toolbar stays one row with Frag Claude', async ({ page }) => {
  await mockClaude(page);
  await page.setViewportSize({ width: 744, height: 1133 });
  await openSeeded(page, DAY, WITH_KEY);
  for (const width of [744, 768, 810, 820, 834, 1180]) {
    await page.setViewportSize({ width, height: 1133 });
    for (const tool of ['Radierer', 'Kugelschreiber']) {
      const chosen = page.locator('.werkzeuge').getByRole('button', { name: tool, exact: true });
      await chosen.click();
      await expect(chosen).toHaveAttribute('aria-pressed', 'true');
      const at = `${width} Punkte, ${tool}`;
      expect((await box(page, '.leiste')).height, at).toBe(61);
      const ask = (await askButton(page).boundingBox())!;
      const undo = (await page.getByRole('button', { name: 'Rückgängig', exact: true }).boundingBox())!;
      expect(ask.x, at).toBeGreaterThanOrEqual(0);
      expect(ask.y, at).toBeGreaterThanOrEqual(0);
      expect(ask.x + ask.width, at).toBeLessThanOrEqual(width);
      expect(ask.y + ask.height, at).toBeLessThanOrEqual(1133);
      expect([ask.width, ask.height], at).toEqual([44, 44]);
      expect(ask.y, at).toBe(undo.y);
    }
  }
});

test('tapping Frag Claude opens the window and asks nothing', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await expect(askWindow(page)).toBeHidden();
  await touch(page).tapOn(KNOPF);
  await expect(askWindow(page)).toBeVisible();
  const shown = await box(page, FENSTER);
  const bar = await box(page, '.leiste');
  const tabs = await box(page, '.monatsreiter');
  expect(shown.y).toBeGreaterThanOrEqual(bar.y + bar.height);
  expect(shown.x + shown.width).toBeLessThanOrEqual(tabs.x);
  await expect(field(page)).toBeFocused();

  // Tippen, der Schalter, Blättern und die Einstellungen schicken nichts an Claude.
  await page.keyboard.type('Was steht an?');
  await expect(field(page)).toHaveValue('Was steht an?');
  await touch(page).tapOn('.frag-seite');
  await expect(pageSwitch(page)).toHaveAttribute('aria-checked', 'false');
  await link(page, 'Nächster Tag').click();
  await waitForPageOf(page, '2026-10-30');
  await toSettingsAndBack(page);
  await expect(askWindow(page)).toBeVisible();
  await page.waitForTimeout(300);
  expect(claude.requests).toEqual([]);
});

test('the window stays open across pages and names the open page', async ({ page }) => {
  await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await touch(page).tapOn(KNOPF);
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: Do 29.10.2026');
  await expect(pageSwitch(page)).toHaveAttribute('aria-checked', 'true');
  await page.keyboard.type('Was steht an?');

  await link(page, 'Nächster Tag').click();
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: Fr 30.10.2026');
  await link(page, 'Woche').click();
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: KW 44 2026');
  await link(page, 'Monat').click();
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: Oktober 2026');
  await go(page, MEETING);
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: Abstimmung Beispiel 2027, Seite 1');
  await expect(askWindow(page)).toBeVisible();

  await link(page, 'Einstellungen').click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(askWindow(page)).toBeHidden();
  await link(page, 'Tag').click();
  await opened(page);
  await expect(askWindow(page)).toBeVisible();
  await expect(field(page)).toHaveValue('Was steht an?');
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: Do 29.10.2026');
});

test('pen, finger and wheel on the window leave the page alone', async ({ page }) => {
  await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await touch(page).tapOn(KNOPF);
  await expect(askWindow(page)).toBeVisible();
  // Das Fenster liegt über der Seite: In seiner Mitte trifft ein Zeiger das Fenster, nicht die Fläche oder eine Karte.
  const c = await centerOf(page, FENSTER);
  expect(await page.evaluate(({ x, y }) => document.querySelector('.frag-fenster')!.contains(document.elementFromPoint(x, y)), c)).toBe(true);

  const strokes = await strokeCount(page);
  await pen(page).dragOn(FENSTER, 0, 120);
  expect(await strokeCount(page)).toBe(strokes);

  const before = await viewOf(page);
  await touch(page).dragOn(FENSTER, 0, -200);
  await page.mouse.move(c.x, c.y);
  await page.mouse.wheel(0, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await page.waitForTimeout(200);
  expect(await viewOf(page)).toEqual(before);
  expect(await strokeCount(page)).toBe(strokes);
});

test('a hand resting on Frag Claude while the pen wrote opens nothing', async ({ page }) => {
  await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  const c = await centerOf(page, KNOPF);
  const hand = touch(page);
  await hand.downOn(KNOPF, c.x, c.y);
  await pen(page).stroke(LINE);
  await page.waitForTimeout(300); // Finger gelten erst 250 ms nach dem Abheben des Stifts wieder
  await hand.upOn(KNOPF, c.x, c.y);
  await expect(askWindow(page)).toBeHidden();
  await touch(page).tapOn(KNOPF); // ein Fingertipp danach geht wie sonst
  await expect(askWindow(page)).toBeVisible();
});

// Echte Berührungen laufen durch dieselbe Kette wie am iPad: Zeigerereignisse, Berührungsereignisse und am Ende der Klick, der dem
// Feld den Fokus gibt (siehe tests/e2e/helpers/touch.ts).
test.describe('with a touch screen', () => {
  test.use({ hasTouch: true });

  const middle = async (page: Page, selector: string): Promise<Pt> => {
    const c = await centerOf(page, selector);
    return [c.x, c.y];
  };

  test('a palm opens nothing and gives the field no focus, a finger does', async ({ page }) => {
    await mockClaude(page);
    await openSeeded(page, DAY, WITH_KEY);
    const screen = await touchscreen(page);
    await screen.tap(await middle(page, KNOPF), { radius: PALM_RADIUS });
    await page.waitForTimeout(300);
    await expect(askWindow(page)).toBeHidden();
    await screen.tap(await middle(page, KNOPF));
    await expect(askWindow(page)).toBeVisible();
    await expect(field(page)).toBeFocused();

    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await expect(field(page)).not.toBeFocused();
    await screen.tap(await middle(page, '#frag-feld'), { radius: PALM_RADIUS });
    await page.waitForTimeout(300);
    await expect(field(page)).not.toBeFocused();
    await screen.tap(await middle(page, '#frag-feld'));
    await expect(field(page)).toBeFocused();
  });
});

test('Vollbild offers Frag Claude in the ring and the Lasche', async ({ page }) => {
  await mockClaude(page);
  await openSeeded(page, DAY, { settings: { kiKey: KI_KEY, vollbild: { an: true, werkzeuge: 'kreis' } } });
  await touch(page).tapOn(QUICK);
  await expect(page.locator('.ring-knopf').first()).toBeVisible();
  await touch(page).tapOn('.ring-knopf[aria-label="Frag Claude"]');
  await expect(page.locator('.ring-knopf')).toHaveCount(0);
  await expect(askWindow(page)).toBeVisible();
  expect((await box(page, FENSTER)).y).toBeGreaterThanOrEqual(60);
  await expect(field(page)).toBeFocused();

  await changeStoredSettings(page, { vollbild: { an: true, werkzeuge: 'tab' } });
  await page.reload();
  await opened(page);
  await touch(page).tapOn('button.lasche');
  const view = page.locator('.lasche-knopf[data-gruppe="ansicht"]');
  expect(await view.evaluateAll((els) => els.map((el) => el.getAttribute('aria-label')))).toEqual(['Ganze Seite', 'Frag Claude', 'Vollbild aus']);
  await touch(page).tapOn('.lasche-knopf[aria-label="Frag Claude"]');
  await expect(askWindow(page)).toBeVisible();
});

// ---------- Fragen und Antworten ----------

type Block = { type: string; text?: string; source?: { media_type: string; data: string } };
type Message = { role: string; content: string | Block[] };

/** Die Blöcke der letzten Nachricht einer Anfrage. */
const lastBlocks = (body: { messages: Message[] }): Block[] => body.messages.at(-1)!.content as Block[];
const textOf = (blocks: Block[]): string => blocks.find((block) => block.type === 'text')!.text!;

/** Öffnet das Fenster mit dem Knopf, sobald die offene Seite angemeldet ist: Der Schalter nennt sie (`label`). */
async function openAsk(page: Page, label: string): Promise<void> {
  await touch(page).tapOn(KNOPF);
  await expect(askWindow(page)).toBeVisible();
  await expect(pageSwitch(page)).toHaveAccessibleName(`Seite mitschicken: ${label}`);
}

/** Tippt ins Feld, schreibt die Frage und schickt sie mit Enter. */
async function askWithEnter(page: Page, question: string): Promise<void> {
  await field(page).click();
  await page.keyboard.type(question);
  await page.keyboard.press('Enter');
}

test('a question about the day page goes out with picture, note and meetings', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  // Die Karte „Besprechungen“ kennt den Termin des Tages: Er geht mit der Frage hinaus.
  await expect(page.locator('.karte.besprechungen')).toContainText('Abstimmung Beispiel 2027');
  await openAsk(page, 'Do 29.10.2026');
  await askWithEnter(page, 'Was steht heute an?');
  await expect(answers(page)).toHaveText(['Hallo.']);
  await expect(costs(page)).toHaveText(['≈ 1,1 Cent']);
  await expect(field(page)).toHaveValue('');

  expect(claude.requests).toHaveLength(1);
  const [request] = claude.requests;
  expect(request.url).toBe('https://api.anthropic.com/v1/messages');
  expect(request.headers).toMatchObject({
    'content-type': 'application/json',
    'x-api-key': KI_KEY,
    'anthropic-version': '2026-10-21',
    'anthropic-dangerous-direct-browser-access': 'true',
  });
  expect(request.body).toMatchObject({ model: 'claude-sonnet-5-5', max_tokens: 2048, stream: true, thinking: { type: 'between_tools' } });
  expect(request.body.system).toContain('Keine Gedankenstriche');
  expect(request.body.messages).toHaveLength(1);
  const [image, ...rest] = lastBlocks(request.body);
  expect(image.type).toBe('image');
  expect(image.source!.media_type).toBe('image/png');
  expect(pngSize(image.source!.data)).toEqual({ w: 1658, h: 2212 });
  const text = textOf(rest);
  expect(text.startsWith('Offene Seite: Tagesseite Do 29.10.2026\n\n')).toBe(true);
  expect(text).toContain('Tagesnotiz 2026-10-29, Anfang:');
  expect(text).toContain('- [ ] Liste Planobjekte ergänzen (fällig 30.10.)');
  expect(text).toContain('Karte „Besprechungen“ dieses Tages:\n- 08:00 · Abstimmung Beispiel 2027 · Musterstadt');
  expect(text.endsWith('\n\nFrage: Was steht heute an?')).toBe(true);
});

test('Haiku answers when chosen', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, { settings: { kiKey: KI_KEY, kiModel: 'haiku' } });
  await openAsk(page, 'Do 29.10.2026');
  await askWithEnter(page, 'Was steht an?');
  await expect(answers(page)).toHaveText(['Hallo.']);
  await expect(costs(page)).toHaveText(['unter 0,1 Cent']);
  expect(claude.requests.map((request) => request.body.model)).toEqual(['claude-haiku-5-5']);
});

test('errors keep the question', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  claude.next = { status: 401, type: 'authentication_error', message: 'invalid x-api-key' };
  await openAsk(page, 'Do 29.10.2026');
  await askWithEnter(page, 'Was steht an?');
  await expect(errorLine(page)).toHaveText('Der KI-Schlüssel passt nicht. Bitte in den Einstellungen prüfen.');
  await expect(field(page)).toHaveValue('Was steht an?');
  await expect(answers(page)).toHaveCount(0);

  claude.next = 'offline';
  await fragen(page).click();
  await expect(errorLine(page)).toHaveText('Ohne Netz kann Claude nicht antworten.');
  await expect(field(page)).toHaveValue('Was steht an?');
  await expect(answers(page)).toHaveCount(0);

  claude.next = { text: 'Jetzt.' };
  await fragen(page).click();
  await expect(answers(page)).toHaveText(['Jetzt.']);
  await expect(errorLine(page)).toHaveText('');
  await expect(field(page)).toHaveValue('');
  expect(claude.requests).toHaveLength(3);
});

test('a follow-up after paging sends the new page', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await openAsk(page, 'Do 29.10.2026');
  await askWithEnter(page, 'Was steht an?');
  await expect(costs(page)).toHaveCount(1);
  await link(page, 'Nächster Tag').click();
  await expect(pageSwitch(page)).toHaveAccessibleName('Seite mitschicken: Fr 30.10.2026');
  await askWithEnter(page, 'Und morgen?');
  await expect(costs(page)).toHaveCount(2);

  expect(claude.requests).toHaveLength(2);
  const { messages } = claude.requests[1].body as { messages: Message[] };
  expect(messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user']);
  const blocks = messages.flatMap((message) => (Array.isArray(message.content) ? message.content : []));
  expect(blocks.filter((block) => block.type === 'image')).toHaveLength(1);
  const last = messages[2].content as Block[];
  expect(last[0].type).toBe('image');
  expect(textOf(last).startsWith('Offene Seite: Tagesseite Fr 30.10.2026')).toBe(true);
  expect(textOf(last).endsWith('Frage: Und morgen?')).toBe(true);
  expect(textOf(messages[0].content as Block[]).startsWith('Offene Seite: Tagesseite Do 29.10.2026')).toBe(true);
  expect(messages[1].content).toBe('Hallo.');
  // Jede Runde nennt die Seite, die mit ihr ging, die neueste steht oben.
  await expect(askWindow(page).locator('.frag-wann')).toHaveText([/ · Fr 30\.10\.2026$/, / · Do 29\.10\.2026$/]);
});

test('a meeting page sends topic and time and no note', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await go(page, MEETING);
  await waitForPageOf(page, BASE);
  await openAsk(page, 'Abstimmung Beispiel 2027, Seite 1');
  await askWithEnter(page, 'Worum ging es?');
  await expect(costs(page)).toHaveCount(1);
  const text = textOf(lastBlocks(claude.requests[0].body));
  expect(text.startsWith('Offene Seite: Besprechung „Abstimmung Beispiel 2027“ am Do 29.10.2026 um 08:00, Seite 1')).toBe(true);
  expect(text).not.toContain('Tagesnotiz');
  expect(text.endsWith('Frage: Worum ging es?')).toBe(true);
});

// „In Ergänzungen übernehmen“: Die Zeilen kommen an „Ergänzungen“ der Tagesnotiz der Antwort, und nur dieser Tipp ändert eine Notiz.

const NOTE29 = '05 Daily Notes/2026-10-29.md';
const NOTE30 = '05 Daily Notes/2026-10-30.md';
const WEEK = '#/woche/2026-W44';
const ANSWER = 'Zwei Punkte:\n- [ ] Angebot prüfen\n- Termin mit Muster';
const take = (page: Page) => askWindow(page).getByRole('button', { name: 'In Ergänzungen übernehmen', exact: true });
const taken = (page: Page) => askWindow(page).getByRole('button', { name: 'Übernommen', exact: true });
/** Der Abschnitt „Ergänzungen“ einer Notiz als Zeilen ohne Leerzeilen. */
const ergaenzungen = (text: string) =>
  text
    .split(/^## /m)
    .find((part) => part.startsWith('Ergänzungen'))!
    .split('\n')
    .slice(1)
    .filter((line) => line.trim() !== '');
const expected = ['- Claude, 12:00: Was steht an?', '- Zwei Punkte:', '- [ ] Angebot prüfen', '- Termin mit Muster'];

test('Übernehmen writes into Ergänzungen and the card shows it', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  claude.next = { text: ANSWER };
  await openAsk(page, 'Do 29.10.2026');
  await askWithEnter(page, 'Was steht an?');
  await expect(costs(page)).toHaveCount(1);
  // Bis zum Tipp ändert sich nichts an der Notiz.
  expect((await queued(page))[NOTE29]).toBeUndefined();
  await take(page).click();
  await expect(taken(page)).toBeDisabled();
  const written = (await queued(page))[NOTE29];
  expect(ergaenzungen(written).slice(-4)).toEqual(expected);
  const card = page.getByRole('region', { name: 'Morgenbriefing' });
  await expect(card.getByRole('checkbox', { name: 'Angebot prüfen' })).toBeVisible();
  await expect(card).toContainText('Termin mit Muster');
});

test('after paging the answer still goes to its own day', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  claude.next = { text: ANSWER };
  await openAsk(page, 'Do 29.10.2026');
  await askWithEnter(page, 'Was steht an?');
  await expect(costs(page)).toHaveCount(1);
  await link(page, 'Nächster Tag').click();
  await waitForPageOf(page, '2026-10-30');
  await take(page).click();
  await expect(taken(page)).toBeDisabled();
  const changes = await queued(page);
  expect(ergaenzungen(changes[NOTE29]).slice(-4)).toEqual(expected);
  expect(changes[NOTE30]).toBeUndefined();
});

test('on a week page the answer goes to today', async ({ page }) => {
  const claude = await mockClaude(page);
  await openSeeded(page, DAY, WITH_KEY);
  await go(page, WEEK);
  await waitForPageOf(page, '2026-W44');
  claude.next = { text: ANSWER };
  await openAsk(page, 'KW 44 2026');
  await askWithEnter(page, 'Was steht an?');
  await expect(costs(page)).toHaveCount(1);
  await take(page).click();
  await expect(taken(page)).toBeDisabled();
  expect(ergaenzungen((await queued(page))[NOTE29]).slice(-4)).toEqual(expected);
});
