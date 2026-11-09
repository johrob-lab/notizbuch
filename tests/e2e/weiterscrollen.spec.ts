import { expect, test as base, type Page } from '@playwright/test';
import { PAGE_GAP } from '../../src/ink/chain';
import { serializePage } from '../../src/ink/svg';
import { PAGE_H, type Stroke } from '../../src/ink/types';
import { bringToForeground, lastHead, openSeeded, queued, sendToBackground, type RepoMock } from './helpers/app';
import { inkNear, mouse, pen, touch, viewOf } from './helpers/pointer';

/**
 * Weiterscrollen: Über und unter der offenen Tages-, Wochen- und Monatsseite hängen ihre Nachbarn. Wer mit dem Finger
 * hinüberschiebt und loslässt, während ein Nachbar die Mitte des Bildschirms bedeckt, hat ihn offen, mit neuer Adresse und
 * ohne neuen Eintrag im Verlauf. Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und hält die Uhr an: Heute
 * ist in allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit). Alle Striche sind erfunden.
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

const DAY = '#/tag/2026-10-29';
const tagFile = (day: string) => `07 Anhänge/Notizbuch/2026/${day} Tag.svg`;
/** Ein Strich im Feld Notizen der Tagesseite. */
const LINE: [number, number][] = [
  [200, 1000],
  [260, 1020],
  [320, 1000],
];
/** Hier hat die Tagesseite weder Linien noch Schrift, die dunkel sind: Tinte dort stammt von einem Strich. */
const CLEAN: [number, number] = [600, 300];
/** So weit vor und hinter der Hälfte des Spalts lässt der Finger los (Seiteneinheiten). */
const MISS = 8;
/** So viel Abstand hält der Finger beim Schieben vom Rand der Fläche (Bildschirmpunkte). */
const MARGIN = 40;

const hash = (page: Page) => page.evaluate(() => window.location.hash);
const historyLength = (page: Page) => page.evaluate(() => window.history.length);
/** `null`, solange keine Seite gelesen ist (der Testzugang fehlt dann). */
const neighbors = (page: Page) => page.evaluate(() => window.__notizbuch?.neighbors?.() ?? null);
const strokeCount = (page: Page) => page.evaluate(() => window.__notizbuch.currentPage().strokes.length);
const waitForPageOf = (page: Page, kind: string, key: string) =>
  page.waitForFunction(
    ([k, id]) => {
      const current = window.__notizbuch?.currentPage?.();
      return current?.kind === k && current.key === id;
    },
    [kind, key],
  );
/** Stift und Handballen: Finger gelten erst 250 ms nach dem Abheben des Stifts wieder. */
const afterPalmWindow = (page: Page) => page.waitForTimeout(300);
/** Wie viele Striche eine Datei hat. Die Linien des Hintergrunds sind auch <path>-Elemente, aber ohne `data-id`. */
const strokesIn = (text: string) => (text.match(/<path data-id=/g) ?? []).length;
/** Wie oft die App die Datei `path` bei GitHub geholt hat. */
const readsOf = (repo: RepoMock, path: string) =>
  repo.requests.filter((request) => decodeURIComponent(request) === `GET /repos/${repo.name}/contents/${path}`).length;

/** Der Zähler im Browser, wie oft der Hinweis „Seite wird geladen“ auf die Seite kam. */
type NoticeCount = { loadingNotices?: number };
/**
 * Zählt von jetzt an im Browser, wie oft der Hinweis „Seite wird geladen“ auf die Seite kommt, auch für einen Augenblick, den
 * kein Abfragen von außen träfe. Eine neue Seite kommt als Ganzes dazu: Darum zählt jeder neue Knoten, der den Text enthält.
 */
const countLoadingNotices = (page: Page) =>
  page.evaluate(() => {
    const holder = window as unknown as NoticeCount;
    holder.loadingNotices = 0;
    new MutationObserver((records) => {
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (node.textContent?.includes('Seite wird geladen')) holder.loadingNotices = (holder.loadingNotices ?? 0) + 1;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
const loadingNotices = (page: Page) => page.evaluate(() => (window as unknown as NoticeCount).loadingNotices);

/**
 * Ein Bild, wie es auf den Bildschirm kommt: die Adresse, wie viele Ebenen die Fläche hat und auf ihrer Grundebene, wie viele
 * Bildpunkte Papier sind und wie viele etwas anderes zeigen (Linien, Schrift, Striche).
 */
type Frame = { hash: string; layers: number; paper: number; marked: number };
type FrameLog = { frames?: Frame[]; watching?: boolean };
/**
 * Hält von jetzt an im Browser jedes Bild fest, kurz bevor es auf den Bildschirm kommt (`requestAnimationFrame`). Ein Augenblick
 * ohne Fläche, ohne Linien oder mit der Seite an anderer Stelle fällt so auf, auch wenn er nur ein Bild lang ist.
 */
const watchFrames = (page: Page) =>
  page.evaluate(() => {
    const log = window as unknown as FrameLog;
    const frames: Frame[] = [];
    log.frames = frames;
    log.watching = true;
    const tick = () => {
      if (!log.watching) return;
      const base = document.querySelector<HTMLCanvasElement>('[data-testid="surface"] canvas[data-layer="grund"]');
      let paper = 0;
      let marked = 0;
      if (base && base.width > 0 && base.height > 0) {
        const data = base.getContext('2d')!.getImageData(0, 0, base.width, base.height).data;
        for (let i = 0; i < data.length; i += 4) {
          if (data[i + 3] < 128) continue; // der Spalt und der Rand: dort zeigt die Fläche nichts
          if (data[i] + data[i + 1] + data[i + 2] > 750) paper++;
          else marked++;
        }
      }
      frames.push({ hash: location.hash, layers: document.querySelectorAll('[data-testid="surface"] canvas').length, paper, marked });
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
const framesSoFar = (page: Page) => page.evaluate(() => (window as unknown as FrameLog).frames?.length ?? 0);
const stopWatching = (page: Page) =>
  page.evaluate(() => {
    const log = window as unknown as FrameLog;
    log.watching = false;
    return log.frames ?? [];
  });
/** Was ein Bild zeigt, ohne die Adresse. */
const picture = ({ layers, paper, marked }: Frame) => ({ layers, paper, marked });

/** Ein erfundener Strich mit dem Kugelschreiber quer durch `at` (Seiteneinheiten). */
function strokeThrough(id: string, [x, y]: [number, number]): Stroke {
  return {
    id,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t: 1000,
    w: 1.2,
    pts: [
      { x: x - 30, y: y - 10, w: 1.2 },
      { x: x + 30, y: y + 10, w: 1.2 },
    ],
  };
}

/** Die Datei einer Tagesseite mit diesen Strichen. */
const dayWith = (day: string, ...strokes: Stroke[]) => serializePage({ kind: 'tag', key: day, meta: {}, strokes }, [], '');

/** Die Fläche, die Ansicht und wo die Mitte der Fläche liegt: so viele Seiteneinheiten unter dem Oberrand der offenen Seite. */
async function middleOf(page: Page) {
  const box = (await page.getByTestId('surface').boundingBox())!;
  const view = await viewOf(page);
  return { box, view, y: (box.y + box.height / 2 - view.y) / view.scale };
}

/**
 * Schiebt die Seite mit einem Finger, bis die Mitte der Fläche `target` Seiteneinheiten unter dem Oberrand der offenen Seite
 * liegt (darüber negativ, auf dem Nachbarn darunter mehr als `PAGE_H`), und hebt ab. Die Strecke kommt aus der Ansicht und der
 * Größe der Fläche. Jeder Zug bleibt in der Fläche; reicht einer nicht, folgen weitere, und erst der letzte kommt ans Ziel.
 * Mit `lift: false` bleibt der Finger am Ziel liegen, und erst die Rückgabe hebt ihn dort ab (sonst tut sie nichts).
 */
async function scrollUntil(page: Page, target: number, { lift = true } = {}): Promise<() => Promise<void>> {
  const finger = touch(page);
  for (let i = 0; i < 5; i++) {
    const { box, view, y } = await middleOf(page);
    const dy = (y - target) * view.scale; // so weit muss der Finger auf dem Bildschirm, nach unten positiv
    const room = box.height - 2 * MARGIN;
    const step = Math.max(-room, Math.min(room, dy));
    const x = box.x + box.width / 2;
    const from = dy < 0 ? box.y + box.height - MARGIN : box.y + MARGIN;
    const onPage = (screenY: number): [number, number] => [(x - view.x) / view.scale, (screenY - view.y) / view.scale];
    const last = step === dy;
    await finger.stroke([onPage(from), onPage(from + step / 2), onPage(from + step)], { lift: lift || !last });
    if (!last) continue;
    if (lift) return async () => undefined;
    // Die Seite ist unter dem Finger gewandert: Er hebt dort ab, wo er auf dem Bildschirm liegt.
    return async () => {
      const now = await viewOf(page);
      await finger.up((x - now.x) / now.scale, (from + step - now.y) / now.scale);
    };
  }
  throw new Error(`Die Mitte kam nicht bis ${target}.`);
}

/** Bis hierher geschoben, bedeckt der Nachbar darunter die Mitte: Er wird beim Loslassen zur offenen Seite. */
const PAST_BELOW = PAGE_H + PAGE_GAP / 2 + MISS;
/** Bis hierher geschoben, liegt die Mitte noch im Spalt vor seiner Hälfte: Die Seite bleibt offen. */
const SHORT_OF_BELOW = PAGE_H + PAGE_GAP / 2 - MISS;
/** Dasselbe wie `PAST_BELOW` nach oben. */
const PAST_ABOVE = -PAGE_GAP / 2 - MISS;

test('scrolling down past the middle opens the next day', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 }); // es gibt noch keine Dateien
  const entries = await historyLength(page);

  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await historyLength(page)).toBe(entries); // die Adresse wechselt ohne neuen Eintrag im Verlauf
});

test('releasing before the middle keeps the page', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const entries = await historyLength(page);

  await scrollUntil(page, SHORT_OF_BELOW);
  // Die Mitte liegt im Spalt unter der Seite, aber noch vor seiner Hälfte: Es bleibt beim 29.10., und die Seite bleibt stehen.
  const { y } = await middleOf(page);
  expect(y).toBeGreaterThan(PAGE_H);
  expect(y).toBeLessThan(PAGE_H + PAGE_GAP / 2);
  await page.waitForTimeout(300);
  expect(await hash(page)).toBe(DAY);
  expect(await historyLength(page)).toBe(entries);
  expect(await page.evaluate(() => window.__notizbuch.currentPage().key)).toBe('2026-10-29');
  expect((await middleOf(page)).y).toBeCloseTo(y, 3);
});

test('scrolling up opens the day before', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const entries = await historyLength(page);

  await scrollUntil(page, PAST_ABOVE);
  expect(await hash(page)).toBe('#/tag/2026-10-28');
  await waitForPageOf(page, 'tag', '2026-10-28');
  expect(await historyLength(page)).toBe(entries);
});

test('weeks and months scroll to the next week and month', async ({ page }) => {
  await openSeeded(page, '#/woche/2026-W44');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/woche/2026-W45');
  await waitForPageOf(page, 'woche', '2026-W45');

  await page.evaluate(() => {
    window.location.hash = '#/monat/2026-10';
  });
  await waitForPageOf(page, 'monat', '2026-10');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/monat/2026-11');
  await waitForPageOf(page, 'monat', '2026-11');
});

test('a stroke goes into the page that is open', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);

  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(0);
  // Der 29.10. hängt jetzt darüber, mit seinem Strich.
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);

  await sendToBackground(page);
  const both = [tagFile('2026-10-29'), tagFile('2026-10-30')];
  await expect.poll(() => repo.puts.map((put) => put.path).sort()).toEqual(both);
  for (const put of repo.puts) expect(strokesIn(put.text), put.path).toBe(1);
});

test('the preview shows what the neighbour has', async ({ page }) => {
  const next = dayWith('2026-10-30', strokeThrough('a', CLEAN), strokeThrough('b', [600, 1000]));
  await openSeeded(page, DAY, { files: { [tagFile('2026-10-30')]: next } });
  expect(await inkNear(page, CLEAN, 4)).toBe(0); // die eigene Seite hat dort nichts
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 2 });

  // Kurz vor der Hälfte des Spalts ist der obere Teil des 30.10. zu sehen, mit seinem Strich.
  await scrollUntil(page, SHORT_OF_BELOW);
  const below: [number, number] = [CLEAN[0], CLEAN[1] + PAGE_H + PAGE_GAP];
  await expect.poll(() => inkNear(page, below, 4)).toBeGreaterThan(0);
  expect(await hash(page)).toBe(DAY);
});

test('a change from another device shows in the preview, and the neighbour is only read', async ({ page }) => {
  const file = tagFile('2026-10-30');
  const repo = await openSeeded(page, DAY, { files: { [file]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  await expect.poll(() => lastHead(page)).not.toBeNull();

  // Ein anderes Gerät ergänzt den Strich 'b' auf dem 30.10.
  repo.commit(file, dayWith('2026-10-30', strokeThrough('a', CLEAN), strokeThrough('b', [600, 1000])));
  await bringToForeground(page);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 2 });
  expect(await queued(page)).toEqual({}); // keine Datei geschrieben, auch die des Nachbarn nicht
  expect(repo.puts).toEqual([]);
});

test('a long drag stops where 60 points of the next day are left, and letting go opens it', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const { box, view } = await middleOf(page);
  const x = box.x + box.width / 2;
  const onPage = (screenY: number): [number, number] => [(x - view.x) / view.scale, (screenY - view.y) / view.scale];
  // Die Maus darf beim Ziehen aus dem Fenster laufen: Sie zieht hier dreimal so weit, wie die Fläche hoch ist.
  const drag = mouse(page);
  const from = box.y + box.height - MARGIN;
  await drag.stroke([onPage(from), onPage(from - 3 * box.height)], { lift: false });
  // Die Kette endet am Unterrand des 30.10.: Von ihm bleiben 60 Punkte oben auf der Fläche.
  const chainEnd = await page.evaluate((y) => window.__notizbuch.toClient(0, y).y, 2 * PAGE_H + PAGE_GAP);
  expect(chainEnd - box.y).toBeCloseTo(60, 3);
  await drag.up(...onPage(from));
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
});

test('there is still exactly one surface with three canvases', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');

  const canvases = await page.evaluate(() =>
    [...document.querySelectorAll('canvas')].map((c) => ({
      inSurface: c.closest('[data-testid="surface"]') !== null,
      sized: c.width > 0 && c.height > 0,
    })),
  );
  expect(canvases).toEqual(Array.from({ length: 3 }, () => ({ inSurface: true, sized: true })));
});

test('the next day stays where it was on the screen', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });

  // Der Finger bleibt liegen: So steht fest, wo der 30.10. auf dem Bildschirm ist, kurz bevor er die offene Seite wird.
  const lift = await scrollUntil(page, PAST_BELOW, { lift: false });
  const before = await viewOf(page);
  const nextTop = await page.evaluate((y) => window.__notizbuch.toClient(0, y), PAGE_H + PAGE_GAP);
  await lift();
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');

  // Sein Oberrand liegt dort, wo er als Nachbar lag, im selben Maßstab.
  const after = await viewOf(page);
  expect(Math.abs(after.y - nextTop.y)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.x - nextTop.x)).toBeLessThanOrEqual(1);
  expect(after.scale).toBeCloseTo(before.scale, 6);
});

test('the page left behind becomes the neighbour with its newest stroke', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);

  // Gleich weiter, ohne auf ein Hochladen zu warten: Der 29.10. hängt darüber, mit dem Strich.
  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await neighbors(page)).toEqual({ above: 1, below: 0 });

  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([tagFile('2026-10-29')]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
});

test('scrolling on at once does not mix up pages', async ({ page }) => {
  // Nur der 30.10. hat einen Strich: Zeigt die Vorschau über dem 31.10. einen, stammt sie vom 30.10.
  await openSeeded(page, DAY, { files: { [tagFile('2026-10-30')]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });

  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/tag/2026-10-31');
  await waitForPageOf(page, 'tag', '2026-10-31');
  expect(await page.evaluate(() => window.__notizbuch.currentPage().key)).toBe('2026-10-31');
  expect(await strokeCount(page)).toBe(0);
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });
});

test('no loading notice flashes when scrolling to a page', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await countLoadingNotices(page);

  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await loadingNotices(page)).toBe(0);

  // Jede andere Seite zeigt den Hinweis wie bisher, solange sie lädt (und der Zähler sieht ihn).
  await page.evaluate(() => {
    window.location.hash = '#/tag/2026-11-05';
  });
  await waitForPageOf(page, 'tag', '2026-11-05');
  expect(await loadingNotices(page)).toBeGreaterThan(0);
});

test('the page left behind is not read again until another device changes it', async ({ page }) => {
  const file = tagFile('2026-10-29');
  const repo = await openSeeded(page, DAY, { files: { [file]: dayWith('2026-10-29', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await expect.poll(() => lastHead(page)).not.toBeNull();
  const reads = readsOf(repo, file);

  // Ihre Sitzung speichert vielleicht noch: Die Vorschau zeigt, was die Seite beim Wechsel hatte, und liest die Datei nicht.
  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  await expect.poll(() => readsOf(repo, tagFile('2026-10-31'))).toBe(1); // der neue Nachbar darunter ist gelesen
  await page.waitForTimeout(300);
  expect(readsOf(repo, file)).toBe(reads);
  expect(await neighbors(page)).toEqual({ above: 1, below: 0 });

  // Ein anderes Gerät ergänzt einen Strich auf dem 29.10.: Jetzt liest die Vorschau die Datei.
  repo.commit(file, dayWith('2026-10-29', strokeThrough('a', CLEAN), strokeThrough('b', [600, 1000])));
  await bringToForeground(page);
  await expect.poll(() => neighbors(page)).toEqual({ above: 2, below: 0 });
  expect(repo.puts).toEqual([]);
});

test('the screen shows the same in every frame while the next day opens', async ({ page }) => {
  await openSeeded(page, DAY, { files: { [tagFile('2026-10-30')]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);

  // Der Finger bleibt am Ziel liegen, bis ein paar Bilder davon festgehalten sind.
  const lift = await scrollUntil(page, PAST_BELOW, { lift: false });
  await watchFrames(page);
  await expect.poll(() => framesSoFar(page)).toBeGreaterThan(2);
  await lift();
  await waitForPageOf(page, 'tag', '2026-10-30');
  const opened = await framesSoFar(page);
  await expect.poll(() => framesSoFar(page)).toBeGreaterThan(opened + 5);
  const frames = await stopWatching(page);

  // Vor dem Abheben: der 29.10. mit seinem Strich, darunter der 30.10. mit seinem, beide mit Linien und Schrift.
  const before = frames.filter((f) => f.hash === DAY);
  const last = before[before.length - 1];
  expect(last.layers).toBe(3);
  expect(last.marked).toBeGreaterThan(0);
  // Danach zeigt jedes Bild genau dasselbe: kein Bild ohne Fläche, ohne Linien und Schrift oder mit der Seite an anderer Stelle.
  const after = frames.filter((f) => f.hash !== DAY);
  expect(after.length).toBeGreaterThan(5);
  expect(after.map(picture)).toEqual(after.map(() => picture(last)));
});

test('scrolling up keeps the day before where it was, and the day left behind hangs below it', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);

  const lift = await scrollUntil(page, PAST_ABOVE, { lift: false });
  const before = await viewOf(page);
  const previousTop = await page.evaluate((y) => window.__notizbuch.toClient(0, y), -(PAGE_H + PAGE_GAP));
  await lift();
  expect(await hash(page)).toBe('#/tag/2026-10-28');
  await waitForPageOf(page, 'tag', '2026-10-28');

  const after = await viewOf(page);
  expect(Math.abs(after.y - previousTop.y)).toBeLessThanOrEqual(1);
  expect(after.scale).toBeCloseTo(before.scale, 6);
  // Der 29.10. hängt jetzt darunter, mit seinem Strich, der 27.10. darüber hat keinen.
  expect(await neighbors(page)).toEqual({ above: 0, below: 1 });
});
