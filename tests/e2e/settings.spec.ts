import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { addRepo, bringToForeground, lastHead, localFiles, networkBack, openSeeded, queueChange, queued, savedSettings, sendToBackground, type OpenOptions } from './helpers/app';
import { pen } from './helpers/pointer';

// Die Einstellungen: Glättung, Vorhersage, Gerät und der Zugang. GitHub antwortet aus Repos im Speicher
// (tests/e2e/helpers/app.ts). Alles hier ist erfunden, auch die Token. Heute ist in allen Tests der 29.10.2026 (Wiener Zeit).

/** Jeder Test achtet auf Fehler im Browser und darauf, dass kein Token in der Konsole landet. Die Uhr steht fest. */
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

const OLD_REPO = 'johrob-lab/2-gehirn-test';
const NEW_REPO = 'johrob-lab/2-gehirn';
const OLD_TOKEN = 'github_pat_TEST_ALT_0123456789';
const NEW_TOKEN = 'github_pat_TEST_NEU_0123456789';
const DAY = '#/tag/2026-10-29';
const NOTE = '05 Daily Notes/2026-10-29.md';
const TAG = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const NAME1 = 'Liste Planobjekte ergänzen (fällig 30.10.)';
/** Eine Notiz, die es auf GitHub noch nicht gibt: Sie wird in die Warteschlange gestellt, während der Wechsel läuft. */
const LATE = '05 Daily Notes/2026-10-30.md';
/** Ein Strich im unteren Teil der Tagesseite (Feld „Notizen“). */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
/** Ein Zickzack mit Ausschlägen von 40 Einheiten: Je stärker die Glättung, desto flacher wird er. */
const zigzag = (y: number): [number, number][] => Array.from({ length: 21 }, (_, i): [number, number] => [200 + i * 20, y + (i % 2 === 0 ? 0 : 40)]);
const WARNING = (day: string) => `Dein Zugang läuft am ${day} ab. Bitte rechtzeitig erneuern.`;
/** Die Notiz des Tages in dem Repo, zu dem gewechselt wird. */
const OTHER_NOTE = ['---', 'date: 2026-10-29', 'tags: [daily]', '---', '# 2026-10-29', '', '## Morgenbriefing (automatisch)', '', '- [ ] Aufgabe aus dem anderen Repo %%todo:AAMkNEU1%%', ''].join('\n');

/** Ein eingerichtetes Gerät mit Zugang zum Test-Repo, gültig bis zum 29.10.2027, geöffnet auf der Tagesseite. */
const open = (page: Page, o: OpenOptions = {}) =>
  openSeeded(page, DAY, { repo: OLD_REPO, token: OLD_TOKEN, ...o, settings: { tokenExpiry: '2027-10-29', ...o.settings } });

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const toSettings = async (page: Page) => {
  await page.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
};
const toDay = (page: Page) => page.getByRole('link', { name: 'Tag', exact: true }).click();
const group = (page: Page, name: string): Locator => page.getByRole('group', { name });
const choose = (page: Page, name: string, option: string) => group(page, name).getByRole('radio', { name: option, exact: true }).check();
const saved = async (page: Page, key: string) => (await savedSettings(page))?.[key];
const token = (page: Page) => page.getByLabel('Token', { exact: true });
const repository = (page: Page) => page.getByLabel('Repository', { exact: true });
const until = (page: Page) => page.getByLabel('Gültig bis', { exact: true });
const submit = (page: Page) => page.getByRole('button', { name: 'Prüfen und speichern' });
const change = (page: Page) => page.getByRole('button', { name: 'Zugang ändern' });
const problem = (page: Page) => page.getByRole('alert').filter({ hasText: /\S/ });
const notice = (page: Page, text: string) => page.locator('.meldung', { hasText: text });
const status = (page: Page) => page.getByTestId('status');
const strokeYs = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.map((s) => s.pts.map((p) => p.y)));
const amplitude = (ys: number[]) => Math.max(...ys) - Math.min(...ys);

// ---------- Die Seite ----------

test('the settings page shows the choices of this device and the access, without the token', async ({ page }) => {
  await open(page);
  await toSettings(page);
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(group(page, 'Glättung').locator('label')).toHaveText(['aus', 'leicht', 'mittel', 'stark']);
  await expect(group(page, 'Vorhersage').locator('label')).toHaveText(['an', 'aus']);
  await expect(group(page, 'Gerät').locator('label')).toHaveText(['iPad', 'Firmen-PC']);
  await expect(group(page, 'Glättung').getByRole('radio', { name: 'mittel' })).toBeChecked();
  await expect(group(page, 'Vorhersage').getByRole('radio', { name: 'an' })).toBeChecked();
  await expect(group(page, 'Gerät').getByRole('radio', { name: 'iPad' })).toBeChecked();
  await expect(page.getByRole('heading', { name: 'Zugang' })).toBeVisible();
  await expect(page.getByText('gespeichert, gültig bis 29.10.2027', { exact: true })).toBeVisible();
  await expect(page.getByText(OLD_REPO, { exact: true })).toBeVisible();
  await expect(change(page)).toBeVisible();
  // Kein Token, kein Feld für ihn und keine Warnung, solange das Ablaufdatum weit weg ist
  expect(await page.content()).not.toContain(OLD_TOKEN);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain(OLD_TOKEN);
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
  await expect(page.locator('.einstellungen .ablauf')).toHaveCount(0);
  // Die Seite hat keine Schreibfläche und keine Monatsreiter
  await expect(page.getByTestId('surface')).toHaveCount(0);
  await expect(status(page)).toHaveText('Gesichert');
});

test('the choices are big enough to hit with a finger', async ({ page }) => {
  await open(page);
  await toSettings(page);
  for (const name of ['Glättung', 'Vorhersage', 'Gerät']) {
    const labels = group(page, name).locator('label');
    for (let i = 0; i < (await labels.count()); i++) {
      const box = (await labels.nth(i).boundingBox())!;
      expect(box.height, `${name} ${i}`).toBeGreaterThanOrEqual(44);
      expect(box.width, `${name} ${i}`).toBeGreaterThanOrEqual(44);
    }
  }
  const button = (await change(page).boundingBox())!;
  expect(button.height).toBeGreaterThanOrEqual(44);
});

test('a device saved without an expiry says only that the token is saved', async ({ page }) => {
  await openSeeded(page, DAY, { repo: OLD_REPO, token: OLD_TOKEN });
  await toSettings(page);
  await expect(page.getByText('gespeichert', { exact: true })).toBeVisible();
  await expect(page.getByText('gültig bis')).toHaveCount(0);
});

// ---------- Glättung, Vorhersage, Gerät ----------

test('smoothing applies at once to the next stroke and is saved', async ({ page }) => {
  await open(page);
  await toSettings(page);
  await choose(page, 'Glättung', 'aus');
  await expect.poll(() => saved(page, 'smoothing')).toBe('aus');
  await toDay(page);
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await pen(page).stroke(zigzag(1000));
  const [rough] = await strokeYs(page);
  expect(amplitude(rough)).toBeGreaterThan(35); // ohne Glättung bleibt der Zickzack, wie er gezeichnet wurde

  await toSettings(page);
  await choose(page, 'Glättung', 'stark');
  await expect.poll(() => saved(page, 'smoothing')).toBe('stark');
  await toDay(page);
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect.poll(async () => (await strokeYs(page)).length).toBe(1); // der erste Strich ist wieder da
  await pen(page).stroke(zigzag(1100));
  const strokes = await strokeYs(page);
  expect(strokes).toHaveLength(2);
  expect(amplitude(strokes[1])).toBeLessThan(amplitude(rough) * 0.6); // ohne Neuladen: die neue Glättung gilt
});

test('prediction and device are saved, and the device applies at once', async ({ page }) => {
  const repo = await open(page);
  await toSettings(page);
  await choose(page, 'Vorhersage', 'aus');
  await expect.poll(() => saved(page, 'prediction')).toBe(false);
  await choose(page, 'Gerät', 'Firmen-PC');
  await expect.poll(() => saved(page, 'device')).toBe('Firmen-PC');
  await expect(group(page, 'Vorhersage').getByRole('radio', { name: 'aus' })).toBeChecked();
  await expect(group(page, 'Gerät').getByRole('radio', { name: 'Firmen-PC' })).toBeChecked();
  // Am Firmen-PC gibt es keine Werkzeuge, ohne dass die App neu geladen wurde
  await toDay(page);
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toHaveCount(0);
  // Abhaken geht dort, und der Commit nennt das neue Gerät
  await page.getByRole('checkbox', { name: NAME1, exact: true }).check();
  await expect.poll(() => repo.puts.map((p) => p.message)).toEqual(['Notizbuch: 2026-10-29.md (Firmen-PC)']);
  // und zurück an das iPad
  await toSettings(page);
  await choose(page, 'Gerät', 'iPad');
  await expect.poll(() => saved(page, 'device')).toBe('iPad');
  await toDay(page);
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible();
});

test('the choices survive a reload, and the other settings are not touched', async ({ page }) => {
  await open(page, { settings: { quickSwitchPos: [0.3, 0.7] } });
  await toSettings(page);
  await choose(page, 'Glättung', 'leicht');
  await choose(page, 'Vorhersage', 'aus');
  await choose(page, 'Gerät', 'Firmen-PC');
  await expect.poll(() => saved(page, 'device')).toBe('Firmen-PC');
  await expect.poll(() => saved(page, 'smoothing')).toBe('leicht');
  await expect.poll(() => saved(page, 'prediction')).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await expect(group(page, 'Glättung').getByRole('radio', { name: 'leicht' })).toBeChecked();
  await expect(group(page, 'Vorhersage').getByRole('radio', { name: 'aus' })).toBeChecked();
  await expect(group(page, 'Gerät').getByRole('radio', { name: 'Firmen-PC' })).toBeChecked();
  expect(await savedSettings(page)).toEqual({
    token: OLD_TOKEN,
    repo: OLD_REPO,
    device: 'Firmen-PC',
    smoothing: 'leicht',
    prediction: false,
    quickSwitchPos: [0.3, 0.7],
    tokenExpiry: '2027-10-29',
  });
});

test('a choice that can not be saved is taken back and says so, and works again when saving works', async ({ page }) => {
  const repo = await open(page);
  await toSettings(page);
  // Der Speicher des Browsers nimmt die Einstellungen nicht an (zum Beispiel, weil er voll ist). Alles andere schreibt weiter.
  await page.evaluate(() => {
    const original = IDBObjectStore.prototype.put;
    Object.assign(window, {
      restorePut: () => {
        IDBObjectStore.prototype.put = original;
      },
    });
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === 'settings') throw new DOMException('Der Speicher ist voll.', 'QuotaExceededError');
      return original.call(this, value, key);
    };
  });
  const radio = (name: string, option: string) => group(page, name).getByRole('radio', { name: option, exact: true });
  await radio('Glättung', 'stark').click();
  await expect(problem(page)).toHaveText('Das hat nicht geklappt. Bitte noch einmal versuchen.');
  await expect(radio('Glättung', 'mittel')).toBeChecked();
  expect(await saved(page, 'smoothing')).toBe('mittel');

  // Ein Gerät, das sich nicht speichern ließ, gilt auch nicht: Die Werkzeuge bleiben, und der Commit nennt das iPad
  await radio('Gerät', 'Firmen-PC').click();
  await expect(problem(page)).toHaveText('Das hat nicht geklappt. Bitte noch einmal versuchen.');
  await expect(radio('Gerät', 'iPad')).toBeChecked();
  await toDay(page);
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(page.getByRole('toolbar', { name: 'Werkzeuge' })).toBeVisible();
  await page.getByRole('checkbox', { name: NAME1, exact: true }).check();
  await expect.poll(() => repo.puts.map((p) => p.message)).toEqual(['Notizbuch: 2026-10-29.md (iPad)']);

  // Geht das Speichern wieder, gilt die Wahl, und die Meldung ist weg
  await page.evaluate(() => (window as unknown as { restorePut(): void }).restorePut());
  await toSettings(page);
  await radio('Glättung', 'stark').click();
  await expect.poll(() => saved(page, 'smoothing')).toBe('stark');
  await expect(radio('Glättung', 'stark')).toBeChecked();
  await expect(problem(page)).toHaveCount(0);
});

// ---------- Das Ablaufdatum ----------

test('the expiry notice shows once per start, and the settings always show it', async ({ page }) => {
  await open(page, { settings: { tokenExpiry: '2026-11-05' } });
  const text = WARNING('05.11.2026');
  await expect(notice(page, text)).toBeVisible();
  await expect(notice(page, text)).toHaveAttribute('role', 'status');
  await notice(page, text).getByRole('button', { name: 'Hinweis schließen' }).click();
  await expect(notice(page, text)).toHaveCount(0);
  // Blättern ist kein neuer Start
  await page.getByRole('link', { name: 'Woche', exact: true }).click();
  await page.getByRole('link', { name: 'Tag', exact: true }).click();
  await expect(notice(page, text)).toHaveCount(0);
  // Die Einstellungen zeigen die Warnung dauerhaft, auch wenn der Hinweis geschlossen ist
  await toSettings(page);
  await expect(page.locator('.einstellungen .ablauf')).toHaveText(text);
  await expect(page.getByText('gespeichert, gültig bis 05.11.2026', { exact: true })).toBeVisible();
  await expect(notice(page, text)).toHaveCount(0);
  // Ein Neustart zeigt den Hinweis wieder
  await page.reload();
  await expect(notice(page, text)).toBeVisible();
});

test('an expiry 14 days away has a notice', async ({ page }) => {
  await open(page, { settings: { tokenExpiry: '2026-11-12' } });
  await expect(notice(page, WARNING('12.11.2026'))).toBeVisible();
});

test('an expiry 15 days away has no notice and no warning', async ({ page }) => {
  await open(page, { settings: { tokenExpiry: '2026-11-13' } });
  await expect(status(page)).toHaveText('Gesichert');
  await expect(page.locator('.meldung')).toHaveCount(0);
  await toSettings(page);
  await expect(page.locator('.einstellungen .ablauf')).toHaveCount(0);
});

test('an expiry that has passed is warned about, too', async ({ page }) => {
  await open(page, { settings: { tokenExpiry: '2026-10-01' } });
  await expect(notice(page, WARNING('01.10.2026'))).toBeVisible();
});

test('a device saved without an expiry has no notice', async ({ page }) => {
  await openSeeded(page, DAY, { repo: OLD_REPO, token: OLD_TOKEN });
  await expect(status(page)).toHaveText('Gesichert');
  await expect(page.locator('.meldung')).toHaveCount(0);
});

// ---------- Der Zugang ----------

test('the status Zugang erneuern leads to the settings, where a new token fixes it', async ({ page }) => {
  const repo = await open(page);
  repo.tokens = [NEW_TOKEN]; // GitHub kennt den gespeicherten Token nicht mehr
  await bringToForeground(page);
  await expect(status(page)).toHaveText('Zugang erneuern');
  await status(page).getByRole('link', { name: 'Zugang erneuern' }).click();
  await expect.poll(() => hash(page)).toBe('#/einstellungen');
  await expect(page.getByRole('heading', { name: 'Einstellungen' })).toBeVisible();
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await submit(page).click();
  await expect(change(page)).toBeVisible(); // das Formular ist zu
  await expect(status(page)).toHaveText('Gesichert');
  expect(repo.used.at(-1)).toBe(NEW_TOKEN);
  expect(await saved(page, 'token')).toBe(NEW_TOKEN);
});

test('a new token keeps the local data and uploads the queue with the new token', async ({ page }) => {
  const repo = await open(page);
  await expect.poll(() => localFiles(page)).toContain(NOTE);
  repo.tokens = [NEW_TOKEN];
  // Ein Strich, solange GitHub den Token ablehnt: Er wartet in der Warteschlange.
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect(status(page)).toHaveText('Zugang erneuern');
  expect(Object.keys(await queued(page))).toEqual([TAG]);
  const filesBefore = await localFiles(page);

  await status(page).getByRole('link', { name: 'Zugang erneuern' }).click();
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await until(page).fill('2028-01-15');
  await submit(page).click();

  await expect(page.getByText('gespeichert, gültig bis 15.01.2028', { exact: true })).toBeVisible();
  await expect(status(page)).toHaveText('Gesichert');
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([TAG]); // mit dem neuen Token hochgeladen
  await expect.poll(() => queued(page)).toEqual({});
  expect(repo.used.at(-1)).toBe(NEW_TOKEN);
  expect(await localFiles(page)).toEqual(expect.arrayContaining(filesBefore)); // nichts wurde gelöscht
  expect(await savedSettings(page)).toMatchObject({ token: NEW_TOKEN, repo: OLD_REPO, tokenExpiry: '2028-01-15', device: 'iPad' });
});

test('a new expiry removes the warning', async ({ page }) => {
  await open(page, { settings: { tokenExpiry: '2026-11-05' } });
  await expect(notice(page, WARNING('05.11.2026'))).toBeVisible();
  await toSettings(page);
  await expect(page.locator('.einstellungen .ablauf')).toBeVisible();
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await submit(page).click(); // Gültig bis steht auf heute in einem Jahr
  await expect(page.getByText('gespeichert, gültig bis 29.10.2027', { exact: true })).toBeVisible();
  await expect(page.locator('.einstellungen .ablauf')).toHaveCount(0);
  await expect(notice(page, WARNING('05.11.2026'))).toHaveCount(0);
});

test('a wrong new token changes nothing', async ({ page }) => {
  const repo = await open(page);
  repo.tokens = [OLD_TOKEN];
  await toSettings(page);
  await change(page).click();
  await token(page).fill('github_pat_TEST_FALSCH');
  await submit(page).click();
  await expect(problem(page)).toHaveText('Der Zugang klappt nicht. Bitte Token prüfen.');
  expect(await savedSettings(page)).toMatchObject({ token: OLD_TOKEN, repo: OLD_REPO, tokenExpiry: '2027-10-29' });
  await expect(token(page)).toBeVisible(); // das Formular bleibt offen
  await expect(status(page)).toHaveText('Gesichert'); // der alte Zugang arbeitet weiter
});

test('the form for a new access starts empty, with the repository and a year from today, and can be closed', async ({ page }) => {
  await open(page);
  await toSettings(page);
  await change(page).click();
  await expect(token(page)).toHaveValue('');
  await expect(token(page)).toHaveAttribute('type', 'password');
  await expect(token(page)).toHaveAttribute('autocomplete', 'off');
  await expect(repository(page)).toHaveValue(OLD_REPO);
  await expect(repository(page).locator('option')).toHaveText(['johrob-lab/2-gehirn', 'johrob-lab/2-gehirn-test']);
  await expect(until(page)).toHaveValue('2027-10-29');
  await expect(page.getByLabel('Gerät', { exact: true })).toHaveCount(0); // das Gerät steht darüber bei den anderen Einstellungen
  await token(page).fill('github_pat_TEST_HALB');
  await page.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(token(page)).toHaveCount(0);
  expect(await page.evaluate(() => document.body.innerText)).not.toContain('github_pat_TEST_HALB');
  // Wieder geöffnet, ist das Feld leer
  await change(page).click();
  await expect(token(page)).toHaveValue('');
  expect(await savedSettings(page)).toMatchObject({ token: OLD_TOKEN });
});

test('a repository that is not on the list stays chosen when only the token changes', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { repo: 'muster/vault-test', token: OLD_TOKEN, settings: { tokenExpiry: '2027-10-29' } });
  await toSettings(page);
  await change(page).click();
  await expect(repository(page)).toHaveValue('muster/vault-test');
  await expect(repository(page).locator('option')).toHaveText(['muster/vault-test', 'johrob-lab/2-gehirn', 'johrob-lab/2-gehirn-test']);
  await token(page).fill(NEW_TOKEN);
  await submit(page).click();
  await expect(page.getByText('gespeichert, gültig bis 29.10.2027', { exact: true })).toBeVisible();
  expect(await savedSettings(page)).toMatchObject({ token: NEW_TOKEN, repo: 'muster/vault-test' });
  expect(await localFiles(page)).toContain(NOTE); // kein Wechsel, also bleibt alles
  expect(repo.unhandled).toEqual([]);
});

// ---------- Das Repository wechseln ----------

test('a change of the repository is refused while changes wait, and nothing is touched', async ({ page }) => {
  const oldRepo = await open(page);
  const newRepo = await addRepo(page, NEW_REPO);
  await expect.poll(() => localFiles(page)).toContain(NOTE);
  oldRepo.offline = true;
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect(status(page)).toHaveText('Wartet auf Netz · 1 Änderung');
  const filesBefore = await localFiles(page);
  const headBefore = await lastHead(page);

  await toSettings(page);
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await repository(page).selectOption(NEW_REPO);
  await submit(page).click();

  await expect(problem(page)).toHaveText('Erst sichern: Es wartet noch 1 Änderung.');
  expect(await savedSettings(page)).toMatchObject({ token: OLD_TOKEN, repo: OLD_REPO });
  expect(Object.keys(await queued(page))).toEqual([TAG]); // die Änderung wartet weiter
  expect(await localFiles(page)).toEqual(filesBefore);
  expect(await lastHead(page)).toBe(headBefore);
  expect(newRepo.requests).toEqual([]); // dem anderen Repo wurde nichts geschickt, nicht einmal eine Frage
  expect(newRepo.puts).toEqual([]);
  await expect(status(page)).toHaveText('Wartet auf Netz · 1 Änderung');
  await expect(token(page)).toBeVisible(); // das Formular bleibt offen
  await expect(submit(page)).toBeEnabled();

  // Ist die Änderung oben, geht es: Der Strich landet im alten Repo, nie im neuen.
  oldRepo.offline = false;
  await networkBack(page);
  await expect(status(page)).toHaveText('Gesichert');
  await submit(page).click();
  await expect(page.getByText(NEW_REPO, { exact: true })).toBeVisible();
  expect(oldRepo.puts.map((p) => p.path)).toEqual([TAG]);
  expect(newRepo.puts).toEqual([]);
  expect(await savedSettings(page)).toMatchObject({ token: NEW_TOKEN, repo: NEW_REPO });
});

test('a change that is queued while the new repository is asked stops the switch and still goes to the repository it belongs to', async ({ page }) => {
  const oldRepo = await open(page);
  const newRepo = await addRepo(page, NEW_REPO);
  await expect.poll(() => localFiles(page)).toContain(NOTE);
  const filesBefore = await localFiles(page);
  await toSettings(page);
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await repository(page).selectOption(NEW_REPO);
  // GitHub antwortet auf die Frage nach dem neuen Repo erst, wenn der Test es erlaubt
  let answer!: () => void;
  newRepo.checkGate = new Promise<void>((resolve) => (answer = resolve));
  await submit(page).click();
  await expect.poll(() => newRepo.requests).toEqual([`GET /repos/${NEW_REPO}`]);
  // In der Zwischenzeit kommt eine Änderung in die Warteschlange (hier von außen, wie von einem anderen Fenster)
  await queueChange(page, LATE, 'Nachtrag');
  answer();

  await expect(problem(page)).toHaveText('Erst sichern: Es wartet noch 1 Änderung.');
  expect(await savedSettings(page)).toMatchObject({ token: OLD_TOKEN, repo: OLD_REPO });
  expect(await localFiles(page)).toEqual(expect.arrayContaining(filesBefore)); // nichts wurde geleert
  // Die App arbeitet für das alte Repo weiter: Die Änderung geht dorthin, nie ins neue
  await expect.poll(() => oldRepo.puts.map((p) => p.path)).toEqual([LATE]);
  expect(oldRepo.puts[0].text).toBe('Nachtrag');
  await expect.poll(async () => await queued(page)).toEqual({});
  await expect(status(page)).toHaveText('Gesichert');
  expect(newRepo.puts).toEqual([]);
  expect(newRepo.requests).toEqual([`GET /repos/${NEW_REPO}`]); // das neue Repo hat nur die Frage nach dem Zugang gehört
  // Und das Formular ist noch offen: Es geht, sobald nichts mehr wartet
  await submit(page).click();
  await expect(page.getByText(NEW_REPO, { exact: true })).toBeVisible();
  expect(await savedSettings(page)).toMatchObject({ token: NEW_TOKEN, repo: NEW_REPO });
  expect(newRepo.puts).toEqual([]);
});

test('a change of the repository first uploads what waits, to the repository it belongs to', async ({ page }) => {
  const oldRepo = await open(page);
  const newRepo = await addRepo(page, NEW_REPO);
  oldRepo.failWrites = true; // das Hochladen scheitert zunächst
  await pen(page).stroke(LINE);
  await sendToBackground(page);
  await expect.poll(async () => Object.keys(await queued(page))).toEqual([TAG]);
  await toSettings(page);
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await repository(page).selectOption(NEW_REPO);
  oldRepo.failWrites = false; // jetzt geht es, und das Wechseln sichert zuerst
  await submit(page).click();
  await expect(page.getByText(NEW_REPO, { exact: true })).toBeVisible();
  expect(oldRepo.puts.map((p) => p.path)).toEqual([TAG]);
  expect(newRepo.puts).toEqual([]);
  expect(newRepo.deletes).toEqual([]);
  expect(await queued(page)).toEqual({});
  expect(await savedSettings(page)).toMatchObject({ token: NEW_TOKEN, repo: NEW_REPO });
});

test('a change of the repository clears the local data and the app talks to the new repository only', async ({ page }) => {
  const oldRepo = await open(page);
  const newRepo = await addRepo(page, NEW_REPO, { files: { [NOTE]: OTHER_NOTE } });
  newRepo.commit(NOTE, OTHER_NOTE); // der neue Stand hat einen anderen Commit als der alte
  newRepo.tokens = [NEW_TOKEN]; // und kennt den alten Token nicht
  await expect.poll(() => localFiles(page)).toContain(NOTE);
  const oldHead = await lastHead(page);
  expect(oldHead).not.toBeNull();

  await toSettings(page);
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await repository(page).selectOption(NEW_REPO);
  await submit(page).click();
  await expect(page.getByText(NEW_REPO, { exact: true })).toBeVisible();
  await expect(page.getByText('gespeichert, gültig bis 29.10.2027', { exact: true })).toBeVisible();
  expect(await savedSettings(page)).toEqual({
    token: NEW_TOKEN,
    repo: NEW_REPO,
    device: 'iPad',
    smoothing: 'mittel',
    prediction: true,
    tokenExpiry: '2027-10-29',
  });
  expect(await localFiles(page)).toEqual([]); // die Kopien des alten Repos sind weg
  expect(await queued(page)).toEqual({});
  await expect.poll(async () => {
    const head = await lastHead(page);
    return head !== null && head !== oldHead; // der Merkzettel gehört jetzt zum neuen Repo
  }).toBe(true);
  await expect(status(page)).toHaveText('Gesichert');
  const asked = oldRepo.requests.length;

  // Die Tagesseite kommt aus dem neuen Repo
  await toDay(page);
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  await expect(page.getByRole('checkbox', { name: 'Aufgabe aus dem anderen Repo', exact: true })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: NAME1, exact: true })).toHaveCount(0);
  await expect(status(page)).toHaveText('Gesichert');
  // Ein Strich und ein Haken gehören dem neuen Repo
  await pen(page).stroke(LINE);
  await page.getByRole('checkbox', { name: 'Aufgabe aus dem anderen Repo', exact: true }).check();
  await sendToBackground(page);
  await expect.poll(() => newRepo.puts.map((p) => p.path).sort()).toEqual([NOTE, TAG].sort());
  await expect(status(page)).toHaveText('Gesichert');
  // Das alte Repo hört nichts mehr von der App: keine Anfrage, kein Schreiben
  expect(oldRepo.requests.length).toBe(asked);
  expect(oldRepo.puts).toEqual([]);
  expect(oldRepo.deletes).toEqual([]);
  expect(oldRepo.unhandled).toEqual([]);
  expect(newRepo.unhandled).toEqual([]);
  expect(newRepo.used.every((used) => used === NEW_TOKEN)).toBe(true);
});

test('a change of the repository with a token that does not work changes nothing', async ({ page }) => {
  const oldRepo = await open(page);
  const newRepo = await addRepo(page, NEW_REPO);
  newRepo.tokens = [NEW_TOKEN];
  await expect.poll(() => localFiles(page)).toContain(NOTE);
  const filesBefore = await localFiles(page);
  await toSettings(page);
  await change(page).click();
  await token(page).fill('github_pat_TEST_FALSCH');
  await repository(page).selectOption(NEW_REPO);
  await submit(page).click();
  await expect(problem(page)).toHaveText('Der Zugang klappt nicht. Bitte Token prüfen.');
  expect(await savedSettings(page)).toMatchObject({ token: OLD_TOKEN, repo: OLD_REPO });
  expect(await localFiles(page)).toEqual(expect.arrayContaining(filesBefore)); // die alten Kopien bleiben, solange der Wechsel nicht gelang
  expect(newRepo.puts).toEqual([]);
  expect(oldRepo.puts).toEqual([]);
  await expect(status(page)).toHaveText('Gesichert');
});

test('a token that may not write into the new repository is refused with its own text', async ({ page }) => {
  await open(page);
  const newRepo = await addRepo(page, NEW_REPO);
  newRepo.canWrite = false;
  await toSettings(page);
  await change(page).click();
  await token(page).fill(NEW_TOKEN);
  await repository(page).selectOption(NEW_REPO);
  await submit(page).click();
  await expect(problem(page)).toHaveText('Der Token darf nicht schreiben. Bitte beim Token „Contents: Read and write“ wählen.');
  expect(await savedSettings(page)).toMatchObject({ token: OLD_TOKEN, repo: OLD_REPO });
});
