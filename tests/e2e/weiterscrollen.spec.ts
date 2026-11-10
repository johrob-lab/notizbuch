import { expect, test as base, type Page } from '@playwright/test';
import { PAGE_GAP } from '../../src/ink/chain';
import { serializePage } from '../../src/ink/svg';
import { PAGE_H, type Stroke } from '../../src/ink/types';
import { dailyNotePath, GEBURTSTAGE_PATH, TERMINE_PATH, wochePagePath } from '../../src/lib/filenames';
import {
  addRepo,
  bringToForeground,
  changeStoredSettings,
  lastHead,
  openSeeded,
  queued,
  savedSettings,
  sendToBackground,
  type RepoMock,
} from './helpers/app';
import { centerOf, inkNear, mouse, pen, pinch, touch, twoFingerTap, viewOf } from './helpers/pointer';

/**
 * Weiterscrollen: Über und unter der offenen Tages-, Wochen- und Monatsseite hängen ihre Nachbarn. Wer mit dem Finger
 * hinüberschiebt und loslässt, während ein Nachbar die Mitte des Bildschirms bedeckt, hat ihn offen, mit neuer Adresse und
 * ohne neuen Eintrag im Verlauf. Ebenso, wenn das Mausrad kurz stillsteht, und wenn der Stift auf dem Nachbarn aufsetzt (er
 * schreibt dann nichts) oder ein Finger auf ihn tippt. Jeder Test achtet auf Fehler, die im Browser unbehandelt bleiben, und
 * hält die Uhr an: Heute ist in allen Tests der 29.10.2026, 12:00 Uhr (Wiener Zeit). Alle Striche, Termine und Namen sind
 * erfunden.
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
/** Der Hintergrund, den die Vorschau des Nachbarn zeigt (SVG-Text), `null` ohne diesen Nachbarn oder ohne gelesene Seite. */
const neighborBackground = (page: Page, side: 'above' | 'below') =>
  page.evaluate((s) => window.__notizbuch?.neighborBackground?.(s) ?? null, side);
const screenBackground = (page: Page) => page.evaluate(() => window.__notizbuch.screenBackground());
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

/** Öffnet eine Adresse wie ein Link (neuer Eintrag im Verlauf). */
const goTo = (page: Page, next: string) => page.evaluate((h) => void (window.location.hash = h), next);
/**
 * GitHub antwortet auf das Lesen der Datei `path` erst, wenn der Test `release` ruft: So bleibt die Vorschau oder die Seite
 * dieser Datei beim Laden. `held.asked` zählt die Anfragen, die warten oder gewartet haben.
 */
async function holdReads(page: Page, path: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const held = { asked: 0 };
  await page.route(
    (url) => decodeURIComponent(url.pathname).endsWith(`/contents/${path}`),
    async (route) => {
      if (route.request().method() === 'GET') {
        held.asked++;
        await gate;
      }
      await route.fallback();
    },
  );
  return { release, held };
}
/** Merkt sich die Schreibfläche, die jetzt da ist: `newSurface` wartet dann, bis die nächste Seite ihre eigene hat. */
const markSurface = (page: Page) =>
  page.evaluate(() => {
    (window as unknown as { oldSurface?: Element | null }).oldSurface = document.querySelector('[data-testid="surface"] canvas');
  });
const newSurface = (page: Page) =>
  page.waitForFunction(() => {
    const now = document.querySelector('[data-testid="surface"] canvas');
    return now !== null && now !== (window as unknown as { oldSurface?: Element | null }).oldSurface;
  });
/**
 * Wo die Tagesseite liegt, abgelesen an der Ebene ihrer Karten: Sie folgt der Ansicht der Fläche auch, solange die Seite noch
 * lädt und der Testzugang der App fehlt. Wie `viewOf`: Ort des Seitenursprungs in Bildschirmkoordinaten und Maßstab.
 */
const cardView = (page: Page) =>
  page.evaluate(() => {
    const stage = document.querySelector('.buehne')!.getBoundingClientRect();
    const m = new DOMMatrixReadOnly(getComputedStyle(document.querySelector('.karten')!).transform);
    return { x: stage.left + m.e, y: stage.top + m.f, scale: m.a };
  });
/**
 * Ein Finger (`touch`) oder der Stift (`pen`) setzt am ersten Ort von `path` auf (Bildschirmkoordinaten), zieht zu den weiteren und
 * hebt am letzten ab, ohne den Testzugang der App.
 */
const strokeOnScreen = (page: Page, kind: 'touch' | 'pen', path: { x: number; y: number }[]) =>
  page.evaluate(
    ({ pointerType, points }) => {
      const target = document.querySelector('[data-testid="surface"] canvas[data-layer="live"]')!;
      const send = (type: 'pointerdown' | 'pointermove' | 'pointerup', at: { x: number; y: number }) =>
        target.dispatchEvent(
          new PointerEvent(type, {
            pointerId: pointerType === 'pen' ? 11 : 29,
            pointerType,
            isPrimary: true,
            pressure: 0.5,
            width: 1,
            height: 1,
            clientX: at.x,
            clientY: at.y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      points.forEach((at, i) => send(i === 0 ? 'pointerdown' : 'pointermove', at));
      send('pointerup', points[points.length - 1]);
    },
    { pointerType: kind, points: path },
  );
/** Ein Finger zieht auf der Fläche von `from` nach `to` (Bildschirmkoordinaten) und hebt ab, ohne den Testzugang der App. */
const swipeOnScreen = (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) =>
  strokeOnScreen(
    page,
    'touch',
    [0, 0.25, 0.5, 0.75, 1].map((f) => ({ x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f })),
  );
/** Wie `scrollUntil`, aber ohne den Testzugang der App: für eine Tagesseite, die noch lädt. Die Lage kommt aus `cardView`. */
async function scrollWhileLoading(page: Page, target: number) {
  for (let i = 0; i < 5; i++) {
    const box = (await page.getByTestId('surface').boundingBox())!;
    const view = await cardView(page);
    const dy = ((box.y + box.height / 2 - view.y) / view.scale - target) * view.scale;
    const room = box.height - 2 * MARGIN;
    const step = Math.max(-room, Math.min(room, dy));
    const x = box.x + box.width / 2;
    const from = dy < 0 ? box.y + box.height - MARGIN : box.y + MARGIN;
    await swipeOnScreen(page, { x, y: from }, { x, y: from + step });
    if (step === dy) return;
  }
  throw new Error(`Die Mitte kam nicht bis ${target}.`);
}
/** Wie `pen(page).stroke`, aber ohne den Testzugang der App: für eine Tagesseite, die noch lädt. Die Lage kommt aus `cardView`. */
async function penWhileLoading(page: Page, path: [number, number][]) {
  const view = await cardView(page);
  await strokeOnScreen(
    page,
    'pen',
    path.map(([x, y]) => ({ x: view.x + x * view.scale, y: view.y + y * view.scale })),
  );
}

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
/** Bis hierher geschoben, liegt die Mitte noch weit auf dem 29.10., unten auf dem Bildschirm ist schon der Anfang des 30.10. */
const NEXT_IN_VIEW = PAGE_H - 400;
/** Ein Ort auf dem 30.10. in Einheiten des 29.10. (150 unter dem Oberrand des 30.10.), bei `NEXT_IN_VIEW` gut zu sehen. */
const ON_NEXT: [number, number] = [600, PAGE_H + PAGE_GAP + 150];

/** Ein Dreh am Mausrad: `dy` Bildschirmpunkte (nach unten positiv), mit `ctrl` gezoomt, an einem Ort der offenen Seite. */
type Spin = { dy: number; ctrl?: boolean; at?: [number, number] };
/** Was im selben Zug gleich nach dem Rad geschieht: Die Maus drückt auf `press` (Seiteneinheiten), oder `open` wird die Adresse. */
type AfterSpin = { press?: [number, number]; open?: string };

/** Die Drehungen am Mausrad, je höchstens 100 Punkte, bis die Mitte der Fläche `target` Seiteneinheiten unter dem Oberrand liegt. */
async function spinsTo(page: Page, target: number): Promise<Spin[]> {
  const { view, y } = await middleOf(page);
  const spins: Spin[] = [];
  let rest = (target - y) * view.scale; // so weit muss das Rad die Seite nach oben schieben, in Bildschirmpunkten
  while (Math.abs(rest) > 0.01) {
    const dy = Math.max(-100, Math.min(100, rest));
    spins.push({ dy });
    rest -= dy;
  }
  return spins;
}

/**
 * Dreht das Mausrad: jede Drehung ein eigenes Ereignis wie beim Drehen, alle in einem Zug ohne Pause dazwischen. Gleich danach, im
 * selben Zug und damit sicher vor dem Ende von `WHEEL_SETTLE_MS`, geschieht `after`. Gibt die Adresse, die Lage der Mitte (wie
 * `middleOf`) und den Maßstab zurück, wie sie in diesem Moment sind: So hängt kein Test davon ab, wie schnell der Rechner ist.
 */
const spin = (page: Page, spins: Spin[], after: AfterSpin = {}) =>
  page.evaluate(
    ({ list, then }) => {
      const surface = document.querySelector('[data-testid="surface"]')!;
      const live = surface.querySelector('canvas[data-layer="live"]')!;
      for (const s of list) {
        const c = window.__notizbuch.toClient(...(s.at ?? [600, 800]));
        const init = { clientX: c.x, clientY: c.y, deltaY: s.dy, ctrlKey: !!s.ctrl };
        live.dispatchEvent(new WheelEvent('wheel', { ...init, bubbles: true, cancelable: true }));
      }
      const box = surface.getBoundingClientRect();
      const origin = window.__notizbuch.toClient(0, 0);
      const scale = (window.__notizbuch.toClient(1000, 0).x - origin.x) / 1000;
      const now = { hash: location.hash, middle: (box.top + box.height / 2 - origin.y) / scale, scale };
      if (then.press) {
        const c = window.__notizbuch.toClient(...then.press);
        const init = { pointerId: 1, pointerType: 'mouse', isPrimary: true, clientX: c.x, clientY: c.y, button: 0, buttons: 1 };
        live.dispatchEvent(new PointerEvent('pointerdown', { ...init, bubbles: true, cancelable: true, composed: true }));
      }
      if (then.open) location.hash = then.open;
      return now;
    },
    { list: spins, then: after },
  );

/** Ein Finger wischt einmal fast über die ganze Höhe der Fläche, mit `up` nach oben (die Seite wandert mit), sonst nach unten. */
async function swipe(page: Page, up: boolean) {
  const box = (await page.getByTestId('surface').boundingBox())!;
  const view = await viewOf(page);
  const x = box.x + box.width / 2;
  const [from, to] = up ? [box.y + box.height - MARGIN, box.y + MARGIN] : [box.y + MARGIN, box.y + box.height - MARGIN];
  const onPage = (screenY: number): [number, number] => [(x - view.x) / view.scale, (screenY - view.y) / view.scale];
  await touch(page).stroke([onPage(from), onPage((from + to) / 2), onPage(to)]);
}

/** Wo ein Ort der offenen Seite (Seiteneinheiten) senkrecht auf dem Bildschirm liegt. */
const screenY = (page: Page, y: number) => page.evaluate((at) => window.__notizbuch.toClient(0, at).y, y);

/**
 * Ein Termin am Dienstag, 03.11., und ein Geburtstag am Donnerstag, 05.11., beide in Woche 45. Kurz, damit sie auch in ein
 * Kästchen des Monats passen. Erfunden.
 */
const AGENDA = {
  [TERMINE_PATH]: ['# Termine', '- 2026-11-03 10:00 bis 11:00 | Probe | Raum 1 | Outlook', ''].join('\n'),
  [GEBURTSTAGE_PATH]: ['# Geburtstage', '- 2026-11-05 | Erika Muster | Geburtstag | Google', ''].join('\n'),
};
/** Eine Tagesnotiz, wie sie die Abendroutine schreibt: unter `## Handschrift` der Block `### Prioritäten` mit diesen Zeilen. */
const noteWith = (day: string, ...lines: string[]): string => {
  const head = ['---', `date: ${day}`, '---', `# ${day}`, '', '## Handschrift', '', '### Prioritäten'];
  return [...head, `Quelle: [[${day} Tag.svg]]`, ...lines, ''].join('\n');
};
/** Die Datei einer Wochenseite mit diesen Strichen. */
const weekWith = (week: string, ...strokes: Stroke[]) => serializePage({ kind: 'woche', key: week, meta: {}, strokes }, [], '');

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

test('the preview of a neighbour the device knows does not ask GitHub', async ({ page }) => {
  const file = tagFile('2026-10-30');
  const repo = await openSeeded(page, '#/tag/2026-10-30', { files: { [file]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  await waitForPageOf(page, 'tag', '2026-10-30');
  await expect.poll(() => strokeCount(page)).toBe(1); // gelesen, die Kopie liegt auf dem Gerät
  await page.waitForTimeout(300); // das Auffrischen im Hintergrund der Seite ist angekommen
  const reads = readsOf(repo, file);

  // Der 29.10. hat den 30.10. als Nachbarn darunter: Seine Vorschau kommt aus der Kopie und fragt GitHub nicht.
  await goTo(page, DAY);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  await page.waitForTimeout(300); // ein Auffrischen im Hintergrund wäre hier angekommen
  expect(readsOf(repo, file)).toBe(reads);
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
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });

  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([tagFile('2026-10-29')]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
});

/**
 * Alles in einem Zug, so dass die App dazwischen nichts anderes tut: Ein Finger schiebt die Seite, bis die Mitte der Fläche `target`
 * Seiteneinheiten unter dem Oberrand der offenen Seite liegt, und hebt ab. Gleich danach setzt der Stift am ersten Punkt von `path`
 * (Seiteneinheiten derselben Seite) auf und zieht zu den weiteren, ohne abzuheben. Der Weg des Fingers bleibt in der Fläche. Gibt
 * zurück, wie es in diesem Moment ist: die Adresse, welche Seite die Fläche zeigt und wie viele Bewegungen des Stifts sie als Strich
 * gezeichnet hat.
 */
const swipeThenPen = (page: Page, target: number, path: [number, number][]) =>
  page.evaluate(
    ({ goal, points, margin }) => {
      const surface = document.querySelector('[data-testid="surface"]')!;
      const live = surface.querySelector('canvas[data-layer="live"]')!;
      const send = (type: 'pointerdown' | 'pointermove' | 'pointerup', pointerType: 'touch' | 'pen', at: { x: number; y: number }) =>
        live.dispatchEvent(
          new PointerEvent(type, {
            pointerId: pointerType === 'pen' ? 11 : 21,
            pointerType,
            isPrimary: true,
            pressure: 0.5,
            width: 1,
            height: 1,
            clientX: at.x,
            clientY: at.y,
            button: type === 'pointermove' ? -1 : 0,
            buttons: type === 'pointerup' ? 0 : 1,
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      const box = surface.getBoundingClientRect();
      const origin = window.__notizbuch.toClient(0, 0);
      const scale = (window.__notizbuch.toClient(1000, 0).x - origin.x) / 1000;
      const dy = ((box.top + box.height / 2 - origin.y) / scale - goal) * scale; // so weit muss der Finger, nach unten positiv
      if (Math.abs(dy) > box.height - 2 * margin) throw new Error(`Die Mitte ist zu weit von ${goal} entfernt.`);
      const x = box.left + box.width / 2;
      const from = dy < 0 ? box.bottom - margin : box.top + margin;
      send('pointerdown', 'touch', { x, y: from });
      for (const f of [0.25, 0.5, 0.75, 1]) send('pointermove', 'touch', { x, y: from + dy * f });
      send('pointerup', 'touch', { x, y: from + dy });
      points.forEach(([px, py], i) => send(i === 0 ? 'pointerdown' : 'pointermove', 'pen', window.__notizbuch.toClient(px, py)));
      return { hash: location.hash, key: window.__notizbuch.currentPage().key, penMoves: window.__notizbuch.liveStats().events };
    },
    { goal: target, points: path, margin: MARGIN },
  );

test('a stroke begun on the day just left, before the next one is open, is in its preview and in its file', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);

  // Der Finger schiebt den 30.10. über die Hälfte des Spalts und hebt ab, gleich danach schreibt der Stift auf dem 29.10., der oben
  // noch im Bild ist. Die Adresse ist da schon die neue, aufgebaut ist aber noch der 29.10.: Er nimmt den Strich an.
  const now = await swipeThenPen(page, PAST_BELOW, [
    [300, PAGE_H - 200],
    [360, PAGE_H - 180],
    [420, PAGE_H - 200],
  ]);
  expect(now).toEqual({ hash: '#/tag/2026-10-30', key: '2026-10-29', penMoves: 2 });

  // Beim Abbau wird der Strich fertig. Der 29.10. hängt über dem 30.10., und seine Vorschau zeigt ihn.
  await waitForPageOf(page, 'tag', '2026-10-30');
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });
  expect(await strokeCount(page)).toBe(0);

  // Gespeichert ist er in der Datei des 29.10., und nur dort.
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
  // Die Vorschau des 30.10. ist gelesen, sobald sie seinen Strich zeigt: Dann ist die Seite beim Wechsel schon zu sehen.
  await openSeeded(page, DAY, { files: { [tagFile('2026-10-30')]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
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

/** Das Repo, in das ein anderes Fenster wechselt, und sein Token. Erfunden. */
const OTHER_REPO = 'muster/vault-anders';
const OTHER_TOKEN = 'test-zugang-anders-0123456789';

test('when the app goes on with a new engine, the day left behind is read again', async ({ page }) => {
  // Der 29.10. hat einen Strich. Im Repo, in das gleich ein anderes Fenster wechselt, hat er zwei.
  const file = tagFile('2026-10-29');
  const repo = await openSeeded(page, DAY, { files: { [file]: dayWith('2026-10-29', strokeThrough('a', CLEAN)) } });
  const other = await addRepo(page, OTHER_REPO, { files: { [file]: dayWith('2026-10-29', strokeThrough('a', CLEAN), strokeThrough('b', [600, 1000])) } });
  await expect.poll(() => strokeCount(page)).toBe(1);

  // Ein neuer Token für dieses Repo. GitHub antwortet auf seine Prüfung erst, wenn der Test es erlaubt. Die App bleibt dabei
  // bedienbar: zurück zum 29.10.
  let answer!: () => void;
  repo.checkGate = new Promise<void>((resolve) => (answer = resolve));
  await page.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Zugang ändern' }).click();
  await page.getByLabel('Token', { exact: true }).fill('test-zugang-erneuert-0123456789');
  await page.getByRole('button', { name: 'Prüfen und speichern' }).click();
  await expect.poll(() => repo.requests.filter((request) => request === `GET /repos/${repo.name}`)).toHaveLength(1);
  await goTo(page, DAY);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await expect.poll(() => strokeCount(page)).toBe(1);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });

  // Weiter zum 30.10.: Der 29.10. hängt darüber, mit seinem Strich aus der Übergabe.
  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'tag', '2026-10-30');
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });

  // Ein anderes Fenster wechselt das Repository. Die Prüfung des Tokens merkt es, und die App arbeitet mit einer neuen Engine auf
  // dem gespeicherten Repository weiter. Der 30.10. bleibt offen, und seine Vorschau liest beide Nachbarn jetzt dort, den 31.10.
  // und auch den 29.10.
  await changeStoredSettings(page, { repo: OTHER_REPO, token: OTHER_TOKEN }, ['files', 'outbox', 'meta']);
  answer();
  await expect.poll(() => readsOf(other, tagFile('2026-10-31'))).toBeGreaterThan(0);
  await expect.poll(() => neighbors(page)).toEqual({ above: 2, below: 0 });
  expect(await hash(page)).toBe('#/tag/2026-10-30');
});

test('the screen shows the same in every frame while the next day opens', async ({ page }) => {
  // Der 30.10. hat einen Strich und einen Geburtstag. Den Geburtstag zeigt die Tagesseite im Kopf, schon in der Vorschau, und er
  // bleibt beim Wechsel stehen. (Einen Termin hat der 30.10. im Mini-Vault auch, aber Termine zeigt die Tagesseite nur in ihren
  // Karten, nicht auf der Fläche.)
  const birthday = ['# Geburtstage', '- 2026-10-30 | Max Beispiel | Geburtstag | Google', ''].join('\n');
  const next = dayWith('2026-10-30', strokeThrough('a', CLEAN));
  await openSeeded(page, DAY, { files: { [tagFile('2026-10-30')]: next, [GEBURTSTAGE_PATH]: birthday } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  await expect.poll(() => neighborBackground(page, 'below')).toContain('Max Beispiel');
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
  expect(Math.abs(after.x - previousTop.x)).toBeLessThanOrEqual(1);
  expect(after.scale).toBeCloseTo(before.scale, 6);
  // Der 29.10. hängt jetzt darunter, mit seinem Strich, der 27.10. darüber hat keinen.
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
});

test('a day left before it was read is read by the next one, also when scrolling on at once', async ({ page }) => {
  // Der 30.10. hat einen Strich, aber GitHub antwortet auf ihn erst, wenn der Test es erlaubt.
  const middle = tagFile('2026-10-30');
  await openSeeded(page, '#/tag/2026-10-25', { files: { [middle]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  const { release, held } = await holdReads(page, middle);
  await goTo(page, DAY);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await expect.poll(() => held.asked).toBeGreaterThan(0); // die Vorschau des 30.10. wartet

  // Zum 30.10. und gleich weiter zum 31.10., solange der 30.10. noch lädt (seine Sitzung hat also nie gelesen).
  await markSurface(page);
  await scrollUntil(page, PAST_BELOW);
  await newSurface(page);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await scrollWhileLoading(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/tag/2026-10-31');
  await waitForPageOf(page, 'tag', '2026-10-31');

  // Der 30.10. hängt darüber. Er hat nie geschrieben: Der 31.10. liest ihn wie jeden Nachbarn und zeigt seinen Strich, sobald
  // GitHub antwortet.
  release();
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 });
  expect(await queued(page)).toEqual({}); // nichts geschrieben, auch nicht in die Datei des 30.10.
});

test('a day whose preview was not read yet says that it is loading', async ({ page }) => {
  const next = tagFile('2026-10-30');
  await openSeeded(page, '#/tag/2026-10-25', { files: { [next]: dayWith('2026-10-30', strokeThrough('a', CLEAN)) } });
  const { release, held } = await holdReads(page, next);
  await goTo(page, DAY);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await expect.poll(() => held.asked).toBeGreaterThan(0);

  // Die Vorschau zeigte noch nichts vom 30.10.: Bis seine Datei da ist, sagt er wie jede Seite, dass er lädt.
  await scrollUntil(page, PAST_BELOW);
  await expect(page.getByText('Seite wird geladen')).toBeVisible();
  // Solange nimmt er keinen Strich an: Die Fläche zeigt noch nicht, was in seiner Datei steht.
  await penWhileLoading(page, IN_HEAD);
  await expect(toolButton(page, 'Rückgängig')).toBeDisabled();
  release();
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(1);
  await expect(page.getByText('Seite wird geladen')).toHaveCount(0);
  // Der eine Strich ist der aus seiner Datei, der Stift hat keinen dazugebracht.
  expect(await page.evaluate(() => window.__notizbuch.currentPage().strokes.map((s) => s.id))).toEqual(['a']);
});

/**
 * Der 29.10. ist offen, und die Vorschau des 30.10. darunter hat seine Datei gelesen: Es gibt sie nicht. Von da an antwortet
 * GitHub auf das Lesen dieser Datei erst, wenn der Test `release` ruft. Der Finger schiebt zum 30.10., dessen Sitzung fragt GitHub
 * nach der Datei, und sofort schreibt der Stift einen Strich in seinen Kopf. Gibt das Repo, `release` und den Pfad der Datei zurück.
 */
async function writeOnNextDayWhileItLoads(page: Page) {
  const file = tagFile('2026-10-30');
  const previewRead = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && decodeURIComponent(new URL(response.url()).pathname).endsWith(`/contents/${file}`),
  );
  const repo = await openSeeded(page, DAY);
  await previewRead; // die Vorschau ist gelesen (an der Zahl ihrer Striche sieht man das nicht, sie ist vorher und nachher 0)
  const { release, held } = await holdReads(page, file);

  await markSurface(page);
  await scrollUntil(page, PAST_BELOW);
  await newSurface(page);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await expect.poll(() => held.asked).toBeGreaterThan(0); // die Sitzung des 30.10. wartet auf GitHub
  await expect(page.getByText('Seite wird geladen')).toHaveCount(0); // die Vorschau war gelesen
  await penWhileLoading(page, IN_HEAD);
  // Die Fläche hat den Strich angenommen, obwohl der 30.10. noch nicht gelesen ist (der Testzugang fehlt noch).
  await expect(toolButton(page, 'Rückgängig')).toBeEnabled();
  expect(await page.evaluate(() => window.__notizbuch === undefined)).toBe(true);
  return { repo, release, file };
}

test('right after scrolling onto a day without a file the first stroke is taken at once and saved', async ({ page }) => {
  const { repo, release, file } = await writeOnNextDayWhileItLoads(page);

  release();
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(1);
  // Das Lesen hat nichts an der Seite geändert: Der Verlauf für Rückgängig bleibt.
  await expect(toolButton(page, 'Rückgängig')).toBeEnabled();
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([file]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
});

test('a stroke on a day left before its file was read is saved all the same', async ({ page }) => {
  const { repo, release, file } = await writeOnNextDayWhileItLoads(page);

  // Gleich zurück zum 29.10., solange GitHub noch wartet. Der 30.10. hängt darunter, mit dem Strich aus der Übergabe.
  await afterPalmWindow(page);
  await scrollWhileLoading(page, PAST_ABOVE);
  expect(await hash(page)).toBe(DAY);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });

  // Die Sitzung des 30.10. liest noch zu Ende und speichert den Strich.
  release();
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([file]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
  expect(await neighbors(page)).toEqual({ above: 0, below: 1 });
});

test('there, back and there again before the file is read, the stroke stays', async ({ page }) => {
  const { repo, release, file } = await writeOnNextDayWhileItLoads(page);

  await afterPalmWindow(page);
  await scrollWhileLoading(page, PAST_ABOVE);
  await waitForPageOf(page, 'tag', '2026-10-29');
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  // Wieder zum 30.10., noch bevor GitHub geantwortet hat.
  await markSurface(page);
  await scrollUntil(page, PAST_BELOW);
  await newSurface(page);
  expect(await hash(page)).toBe('#/tag/2026-10-30');

  release();
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([file]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
});

/** Der Hinweis einer Seite, die sich nicht laden ließ (`NOT_LOADED` in PageView.tsx). */
const NOT_LOADED = 'Diese Seite konnte nicht geladen werden. Neuer Versuch, sobald das Netz da ist.';
/** Ein Repository aus der Liste der Einstellungen, in das gewechselt wird, und ein erfundener Token dafür. */
const SWITCH_REPO = 'johrob-lab/2-gehirn-test';
const SWITCH_TOKEN = 'test-zugang-wechsel-0123456789';

/** Öffnet die Einstellungen und wechselt dort das Repository (Zugang ändern, neuer Token, anderes Repository, Prüfen und speichern). */
async function switchRepository(page: Page, repo: string) {
  await page.getByRole('link', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('button', { name: 'Zugang ändern' }).click();
  await page.getByLabel('Token', { exact: true }).fill(SWITCH_TOKEN);
  await page.getByLabel('Repository', { exact: true }).selectOption(repo);
  await page.getByRole('button', { name: 'Prüfen und speichern' }).click();
}

test('the repository does not change while a stroke waits on a day that could not be loaded', async ({ page }) => {
  const { repo, release, file } = await writeOnNextDayWhileItLoads(page);
  const other = await addRepo(page, SWITCH_REPO);

  // GitHub antwortet auf das Lesen des 30.10. mit einem Fehler: Er lässt sich nicht laden, der Strich bleibt zu sehen.
  repo.failReads = true;
  release();
  await expect(page.getByText(NOT_LOADED)).toBeVisible();
  repo.failReads = false;

  // In die Einstellungen, der 30.10. wird verlassen: Sein Strich wartet nur im Arbeitsspeicher, bis der Tag wieder offen ist.
  // Darum wechselt das Repository nicht, und das neue hört nicht einmal eine Frage.
  await switchRepository(page, SWITCH_REPO);
  await expect(page.getByRole('alert').filter({ hasText: /\S/ })).toHaveText('Erst sichern: Es wartet noch 1 Änderung.');
  expect(await savedSettings(page)).toMatchObject({ repo: repo.name });
  expect(other.requests).toEqual([]);

  // Wieder auf dem 30.10.: Jetzt lässt er sich laden, und der Strich kommt in seine Datei. Danach geht der Wechsel, und der
  // Strich steht im Repository, zu dem er gehört.
  await goTo(page, '#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(1);
  await expect.poll(async () => Object.keys(await queued(page))).toEqual([file]);
  await switchRepository(page, SWITCH_REPO);
  await expect.poll(async () => (await savedSettings(page))?.repo).toBe(SWITCH_REPO);
  expect(repo.puts.map((put) => put.path)).toEqual([file]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
  expect(other.puts).toEqual([]);
});

test('a change of the repository waits until a day left before its file was read has saved its stroke', async ({ page }) => {
  const { repo, release, file } = await writeOnNextDayWhileItLoads(page);
  const other = await addRepo(page, SWITCH_REPO);

  // In die Einstellungen, solange GitHub zum 30.10. noch nicht geantwortet hat: Seine Sitzung liest noch zu Ende und speichert
  // den Strich. So lange wartet der Wechsel und fragt das neue Repository nichts (ohne Warten hätte er es hier schon gefragt).
  await switchRepository(page, SWITCH_REPO);
  await page.waitForTimeout(300);
  expect(other.requests).toEqual([]);
  release();
  await expect.poll(async () => (await savedSettings(page))?.repo).toBe(SWITCH_REPO);
  expect(repo.puts.map((put) => put.path)).toEqual([file]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
  expect(other.puts).toEqual([]);
});

test('the pen on the neighbour opens it and writes nothing', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);
  expect(await hash(page)).toBe(DAY);

  // Der Stift setzt auf dem 30.10. auf, zieht und hebt ab: Der 30.10. wird die offene Seite, und kein Strich entsteht.
  await pen(page).stroke([ON_NEXT, [ON_NEXT[0] + 60, ON_NEXT[1] + 20], [ON_NEXT[0] + 120, ON_NEXT[1]]]);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(0);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 }); // auch auf dem 29.10. nicht
  expect(await queued(page)).toEqual({});
  await sendToBackground(page);
  await page.waitForTimeout(300);
  expect(repo.puts).toEqual([]);

  // Der nächste Strich schreibt, und zwar auf den 30.10.
  await bringToForeground(page);
  await page.getByRole('button', { name: 'Ganze Seite', exact: true }).click();
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([tagFile('2026-10-30')]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
});

test('a finger tap on the neighbour opens it', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const entries = await historyLength(page);
  await scrollUntil(page, NEXT_IN_VIEW);
  const before = await viewOf(page);
  const nextTop = await screenY(page, PAGE_H + PAGE_GAP);

  await touch(page).tap(...ON_NEXT);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await historyLength(page)).toBe(entries);
  // Wie beim Scrollen bleibt der 30.10. dort, wo er als Nachbar stand.
  const after = await viewOf(page);
  expect(Math.abs(after.y - nextTop)).toBeLessThanOrEqual(1);
  expect(after.scale).toBeCloseTo(before.scale, 6);
});

test('a two-finger tap on the neighbour still undoes on the open page', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await pen(page).stroke(LINE);
  await expect.poll(() => strokeCount(page)).toBe(1);
  await afterPalmWindow(page);
  await scrollUntil(page, NEXT_IN_VIEW);

  await twoFingerTap(page, ON_NEXT, [ON_NEXT[0] + 200, ON_NEXT[1]]);
  await expect.poll(() => strokeCount(page)).toBe(0);
  expect(await hash(page)).toBe(DAY);
});

test('the mouse wheel scrolls on and opens the page after a pause', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const entries = await historyLength(page);

  const now = await spin(page, await spinsTo(page, PAST_BELOW));
  expect(now.middle).toBeCloseTo(PAST_BELOW, 1);
  expect(now.hash).toBe(DAY); // gleich nach dem letzten Dreh: Das Rad steht erst einen Augenblick still
  await expect.poll(() => hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await historyLength(page)).toBe(entries);
});

test('a pause of the wheel before the middle keeps the page, zooming with the wheel past it opens the next', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const short = await spin(page, await spinsTo(page, SHORT_OF_BELOW));
  expect(short.middle).toBeCloseTo(SHORT_OF_BELOW, 1);
  await page.waitForTimeout(400);
  expect(await hash(page)).toBe(DAY);

  // Strg und Rad zoomen um einen Ort weit unten auf dem 30.10. hinein: Die Mitte rückt zu ihm hin, über die Hälfte des Spalts.
  const zoomed = await spin(page, [{ dy: -100, ctrl: true, at: [600, PAGE_H + PAGE_GAP + 300] }]);
  expect(zoomed.scale).toBeGreaterThan(short.scale);
  expect(zoomed.middle).toBeGreaterThan(PAGE_H + PAGE_GAP / 2);
  expect(zoomed.hash).toBe(DAY);
  await expect.poll(() => hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect((await viewOf(page)).scale).toBeCloseTo(zoomed.scale, 6);
});

test('zoomed in it scrolls on and keeps the zoom', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  const normal = await viewOf(page);
  // Zwei Finger ziehen auseinander, doppelt so weit: doppelter Maßstab.
  await pinch(
    page,
    [
      [500, 800],
      [700, 800],
    ],
    [
      [400, 800],
      [800, 800],
    ],
  );
  const zoomed = await viewOf(page);
  expect(zoomed.scale / normal.scale).toBeCloseTo(2, 2);

  await scrollUntil(page, PAST_BELOW);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect((await viewOf(page)).scale).toBeCloseTo(zoomed.scale, 6);
});

test('a meeting page has no neighbours', async ({ page }) => {
  const meeting = `#/besprechung/${encodeURIComponent('2026-11-04 0800 Muster')}/1`;
  await openSeeded(page, meeting);
  await waitForPageOf(page, 'besprechung', '2026-11-04 0800 Muster');
  expect(await neighbors(page)).toEqual({ above: null, below: null });
  expect(await neighborBackground(page, 'above')).toBeNull();
  expect(await neighborBackground(page, 'below')).toBeNull();
  const box = (await page.getByTestId('surface').boundingBox())!;

  // Weit nach oben gewischt bleiben wie bisher 60 Punkte der Seite oben auf dem Bildschirm, weit nach unten 60 Punkte unten.
  for (let i = 0; i < 4; i++) await swipe(page, true);
  expect((await screenY(page, PAGE_H)) - box.y).toBeCloseTo(60, 3);
  for (let i = 0; i < 4; i++) await swipe(page, false);
  expect(box.y + box.height - (await screenY(page, 0))).toBeCloseTo(60, 3);
  expect(await hash(page)).toBe(meeting);

  // Über der Seite ist kein Nachbar: Der Stift schreibt dort wie bisher.
  await pen(page).stroke([
    [500, -200],
    [560, -180],
    [620, -200],
  ]);
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect(await hash(page)).toBe(meeting);
});

test('the preview shows appointments and birthdays of the neighbour', async ({ page }) => {
  // Woche 45 hat einen Termin, einen Geburtstag und eine Priorität am 04.11. Die Vorschau zeigt Termin und Geburtstag, die
  // Priorität erst, wenn die Woche offen ist. Woche 44 hat am 29.10. eine Priorität.
  const prioritaeten = {
    [dailyNotePath('2026-10-29')]: noteWith('2026-10-29', 'Sperren abstimmen'),
    [dailyNotePath('2026-11-04')]: noteWith('2026-11-04', 'Angebot prüfen'),
  };
  await openSeeded(page, '#/woche/2026-W44', { files: { ...AGENDA, ...prioritaeten } });
  await expect.poll(() => screenBackground(page)).toContain('Sperren abstimmen');
  await expect.poll(() => neighborBackground(page, 'below')).toContain('10:00 Probe');
  const preview = (await neighborBackground(page, 'below'))!;
  expect(preview).toContain('Erika Muster');
  expect(preview).not.toContain('Angebot prüfen');

  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'woche', '2026-W45');
  const own = await screenBackground(page);
  expect(own).toContain('10:00 Probe');
  expect(own).toContain('Erika Muster');
  await expect.poll(() => screenBackground(page)).toContain('Angebot prüfen');
  // Die Woche, die eben offen war, hängt darüber und zeigt weiter, was sie zeigte, mit ihrer Priorität.
  expect(await neighborBackground(page, 'above')).toContain('Sperren abstimmen');
});

test('the month and the day show the entries of their neighbours like their own', async ({ page }) => {
  await openSeeded(page, '#/monat/2026-10', { files: AGENDA });
  await expect.poll(() => neighborBackground(page, 'below')).toContain('10:00 Probe');
  expect(await neighborBackground(page, 'below')).toContain('Erika Muster');

  // Die Tagesseite zeigt im Kopf nur Geburtstage: Der 05.11. hat einen, der Termin am 03.11. steht nur in den Karten.
  await goTo(page, '#/tag/2026-11-04');
  await waitForPageOf(page, 'tag', '2026-11-04');
  await expect.poll(() => neighborBackground(page, 'below')).toContain('Erika Muster');
  expect(await neighborBackground(page, 'above')).not.toContain('Probe');
});

test('a new appointment shows in the preview, which keeps its strokes and does not read the neighbour again', async ({ page }) => {
  const next = wochePagePath('2026-W45');
  const repo = await openSeeded(page, '#/woche/2026-W44', { files: { [next]: weekWith('2026-W45', strokeThrough('a', CLEAN)) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 1 });
  await expect.poll(() => neighborBackground(page, 'below')).toContain('Zahnarzt'); // am 02.11., aus dem Mini-Vault
  await expect.poll(() => lastHead(page)).not.toBeNull();
  await page.waitForTimeout(300);
  const reads = readsOf(repo, next);

  // Ein anderes Gerät trägt am 04.11. einen Termin ein.
  repo.commit(TERMINE_PATH, `${repo.read(TERMINE_PATH)}- 2026-11-04 15:00 bis 16:00 | Neue Runde | Raum 2 | Outlook\n`);
  await bringToForeground(page);
  await expect.poll(() => neighborBackground(page, 'below')).toContain('Neue Runde');
  expect(await neighbors(page)).toEqual({ above: 0, below: 1 });
  await page.waitForTimeout(300);
  expect(readsOf(repo, next)).toBe(reads);
  expect(repo.puts).toEqual([]);
});

test('after the wheel, a pressed mouse button keeps the page until it is let go', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  // Gleich nach dem Rad drückt die Maus auf den 29.10. und hält: Erst nach dem Loslassen wird der 30.10. die offene Seite.
  const now = await spin(page, await spinsTo(page, PAST_BELOW), { press: [600, 1000] });
  expect(now.hash).toBe(DAY);
  await page.waitForTimeout(600);
  expect(await hash(page)).toBe(DAY);
  await mouse(page).up(600, 1000);
  await expect.poll(() => hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
});

test('a page left before the wheel comes to rest does not open its neighbour afterwards', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  // Gleich nach dem Rad, bevor es zur Ruhe kommt, geht eine andere Seite auf, wie mit einem Link.
  const now = await spin(page, await spinsTo(page, PAST_BELOW), { open: '#/tag/2026-11-05' });
  expect(now.hash).toBe(DAY);
  await waitForPageOf(page, 'tag', '2026-11-05');
  await page.waitForTimeout(400);
  expect(await hash(page)).toBe('#/tag/2026-11-05');
});

/** Ein Knopf der Werkzeugleiste, nach seinem Namen. */
const toolButton = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/**
 * Der Stift schwebt über `at` (Seiteneinheiten der offenen Seite), ohne aufzusetzen. Gleich danach, im selben Zug und damit vor
 * dem Ablauf der Zeit, nach der die Spitze von selbst geht: wie viele Spitzen auf der Fläche stehen.
 */
const tipsWhileHovering = (page: Page, at: [number, number]) =>
  page.evaluate(([x, y]) => {
    const live = document.querySelector('[data-testid="surface"] canvas[data-layer="live"]')!;
    const c = window.__notizbuch.toClient(x, y);
    const init = { pointerId: 11, pointerType: 'pen', isPrimary: true, pressure: 0, clientX: c.x, clientY: c.y, button: -1, buttons: 0 };
    live.dispatchEvent(new PointerEvent('pointermove', { ...init, bubbles: true, cancelable: true, composed: true }));
    return document.querySelectorAll('[data-testid="surface"] .spitze').length;
  }, at);

test('the fountain pen hovering over the neighbour or the gap in front of it shows no tip', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await toolButton(page, 'Füllfeder').click();
  await scrollUntil(page, NEXT_IN_VIEW);

  // Über dem 29.10. zeigt die Spitze, wo der Stift schriebe. Über dem Spalt und dem 30.10. schreibt er nicht: keine Spitze.
  expect(await tipsWhileHovering(page, [600, 1000])).toBe(1);
  expect(await tipsWhileHovering(page, [600, PAGE_H + PAGE_GAP / 2])).toBe(0);
  expect(await tipsWhileHovering(page, [600, 1000])).toBe(1);
  expect(await tipsWhileHovering(page, ON_NEXT)).toBe(0);
});

test('after the pen opened the neighbour, a small touch counts as the hand until the pen lifts', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);
  const tip = pen(page);
  await tip.down(...ON_NEXT);
  await waitForPageOf(page, 'tag', '2026-10-30');

  // Der Stift liegt noch auf und gleitet jetzt über die neue Seite. Eine kleine Berührung daneben ist die Hand: Sie schiebt nichts.
  // (Schöbe sie, wechselte es beim Loslassen zurück zum 29.10., denn der bedeckt noch die Mitte.)
  await tip.move(600, 220);
  const before = await viewOf(page);
  await touch(page).stroke([
    [300, 300],
    [300, 200],
  ]);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  expect(await viewOf(page)).toEqual(before);
  await tip.up(600, 220);
  expect(await strokeCount(page)).toBe(0);

  // Nach dem Abheben gilt die Pause wie immer, danach schiebt ein Finger die Seite wieder (ganz im Bild, die Mitte auf dem 30.10.).
  await toolButton(page, 'Ganze Seite').click();
  await afterPalmWindow(page);
  const fitted = await viewOf(page);
  await touch(page).stroke([
    [300, 800],
    [300, 700],
  ]);
  expect((await viewOf(page)).y).toBeLessThan(fitted.y - 50);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
});

test('a pen that opened the neighbour and lifts over the top bar leaves the fingers working', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);
  const tip = pen(page);
  await tip.down(...ON_NEXT);
  await waitForPageOf(page, 'tag', '2026-10-30');
  await tip.move(600, 220);

  // Er hebt über der Leiste oben ab: Sein Ende kommt nicht bei der Fläche an, das Tor geht trotzdem wieder auf.
  const bar = await centerOf(page, '.topbar');
  await tip.upOn('.topbar', bar.x, bar.y);
  await toolButton(page, 'Ganze Seite').click();
  await afterPalmWindow(page);
  const fitted = await viewOf(page);
  await touch(page).stroke([
    [300, 800],
    [300, 700],
  ]);
  expect((await viewOf(page)).y).toBeLessThan(fitted.y - 50);
});

test('the eraser on the neighbour erases nothing and opens it', async ({ page }) => {
  // Ein Strich des 29.10. ragt über seinen Unterrand hinaus bis auf den 30.10. Der Radierer setzt dort auf, wo er über dem 30.10. liegt.
  const below = PAGE_H + PAGE_GAP;
  const long: Stroke = { ...strokeThrough('lang', [600, 1500]), pts: [{ x: 600, y: 1450, w: 1.2 }, { x: 600, y: below + 160, w: 1.2 }] };
  const repo = await openSeeded(page, DAY, { files: { [tagFile('2026-10-29')]: dayWith('2026-10-29', long) } });
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  expect(await strokeCount(page)).toBe(1);
  await toolButton(page, 'Radierer').click();
  await scrollUntil(page, NEXT_IN_VIEW);

  await pen(page).stroke([
    [560, below + 100],
    [600, below + 100],
    [640, below + 100],
  ]);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  await expect.poll(() => neighbors(page)).toEqual({ above: 1, below: 0 }); // der lange Strich ist noch da
  expect(await queued(page)).toEqual({});
  expect(repo.puts).toEqual([]);
});

test('the pen in the gap opens the neighbour and writes nothing', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);

  const gap = PAGE_H + PAGE_GAP / 2;
  await pen(page).stroke([
    [500, gap],
    [560, gap],
    [620, gap],
  ]);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
  expect(await strokeCount(page)).toBe(0);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  expect(await queued(page)).toEqual({});
});

test('a stroke that starts on the page and runs into the next day stays one stroke of the open page', async ({ page }) => {
  const repo = await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);

  await pen(page).stroke([
    [600, PAGE_H - 60],
    [600, PAGE_H + PAGE_GAP / 2],
    [600, PAGE_H + PAGE_GAP + 60],
  ]);
  await expect.poll(() => strokeCount(page)).toBe(1);
  expect(await hash(page)).toBe(DAY);
  expect(await neighbors(page)).toEqual({ above: 0, below: 0 });
  // Er ist am Rand nicht abgeschnitten: Er reicht wie bisher über die Seite hinaus, bis dorthin, wo der 30.10. beginnt.
  const lowest = await page.evaluate(() => Math.max(...window.__notizbuch.currentPage().strokes[0].pts.map((pt) => pt.y)));
  expect(lowest).toBeGreaterThan(PAGE_H + PAGE_GAP);
  await sendToBackground(page);
  await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([tagFile('2026-10-29')]);
  expect(strokesIn(repo.puts[0].text)).toBe(1);
});

test('a mouse click on the neighbour opens it', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);
  await mouse(page).tap(...ON_NEXT);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
  await waitForPageOf(page, 'tag', '2026-10-30');
});

/** Der Zähler im Browser, wie oft der Link eines Tages in „Tage dieser Seite“ ohne „Priorität“ auf der Seite stand. */
type LinkLog = { linksWithoutPrio?: number };
/**
 * Zählt von jetzt an im Browser, wie oft nach einer Änderung der Seite der Link des Tages `day` in der Liste „Tage dieser Seite“
 * dasteht, ohne eine Priorität zu nennen. Sein Text kommt aus denselben Daten wie die Zeilen auf der Fläche, auch im ersten Bild
 * einer neuen Seite.
 */
const watchDayLink = (page: Page, day: string) =>
  page.evaluate((d) => {
    const log = window as unknown as LinkLog;
    log.linksWithoutPrio = 0;
    new MutationObserver(() => {
      const link = document.querySelector(`nav.tage a[href="#/tag/${d}"]`);
      if (link && !link.textContent?.includes('Priorität')) log.linksWithoutPrio = (log.linksWithoutPrio ?? 0) + 1;
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  }, day);
const linksWithoutPrio = (page: Page) => page.evaluate(() => (window as unknown as LinkLog).linksWithoutPrio);

test('back in the week just left, its priorities are there from the first frame', async ({ page }) => {
  // Woche 44 hat am Samstag, 31.10., eine Priorität. Ihr Tag liegt unten auf der Seite, beim Zurückscrollen also im Bild.
  const prio = { [dailyNotePath('2026-10-31')]: noteWith('2026-10-31', 'Sperren abstimmen') };
  await openSeeded(page, '#/woche/2026-W44', { files: prio });
  await expect.poll(() => screenBackground(page)).toContain('Sperren abstimmen');
  await scrollUntil(page, PAST_BELOW);
  await waitForPageOf(page, 'woche', '2026-W45');
  await expect.poll(() => neighborBackground(page, 'above')).toContain('Sperren abstimmen');

  // Zurück in die Woche 44: Sie hat ihre Priorität schon beim Aufgehen, nicht erst, wenn ihre Tagesnotizen wieder gelesen sind.
  await watchDayLink(page, '2026-10-31');
  const lift = await scrollUntil(page, PAST_ABOVE, { lift: false });
  await watchFrames(page);
  await expect.poll(() => framesSoFar(page)).toBeGreaterThan(2);
  await lift();
  await waitForPageOf(page, 'woche', '2026-W44');
  const opened = await framesSoFar(page);
  await expect.poll(() => framesSoFar(page)).toBeGreaterThan(opened + 5);
  const frames = await stopWatching(page);
  expect(await linksWithoutPrio(page)).toBe(0);

  // Jedes Bild nach dem Wechsel zeigt dasselbe wie das letzte davor, mit der Priorität.
  const before = frames.filter((f) => f.hash === '#/woche/2026-W45');
  const last = before[before.length - 1];
  expect(last.marked).toBeGreaterThan(0);
  const after = frames.filter((f) => f.hash !== '#/woche/2026-W45');
  expect(after.length).toBeGreaterThan(5);
  expect(after.map(picture)).toEqual(after.map(() => picture(last)));
});

/**
 * Ein Finger zieht in einem Zug so, dass die Mitte der Fläche nacheinander bei `targets` liegt (Seiteneinheiten der offenen Seite),
 * und hebt ab. Er setzt in der Mitte der Fläche auf; die Wege bleiben kürzer als die halbe Höhe der Fläche.
 */
async function dragMiddleThrough(page: Page, targets: number[]) {
  const { box, view, y } = await middleOf(page);
  const x = box.x + box.width / 2;
  const start = box.y + box.height / 2;
  const onPage = (screenY: number): [number, number] => [(x - view.x) / view.scale, (screenY - view.y) / view.scale];
  await touch(page).stroke([onPage(start), ...targets.map((target) => onPage(start - (target - y) * view.scale))]);
}

/** Ein kurzer Strich oben im Kopf der Tagesseite, über dem Datum: Dort ist Papier, und der Kopf ist nach dem Wechsel zu sehen. */
const IN_HEAD: [number, number][] = [
  [700, 40],
  [760, 50],
  [820, 40],
];

for (const how of ['pen', 'finger tap'] as const) {
  test(`after a ${how} opened the next day, moving the day before around does not go back to it`, async ({ page }) => {
    const repo = await openSeeded(page, DAY);
    await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
    await scrollUntil(page, NEXT_IN_VIEW);
    if (how === 'pen') await pen(page).stroke([ON_NEXT, [ON_NEXT[0] + 60, ON_NEXT[1]]]);
    else await touch(page).tap(...ON_NEXT);
    expect(await hash(page)).toBe('#/tag/2026-10-30');
    await waitForPageOf(page, 'tag', '2026-10-30');
    const entries = await historyLength(page);

    // Gleich auf den 30.10. schreiben, dann die Seite ein Stück schieben. Die Mitte liegt noch auf dem 29.10.: Bleibt sie dort,
    // wechselt nichts zurück, auch nicht, wenn sie unterwegs auf den 30.10. und wieder zurück kam.
    await pen(page).stroke(IN_HEAD);
    await expect.poll(() => strokeCount(page)).toBe(1);
    await afterPalmWindow(page);
    const { y } = await middleOf(page);
    expect(y).toBeLessThan(-PAGE_GAP / 2);
    await dragMiddleThrough(page, [y + 100]);
    expect(await hash(page)).toBe('#/tag/2026-10-30');
    await dragMiddleThrough(page, [300, y]);
    expect(await hash(page)).toBe('#/tag/2026-10-30');
    expect(await historyLength(page)).toBe(entries);

    // Der nächste Strich schreibt also auf den 30.10., und nur dorthin.
    await pen(page).stroke(IN_HEAD.map(([px, py]): [number, number] => [px, py + 30]));
    await expect.poll(() => strokeCount(page)).toBe(2);
    await sendToBackground(page);
    await expect.poll(() => repo.puts.map((put) => put.path)).toEqual([tagFile('2026-10-30')]);
    expect(strokesIn(repo.puts[0].text)).toBe(2);
  });
}

test('after a click opened the next day, turning the wheel a little does not go back to the day before', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);
  await mouse(page).tap(...ON_NEXT);
  await waitForPageOf(page, 'tag', '2026-10-30');

  // Die Mitte liegt noch auf dem 29.10. und bleibt dort, während das Rad die Seite ein Stück schiebt: kein Wechsel zurück.
  const now = await spin(page, [{ dy: 50 }, { dy: 50 }]);
  expect(now.middle).toBeLessThan(-PAGE_GAP / 2);
  await page.waitForTimeout(400);
  expect(await hash(page)).toBe('#/tag/2026-10-30');
});

/** Der Stift bewegt sich über `at` (Seiteneinheiten der offenen Seite) mit diesen Tasten (`buttons`), ohne Druck. */
const penMoveWith = (page: Page, at: [number, number], buttons: number) =>
  page.evaluate(
    ({ at: [x, y], buttons: pressed }) => {
      const live = document.querySelector('[data-testid="surface"] canvas[data-layer="live"]')!;
      const c = window.__notizbuch.toClient(x, y);
      const init = { pointerId: 11, pointerType: 'pen', isPrimary: true, pressure: 0, clientX: c.x, clientY: c.y, button: -1, buttons: pressed };
      live.dispatchEvent(new PointerEvent('pointermove', { ...init, bubbles: true, cancelable: true, composed: true }));
    },
    { at, buttons },
  );

test('a pen hovering with a button held leaves the fingers working', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  // Mit gedrückter Taste am Schaft (2) oder Radiertaste (32) schwebt der Stift nur, er liegt nicht auf: Finger schieben weiter.
  for (const buttons of [2, 32]) {
    await penMoveWith(page, [600, 900], buttons);
    const before = await viewOf(page);
    await touch(page).stroke([
      [300, 900],
      [300, 850],
    ]);
    expect((await viewOf(page)).y, `Taste ${buttons}`).toBeLessThan(before.y - 20);
  }
});

test('a pen that opened the neighbour and hovers again without a lift that arrived leaves the fingers working', async ({ page }) => {
  await openSeeded(page, DAY);
  await expect.poll(() => neighbors(page)).toEqual({ above: 0, below: 0 });
  await scrollUntil(page, NEXT_IN_VIEW);
  await pen(page).down(...ON_NEXT);
  await waitForPageOf(page, 'tag', '2026-10-30');
  await penMoveWith(page, [600, 220], 1); // liegt auf: Das Tor gegen Handballen ist zu

  // Sein Abheben kam nirgends an, aber er schwebt wieder: Dann liegt er nicht mehr auf, und das Tor geht wieder auf.
  await penMoveWith(page, [600, 260], 0);
  await toolButton(page, 'Ganze Seite').click();
  await afterPalmWindow(page);
  const fitted = await viewOf(page);
  await touch(page).stroke([
    [300, 800],
    [300, 700],
  ]);
  expect((await viewOf(page)).y).toBeLessThan(fitted.y - 50);
});
