import { expect, test as base, type Page, type Route } from '@playwright/test';
import { serializePage } from '../../src/ink/svg';
import type { Stroke } from '../../src/ink/types';
import { besprechungLayout } from '../../src/pages/layouts';
import { bringToForeground, openSeeded, queued, sendToBackground } from './helpers/app';
import { mouse, pen } from './helpers/pointer';

/**
 * Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und darauf, dass die App nie einen Dialog des
 * Browsers öffnet (`window.confirm` blockiert das iPad): Die Rückfrage kommt von der App selbst. Heute ist in allen
 * Tests der 29.10.2026 (Wiener Zeit).
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

const TODAY = '2026-10-29';
const DAY = `#/tag/${TODAY}`;
const BASE = '2026-10-29 0800 Abstimmung Beispiel 2027';
const THEMA = 'Abstimmung Beispiel 2027';
const FILES = '07 Anhänge/Notizbuch/2026';
const PAGE1 = `${FILES}/${BASE} S1.svg`;
const PAGE2 = `${FILES}/${BASE} S2.svg`;
const PAGE3 = `${FILES}/${BASE} S3.svg`;
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';
const QUESTION = 'Seite wirklich löschen?';
/** So beginnt jeder Strich in einer Datei. Der Hintergrund der Seite hat auch <path>-Elemente, aber keine mit `data-id`. */
const STROKE = '<path data-id=';
/** Striche im Schreibfeld der Besprechung (es beginnt bei 200 und reicht bis 1544). */
const LINE: [number, number][] = [
  [200, 500],
  [260, 520],
  [320, 500],
];
const LINE_2: [number, number][] = [
  [200, 700],
  [260, 720],
  [320, 700],
];

const hashOf = (base: string, n: number) => `#/besprechung/${encodeURIComponent(base)}/${n}`;
const hash = (page: Page) => page.evaluate(() => window.location.hash);
const go = (page: Page, next: string) => page.evaluate((h) => void (window.location.hash = h), next);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const link = (page: Page, name: string) => page.getByRole('link', { name, exact: true });
const field = (page: Page, label: string) => page.getByLabel(label, { exact: true });
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const headerOf = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().meta);
const waitForPageOf = (page: Page, kind: string, key: string) =>
  page.waitForFunction(
    ([k, id]) => {
      const current = window.__notizbuch?.currentPage?.();
      return current?.kind === k && current.key === id;
    },
    [kind, key],
  );
const waitForPageNumber = (page: Page, n: number) =>
  page.waitForFunction((want) => window.__notizbuch?.currentPage?.().meta.seitennr === want, String(n));

/** Ein Strich im Schreibfeld der Seite, wie ihn ein anderes Gerät geschrieben hätte. */
function strokeOf(id: string): Stroke {
  return { id, tool: 'kugel', color: 'schwarz', widthMm: 0.2, t: 1000, w: 1.2, pts: [{ x: 200, y: 900, w: 1.2 }, { x: 260, y: 920, w: 1.2 }] };
}

/** Eine Seite der Besprechung als Datei, so wie die App sie schreibt (Kopfdaten und der Hintergrund, der sie zeigt). */
function pageText(n: number, meta: Record<string, string> = {}, base = BASE, strokes: Stroke[] = []): string {
  const full = { thema: THEMA, datum: TODAY, zeit: '08:00', ort: '', projekt: '', ...meta, seitennr: String(n) };
  const layout = besprechungLayout(full);
  return serializePage({ kind: 'besprechung', key: base, meta: full, strokes }, layout.fields, layout.background());
}

/** Eine Seite aus der Zeit vor den Kopfdaten: ohne jede Angabe. */
function oldPageText(base = BASE): string {
  return serializePage({ kind: 'besprechung', key: base, meta: {}, strokes: [] }, besprechungLayout({}).fields, besprechungLayout({}).background());
}

/** Der Text, den die Warteschlange dieses Geräts für eine Datei hält. */
async function queuedText(page: Page, path: string): Promise<string> {
  return (await queued(page))[path] ?? '';
}

/** Sobald die Warteschlange den Text hat, der `needle` enthält, ist er lokal gesichert: Erst dann geht er mit dem Abgleich hoch. */
async function waitUntilQueued(page: Page, path: string, needle: string) {
  await expect.poll(() => queuedText(page, path), { message: `${needle} in der Warteschlange` }).toContain(needle);
}

// ---------- Kopf ----------

test('project choice lands in the file', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  const project = field(page, 'Projekt');
  // Die Auswahl kommt aus der Dateiliste von 02 Projekte: nur die Namen, ohne Endung.
  await expect(project.locator('option')).toHaveText(['kein Projekt', 'Beispielprojekt A', 'Beispielprojekt B']);
  await project.selectOption('Beispielprojekt A');
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE1, STROKE);
  await sendToBackground(page);

  await expect.poll(() => repo.puts.length).toBe(1);
  const [put] = repo.puts;
  expect(put.path).toBe(PAGE1);
  expect(put.text).toContain('data-projekt="Beispielprojekt A"');
  expect(put.text).toContain(STROKE);
  expect(put.text).toContain('Beispielprojekt A</text>'); // auch im Hintergrund der Seite
  expect(repo.deletes).toEqual([]);
});

test('header edit keeps the file name', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await field(page, 'Thema').fill('Neues Thema');
  await field(page, 'Ort').fill('Raum 3');
  await field(page, 'Datum').fill('2026-10-30');
  await field(page, 'Zeit').fill('09:15');
  await waitUntilQueued(page, PAGE1, 'data-zeit="09:15"');
  await sendToBackground(page);

  await expect.poll(() => repo.puts.length).toBeGreaterThan(0);
  const text = repo.read(PAGE1)!;
  for (const part of ['data-thema="Neues Thema"', 'data-ort="Raum 3"', 'data-datum="2026-10-30"', 'data-zeit="09:15"', 'data-seitennr="1"']) {
    expect(text, part).toContain(part);
  }
  expect(text).toContain('Neues Thema</text>'); // der Hintergrund zeigt den neuen Kopf
  expect(text).not.toContain(`${THEMA}</text>`);
  // Dieselbe Datei, kein neuer Name, nichts gelöscht, und der Schlüssel der Seite ist der alte Name.
  expect([...new Set(repo.puts.map((p) => p.path))]).toEqual([PAGE1]);
  expect(repo.deletes).toEqual([]);
  expect(text).toContain(`data-schluessel="${BASE}"`);
  expect(await hash(page)).toBe(hashOf(BASE, 1));
});

test('special characters in the header survive the file and come back as typed', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  const thema = 'Sperren & "Muster" <2027>';
  const ort = 'Büro Ä & Ö 🙂';
  await field(page, 'Thema').fill(thema);
  await field(page, 'Ort').fill(ort);
  await waitUntilQueued(page, PAGE1, 'data-ort="Büro Ä &amp; Ö 🙂"');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBeGreaterThan(0);
  const text = repo.read(PAGE1)!;
  expect(text).toContain('data-thema="Sperren &amp; &quot;Muster&quot; &lt;2027&gt;"');
  expect(text).toContain('Sperren &amp; "Muster" &lt;2027&gt;</text>'); // im Hintergrund der Seite

  // Wieder öffnen: Die Felder zeigen genau, was getippt wurde.
  await go(page, DAY);
  await waitForPageOf(page, 'tag', TODAY);
  await go(page, hashOf(BASE, 1));
  await waitForPageOf(page, 'besprechung', BASE);
  await expect(field(page, 'Thema')).toHaveValue(thema);
  await expect(field(page, 'Ort')).toHaveValue(ort);
});

test('an address with decomposed umlauts opens the same page and saves under the name the vault uses', async ({ page }) => {
  const composed = '2026-10-29 0900 M\u00fcller Abstimmung';
  const decomposed = '2026-10-29 0900 Mu\u0308ller Abstimmung';
  const path = `${FILES}/${composed} S1.svg`;
  const repo = await openSeeded(page, hashOf(decomposed, 1), {
    files: { [path]: pageText(1, { thema: 'M\u00fcller Abstimmung', zeit: '09:00' }, composed) },
  });
  await expect(field(page, 'Thema')).toHaveValue('M\u00fcller Abstimmung');
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, path, STROKE);
  // Eine Warteschlange, ein Name: Nicht dieselbe Seite noch einmal unter der Schreibweise mit Buchstabe plus Trema.
  expect(Object.keys(await queued(page))).toEqual([path]);
  expect((await headerOf(page)).thema).toBe('M\u00fcller Abstimmung');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([path]);
  expect(repo.puts[0].text).toContain(`data-schluessel="${composed}"`);
});

test('the header shows what the file says, and a field that is not valid is not saved', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1, { ort: 'Musterort', projekt: 'Beispielprojekt B' }) } });
  await expect(field(page, 'Thema')).toHaveValue(THEMA);
  await expect(field(page, 'Datum')).toHaveValue(TODAY);
  await expect(field(page, 'Zeit')).toHaveValue('08:00');
  await expect(field(page, 'Ort')).toHaveValue('Musterort');
  await expect(field(page, 'Projekt')).toHaveValue('Beispielprojekt B');

  // Ein geleertes Datum oder eine geleerte Zeit ist keine Angabe: Die Seite behält die alte, und das Feld zeigt sie wieder.
  await field(page, 'Datum').fill('');
  await field(page, 'Zeit').fill('');
  await field(page, 'Thema').focus(); // das Verlassen der Felder
  await expect(field(page, 'Datum')).toHaveValue(TODAY);
  await expect(field(page, 'Zeit')).toHaveValue('08:00');
  expect(await headerOf(page)).toMatchObject({ datum: TODAY, zeit: '08:00' });
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

test('a date or a time that the picker reports with a change event only is saved too', async ({ page }) => {
  // Manche Auswahlfenster (iPadOS) melden nur `change`, nicht `input`.
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  const pick = (label: string, value: string) =>
    field(page, label).evaluate((el, v) => {
      (el as HTMLInputElement).value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);
  await pick('Datum', '2026-10-30');
  await pick('Zeit', '09:15');
  await waitUntilQueued(page, PAGE1, 'data-zeit="09:15"');
  expect(await headerOf(page)).toMatchObject({ datum: '2026-10-30', zeit: '09:15' });

  // Beim Verlassen der Felder zeigen sie, was die Seite hat: die Auswahl, nicht den alten Wert.
  await field(page, 'Thema').focus();
  await expect(field(page, 'Datum')).toHaveValue('2026-10-30');
  await expect(field(page, 'Zeit')).toHaveValue('09:15');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBeGreaterThan(0);
  expect(repo.read(PAGE1)).toContain('data-datum="2026-10-30"');
  expect(repo.read(PAGE1)).toContain('data-zeit="09:15"');
});

test('a page that does not exist yet starts with the header from its name', async ({ page }) => {
  const base = '2026-10-29 1430 Muster anrufen';
  const path = `${FILES}/${base} S1.svg`;
  const repo = await openSeeded(page, hashOf(base, 1));
  await expect(field(page, 'Thema')).toHaveValue('Muster anrufen');
  await expect(field(page, 'Datum')).toHaveValue(TODAY);
  await expect(field(page, 'Zeit')).toHaveValue('14:30');
  await expect(field(page, 'Projekt')).toHaveValue('');
  await expect(page.locator('.reiter[aria-current="true"]')).toHaveText('OKT');
  // Ansehen legt keine Datei an.
  expect(await queued(page)).toEqual({});

  await field(page, 'Ort').fill('Musterort');
  await waitUntilQueued(page, path, 'data-ort="Musterort"');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([path]);
  const text = repo.puts[0].text;
  for (const part of ['data-thema="Muster anrufen"', 'data-datum="2026-10-29"', 'data-zeit="14:30"', 'data-ort="Musterort"', 'data-seitennr="1"', `data-schluessel="${base}"`]) {
    expect(text, part).toContain(part);
  }
});

test('an old page without header data gets one from its name, written with the next change and not before', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: oldPageText() } });
  await expect(field(page, 'Thema')).toHaveValue(THEMA);
  await expect(field(page, 'Zeit')).toHaveValue('08:00');
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);

  await pen(page).stroke(LINE);
  await waitUntilQueued(page, PAGE1, STROKE);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).toContain(`data-thema="${THEMA}"`);
  expect(repo.puts[0].text).toContain('data-zeit="08:00"');
});

test('a stroke and a header change at the same time are both kept', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await pen(page).stroke(LINE);
  await field(page, 'Thema').fill('Mitten im Schreiben'); // gleich danach, ohne zu warten
  await pen(page).stroke(LINE_2);
  expect(await strokeCount(page)).toBe(2);
  expect(await headerOf(page)).toMatchObject({ thema: 'Mitten im Schreiben' });

  // Der Verlauf bleibt: Rückgängig nimmt die Striche der Reihe nach zurück, auch den, der vor der Änderung am Kopf entstand.
  // Der Kopf gehört nicht zum Verlauf.
  await button(page, 'Rückgängig').click();
  expect(await strokeCount(page)).toBe(1);
  await expect(button(page, 'Rückgängig')).toBeEnabled();
  await button(page, 'Rückgängig').click();
  expect(await strokeCount(page)).toBe(0);
  expect(await headerOf(page)).toMatchObject({ thema: 'Mitten im Schreiben' });
  await button(page, 'Wiederholen').click();
  await button(page, 'Wiederholen').click();
  expect(await strokeCount(page)).toBe(2);

  await waitUntilQueued(page, PAGE1, 'data-thema="Mitten im Schreiben"');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const text = repo.puts[0].text;
  expect(text.split(STROKE).length - 1).toBe(2);
  expect(text).toContain('data-thema="Mitten im Schreiben"');
});

test('a header change after a stroke keeps the stroke in the file, although it is the last change of the page', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await pen(page).stroke(LINE);
  await waitUntilQueued(page, PAGE1, STROKE);
  await field(page, 'Ort').fill('Raum 7');
  await waitUntilQueued(page, PAGE1, 'data-ort="Raum 7"');
  expect(await queuedText(page, PAGE1)).toContain(STROKE);

  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBeGreaterThan(0);
  const text = repo.read(PAGE1)!;
  expect(text.split(STROKE).length - 1).toBe(1);
  expect(text).toContain('data-ort="Raum 7"');
  expect(await strokeCount(page)).toBe(1);
});

test('a stroke that is just being drawn when the header changes is kept and carries the new header', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  const [first, ...rest] = LINE;
  await pen(page).down(...first);
  await pen(page).move(...rest[0]);
  await field(page, 'Ort').fill('Raum 7'); // der Stift liegt noch auf
  await pen(page).move(...rest[1]);
  await pen(page).up(...rest[1]);
  expect(await strokeCount(page)).toBe(1);
  expect(await headerOf(page)).toMatchObject({ ort: 'Raum 7' });

  await waitUntilQueued(page, PAGE1, STROKE);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).toContain(STROKE);
  expect(repo.puts[0].text).toContain('data-ort="Raum 7"');
});

test('strokes queued on this device and a project set on another device are both kept when the page goes up', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE1, STROKE);

  // Am Firmen-PC wird das Projekt gewählt und hochgeladen, bevor dieses Gerät etwas hochgeladen hat.
  repo.commit(PAGE1, pageText(1, { projekt: 'Beispielprojekt A' }));
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const text = repo.read(PAGE1)!;
  expect(text).toContain('data-projekt="Beispielprojekt A"');
  expect(text.split(STROKE).length - 1).toBe(1);
  // Und die Seite zeigt es: das Projekt vom PC und den eigenen Strich.
  await expect(field(page, 'Projekt')).toHaveValue('Beispielprojekt A');
  expect(await strokeCount(page)).toBe(1);
  expect(repo.puts.map((p) => p.path)).toEqual([PAGE1]); // keine Konfliktkopie
});

test('a project chosen on this device and a stroke drawn on another device are both kept when the page goes up', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await field(page, 'Projekt').selectOption('Beispielprojekt B');
  await waitUntilQueued(page, PAGE1, 'data-projekt="Beispielprojekt B"');

  repo.commit(PAGE1, pageText(1, {}, BASE, [strokeOf('fremd')]));
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  const text = repo.read(PAGE1)!;
  expect(text).toContain('data-projekt="Beispielprojekt B"');
  expect(text).toContain('data-id="fremd"');
  await expect.poll(() => strokeCount(page)).toBe(1); // der Strich vom anderen Gerät ist zu sehen
  await expect(field(page, 'Projekt')).toHaveValue('Beispielprojekt B');
});

const UNUSABLE = [
  { name: 'not loaded', options: { files: { [PAGE1]: pageText(1) }, failReads: true } },
  { name: 'not readable', options: { files: { [PAGE1]: BROKEN } } },
];

for (const { name, options } of UNUSABLE) {
  test(`the header can not be changed on a page that is ${name}`, async ({ page }) => {
    const repo = await openSeeded(page, hashOf(BASE, 1), options);
    for (const label of ['Thema', 'Datum', 'Zeit', 'Ort', 'Projekt']) await expect(field(page, label)).toBeDisabled();
    await expect(button(page, '+ Seite')).toBeDisabled();
    await sendToBackground(page);
    expect(repo.puts).toEqual([]);
    expect(await queued(page)).toEqual({});
  });
}

test('a meeting address typed by hand with a blocked word shows that the app does not open it, and is not tried again', async ({ page }) => {
  const blocked = '2026-10-29 0800 Passwort Liste';
  const repo = await openSeeded(page, hashOf(blocked, 1));
  const notice = page.getByRole('alert').filter({ hasText: 'Die App öffnet diese Seite nicht' });
  await expect(notice).toBeVisible();
  await expect(page.getByText('Neuer Versuch', { exact: false })).toHaveCount(0);
  for (const label of ['Thema', 'Datum', 'Zeit', 'Ort', 'Projekt']) await expect(field(page, label)).toBeDisabled();
  await expect(button(page, '+ Seite')).toBeDisabled();
  await pen(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  // Die App kommt wieder in den Vordergrund (ein Anlass für einen neuen Versuch): Es bleibt dabei.
  await sendToBackground(page);
  await bringToForeground(page);
  await expect(notice).toBeVisible();
  expect(repo.requests.filter((request) => request.includes('Passwort'))).toEqual([]); // die Pfadsperre fragt GitHub nie
  expect(repo.puts).toEqual([]);
  expect(await queued(page)).toEqual({});
});

test('on the office PC the header can be typed, and nothing can be inked or added', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) }, device: 'Firmen-PC' });
  await expect(page.locator('.leiste')).toHaveCount(0); // keine Werkzeuge
  await expect(button(page, '+ Seite')).toHaveCount(0);
  await expect(button(page, 'Seite löschen')).toHaveCount(0);
  await expect(page.getByText('Seite 1 von 1', { exact: true })).toBeVisible();

  await mouse(page).stroke(LINE);
  await pen(page).stroke(LINE);
  expect(await strokeCount(page)).toBe(0);
  expect(await queued(page)).toEqual({});

  await field(page, 'Ort').fill('Büro');
  await field(page, 'Projekt').selectOption('Beispielprojekt B');
  await waitUntilQueued(page, PAGE1, 'data-projekt="Beispielprojekt B"');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).toContain('data-ort="Büro"');
  expect(repo.puts[0].path).toBe(PAGE1);
});

// ---------- Projektliste ----------

test('without network the project list is kein Projekt and the project of the page, and the full list is back at the next opening', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1, { projekt: 'Beispielprojekt A' }) } });
  const project = field(page, 'Projekt');
  await expect(project.locator('option')).toHaveText(['kein Projekt', 'Beispielprojekt A', 'Beispielprojekt B']);
  await expect(project).toHaveValue('Beispielprojekt A');

  const offline = (route: Route) => route.abort('internetdisconnected');
  await page.route('https://api.github.com/**', offline);
  await go(page, DAY);
  await waitForPageOf(page, 'tag', TODAY);
  await go(page, hashOf(BASE, 1));
  await waitForPageOf(page, 'besprechung', BASE);
  await expect(project.locator('option')).toHaveText(['kein Projekt', 'Beispielprojekt A']);
  await expect(project).toHaveValue('Beispielprojekt A');

  await page.unroute('https://api.github.com/**', offline);
  await go(page, DAY);
  await waitForPageOf(page, 'tag', TODAY);
  await go(page, hashOf(BASE, 1));
  await waitForPageOf(page, 'besprechung', BASE);
  await expect(project.locator('option')).toHaveText(['kein Projekt', 'Beispielprojekt A', 'Beispielprojekt B']);
  await expect(project).toHaveValue('Beispielprojekt A');
});

test('a project that is no longer in the list stays selected', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1, { projekt: 'Altes Projekt' }) } });
  const project = field(page, 'Projekt');
  await expect(project.locator('option')).toHaveText(['kein Projekt', 'Beispielprojekt A', 'Beispielprojekt B', 'Altes Projekt']);
  await expect(project).toHaveValue('Altes Projekt');
});

test('choosing kein Projekt takes the project out of the file', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1, { projekt: 'Beispielprojekt A' }) } });
  await field(page, 'Projekt').selectOption({ label: 'kein Projekt' });
  await waitUntilQueued(page, PAGE1, 'data-projekt=""');
  await sendToBackground(page);
  await expect.poll(() => repo.puts.length).toBe(1);
  expect(repo.puts[0].text).not.toContain('Beispielprojekt A');
});

// ---------- Seiten ----------

test('the page bar says which page of how many', async ({ page }) => {
  const other = `${FILES}/2026-10-29 0900 Muster S1.svg`;
  await openSeeded(page, hashOf(BASE, 2), {
    files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2), [PAGE3]: pageText(3), [other]: pageText(1, { thema: 'Muster' }, '2026-10-29 0900 Muster') },
  });
  // Gezählt werden nur die Seiten dieser Besprechung.
  await expect(page.getByText('Seite 2 von 3', { exact: true })).toBeVisible();
});

test('a page that is not in the list yet counts anyway', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1) } });
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
});

test('without a list only the number of the page is shown', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 2), { offline: true });
  await expect(page.getByText('Seite 2', { exact: true })).toBeVisible();
  await expect(page.getByText(/ von /)).toHaveCount(0);
});

test('plus page opens S2', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), {
    files: { [PAGE1]: pageText(1, { ort: 'Musterort', projekt: 'Beispielprojekt A' }) },
  });
  await expect(page.getByText('Seite 1 von 1', { exact: true })).toBeVisible();
  await button(page, '+ Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 2));
  await waitForPageNumber(page, 2);
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  // Dieselben Kopfdaten, auch die, die nicht im Namen stehen.
  await expect(field(page, 'Thema')).toHaveValue(THEMA);
  await expect(field(page, 'Ort')).toHaveValue('Musterort');
  await expect(field(page, 'Projekt')).toHaveValue('Beispielprojekt A');

  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([PAGE2]);
  const text = repo.puts[0].text;
  for (const part of ['data-seitennr="2"', 'data-projekt="Beispielprojekt A"', 'data-ort="Musterort"', `data-thema="${THEMA}"`, `data-schluessel="${BASE}"`]) {
    expect(text, part).toContain(part);
  }
  expect(text).toContain('Seite 2</text>'); // der Hintergrund zählt mit
  expect(repo.read(PAGE1)).toBe(pageText(1, { ort: 'Musterort', projekt: 'Beispielprojekt A' })); // Seite 1 bleibt, wie sie war
});

test('plus page takes the header as it is now, even when it was just changed', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await field(page, 'Ort').fill('Raum 9');
  await button(page, '+ Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 2));
  await waitForPageNumber(page, 2);
  await expect(field(page, 'Ort')).toHaveValue('Raum 9');
  await sendToBackground(page);
  await expect.poll(() => repo.read(PAGE2) ?? '').toContain('data-ort="Raum 9"');
  await expect.poll(() => repo.read(PAGE1) ?? '').toContain('data-ort="Raum 9"');
});

test('a new page never takes the number of a page that exists on this device only', async ({ page }) => {
  // Seite 2 gibt es nur hier: Der Upload scheitert, also kennt GitHub sie nicht und die Ordnerliste auch nicht.
  await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1) }, failWrites: true });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE2, STROKE);

  await go(page, hashOf(BASE, 1));
  await waitForPageNumber(page, 1);
  // Gezählt wird auch die Seite, die GitHub nicht listet und die es nur auf diesem Gerät gibt.
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await button(page, '+ Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 3));
  await waitForPageNumber(page, 3);
  await expect(page.getByText('Seite 3 von 3', { exact: true })).toBeVisible();
  expect(await strokeCount(page)).toBe(0);

  await go(page, hashOf(BASE, 2));
  await waitForPageNumber(page, 2);
  expect(await strokeCount(page)).toBe(1); // Seite 2 hat ihren Strich noch
});

// ---------- Blättern ----------

test('the arrows of the top bar page through the pages: ‹ on S2 opens S1 with its strokes', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE1, STROKE);
  await button(page, '+ Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 2));
  await waitForPageNumber(page, 2);
  expect(await strokeCount(page)).toBe(0);

  // Vorher gab es von Seite 2 keinen Weg zurück.
  await link(page, 'Vorige Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await waitForPageNumber(page, 1);
  expect(await strokeCount(page)).toBe(1);
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();

  // Und wieder vor.
  await link(page, 'Nächste Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 2));
  await waitForPageNumber(page, 2);
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
});

test('› on the last page is disabled, and ‹ on the first page too', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 3), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2), [PAGE3]: pageText(3) } });
  await expect(page.getByText('Seite 3 von 3', { exact: true })).toBeVisible();
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(link(page, 'Vorige Seite')).toHaveAttribute('href', hashOf(BASE, 2));

  await link(page, 'Vorige Seite').click();
  await waitForPageNumber(page, 2);
  await expect(link(page, 'Vorige Seite')).toHaveAttribute('href', hashOf(BASE, 1));
  await expect(link(page, 'Nächste Seite')).toHaveAttribute('href', hashOf(BASE, 3));

  await link(page, 'Vorige Seite').click();
  await waitForPageNumber(page, 1);
  await expect(button(page, 'Vorige Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(link(page, 'Nächste Seite')).toHaveAttribute('href', hashOf(BASE, 2));
  // Ein grauer Pfeil führt nirgends hin.
  await button(page, 'Vorige Seite').click({ force: true });
  expect(await hash(page)).toBe(hashOf(BASE, 1));
});

test('a page that is only opened and exists nowhere yet is the last page: › is grey, ‹ leads to the page before', async ({ page }) => {
  // Seite 2 wird nur geöffnet: weder GitHub noch dieses Gerät kennen Seite 3. Die Seite davor gibt es.
  await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1) } });
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');
  await expect(link(page, 'Vorige Seite')).toHaveAttribute('href', hashOf(BASE, 1));
});

test('a missing page in between is skipped, and the label counts the pages that are there', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 3), { files: { [PAGE1]: pageText(1), [PAGE3]: pageText(3) } });
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  await expect(link(page, 'Vorige Seite')).toHaveAttribute('href', hashOf(BASE, 1));
  await link(page, 'Vorige Seite').click();
  await waitForPageNumber(page, 1);
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await expect(link(page, 'Nächste Seite')).toHaveAttribute('href', hashOf(BASE, 3));
});

test('without network ‹ opens the page before from this device, and › stays grey where the next page is unknown', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE1, STROKE);
  await button(page, '+ Seite').click();
  await waitForPageNumber(page, 2);

  // Ab jetzt ist GitHub nicht mehr zu erreichen, und die App startet neu: Es gibt nur, was dieses Gerät hat.
  await page.route('https://api.github.com/**', (route) => route.abort('internetdisconnected'));
  await page.reload();
  await waitForPageNumber(page, 2);
  await expect(page.getByText('Seite 2', { exact: true })).toBeVisible(); // ohne Liste nur die Nummer
  await expect(page.getByText(/ von /)).toHaveCount(0);
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');

  await link(page, 'Vorige Seite').click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await waitForPageNumber(page, 1);
  expect(await strokeCount(page)).toBe(1);
  // Seite 2 hat dieses Gerät, also führt › dorthin.
  await expect(link(page, 'Nächste Seite')).toHaveAttribute('href', hashOf(BASE, 2));
});

test('without network and without a copy of the page before, ‹ still goes to the number before, and › stays grey', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 2), { offline: true });
  await expect(page.getByText('Seite 2', { exact: true })).toBeVisible();
  await expect(link(page, 'Vorige Seite')).toHaveAttribute('href', hashOf(BASE, 1));
  await expect(button(page, 'Nächste Seite')).toHaveAttribute('aria-disabled', 'true');
});

test('after a middle page is deleted the label counts the pages that are left, and the arrows skip it', async ({ page }) => {
  // Das Löschen kommt bei GitHub nicht an (Schreiben scheitert): Dort steht Seite 2 noch, hier ist sie weg.
  await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2), [PAGE3]: pageText(3) }, failWrites: true });
  await expect(page.getByText('Seite 2 von 3', { exact: true })).toBeVisible();
  await button(page, 'Seite löschen').click();
  await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await expect(link(page, 'Nächste Seite')).toHaveAttribute('href', hashOf(BASE, 3));

  await link(page, 'Nächste Seite').click();
  await waitForPageNumber(page, 3);
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  await expect(link(page, 'Vorige Seite')).toHaveAttribute('href', hashOf(BASE, 1));
});

test('plus page does not pull the user back when they have left the page in the meantime', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  // Die Prüfung, ob Seite 2 schon existiert, dauert: Währenddessen geht die Person zum Tag.
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let held = false;
  await page.route(/S2\.svg/, async (route) => {
    held = true;
    await gate;
    await route.fallback();
  });
  await button(page, '+ Seite').click();
  await expect.poll(() => held).toBe(true);
  await go(page, DAY);
  await waitForPageOf(page, 'tag', TODAY);
  release();

  await expect.poll(() => hash(page)).toBe(DAY); // nicht auf Seite 2
  await page.waitForTimeout(300);
  expect(await hash(page)).toBe(DAY);
  expect(await queued(page)).toEqual({}); // und keine leere Seite 2 angelegt
  await sendToBackground(page);
  expect(repo.puts).toEqual([]);
});

// ---------- Löschen ----------

test('delete asks first', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2) } });
  await button(page, 'Seite löschen').click();
  const dialog = page.getByRole('dialog', { name: QUESTION });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('button')).toHaveText(['Abbrechen', 'Löschen']);

  // Abbrechen: Die Datei bleibt, nichts wartet auf einen Abgleich, und die Seite ist noch zu beschreiben.
  await dialog.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.deletes).toEqual([]);
  expect(repo.read(PAGE2)).toBeDefined();
  expect(await hash(page)).toBe(hashOf(BASE, 2));
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE2, STROKE);

  // Löschen: DELETE für genau diese Seite, und die Seite davor geht auf.
  await button(page, 'Seite löschen').click();
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await waitForPageNumber(page, 1);
  await sendToBackground(page);
  await expect.poll(() => repo.deletes.map((d) => d.path)).toEqual([PAGE2]);
  expect(repo.read(PAGE2)).toBeUndefined();
  expect(repo.read(PAGE1)).toBeDefined();
  // Die Seite, die gelöscht wurde, kommt nicht durch einen späteren Upload wieder (auch nicht mit dem Strich von eben).
  expect(repo.puts.filter((p) => p.path === PAGE2 && p.text.includes(STROKE))).toEqual([]);
});

test('escape closes the question and keeps the page, and a stray Enter does not delete', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  const dialog = page.getByRole('dialog', { name: QUESTION });

  await button(page, 'Seite löschen').click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);

  await button(page, 'Seite löschen').click();
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(dialog).toHaveCount(0);

  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.deletes).toEqual([]);
  expect(repo.read(PAGE1)).toBeDefined();
  expect(await hash(page)).toBe(hashOf(BASE, 1));
  await expect(button(page, 'Seite löschen')).toBeFocused(); // der Fokus geht zurück an die Stelle, von der man kam
});

test('the question goes away with its page, so that it can not be taken for a question about the next one', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2) } });
  await button(page, 'Seite löschen').click();
  const dialog = page.getByRole('dialog', { name: QUESTION });
  await expect(dialog).toBeVisible();

  // Zurückwischen oder ein Link: Die Adresse wechselt, während die Rückfrage offen ist.
  await go(page, hashOf(BASE, 1));
  await waitForPageNumber(page, 1);
  await expect(dialog).toHaveCount(0);
  await expect(button(page, 'Seite löschen')).toBeEnabled();

  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  expect(repo.deletes).toEqual([]);
  expect(repo.read(PAGE1)).toBeDefined();
  expect(repo.read(PAGE2)).toBeDefined();
});

test('when the page can not be deleted, it stays, says so and can be written again', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2) } });
  await button(page, 'Seite löschen').click();
  const dialog = page.getByRole('dialog', { name: QUESTION });
  await expect(dialog).toBeVisible();

  // Das Speichern auf dem Gerät scheitert genau einmal, beim Löschen (kein Speicherplatz). Der Tipp und alles, was bis dahin
  // folgt, läuft in einer Aufgabe des Browsers: Kein anderer Zugriff kommt dazwischen.
  await dialog.getByRole('button', { name: 'Löschen', exact: true }).evaluate((el) => {
    const original = IDBDatabase.prototype.transaction;
    IDBDatabase.prototype.transaction = function () {
      IDBDatabase.prototype.transaction = original;
      throw new DOMException('Kein Speicherplatz mehr.', 'QuotaExceededError');
    };
    (el as HTMLButtonElement).click();
  });

  await expect(page.getByRole('alert').filter({ hasText: 'Die Seite konnte nicht gelöscht werden' })).toBeVisible();
  await expect(dialog).toHaveCount(0);
  expect(await hash(page)).toBe(hashOf(BASE, 2));
  // Die Seite ist wieder offen und lässt sich beschreiben, auch wenn die Sitzung vom Löschen beendet war.
  await waitForPageNumber(page, 2);
  await expect(button(page, 'Seite löschen')).toBeEnabled();
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await waitUntilQueued(page, PAGE2, STROKE);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((p) => p.path)).toEqual([PAGE2]);
  expect(repo.deletes).toEqual([]);
  expect(repo.read(PAGE2)).toContain(STROKE);
});

test('the buttons of the question are big enough for a finger', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await button(page, 'Seite löschen').click();
  const sizes = await page
    .getByRole('dialog', { name: QUESTION })
    .getByRole('button')
    .evaluateAll((els) => els.map((el) => ({ name: el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  expect(sizes.map((s) => s.name)).toEqual(['Abbrechen', 'Löschen']);
  for (const s of sizes) {
    expect(s.width, `${s.name} breit genug`).toBeGreaterThanOrEqual(44);
    expect(s.height, `${s.name} hoch genug`).toBeGreaterThanOrEqual(44);
  }
});

test('the fields and buttons of the header are big enough for a finger', async ({ page }) => {
  await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  for (const [name, locator] of [
    ...['Thema', 'Datum', 'Zeit', 'Ort', 'Projekt'].map((label) => [label, field(page, label)] as const),
    ['+ Seite', button(page, '+ Seite')] as const,
    ['Seite löschen', button(page, 'Seite löschen')] as const,
  ]) {
    const box = (await locator.boundingBox())!;
    expect(box.width, `${name} breit genug`).toBeGreaterThanOrEqual(44);
    expect(box.height, `${name} hoch genug`).toBeGreaterThanOrEqual(44);
  }
});

test('deleting the only page opens the day of the meeting', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1) } });
  await button(page, 'Seite löschen').click();
  await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => hash(page)).toBe(DAY);
  await waitForPageOf(page, 'tag', TODAY);
  await sendToBackground(page);
  await expect.poll(() => repo.deletes.map((d) => d.path)).toEqual([PAGE1]);
  expect(repo.read(PAGE1)).toBeUndefined();
});

test('deleting the first of several pages opens the next one, not the day', async ({ page }) => {
  const repo = await openSeeded(page, hashOf(BASE, 1), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2) } });
  await expect(page.getByText('Seite 1 von 2', { exact: true })).toBeVisible();
  await button(page, 'Seite löschen').click();
  await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 2));
  await waitForPageNumber(page, 2);
  await expect(page.getByText('Seite 1 von 1', { exact: true })).toBeVisible();
  await sendToBackground(page);
  await expect.poll(() => repo.deletes.map((d) => d.path)).toEqual([PAGE1]);
  expect(repo.read(PAGE2)).toBeDefined();
});

test('deleting a page of a meeting from another day opens that day', async ({ page }) => {
  const base = '2026-11-04 1000 Muster';
  const path = `${FILES}/${base} S1.svg`;
  const repo = await openSeeded(page, hashOf(base, 1), { files: { [path]: pageText(1, { thema: 'Muster', datum: '2026-11-04', zeit: '10:00' }, base) } });
  await button(page, 'Seite löschen').click();
  await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => hash(page)).toBe('#/tag/2026-11-04');
  await sendToBackground(page);
  await expect.poll(() => repo.deletes.map((d) => d.path)).toEqual([path]);
});

test('a deleted page is not counted any more, even while GitHub still lists it', async ({ page }) => {
  // Das Löschen kommt bei GitHub nicht an (Schreiben scheitert): Dort steht Seite 2 noch, hier ist sie weg.
  const repo = await openSeeded(page, hashOf(BASE, 2), { files: { [PAGE1]: pageText(1), [PAGE2]: pageText(2) }, failWrites: true });
  await expect(page.getByText('Seite 2 von 2', { exact: true })).toBeVisible();
  await button(page, 'Seite löschen').click();
  await page.getByRole('dialog', { name: QUESTION }).getByRole('button', { name: 'Löschen', exact: true }).click();
  await expect.poll(() => hash(page)).toBe(hashOf(BASE, 1));
  await expect(page.getByText('Seite 1 von 1', { exact: true })).toBeVisible();
  expect(repo.read(PAGE2)).toBeDefined();
});
