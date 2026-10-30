import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import { appendErgaenzung, newDailyNote } from '../../src/lib/dailyNote';
import { besprechungLayout } from '../../src/pages/layouts';
import { bringToForeground, lastHead, openSeeded, queued, sendToBackground } from './helpers/app';
import { inkNear, mouse, pen, viewOf, wheel } from './helpers/pointer';

// Die Tagesseite mit ihren drei Karten (Morgenbriefing, Kalender, Besprechungen). GitHub antwortet aus dem erfundenen
// Mini-Vault in tests/fixtures/vault/. Heute ist in allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit).

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
const TERMINE = '04 Ressourcen/Kalender/Termine.md';
const FILES = '07 Anhänge/Notizbuch/2026';
const BASE = '2026-10-29 0800 Abstimmung Beispiel 2027';
const THEMA = 'Abstimmung Beispiel 2027';
const PAGE1 = `${FILES}/${BASE} S1.svg`;
const STALE = 'Die Zeile hat sich geändert, bitte noch einmal.';
const BLOCKED = 'Bitte ein anderes Thema wählen, Wörter wie Passwort sind im Dateinamen nicht erlaubt.';
const FAILED = 'Das hat nicht geklappt. Bitte noch einmal versuchen.';

/** Die drei Aufgaben des Morgenbriefings im Mini-Vault, genau wie in der Datei. */
const TASK1 = '- [ ] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%';
const TASK2 = '- [ ] Urlaube im Plan nachziehen %%ob:k3x9 todo:AAMkTEST2%%';
const TASK3 = '- [x] Reorga abstimmen %%todo:AAMkTEST3 gemeldet%%';
const NAME1 = 'Liste Planobjekte ergänzen (fällig 30.10.)';
const NAME2 = 'Urlaube im Plan nachziehen';
const NAME3 = 'Reorga abstimmen';

/** Eine Notiz mit allem, was die Karte unterscheiden muss: Aufgaben, Listenpunkte, Zitat, Absatz, Kommentar und Anhang. */
const RICH_NOTE = [
  '---',
  'date: 2026-10-29',
  'tags: [daily]',
  '---',
  '# 2026-10-29',
  '',
  '## Morgenbriefing (automatisch)',
  '',
  '### Offene Punkte',
  '- [ ] Erste Aufgabe %%todo:AAMkA%%',
  '',
  'Ein Absatz ohne Listenpunkt %%ob:zz%%',
  '',
  '> - [ ] Zitat Aufgabe',
  '',
  '## Ergänzungen',
  '',
  '- Notiz ohne Kästchen',
  '- [x] Erledigt',
  '',
  '%%',
  'verstecktes Blockkommentar',
  '%%',
  '',
  '## Handschrift',
  '',
  '![[2026-10-29 Tag.svg]]',
  '',
  '- [ ] Aufgabe in Handschrift',
  '',
  '## Abendüberblick (automatisch)',
  '',
  '- [ ] Abend Punkt %%todo:AAMkB%%',
  '',
].join('\n');

const hashOf = (base: string, n: number) => `#/besprechung/${encodeURIComponent(base)}/${n}`;
const hash = (page: Page) => page.evaluate(() => window.location.hash);
const go = (page: Page, next: string) => page.evaluate((h) => void (window.location.hash = h), next);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const checkbox = (page: Page, name: string) => page.getByRole('checkbox', { name, exact: true });
const pencil = (page: Page, name: string) => button(page, `Bearbeiten: ${name}`);
const section = (page: Page, name: string) => button(page, name);
const region = (page: Page, name: string) => page.getByRole('region', { name, exact: true });
const meetings = (page: Page) => region(page, 'Besprechungen');
const calendar = (page: Page) => region(page, 'Kalender');
const editField = (page: Page) => page.getByLabel('Text bearbeiten', { exact: true });
const addField = (page: Page) => page.getByLabel('Ergänzung', { exact: true });
const questionOf = (page: Page) => page.getByRole('dialog', { name: 'Neue Besprechung' });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });

/** Eine Seite der Besprechung als Datei, so wie die App sie schreibt. */
function pageText(n: number, meta: Record<string, string> = {}, base = BASE): string {
  const full = { thema: THEMA, datum: TODAY, zeit: '08:00', ort: '', projekt: '', ...meta, seitennr: String(n) };
  const layout = besprechungLayout(full);
  return serializePage({ kind: 'besprechung', key: base, meta: full, strokes: [] }, layout.fields, layout.background());
}

/** Der Text, den die Warteschlange dieses Geräts für eine Datei hält. */
async function queuedText(page: Page, path: string): Promise<string> {
  return (await queued(page))[path] ?? '';
}

/** Sobald die Warteschlange den Text hat, der `needle` enthält, ist er lokal gesichert: Erst dann geht er mit dem Abgleich hoch. */
async function waitUntilQueued(page: Page, path: string, needle: string) {
  await expect.poll(() => queuedText(page, path), { message: `${needle} in der Warteschlange` }).toContain(needle);
}

/** Lädt die Warteschlange hoch und wartet, bis `count` Änderungen auf GitHub angekommen sind. */
async function upload(page: Page, repo: { puts: unknown[] }, count: number) {
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(count);
}

/** Ein anderes Fenster der App (dieselbe IndexedDB) hat den Text einer Datei umgeschrieben. Dieses Fenster erfährt es nicht. */
async function replaceStoredText(page: Page, path: string, text: string) {
  await page.evaluate(
    ({ path: key, text: next }) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('notizbuch');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('files', 'readwrite');
          const store = tx.objectStore('files');
          const get = store.get(key);
          get.onsuccess = () => void store.put({ ...get.result, text: next });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    { path, text },
  );
}

/** Nirgends auf der Seite steht ein `%%`: weder als Text noch im HTML noch in einem Eingabefeld. */
async function expectNoMarkers(page: Page) {
  expect(await page.locator('body').innerText()).not.toContain('%%');
  expect(await page.locator('#app').evaluate((el) => el.outerHTML)).not.toContain('%%');
  const values = await page.locator('input').evaluateAll((els) => els.map((el) => (el as HTMLInputElement).value));
  expect(values.join('\n')).not.toContain('%%');
}

// ---------- Abhaken ----------

test('ticks a task and uploads - [x]', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  const task = checkbox(page, NAME1);
  await expect(task).not.toBeChecked();
  await task.check();
  await expect(task).toBeChecked();
  await waitUntilQueued(page, NOTE, '- [x] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%');
  await upload(page, repo, 1);

  const [put] = repo.puts;
  expect(put.path).toBe(NOTE);
  expect(put.text).toContain('- [x] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%');
  // Es ändert sich genau diese Zeile: alle Marker und alle anderen Zeilen bleiben Byte für Byte.
  expect(put.text).toBe(NOTE_TEXT.replace(TASK1, TASK1.replace('[ ]', '[x]')));
  expect(repo.deletes).toEqual([]);
  expect(repo.unhandled).toEqual([]);
});

test('unticking a done task keeps its markers', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  const done = checkbox(page, NAME3);
  await expect(done).toBeChecked();
  await done.uncheck();
  await expect(done).not.toBeChecked();
  await waitUntilQueued(page, NOTE, '- [ ] Reorga abstimmen %%todo:AAMkTEST3 gemeldet%%');
  await upload(page, repo, 1);
  expect(repo.puts[0].text).toBe(NOTE_TEXT.replace(TASK3, TASK3.replace('[x]', '[ ]')));
});

test('two ticks in a row both land in the note', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await checkbox(page, NAME1).check();
  await checkbox(page, NAME2).check();
  await expect(checkbox(page, NAME1)).toBeChecked();
  await expect(checkbox(page, NAME2)).toBeChecked();
  await waitUntilQueued(page, NOTE, '- [x] Urlaube im Plan nachziehen');
  await upload(page, repo, 1);
  expect(repo.puts[0].text).toBe(NOTE_TEXT.replace(TASK1, TASK1.replace('[ ]', '[x]')).replace(TASK2, TASK2.replace('[ ]', '[x]')));
});

test('a note with Windows line endings can be ticked, edited and extended, and keeps its line endings', async ({ page }) => {
  const windows = NOTE_TEXT.replace(/\n/g, '\r\n');
  const repo = await openSeeded(page, DAY, { files: { [NOTE]: windows } });
  await expect(checkbox(page, NAME1)).not.toBeChecked();
  await checkbox(page, NAME1).check();
  await expect(checkbox(page, NAME1)).toBeChecked();
  await pencil(page, NAME2).click();
  await expect(editField(page)).toHaveValue(NAME2);
  await editField(page).fill('Urlaube geprüft');
  await editField(page).press('Enter');
  await waitUntilQueued(page, NOTE, '- [ ] Urlaube geprüft %%ob:k3x9 todo:AAMkTEST2%%');
  await addField(page).fill('Noch eine');
  await button(page, 'Hinzufügen').click();
  await waitUntilQueued(page, NOTE, '- [ ] Noch eine');
  await upload(page, repo, 1);

  const ticked = windows.replace(TASK1, TASK1.replace('[ ]', '[x]')).replace(TASK2, '- [ ] Urlaube geprüft %%ob:k3x9 todo:AAMkTEST2%%');
  expect(repo.puts[0].text).toBe(appendErgaenzung(ticked, 'Noch eine', true));
  expect(repo.puts[0].text).not.toMatch(/(?<!\r)\n/); // kein Zeilenende, das nicht \r\n wäre
  await expectNoMarkers(page);
});

test('PC mouse can tick', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { device: 'Firmen-PC' });
  const task = checkbox(page, NAME1);
  await task.click(); // ein echter Mausklick
  await expect(task).toBeChecked();
  await waitUntilQueued(page, NOTE, '- [x] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%');
  await upload(page, repo, 1);
  expect(repo.puts[0].path).toBe(NOTE);
  expect(repo.puts[0].text).toBe(NOTE_TEXT.replace(TASK1, TASK1.replace('[ ]', '[x]')));
});

test('PC mouse can edit, add and open a meeting, but never draws', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { device: 'Firmen-PC' });
  await pencil(page, NAME2).click();
  await editField(page).fill('Urlaube geprüft');
  await editField(page).press('Enter');
  await waitUntilQueued(page, NOTE, '- [ ] Urlaube geprüft %%ob:k3x9 todo:AAMkTEST2%%');

  await addField(page).fill('Vom PC ergänzt');
  await button(page, 'Hinzufügen').click();
  await waitUntilQueued(page, NOTE, '- [ ] Vom PC ergänzt');

  await mouse(page).stroke([
    [200, 900],
    [260, 920],
  ]);
  await pen(page).stroke([
    [200, 1000],
    [260, 1020],
  ]);
  expect(await strokeCount(page)).toBe(0);

  await meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(field(page, 'Zeit')).toHaveValue('08:00');
  await sendToBackground(page);
  await expect.poll(() => [...new Set(repo.puts.map((p) => p.path))].sort()).toEqual([NOTE, PAGE1].sort());
  expect(repo.read(NOTE)).toContain('- [ ] Urlaube geprüft %%ob:k3x9 todo:AAMkTEST2%%');
  expect(repo.read(NOTE)).toContain('- [ ] Vom PC ergänzt');
});

// ---------- Marker, Abschnitte, Stift ----------

test('markers are never shown', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  const text = await page.locator('body').innerText();
  expect(text).not.toContain('%%');
  expect(text).toContain('Liste Planobjekte ergänzen (fällig 30.10.)');
  expect(text).not.toContain('todo:AAMk');
  await expectNoMarkers(page);

  // Auch das Feld zum Bearbeiten zeigt nur den sichtbaren Text.
  await pencil(page, NAME2).click();
  await expect(editField(page)).toHaveValue(NAME2);
  await expectNoMarkers(page);
});

test('Morgenbriefing and Ergänzungen are open, the other sections collapsed, and a tap on the heading toggles', async ({ page }) => {
  await openSeeded(page, DAY, { files: { [NOTE]: RICH_NOTE } });
  const morning = section(page, 'Morgenbriefing (automatisch)');
  const additions = section(page, 'Ergänzungen');
  const handwriting = section(page, 'Handschrift');
  const evening = section(page, 'Abendüberblick (automatisch)');
  await expect(morning).toHaveAttribute('aria-expanded', 'true');
  await expect(additions).toHaveAttribute('aria-expanded', 'true');
  await expect(handwriting).toHaveAttribute('aria-expanded', 'false');
  await expect(evening).toHaveAttribute('aria-expanded', 'false');
  await expect(checkbox(page, 'Erste Aufgabe')).toBeVisible();
  await expect(checkbox(page, 'Erledigt')).toBeVisible();
  // Zugeklappt heißt: Der Inhalt ist nicht da.
  await expect(page.getByText('Abend Punkt')).toHaveCount(0);
  await expect(page.getByText('Aufgabe in Handschrift')).toHaveCount(0);

  await evening.click();
  await expect(evening).toHaveAttribute('aria-expanded', 'true');
  await expect(checkbox(page, 'Abend Punkt')).toBeVisible();
  await evening.click();
  await expect(evening).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Abend Punkt')).toHaveCount(0);

  // Auch ein offener Abschnitt lässt sich zuklappen.
  await additions.click();
  await expect(additions).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Notiz ohne Kästchen')).toHaveCount(0);
  await expect(checkbox(page, 'Erste Aufgabe')).toBeVisible();
});

test('the pencil is only on lines that are list items, and hidden parts of a note stay hidden', async ({ page }) => {
  await openSeeded(page, DAY, { files: { [NOTE]: RICH_NOTE } });
  const card = region(page, 'Morgenbriefing');
  await expect(checkbox(page, 'Erste Aufgabe')).toBeVisible();
  // Offen sind Morgenbriefing und Ergänzungen: drei Listenpunkte, zwei davon mit Kästchen.
  await expect(card.getByRole('button', { name: /^Bearbeiten: / })).toHaveCount(3);
  await expect(card.getByRole('checkbox')).toHaveCount(2);
  await expect(pencil(page, 'Erste Aufgabe')).toBeVisible();
  await expect(pencil(page, 'Notiz ohne Kästchen')).toBeVisible();
  await expect(pencil(page, 'Erledigt')).toBeVisible();
  // Der Absatz und das Zitat sind zu sehen, aber nichts, was die App ändern dürfte.
  await expect(card.getByText('Ein Absatz ohne Listenpunkt')).toBeVisible();
  await expect(card.getByText('Zitat Aufgabe')).toBeVisible();
  await expect(card.getByText('verstecktes Blockkommentar')).toHaveCount(0);
  await expectNoMarkers(page);

  // Ein Anhang (`![[…]]`) ist ein neutraler Hinweis, ohne den Namen der Datei und ohne Ausrufezeichen.
  await section(page, 'Handschrift').click();
  await expect(card.getByText('Anhang', { exact: true })).toBeVisible();
  await expect(card.getByText('Tag.svg')).toHaveCount(0);
  expect(await card.innerText()).not.toContain('!');
  await expect(card.getByRole('button', { name: /^Bearbeiten: / })).toHaveCount(4);
  await expect(pencil(page, 'Aufgabe in Handschrift')).toBeVisible();
});

// ---------- Bearbeiten ----------

test('edits a line and keeps the marker', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await pencil(page, NAME2).click();
  const input = editField(page);
  await expect(input).toHaveValue(NAME2);
  await input.fill('Urlaube bis Ende November nachziehen');
  await input.press('Enter');
  await expect(input).toBeHidden();
  await expect(checkbox(page, 'Urlaube bis Ende November nachziehen')).toBeVisible();
  await expect(page.locator('.karten-hinweis')).toHaveCount(0); // eine gelungene Änderung meldet nichts

  await waitUntilQueued(page, NOTE, '- [ ] Urlaube bis Ende November nachziehen %%ob:k3x9 todo:AAMkTEST2%%');
  await upload(page, repo, 1);
  expect(repo.puts[0].text).toBe(NOTE_TEXT.replace(TASK2, '- [ ] Urlaube bis Ende November nachziehen %%ob:k3x9 todo:AAMkTEST2%%'));
});

test('Escape cancels an edit and writes nothing', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await pencil(page, NAME2).click();
  await editField(page).fill('Wird nicht gespeichert');
  await editField(page).press('Escape');
  await expect(editField(page)).toBeHidden();
  await expect(checkbox(page, NAME2)).toBeVisible();
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

test('saving an edit without a change writes nothing, so a marker in the middle of a line stays where it is', async ({ page }) => {
  const odd = '- [ ] Vor dem Marker%%ob:mitte%% und danach %%todo:AAMkMID%%';
  const repo = await openSeeded(page, DAY, { files: { [NOTE]: NOTE_TEXT.replace(TASK2, odd) } });
  await pencil(page, 'Vor dem Marker und danach').click();
  await expect(editField(page)).toHaveValue('Vor dem Marker und danach');
  await editField(page).press('Enter');
  await expect(editField(page)).toBeHidden();
  await expect(checkbox(page, 'Vor dem Marker und danach')).toBeVisible();
  expect(await queued(page)).toEqual({}); // editItemText hängt die Marker ans Zeilenende: Ohne Änderung bleibt die Zeile, wie sie ist
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

test('with the keyboard the focus goes from the pencil to the field and back to the pencil', async ({ page }) => {
  await openSeeded(page, DAY);
  const NEW = 'Urlaube bis Ende November nachziehen';
  await pencil(page, NAME2).focus();
  await page.keyboard.press('Enter');
  await expect(editField(page)).toBeFocused();
  await editField(page).fill(NEW);
  await editField(page).press('Enter');
  await expect(pencil(page, NEW)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(editField(page)).toBeFocused();
  await editField(page).press('Escape');
  await expect(pencil(page, NEW)).toBeFocused();
});

test('a change from another device while a line is being edited keeps the typed text', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => lastHead(page)).not.toBeNull();
  await pencil(page, NAME2).click();
  const input = editField(page);
  await input.fill('Urlaube bis Jahresende nachziehen');

  // Ein anderes Gerät nimmt den Haken bei „Reorga abstimmen“ weg, während das Feld offen ist.
  const remote = NOTE_TEXT.replace(TASK3, TASK3.replace('[x]', '[ ]'));
  repo.commit(NOTE, remote);
  await bringToForeground(page);
  await expect(checkbox(page, NAME3)).not.toBeChecked();
  await expect(input).toHaveValue('Urlaube bis Jahresende nachziehen');
  await expect(input).toBeFocused();

  await input.press('Enter');
  await waitUntilQueued(page, NOTE, '- [ ] Urlaube bis Jahresende nachziehen %%ob:k3x9 todo:AAMkTEST2%%');
  await upload(page, repo, 1);
  // Beide Änderungen sind da: die fremde und die eigene.
  expect(repo.puts[0].text).toBe(remote.replace(TASK2, '- [ ] Urlaube bis Jahresende nachziehen %%ob:k3x9 todo:AAMkTEST2%%'));
});

test('a line that changed under the card gives a notice and writes nothing', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  const task = checkbox(page, NAME2);
  await expect(task).toBeVisible();
  // Ein anderes Fenster hat die Notiz umgeschrieben: Eine Zeile ist dazugekommen, die Zeilen darunter sind verrutscht.
  const shifted = NOTE_TEXT.replace(TASK2, `- [ ] Zusatzaufgabe %%todo:AAMkNEW%%\n${TASK2}`);
  await replaceStoredText(page, NOTE, shifted);
  await task.click();

  await expect(page.getByRole('status').filter({ hasText: STALE })).toBeVisible();
  await expect(checkbox(page, 'Zusatzaufgabe')).toBeVisible(); // der neue Stand ist zu sehen
  await expect(checkbox(page, NAME2)).not.toBeChecked();
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);

  // Ein zweiter Tipp trifft jetzt die richtige Zeile, und die Zeile darüber bleibt unberührt.
  await checkbox(page, NAME2).check();
  await waitUntilQueued(page, NOTE, '- [x] Urlaube im Plan nachziehen %%ob:k3x9 todo:AAMkTEST2%%');
  await upload(page, repo, 1);
  expect(repo.puts[0].text).toBe(shifted.replace(TASK2, TASK2.replace('[ ]', '[x]')));
});

test('an edit of a line that changed under the card gives the notice too', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await pencil(page, NAME2).click();
  await editField(page).fill('Eigene Fassung');
  const changed = NOTE_TEXT.replace(TASK2, '- [ ] Urlaube anders formuliert %%ob:k3x9 todo:AAMkTEST2%%');
  await replaceStoredText(page, NOTE, changed);
  await editField(page).press('Enter');

  await expect(page.getByRole('status').filter({ hasText: STALE })).toBeVisible();
  await expect(checkbox(page, 'Urlaube anders formuliert')).toBeVisible();
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

// ---------- Ergänzen ----------

test('adds Ergänzung before Abendüberblick', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  const input = addField(page);
  await input.fill('Frau Muster zurückrufen');
  await expect(page.getByRole('switch', { name: 'Aufgabe' })).toBeChecked(); // Standard: an
  await button(page, 'Hinzufügen').click();
  await expect(input).toHaveValue('');
  await expect(checkbox(page, 'Frau Muster zurückrufen')).toBeVisible(); // Ergänzungen ist offen: der Eintrag ist zu sehen

  await waitUntilQueued(page, NOTE, '- [ ] Frau Muster zurückrufen');
  await upload(page, repo, 1);
  const text = repo.puts[0].text;
  expect(text.indexOf('## Ergänzungen')).toBeGreaterThan(text.indexOf('- [x] Reorga abstimmen'));
  expect(text.indexOf('## Ergänzungen')).toBeLessThan(text.indexOf('## Abendüberblick (automatisch)'));
  expect(text.indexOf('- [ ] Frau Muster zurückrufen')).toBeGreaterThan(text.indexOf('## Ergänzungen'));
  expect(text.indexOf('- [ ] Frau Muster zurückrufen')).toBeLessThan(text.indexOf('## Abendüberblick (automatisch)'));
  expect(text).toBe(appendErgaenzung(NOTE_TEXT, 'Frau Muster zurückrufen', true));
});

test('without the task switch an Ergänzung is a plain list item', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await page.getByRole('switch', { name: 'Aufgabe' }).uncheck();
  await addField(page).fill('Nur eine Notiz');
  await addField(page).press('Enter'); // Enter im Feld fügt auch hinzu
  await expect(page.getByText('Nur eine Notiz')).toBeVisible();
  await expect(checkbox(page, 'Nur eine Notiz')).toHaveCount(0);
  await waitUntilQueued(page, NOTE, '- Nur eine Notiz');
  await upload(page, repo, 1);
  expect(repo.puts[0].text).toBe(appendErgaenzung(NOTE_TEXT, 'Nur eine Notiz', false));
});

test('an empty Ergänzung does nothing', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  await button(page, 'Hinzufügen').click();
  await addField(page).fill('   ');
  await button(page, 'Hinzufügen').click();
  await addField(page).fill('%%');
  await button(page, 'Hinzufügen').click();
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

test('day without daily note', async ({ page }) => {
  const day = '2026-11-05';
  const path = `05 Daily Notes/${day}.md`;
  const repo = await openSeeded(page, `#/tag/${day}`);
  await expect(page.getByText('Noch kein Briefing für diesen Tag')).toBeVisible();
  // Ansehen legt keine Datei an.
  expect(await queued(page)).toEqual({});

  await addField(page).fill('Erste Notiz des Tages');
  await button(page, 'Hinzufügen').click();
  await expect(page.getByText('Noch kein Briefing für diesen Tag')).toBeHidden();
  await expect(checkbox(page, 'Erste Notiz des Tages')).toBeVisible();
  await waitUntilQueued(page, path, '- [ ] Erste Notiz des Tages');
  await upload(page, repo, 1);
  const [put] = repo.puts;
  expect(put.path).toBe(path);
  expect(put.text).toContain('date: 2026-11-05');
  expect(put.text).toBe(appendErgaenzung(newDailyNote(day), 'Erste Notiz des Tages', true));
});

test('an empty Ergänzung on a day without a note creates no note', async ({ page }) => {
  const repo = await openSeeded(page, '#/tag/2026-11-05');
  await expect(page.getByText('Noch kein Briefing für diesen Tag')).toBeVisible();
  await button(page, 'Hinzufügen').click();
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
  await expect(page.getByText('Noch kein Briefing für diesen Tag')).toBeVisible();
});

test('nothing is written before the note has been read, and the Ergänzung then lands in the real note', async ({ page }) => {
  const repo = await openSeeded(page, '#/tag/2026-11-05');
  await expect(page.getByText('Noch kein Briefing für diesen Tag')).toBeVisible();
  // Die Notiz von heute antwortet erst, wenn der Test es erlaubt: So lange ist sie nicht gelesen.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => decodeURIComponent(url.pathname).endsWith(`/contents/${NOTE}`),
    async (route) => {
      if (route.request().method() === 'GET') await gate;
      await route.fallback();
    },
  );
  await go(page, DAY);
  await expect(page.getByText('Briefing wird geladen')).toBeVisible();
  await expect(button(page, 'Hinzufügen')).toBeDisabled();
  await addField(page).fill('Zu früh getippt');
  await addField(page).press('Enter');
  expect(await queued(page)).toEqual({});

  release();
  await expect(checkbox(page, NAME1)).toBeVisible();
  await expect(addField(page)).toHaveValue('Zu früh getippt'); // das Getippte geht nicht verloren
  await button(page, 'Hinzufügen').click();
  await waitUntilQueued(page, NOTE, '- [ ] Zu früh getippt');
  await upload(page, repo, 1);
  // Die vorhandene Notiz bekommt die Ergänzung, es entsteht keine neue neben ihr.
  expect(repo.puts[0].text).toBe(appendErgaenzung(NOTE_TEXT, 'Zu früh getippt', true));
});

test('a note that can not be read is shown as such and nothing is written to it', async ({ page }) => {
  const repo = await openSeeded(page, DAY, { failReads: true });
  await expect(page.getByText('Das Briefing lässt sich nicht lesen und wird nicht verändert.')).toBeVisible();
  await expect(button(page, 'Hinzufügen')).toBeDisabled();
  await addField(page).fill('Geht nicht');
  await addField(page).press('Enter');
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

// ---------- Besprechungen ----------

test('meeting from Termin', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  const entry = meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ });
  await expect(entry).toContainText('08:00');
  await expect(entry).toContainText('Klagenfurt');
  await entry.click();

  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(field(page, 'Zeit')).toHaveValue('08:00');
  await expect(field(page, 'Thema')).toHaveValue(THEMA);
  await expect(field(page, 'Ort')).toHaveValue('Klagenfurt');
  await expect(field(page, 'Datum')).toHaveValue(TODAY);
  await upload(page, repo, 1);
  const [put] = repo.puts;
  expect(put.path).toBe(PAGE1);
  for (const part of [`data-thema="${THEMA}"`, 'data-datum="2026-10-29"', 'data-zeit="08:00"', 'data-ort="Klagenfurt"', 'data-seitennr="1"', `data-schluessel="${BASE}"`]) {
    expect(put.text, part).toContain(part);
  }
});

test('an existing meeting is opened instead of a second one', async ({ page }) => {
  const other = '2026-10-29 1000 Team Runde';
  const repo = await openSeeded(page, DAY, {
    files: {
      [PAGE1]: pageText(1, { ort: 'Klagenfurt' }),
      [`${FILES}/${BASE} S2.svg`]: pageText(2, { ort: 'Klagenfurt' }),
      [`${FILES}/${other} S1.svg`]: pageText(1, { thema: 'Team Runde', zeit: '10:00' }, other),
    },
  });
  const list = meetings(page);
  // Das Treffen ohne Termin steht als Eintrag da und führt auf seine Seite.
  await expect(list.getByRole('link', { name: /Team Runde/ })).toHaveAttribute('href', hashOf(other, 1));
  // Zu dem Termin gibt es die Besprechung schon: Ein Tipp öffnet sie, es entsteht keine zweite.
  await list.getByRole('button', { name: /Abstimmung Beispiel 2027/ }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(field(page, 'Ort')).toHaveValue('Klagenfurt');
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
  expect(await queued(page)).toEqual({});
});

test('an existing meeting that only this device has is opened too', async ({ page }) => {
  // Die Besprechung liegt nur im Speicher dieses Geräts: Das Hochladen scheitert, also steht sie in keiner Liste von GitHub.
  // (Beim Verlassen einer Seite lädt die Engine sofort hoch, sonst wäre sie schon auf GitHub, bevor man zurückkommt.)
  const repo = await openSeeded(page, DAY);
  repo.failWrites = true;
  await meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(field(page, 'Zeit')).toHaveValue('08:00');
  await field(page, 'Ort').fill('Raum 5');
  await waitUntilQueued(page, PAGE1, 'data-ort="Raum 5"');
  await go(page, DAY);
  await expect(meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ })).toBeVisible();
  await meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(field(page, 'Ort')).toHaveValue('Raum 5'); // dieselbe Seite, nicht eine neue
  expect(repo.puts).toEqual([]); // GitHub hat nichts angenommen
  repo.failWrites = false;
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].path).toBe(PAGE1);
  expect(repo.puts[0].text).toContain('data-ort="Raum 5"');
});

test('an all-day appointment asks for the time first', async ({ page }) => {
  const repo = await openSeeded(page, '#/tag/2026-10-30');
  const entry = meetings(page).getByRole('button', { name: /Schulung Beispiel/ });
  await expect(entry).toContainText('ganztägig');
  await entry.click();

  const question = questionOf(page);
  await expect(question).toBeVisible();
  await expect(question.getByLabel('Thema')).toHaveValue('Schulung Beispiel');
  await expect(question.getByLabel('Zeit')).toHaveValue('08:00');
  expect(await hash(page)).toBe('#/tag/2026-10-30');

  await question.getByLabel('Zeit').fill('09:30');
  await question.getByRole('button', { name: 'Anlegen' }).click();
  const base = '2026-10-30 0930 Schulung Beispiel';
  await expect.poll(() => hash(page)).toBe(hashOf(base, 1));
  await expect(question).toHaveCount(0);
  await expect(field(page, 'Zeit')).toHaveValue('09:30');
  await upload(page, repo, 1);
  expect(repo.puts[0].path).toBe(`${FILES}/${base} S1.svg`);
  expect(repo.puts[0].text).toContain('data-zeit="09:30"');
});

test('cancelling the question creates nothing', async ({ page }) => {
  const repo = await openSeeded(page, '#/tag/2026-10-30');
  await meetings(page).getByRole('button', { name: /Schulung Beispiel/ }).click();
  await questionOf(page).getByRole('button', { name: 'Abbrechen' }).click();
  await expect(questionOf(page)).toHaveCount(0);
  await meetings(page).getByRole('button', { name: /Schulung Beispiel/ }).click();
  await expect(questionOf(page)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(questionOf(page)).toHaveCount(0);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

test('+ Besprechung asks for the topic and the time, and the time starts at the next full hour', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await button(page, '+ Besprechung').click();
  const question = questionOf(page);
  await expect(question.getByLabel('Thema')).toHaveValue('');
  await expect(question.getByLabel('Zeit')).toHaveValue('13:00'); // es ist 12:00 Uhr
  await question.getByLabel('Thema').fill('Team Runde');
  await question.getByLabel('Zeit').fill('10:15');
  await question.getByRole('button', { name: 'Anlegen' }).click();

  const base = '2026-10-29 1015 Team Runde';
  await expect.poll(() => hash(page)).toBe(hashOf(base, 1));
  await expect(field(page, 'Thema')).toHaveValue('Team Runde');
  await expect(field(page, 'Zeit')).toHaveValue('10:15');
  await upload(page, repo, 1);
  expect(repo.puts[0].path).toBe(`${FILES}/${base} S1.svg`);
});

test('a blocked topic shows the error and keeps the dialog open', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await button(page, '+ Besprechung').click();
  const question = questionOf(page);
  await question.getByLabel('Thema').fill('Passwort Liste');
  await question.getByRole('button', { name: 'Anlegen' }).click();

  await expect(question.getByRole('alert')).toHaveText(BLOCKED);
  await expect(question).toBeVisible();
  await expect(question.getByLabel('Thema')).toBeFocused(); // beim Prüfen war alles gesperrt: Der Fokus kommt zurück
  expect(await hash(page)).toBe(DAY);
  expect(await queued(page)).toEqual({});

  // Mit einem anderen Thema geht es im selben Dialog weiter.
  await question.getByLabel('Thema').fill('Planung Liste');
  await question.getByRole('button', { name: 'Anlegen' }).click();
  await expect.poll(() => hash(page)).toBe(hashOf('2026-10-29 1300 Planung Liste', 1));
  await upload(page, repo, 1);
});

test('a Termin with a blocked title opens the question with the error and the title', async ({ page }) => {
  const termine = `${readFileSync(join(VAULT_DIR, TERMINE), 'utf8')}- 2026-10-29 15:00 bis 16:00 | Token Runde | Raum 2 | Outlook\n`;
  await openSeeded(page, DAY, { files: { [TERMINE]: termine } });
  await meetings(page).getByRole('button', { name: /Token Runde/ }).click();
  const question = questionOf(page);
  await expect(question).toBeVisible();
  await expect(question.getByRole('alert')).toHaveText(BLOCKED);
  await expect(question.getByLabel('Thema')).toHaveValue('Token Runde');
  await expect(question.getByLabel('Zeit')).toHaveValue('15:00');
  await question.getByLabel('Thema').fill('Planung Runde');
  await question.getByRole('button', { name: 'Anlegen' }).click();
  await expect.poll(() => hash(page)).toBe(hashOf('2026-10-29 1500 Planung Runde', 1));
  await expect(field(page, 'Ort')).toHaveValue('Raum 2');
});

test('a Termin whose page can not be looked up opens the question with a message instead of doing nothing', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  // GitHub antwortet auf jede Anfrage nach einer Datei mit einem Serverfehler: Ob es die Seite schon gibt, ist nicht zu klären.
  repo.failReads = true;
  await meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ }).click();
  const question = questionOf(page);
  await expect(question).toBeVisible();
  await expect(question.getByRole('alert')).toHaveText(FAILED);
  await expect(question.getByLabel('Thema')).toHaveValue(THEMA);
  await expect(question.getByLabel('Zeit')).toHaveValue('08:00');
  expect(await hash(page)).toBe(DAY);
  expect(await queued(page)).toEqual({});

  // Geht es wieder, legt derselbe Dialog die Besprechung an, mit dem Ort des Termins.
  repo.failReads = false;
  await question.getByRole('button', { name: 'Anlegen' }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(field(page, 'Ort')).toHaveValue('Klagenfurt');
  await upload(page, repo, 1);
  expect(repo.puts[0].path).toBe(PAGE1);
});

// ---------- Kalender ----------

test('the calendar marks today, holidays and days with appointments, and a tap opens the day', async ({ page }) => {
  await openSeeded(page, DAY);
  const card = calendar(page);
  await expect(card.getByRole('heading', { name: 'Oktober 2026' })).toBeVisible();

  const today = card.getByRole('link', { name: 'Do 29.10.2026, heute, 1 Termin', exact: true });
  await expect(today).toHaveAttribute('aria-current', 'date');
  await expect(today).toHaveAttribute('href', '#/tag/2026-10-29');

  // Feiertage wie im Planer: Text #a8674f auf #f8efea.
  const holiday = card.getByRole('link', { name: 'Mo 26.10.2026, Nationalfeiertag', exact: true });
  await expect(holiday).toHaveCSS('color', 'rgb(168, 103, 79)');
  await expect(holiday).toHaveCSS('background-color', 'rgb(248, 239, 234)');

  const withAppointment = card.getByRole('link', { name: 'Fr 30.10.2026, 1 Termin', exact: true });
  await expect(withAppointment).toBeVisible();
  const plain = card.getByRole('link', { name: 'Fr 23.10.2026', exact: true });
  await expect(plain).toBeVisible();
  await expect(plain).not.toHaveAttribute('aria-current', 'date');

  // Der Montag steht links: Die erste Zeile beginnt am Montag, 28.9.
  const first = card.getByRole('link').first();
  await expect(first).toHaveAttribute('href', '#/tag/2026-09-28');

  await withAppointment.click();
  await expect.poll(() => hash(page)).toBe('#/tag/2026-10-30');
  await expect(meetings(page).getByRole('button', { name: /Schulung Beispiel/ })).toBeVisible();
  await expect(card.getByRole('link', { name: 'Fr 30.10.2026, 1 Termin', exact: true })).toBeVisible();
});

test('a month with six weeks fits into the card', async ({ page }) => {
  await openSeeded(page, '#/tag/2027-08-15'); // der 1. August 2027 ist ein Sonntag: sechs Zeilen
  const card = calendar(page);
  await expect(card.getByRole('heading', { name: 'August 2027' })).toBeVisible();
  await expect(card.getByRole('link')).toHaveCount(42);
  const frame = await card.boundingBox();
  expect(frame, 'Karte').not.toBeNull();
  const heights: number[] = [];
  for (const link of await card.getByRole('link').all()) {
    const box = (await link.boundingBox())!;
    expect(box.y, 'oben in der Karte').toBeGreaterThanOrEqual(frame!.y);
    expect(box.y + box.height, 'unten in der Karte').toBeLessThanOrEqual(frame!.y + frame!.height + 0.5);
    expect(box.height, 'sichtbar hoch').toBeGreaterThan(8);
    heights.push(box.height);
  }
  // Alle sechs Zeilen teilen sich die Höhe gleich: keine ist kleiner gedrückt als die anderen.
  expect(Math.max(...heights) - Math.min(...heights), 'gleich hohe Zeilen').toBeLessThan(1);
});

test('many appointments scroll inside the card, and the last one can still be opened', async ({ page }) => {
  const lines = ['# Termine'];
  for (let hour = 7; hour < 12; hour++) lines.push(`- 2026-10-29 ${String(hour).padStart(2, '0')}:00 bis ${String(hour).padStart(2, '0')}:30 | Runde ${hour} | Raum ${hour} | Outlook`);
  await openSeeded(page, DAY, { files: { [TERMINE]: `${lines.join('\n')}\n` } });
  const list = meetings(page);
  await expect(list.getByRole('button', { name: /Runde 7/ })).toBeVisible();
  // Die Karte ist zu klein für alle: Die Liste scrollt (hier mit dem Rad), der Knopf „+ Besprechung“ bleibt unten stehen und verdeckt nichts.
  const scroller = list.locator('.eintraege');
  expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight), 'die Liste ist länger als die Karte').toBe(true);
  const area = (await scroller.boundingBox())!;
  await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => scroller.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const last = list.getByRole('button', { name: /Runde 11/ });
  // Am Ende der Liste liegt der letzte Eintrag ganz im Sichtfeld der Liste, über dem Knopf.
  await expect
    .poll(async () => {
      const box = await last.boundingBox();
      return box !== null && box.y >= area.y - 1 && box.y + box.height <= area.y + area.height + 1;
    })
    .toBe(true);
  await last.click();
  await expect.poll(() => hash(page)).toBe(hashOf('2026-10-29 1100 Runde 11', 1));
  await expect(field(page, 'Ort')).toHaveValue('Raum 11');
});

// ---------- Fehlende und kaputte Dateien ----------

test('a BOM at the start of Termine.md does not hide the first appointment', async ({ page }) => {
  const termine = '﻿- 2026-10-29 08:00 bis 14:00 | Abstimmung Beispiel 2027 | Klagenfurt | Outlook\n';
  await openSeeded(page, DAY, { files: { [TERMINE]: termine } });
  await expect(meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ })).toBeVisible();
  await expect(calendar(page).getByRole('link', { name: 'Do 29.10.2026, heute, 1 Termin', exact: true })).toBeVisible();
});

test('a malformed line in Termine.md is skipped and the page loads', async ({ page }) => {
  const termine = ['# Termine', 'kaputt', '- 2026-13-45 99:99 bis 10:00 | Gibt es nicht', '- 2026-10-29 08:00 | ohne Ende', '- 2026-10-29 09:00 bis 10:00 | Gut | Raum 1 | Outlook', ''].join('\n');
  await openSeeded(page, DAY, { files: { [TERMINE]: termine } });
  await expect(meetings(page).getByRole('button', { name: /Gut/ })).toBeVisible();
  await expect(meetings(page).getByRole('button')).toHaveCount(2); // der Termin und „+ Besprechung“
  await expect(checkbox(page, NAME1)).toBeVisible();
});

test('without Termine.md the page still loads and a meeting can be added', async ({ page }) => {
  await openSeeded(page, DAY, { omit: [TERMINE] });
  await expect(checkbox(page, NAME1)).toBeVisible();
  await expect(meetings(page).getByText('Keine Termine')).toBeVisible();
  await expect(calendar(page).getByRole('link', { name: 'Do 29.10.2026, heute', exact: true })).toBeVisible();
  await button(page, '+ Besprechung').click();
  await expect(questionOf(page)).toBeVisible();
});

test('a failing year listing does not stop the page', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await page.route(
    (url) => url.hostname === 'api.github.com' && decodeURIComponent(url.pathname).endsWith('/contents/07 Anhänge/Notizbuch/2026'),
    (route) => route.fulfill({ status: 500, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: '{"message":"Server Error"}' }),
  );
  await go(page, '#/tag/2026-10-30'); // die Karten werden neu aufgebaut, die Liste scheitert
  await expect(meetings(page).getByRole('button', { name: /Schulung Beispiel/ })).toBeVisible();
  await go(page, DAY);
  const entry = meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ });
  await expect(entry).toBeVisible();
  await checkbox(page, NAME1).check();
  await entry.click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await upload(page, repo, 2);
});

// ---------- Stift, Maus, Ansicht ----------

test('the pen draws nothing inside a card, and a stroke stops at the edge of a card', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  await pen(page).stroke([
    [100, 300],
    [200, 320],
    [300, 300],
  ]); // Morgenbriefing
  await pen(page).stroke([
    [800, 200],
    [900, 220],
  ]); // Kalender
  await pen(page).stroke([
    [800, 500],
    [900, 520],
  ]); // Besprechungen
  expect(await strokeCount(page)).toBe(0);
  expect(await inkNear(page, [200, 310], 20)).toBe(0);

  // Ein Strich aus dem Notizfeld nach oben in die Karte endet am Rand der Karte (sie reicht bis 630).
  await pen(page).stroke([
    [200, 800],
    [200, 700],
    [200, 600],
    [200, 500],
  ]);
  expect(await strokeCount(page)).toBe(1);
  const ys = await page.evaluate(() => window.__notizbuch.currentPage().strokes[0].pts.map((p) => p.y));
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(630);
  expect(await inkNear(page, [200, 500], 10)).toBe(0);
});

test('the pen still writes in the fields below the cards', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  await pen(page).stroke([
    [200, 900],
    [260, 920],
    [320, 900],
  ]);
  expect(await strokeCount(page)).toBe(1);
});

test('cards move and zoom with the page', async ({ page }) => {
  await openSeeded(page, DAY);
  const card = region(page, 'Morgenbriefing');
  await expect(checkbox(page, NAME1)).toBeVisible();

  // Wie weit die Karte vom Ort entfernt ist, an dem die Seite sie hat (Ecken oben links und unten rechts, Bildschirmpunkte).
  const offBy = async (): Promise<number> => {
    const box = await card.boundingBox();
    if (!box) return Infinity;
    const at = await page.evaluate(() => ({ a: window.__notizbuch.toClient(48, 144), b: window.__notizbuch.toClient(48 + 628, 144 + 486) }));
    return Math.max(Math.abs(box.x - at.a.x), Math.abs(box.y - at.a.y), Math.abs(box.x + box.width - at.b.x), Math.abs(box.y + box.height - at.b.y));
  };
  await expect.poll(offBy).toBeLessThan(1);
  const before = await viewOf(page);
  await wheel(page, [600, 800], { dy: 120 });
  await expect.poll(async () => (await viewOf(page)).y).toBeLessThan(before.y);
  await expect.poll(offBy).toBeLessThan(1);
  await wheel(page, [600, 800], { dy: -300, ctrl: true });
  await expect.poll(async () => (await viewOf(page)).scale).toBeGreaterThan(before.scale);
  await expect.poll(offBy).toBeLessThan(1);
});

test('a wheel over a card moves and zooms the page, and a card that can scroll scrolls first', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  const over = async (x: number, y: number) => {
    const at = await page.evaluate(([px, py]) => window.__notizbuch.toClient(px, py), [x, y]);
    await page.mouse.move(at.x, at.y);
  };
  const inner = region(page, 'Morgenbriefing').locator('.karten-inhalt');
  const scrolled = () => inner.evaluate((el) => el.scrollTop);
  const before = await viewOf(page);

  // Das Morgenbriefing ist länger als die Karte: Das Rad scrollt erst die Karte, die Seite bleibt.
  await over(300, 300);
  await page.mouse.wheel(0, 100);
  await expect.poll(scrolled).toBeGreaterThan(0);
  expect(await viewOf(page)).toEqual(before);

  // Ist die Karte am Ende, wandert die Seite wie über den Notizen.
  await inner.evaluate((el) => void (el.scrollTop = el.scrollHeight));
  await page.mouse.wheel(0, 120);
  await expect.poll(async () => (await viewOf(page)).y).toBeLessThan(before.y);

  // Über dem Kalender gibt es nichts zu scrollen: Strg mit Rad zoomt die Seite (und nicht den Browser).
  const moved = await viewOf(page);
  await over(900, 300);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -300);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await viewOf(page)).scale).toBeGreaterThan(moved.scale);
});

test('a card only pans up and down, so a pinch over it can not zoom the whole app in the browser', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  for (const name of ['Morgenbriefing', 'Kalender', 'Besprechungen']) {
    await expect(region(page, name), name).toHaveCSS('touch-action', 'pan-y');
  }
});

test('card text is readable and the controls are big enough on an iPad 11 inch in portrait', async ({ page }) => {
  await page.setViewportSize({ width: 834, height: 1194 });
  await openSeeded(page, DAY);
  await expect(checkbox(page, NAME1)).toBeVisible();
  const { scale } = await viewOf(page);
  expect(scale).toBeGreaterThan(0.65);

  const fontOf = (locator: Locator) => locator.evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
  // Text mindestens 11 px auf dem Bildschirm.
  expect((await fontOf(page.getByText('Liste Planobjekte ergänzen (fällig 30.10.)', { exact: true }))) * scale).toBeGreaterThanOrEqual(11);
  expect((await fontOf(meetings(page).getByRole('button', { name: /Abstimmung Beispiel 2027/ }))) * scale).toBeGreaterThanOrEqual(11);
  expect((await fontOf(calendar(page).getByRole('link', { name: 'Do 29.10.2026, heute, 1 Termin', exact: true }))) * scale).toBeGreaterThanOrEqual(11);
  // Eingabefelder rechnen mit mindestens 16 Punkten, sonst zoomt Safari beim Antippen in die Seite.
  expect(await fontOf(addField(page))).toBeGreaterThanOrEqual(16);

  // Fläche zum Treffen: mindestens 44 mal 44 Punkte.
  for (const target of [checkbox(page, NAME1).locator('xpath=ancestor::label[1]'), pencil(page, NAME1), button(page, 'Hinzufügen'), button(page, '+ Besprechung')]) {
    const box = await target.boundingBox();
    expect(box, 'Größe').not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(43.5);
    expect(box!.height).toBeGreaterThanOrEqual(43.5);
  }
  await button(page, '+ Besprechung').click();
  expect(await fontOf(questionOf(page).getByLabel('Thema'))).toBeGreaterThanOrEqual(16);
});

// ---------- Finger ----------

test.describe('with a touch screen', () => {
  test.use({ hasTouch: true });

  test('a finger tap ticks a task and opens a section', async ({ page }) => {
    const repo = await openSeeded(page, DAY);
    const tap = async (target: Locator) => {
      // Wie ein Mensch: Was in der Karte unten steht, holt man mit dem Finger nach oben, bevor man es antippt.
      await target.scrollIntoViewIfNeeded();
      const box = await target.boundingBox();
      expect(box, 'sichtbar').not.toBeNull();
      await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    };
    await expect(checkbox(page, NAME1)).toBeVisible();
    await tap(checkbox(page, NAME1));
    await expect(checkbox(page, NAME1)).toBeChecked();
    await tap(section(page, 'Abendüberblick (automatisch)'));
    await expect(section(page, 'Abendüberblick (automatisch)')).toHaveAttribute('aria-expanded', 'true');
    await waitUntilQueued(page, NOTE, '- [x] Liste Planobjekte ergänzen (fällig 30.10.) %%todo:AAMkTEST1%%');
    await upload(page, repo, 1);
    expect(repo.puts[0].text).toBe(NOTE_TEXT.replace(TASK1, TASK1.replace('[ ]', '[x]')));
  });
});
