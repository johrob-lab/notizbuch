import { expect, test as base, type Page } from '@playwright/test';
import { openFresh, savedSettings } from './helpers/app';

// Die Einrichtung eines Geräts: Token, Repository, Gerät und Ablaufdatum. GitHub antwortet aus einem Repo im Speicher
// (tests/e2e/helpers/app.ts). Alles hier ist erfunden, auch die Token. Heute ist in allen Tests der 29.10.2026 (Wiener Zeit).

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und darauf, dass der Token nie in der Konsole landet.
 * Die Uhr steht fest.
 */
const test = base.extend<{ browserErrors: void; noBrowserDialogs: void; fixedToday: void }>({
  browserErrors: [
    async ({ page }, use) => {
      const lines: string[] = [];
      page.on('pageerror', (error) => lines.push(`Fehler: ${error.message}`));
      page.on('console', (message) => lines.push(`Konsole: ${message.text()}`));
      await use();
      expect(lines.filter((line) => line.startsWith('Fehler')), 'unbehandelte Fehler im Browser').toEqual([]);
      expect(lines.filter((line) => line.includes('github_pat_TEST')), 'ein Token in der Konsole').toEqual([]);
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

const TOKEN = 'github_pat_TEST_RICHTIG_0123456789';
const TEST_REPO = 'johrob-lab/2-gehirn-test';
const TODAY = '2026-10-29';
const DAY = `#/tag/${TODAY}`;

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const token = (page: Page) => page.getByLabel('Token', { exact: true });
const repository = (page: Page) => page.getByLabel('Repository', { exact: true });
const device = (page: Page) => page.getByLabel('Gerät', { exact: true });
const until = (page: Page) => page.getByLabel('Gültig bis', { exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Prüfen und speichern' });
const problem = (page: Page) => page.getByRole('alert');

async function fill(page: Page, o: { token?: string; repo?: string; device?: string; until?: string } = {}) {
  await token(page).fill(o.token ?? TOKEN);
  await repository(page).selectOption(o.repo ?? TEST_REPO);
  if (o.device !== undefined) await device(page).selectOption(o.device);
  if (o.until !== undefined) await until(page).fill(o.until);
}

async function fillAndSubmit(page: Page, o: Parameters<typeof fill>[1] = {}) {
  await fill(page, o);
  await submit(page).click();
}

const opened = (page: Page) => page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));

// ---------- Tests aus dem Brief ----------

test('wrong token stays on setup', async ({ page }) => {
  const repo = await openFresh(page, { tokens: [TOKEN] });
  await expect(page.getByRole('heading', { name: 'Notizbuch einrichten' })).toBeVisible();
  await fillAndSubmit(page, { token: 'github_pat_TEST_FALSCH' });
  await expect(problem(page)).toHaveText('Der Zugang klappt nicht. Bitte Token prüfen.');
  // Die Einrichtung bleibt offen, nichts ist gespeichert, und GitHub wurde genau einmal gefragt, mit dem getippten Token.
  await expect(token(page)).toBeVisible();
  await expect(submit(page)).toBeEnabled();
  expect(await hash(page)).not.toContain('#/tag/');
  expect(await savedSettings(page)).toBeNull();
  expect(repo.used).toEqual(['github_pat_TEST_FALSCH']);
  // Mit dem richtigen Token geht es weiter, ohne neu zu tippen, was richtig war.
  await expect(repository(page)).toHaveValue(TEST_REPO);
  await token(page).fill(TOKEN);
  await submit(page).click();
  await expect.poll(() => hash(page)).toBe(DAY);
});

test('right token opens today', async ({ page }) => {
  const repo = await openFresh(page, { tokens: [TOKEN] });
  await fillAndSubmit(page);
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  await expect(page.getByTestId('status')).toHaveText('Gesichert');
  await expect(page.getByTestId('surface')).toHaveCount(1);
  await expect(page.getByRole('heading', { name: 'Notizbuch einrichten' })).toHaveCount(0);
  expect(await savedSettings(page)).toEqual({
    token: TOKEN,
    repo: TEST_REPO,
    device: 'iPad',
    smoothing: 'mittel',
    prediction: true,
    tokenExpiry: '2027-10-29',
  });
  expect(repo.unhandled).toEqual([]);
  expect(repo.used.every((used) => used === TOKEN)).toBe(true);
});

test('token is not shown again', async ({ page }) => {
  await openFresh(page, { tokens: [TOKEN] });
  await fillAndSubmit(page);
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  const leaks = async () => ({
    markup: (await page.content()).includes(TOKEN),
    text: (await page.evaluate(() => document.body.innerText)).includes(TOKEN),
    values: await page.evaluate((secret) => [...document.querySelectorAll('input, textarea, select')].some((el) => (el as HTMLInputElement).value.includes(secret)), TOKEN),
    password: await page.locator('input[type="password"]').count(),
  });
  expect(await leaks()).toEqual({ markup: false, text: false, values: false, password: 0 });

  // In den Einstellungen steht nur, dass der Token gespeichert ist, und bis wann er gilt.
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await expect(page.getByText('gespeichert, gültig bis 29.10.2027', { exact: true })).toBeVisible();
  expect(await leaks()).toEqual({ markup: false, text: false, values: false, password: 0 });

  // Auch das Formular zum Ändern fängt leer an.
  await page.getByRole('button', { name: 'Zugang ändern' }).click();
  await expect(token(page)).toHaveValue('');
  expect((await leaks()).markup).toBe(false);
  expect((await leaks()).values).toBe(false);

  // Und nach dem Neuladen ebenso
  await page.reload();
  await page.getByRole('button', { name: 'Zugang ändern' }).click();
  await expect(token(page)).toHaveValue('');
  expect(await leaks()).toMatchObject({ markup: false, text: false, values: false });
});

// ---------- Das Formular ----------

test('the token is a password field that the browser does not fill in or remember', async ({ page }) => {
  await openFresh(page);
  await expect(token(page)).toHaveAttribute('type', 'password');
  await expect(token(page)).toHaveAttribute('autocomplete', 'off');
  await expect(token(page)).toHaveValue('');
});

test('the repository and the device come from a short list, and the expiry starts a year from today', async ({ page }) => {
  await openFresh(page);
  await expect(repository(page).locator('option')).toHaveText(['johrob-lab/2-gehirn', 'johrob-lab/2-gehirn-test']);
  await expect(device(page).locator('option')).toHaveText(['iPad', 'Firmen-PC']);
  await expect(device(page)).toHaveValue('iPad');
  await expect(until(page)).toHaveValue('2027-10-29');
  await expect(until(page)).toHaveAttribute('type', 'date');
  await expect(until(page)).toHaveAttribute('required', '');
});

test('the controls are big enough to hit with a finger', async ({ page }) => {
  await openFresh(page);
  for (const control of [token(page), repository(page), device(page), until(page), submit(page)]) {
    const box = (await control.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
  }
});

test('the device that is chosen is the device that is saved', async ({ page }) => {
  await openFresh(page);
  await fillAndSubmit(page, { device: 'Firmen-PC' });
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  expect((await savedSettings(page))?.device).toBe('Firmen-PC');
  // Am Firmen-PC gibt es keine Werkzeuge
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toHaveCount(0);
});

test('the other repository can be chosen, too', async ({ page }) => {
  const repo = await openFresh(page, { repo: 'johrob-lab/2-gehirn' });
  await fillAndSubmit(page, { repo: 'johrob-lab/2-gehirn' });
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  expect((await savedSettings(page))?.repo).toBe('johrob-lab/2-gehirn');
  expect(repo.requests.length).toBeGreaterThan(0);
});

// ---------- Was nicht geht ----------

test('a token with characters that cannot be part of a token is refused before GitHub is asked', async ({ page }) => {
  const repo = await openFresh(page);
  const bad = 'Der Token enthält ungültige Zeichen.';
  await fillAndSubmit(page, { token: 'github pat TEST' });
  await expect(problem(page)).toHaveText(bad);
  await token(page).fill('github_pat_TÖST');
  await submit(page).click();
  await expect(problem(page)).toHaveText(bad);
  await token(page).fill('github_pat_TEST\u200b'); // ein unsichtbares Zeichen, wie es beim Kopieren mitkommen kann
  await submit(page).click();
  await expect(problem(page)).toHaveText(bad);
  expect(repo.requests).toEqual([]);
  expect(await savedSettings(page)).toBeNull();
});

test('an empty token asks for a token', async ({ page }) => {
  const repo = await openFresh(page);
  await fillAndSubmit(page, { token: '   ' });
  await expect(problem(page)).toHaveText('Bitte den Token eingeben.');
  expect(repo.requests).toEqual([]);
});

test('spaces around a pasted token are not part of it', async ({ page }) => {
  const repo = await openFresh(page, { tokens: [TOKEN] });
  await fillAndSubmit(page, { token: `   ${TOKEN}  ` });
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  expect((await savedSettings(page))?.token).toBe(TOKEN);
  expect(repo.used.every((used) => used === TOKEN)).toBe(true);
});

test('a token that may only read is told what to choose, and nothing is saved', async ({ page }) => {
  await openFresh(page, { canWrite: false });
  await fillAndSubmit(page);
  await expect(problem(page)).toHaveText('Der Token darf nicht schreiben. Bitte beim Token „Contents: Read and write“ wählen.');
  expect(await savedSettings(page)).toBeNull();
  expect(await hash(page)).not.toContain('#/tag/');
});

test('without a connection the setup says so and can be tried again', async ({ page }) => {
  const repo = await openFresh(page);
  repo.offline = true;
  await fillAndSubmit(page);
  await expect(problem(page)).toHaveText('Keine Verbindung. Bitte später noch einmal.');
  expect(await savedSettings(page)).toBeNull();
  await expect(submit(page)).toBeEnabled();
  repo.offline = false;
  await submit(page).click();
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  expect(await savedSettings(page)).not.toBeNull();
});

test('an unexpected answer of GitHub is a plain failure, with no part of the answer or the token in the text', async ({ page }) => {
  const repo = await openFresh(page);
  repo.checkStatus = 500;
  await fillAndSubmit(page);
  await expect(problem(page)).toHaveText('Das hat nicht geklappt. Bitte noch einmal versuchen.');
  expect(await problem(page).innerText()).not.toContain(TOKEN);
  expect(await savedSettings(page)).toBeNull();
});

test('the expiry has to be a day after today', async ({ page }) => {
  const repo = await openFresh(page);
  await fill(page);
  await until(page).fill(TODAY);
  await submit(page).click();
  await expect(problem(page)).toHaveText('Das Ablaufdatum muss in der Zukunft liegen.');
  await until(page).fill('2026-10-28');
  await submit(page).click();
  await expect(problem(page)).toHaveText('Das Ablaufdatum muss in der Zukunft liegen.');
  await until(page).fill('');
  await submit(page).click();
  await expect(problem(page)).toHaveText('Bitte das Ablaufdatum des Tokens eintragen.');
  expect(repo.requests).toEqual([]);
  expect(await savedSettings(page)).toBeNull();
  // Morgen ist in Ordnung, und das Datum wird so gespeichert, wie es getippt wurde
  await until(page).fill('2026-10-30');
  await submit(page).click();
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  expect((await savedSettings(page))?.tokenExpiry).toBe('2026-10-30');
});

test('the problem goes away when the form is sent again and works', async ({ page }) => {
  await openFresh(page, { tokens: [TOKEN] });
  await fillAndSubmit(page, { token: 'github_pat_TEST_FALSCH' });
  await expect(problem(page)).toHaveText('Der Zugang klappt nicht. Bitte Token prüfen.');
  await token(page).fill(TOKEN);
  await submit(page).click();
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  await expect(page.getByRole('alert').filter({ hasText: 'Der Zugang klappt nicht' })).toHaveCount(0);
});

// ---------- Danach ----------

test('a device that is set up opens the app, not the setup, also after a reload', async ({ page }) => {
  await openFresh(page, { tokens: [TOKEN] });
  await fillAndSubmit(page);
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  await page.reload();
  await opened(page);
  await expect(page.getByRole('heading', { name: 'Notizbuch einrichten' })).toHaveCount(0);
  await expect(page.getByTestId('surface')).toHaveCount(1);
});

test('the saved settings have exactly these fields, and the token is in no other storage of the browser', async ({ page }) => {
  await openFresh(page);
  await fillAndSubmit(page);
  await expect.poll(() => hash(page)).toBe(DAY);
  await opened(page);
  expect(Object.keys((await savedSettings(page)) ?? {}).sort()).toEqual(['device', 'prediction', 'repo', 'smoothing', 'token', 'tokenExpiry']);
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
  expect(storage).not.toContain('github_pat_TEST');
  const cookies = await page.context().cookies();
  expect(JSON.stringify(cookies)).not.toContain('github_pat_TEST');
});
