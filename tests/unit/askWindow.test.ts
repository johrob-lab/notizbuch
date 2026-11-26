import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { kopieImSpeicher } from '../../src/gehirn/kopie';
import { GestureFilter } from '../../src/ink/gestures';
import { pageImage } from '../../src/ki/pageImage';
import { EARLIER_IMAGE } from '../../src/ki/prompt';
import { timeVienna } from '../../src/lib/dates';
import type { KiModel } from '../../src/lib/settings';
import type { SyncEngine } from '../../src/sync/engine';
import { OfflineError, type CopyClient } from '../../src/sync/github';
import type { AskPage } from '../../src/ui/ask';
import { AskWindow, type AskControl } from '../../src/ui/AskWindow';
import { onNoteWrite } from '../../src/ui/noteQueue';
import { FAILED } from '../../src/ui/texts';
import {
  blockStart,
  blockStop,
  errorEvent,
  inputJsonDelta,
  messageDelta,
  messageStart,
  messageStop,
  signatureDelta,
  stepsOf,
  streamOf,
  textDelta,
  textDeltaAt,
  thinkingDelta,
  type Call,
} from './helpers';

// Das Fenster „Frag Claude“ mit einer erfundenen Seite, einer erfundenen Engine und einem erfundenen Zugang zu GitHub für die
// Kopie des Vaults (`fakeCopy`, die Kopie selbst liegt in fake-indexeddb). Zuerst die Hülle: Öffnen, Schließen, der Schalter
// „Seite mitschicken“ und die Hand, die beim Schreiben aufliegt. Danach das Fragen: `fetch` ist ein erfundener Strom (`streamOf`,
// mit Werkzeugschritten `stepsOf`), das Bild der Seite ein fester Text. Die Zeit der Zeigerereignisse gibt der Test vor. happy-dom
// rechnet keine Größen aus: Jedes Element liegt bei 0, 0, und dort tippen die Zeiger. Der Weg durch den Browser ist Sache von
// tests/e2e/fragClaude.spec.ts und tests/e2e/gehirn.spec.ts.

vi.mock('../../src/ki/pageImage', () => ({ pageImage: vi.fn(async () => 'AAAA') }));

type Kind = 'pen' | 'touch' | 'mouse';

function fakePage(o: Partial<AskPage> = {}): AskPage {
  return {
    label: 'Do 29.10.2026',
    day: '2026-10-29',
    describe: vi.fn(async () => 'Offene Seite: Tagesseite Do 29.10.2026'),
    svg: vi.fn(() => '<svg xmlns="http://www.w3.org/2000/svg"/>'),
    filter: new GestureFilter(),
    ...o,
  };
}

/** Eine Engine, die nichts kann: Fragen und Antworten lesen und schreiben keine Notiz. */
const fakeEngine = { readOnly: false } as unknown as SyncEngine;

/** Erfundene Notizen des Vaults. Nur die erste enthält „Beispiel“. */
const NOTIZEN: Record<string, string> = {
  '02 Projekte/Beispiel Projekt.md': '# Beispiel Projekt\n\nDie Bestellung ging am 25.11. hinaus.\n',
  '05 Daily Notes/2026-10-28.md': '# 2026-10-28\n\n## Besprechungen\n- Nichts Neues.\n',
};

/**
 * Ein erfundener Zugang zu GitHub für die Kopie: Kopf `h1`, im Baum die `notizen`. Mit `hang` kommt nie eine Antwort auf die
 * Frage nach dem Kopf (eine Verbindung, die nicht aufgibt). `copyText` ersetzt das Holen einer Datei. `calls` zählt die Anfragen.
 */
function fakeCopy(o: { notizen?: Record<string, string>; hang?: boolean; copyText?: CopyClient['copyText'] } = {}) {
  const notizen = o.notizen ?? NOTIZEN;
  const calls = { head: 0, tree: 0, text: 0 };
  const client: CopyClient = {
    headSha: () => {
      calls.head++;
      return o.hang ? new Promise<string>(() => undefined) : Promise.resolve('h1');
    },
    vaultTree: async () => {
      calls.tree++;
      return { entries: Object.entries(notizen).map(([path, text]) => ({ path, sha: `sha ${path}`, size: text.length })), truncated: false };
    },
    copyText: async (entry) => {
      calls.text++;
      return o.copyText ? o.copyText(entry) : notizen[entry.path];
    },
  };
  return { client, calls };
}

type WindowProps = {
  engine: SyncEngine;
  client: CopyClient;
  kiKey: string;
  model: KiModel;
  page: AskPage | null;
  away: boolean;
  control: { current: AskControl | null };
};

const hosts: HTMLElement[] = [];

function mount(o: { page?: AskPage | null; engine?: SyncEngine; client?: CopyClient } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const control: { current: AskControl | null } = { current: null };
  let props: WindowProps = {
    engine: o.engine ?? fakeEngine,
    client: o.client ?? fakeCopy().client,
    kiKey: 'sk-ant-test-0000',
    model: 'sonnet',
    page: o.page === undefined ? fakePage() : o.page,
    away: false,
    control,
  };
  const draw = () => render(h(AskWindow, props), host);
  draw();
  return {
    host,
    control,
    /** Die App zeichnet das Fenster mit neuen Angaben. */
    set: (change: Partial<WindowProps>) =>
      act(() => {
        props = { ...props, ...change };
        draw();
      }),
  };
}

beforeEach(() => {
  vi.mocked(pageImage).mockClear();
  // Jeder Test bekommt eine leere Kopie.
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
});

afterEach(() => {
  vi.useRealTimers();
  for (const host of hosts.splice(0)) {
    render(null, host);
    host.remove();
  }
  vi.unstubAllGlobals();
  // Ein Test kann den Browser offline stellen.
  delete (navigator as { onLine?: boolean }).onLine;
});

const win = (host: HTMLElement) => host.querySelector<HTMLElement>('.frag-fenster')!;
const field = (host: HTMLElement) => host.querySelector<HTMLTextAreaElement>('#frag-feld')!;
const toggle = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('.frag-seite')!;
const button = (host: HTMLElement, name: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === name)!;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function send(el: Element, type: string, o: { kind: Kind; t: number; size?: number; id?: number }): PointerEvent {
  const ev = new PointerEvent(type, {
    pointerId: o.id ?? 7,
    pointerType: o.kind,
    clientX: 0,
    clientY: 0,
    width: o.size ?? 1,
    height: o.size ?? 1,
    button: 0,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(ev, 'timeStamp', { value: o.t });
  el.dispatchEvent(ev);
  return ev;
}

/** Ein Tipp: aufsetzen und 40 ms später abheben. */
function tap(el: Element, kind: Kind, t: number, size?: number): void {
  send(el, 'pointerdown', { kind, t, size });
  send(el, 'pointerup', { kind, t: t + 40, size });
}

/** Das Ende einer Berührung, wie der Browser es nach dem Abheben meldet: abbrechbar, am Ort des Zeigers. */
function touchEnd(el: Element): TouchEvent {
  const ev = new TouchEvent('touchend', { bubbles: true, cancelable: true, changedTouches: [new Touch({ identifier: 1, target: el, clientX: 0, clientY: 0 })] });
  el.dispatchEvent(ev);
  return ev;
}

/** Was der Browser aus einem Tipp macht, nachdem die Berührung geendet hat. */
function mouseAfterTouch(el: Element, type: 'mousedown' | 'click'): MouseEvent {
  const ev = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 0, clientY: 0, detail: 1 });
  el.dispatchEvent(ev);
  return ev;
}

const type = (host: HTMLElement, text: string) =>
  act(() => {
    field(host).value = text;
    field(host).dispatchEvent(new Event('input', { bubbles: true }));
  });

test('open shows the window and puts the focus in the field', async () => {
  const { host, control } = mount();
  expect(win(host).hidden).toBe(true);
  // Alles im selben Aufruf: Das iPad öffnet die Tastatur nur, solange der Tipp noch läuft, und das Fenster ist dann schon sichtbar.
  let shownAtFocus: boolean | null = null;
  field(host).addEventListener('focus', () => (shownAtFocus = !win(host).hidden));
  control.current!.open();
  expect(shownAtFocus).toBe(true);
  expect(document.activeElement).toBe(field(host));
  await act(() => undefined);
  expect(win(host).hidden).toBe(false);
  expect(document.activeElement).toBe(field(host));
  expect(host.querySelector(`label[for="frag-feld"]`)!.textContent).toBe('Was willst du wissen?');
  expect(host.querySelector('h2')!.textContent).toBe('Frag Claude');
  expect(host.querySelector('.frag-fehler')!.getAttribute('role')).toBe('alert');
  expect(host.querySelector('.frag-verlauf')!.children).toHaveLength(0);
});

test('the tap that opened the window does not take the focus away again', async () => {
  const { host, control } = mount();
  const knopf = document.createElement('button');
  document.body.append(knopf);
  try {
    // Der Tipp hat das Fenster geöffnet. Danach macht der Browser aus der Berührung noch die Maustaste auf dem Knopf: Sie nähme dem Feld
    // den Fokus, am iPad ginge die Tastatur gleich wieder zu.
    control.current!.open();
    expect(mouseAfterTouch(knopf, 'mousedown').defaultPrevented).toBe(true);
    // Nur die eine: Die nächste gehört zu einem neuen Zeiger.
    expect(mouseAfterTouch(knopf, 'mousedown').defaultPrevented).toBe(false);
    await act(() => undefined);
    // Setzt zuerst ein neuer Zeiger auf, geht seine Maustaste durch.
    button(host, 'Neue Frage').focus();
    await act(() => tap(button(host, 'Neue Frage'), 'pen', performance.now()));
    expect(document.activeElement).toBe(field(host));
    send(knopf, 'pointerdown', { kind: 'mouse', t: performance.now() });
    expect(mouseAfterTouch(knopf, 'mousedown').defaultPrevented).toBe(false);
  } finally {
    knopf.remove();
  }
});

test('the switch names the open page and follows it', async () => {
  const { host, set } = mount();
  expect(toggle(host).getAttribute('role')).toBe('switch');
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: Do 29.10.2026');
  expect(toggle(host).getAttribute('aria-checked')).toBe('true');
  expect(toggle(host).disabled).toBe(false);
  await set({ page: null });
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: keine Seite offen');
  expect(toggle(host).disabled).toBe(true);
  await set({ page: fakePage({ label: 'Fr 30.10.2026', day: '2026-10-30' }) });
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: Fr 30.10.2026');
  expect(toggle(host).disabled).toBe(false);
});

test('away hides the window and keeps the field', async () => {
  const { host, control, set } = mount();
  await act(() => control.current!.open());
  await type(host, 'Was steht an?');
  await set({ away: true });
  expect(win(host).hidden).toBe(true);
  await set({ away: false });
  expect(win(host).hidden).toBe(false);
  expect(field(host).value).toBe('Was steht an?');
});

test('Schließen hides and empties', async () => {
  const { host, control } = mount();
  await act(() => control.current!.open());
  expect(button(host, 'Fragen').disabled).toBe(true); // ohne Frage gibt es nichts zu fragen
  await type(host, 'Was steht an?');
  expect(button(host, 'Fragen').disabled).toBe(false);
  await act(() => tap(toggle(host), 'touch', performance.now()));
  expect(toggle(host).getAttribute('aria-checked')).toBe('false');
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now()));
  expect(win(host).hidden).toBe(true);
  expect(field(host).value).toBe('');
  expect(toggle(host).getAttribute('aria-checked')).toBe('true');
});

test('Neue Frage puts the focus back into the field and keeps it', async () => {
  const { host, control } = mount();
  await act(() => control.current!.open());
  await type(host, 'Was steht an?');
  button(host, 'Neue Frage').focus();
  await act(() => tap(button(host, 'Neue Frage'), 'mouse', performance.now()));
  expect(document.activeElement).toBe(field(host));
  expect(field(host).value).toBe('Was steht an?');
});

test('a resting hand triggers nothing', async () => {
  const page = fakePage();
  const { host, control } = mount({ page });
  await act(() => control.current!.open());

  // Der Stift schreibt auf der Seite: Ein Finger auf „Schließen“ ist die Hand.
  page.filter.penDown(performance.now());
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(false);

  // Eine große Auflage auf dem Feld: Ihr Ende und der Klick daraus gehen nicht durch, das Feld bekommt keinen Fokus.
  const t = performance.now();
  send(field(host), 'pointerdown', { kind: 'touch', t, size: 200, id: 9 });
  send(field(host), 'pointerup', { kind: 'touch', t: t + 40, size: 200, id: 9 });
  expect(touchEnd(field(host)).defaultPrevented).toBe(true);
  expect(mouseAfterTouch(field(host), 'mousedown').defaultPrevented).toBe(true);
  expect(mouseAfterTouch(field(host), 'click').defaultPrevented).toBe(true);

  // Der Stift hebt ab. 300 ms später ist ein Finger wieder ein Finger.
  page.filter.penUp(performance.now());
  await wait(300);
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(true);
});

test('a finger tap on the field goes through, a hand that lay there before the pen wrote does not', async () => {
  const page = fakePage();
  const { host, control } = mount({ page });
  await act(() => control.current!.open());

  // Ein Finger tippt aufs Feld: Der Browser darf daraus den Fokus machen.
  const t = performance.now();
  send(field(host), 'pointerdown', { kind: 'touch', t, size: 10 });
  send(field(host), 'pointerup', { kind: 'touch', t: t + 40, size: 10 });
  expect(touchEnd(field(host)).defaultPrevented).toBe(false);
  expect(mouseAfterTouch(field(host), 'click').defaultPrevented).toBe(false);

  // Die Hand liegt schon auf dem Feld, dann schreibt der Stift auf der Seite. Sie hebt erst lange nach dem Stift ab: Sie war die Hand.
  send(field(host), 'pointerdown', { kind: 'touch', t: performance.now(), size: 10, id: 8 });
  page.filter.penDown(performance.now());
  page.filter.penUp(performance.now());
  await wait(300);
  send(field(host), 'pointerup', { kind: 'touch', t: performance.now(), size: 10, id: 8 });
  expect(touchEnd(field(host)).defaultPrevented).toBe(true);
  expect(mouseAfterTouch(field(host), 'click').defaultPrevented).toBe(true);
});

test('a pen on the window holds the gate for the hand', async () => {
  const page = fakePage();
  const { host, control } = mount({ page });
  await act(() => control.current!.open());
  // Der Stift setzt im Fenster auf (Kritzeln ins Feld): Ein Finger auf „Schließen“ ist jetzt die Hand.
  const t = performance.now();
  send(field(host), 'pointerdown', { kind: 'pen', t, id: 3 });
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(false);
  // Er hebt ab, wo auch immer: Das Tor hört es.
  const up = new PointerEvent('pointerup', { pointerId: 3, pointerType: 'pen', bubbles: true, cancelable: true });
  Object.defineProperty(up, 'timeStamp', { value: performance.now() });
  document.body.dispatchEvent(up);
  await wait(300);
  await act(() => tap(button(host, 'Schließen'), 'touch', performance.now(), 10));
  expect(win(host).hidden).toBe(true);
});

test('Strg and the wheel over the window do not zoom the browser', () => {
  const { host } = mount();
  const zoom = new WheelEvent('wheel', { deltaY: -100, bubbles: true, cancelable: true });
  Object.defineProperty(zoom, 'ctrlKey', { value: true }); // happy-dom übernimmt `ctrlKey` beim Rad nicht
  field(host).dispatchEvent(zoom);
  expect(zoom.defaultPrevented).toBe(true);
  const scroll = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true });
  field(host).dispatchEvent(scroll);
  expect(scroll.defaultPrevented).toBe(false);
});

// ---------- Fragen und Antworten ----------

const rounds = (host: HTMLElement) => host.querySelectorAll('.frag-verlauf > .frag-runde');
/** Der Text jeder Antwort, die neueste zuerst. Der Zeilenumbruch nach dem letzten Absatz ist nicht zu sehen und zählt nicht. */
const answers = (host: HTMLElement) => [...host.querySelectorAll('.frag-antwort')].map((el) => el.textContent!.trim());
const errorLine = (host: HTMLElement) => host.querySelector('.frag-fehler')!.textContent;
/** Die Zeile „Fehlercode …“ unter der Fehlerzeile des Fensters, `null` ohne. */
const errorCode = (host: HTMLElement) => host.querySelector('.frag-fenster > .frag-code')?.textContent ?? null;
const costs = (host: HTMLElement) => [...host.querySelectorAll('.frag-kosten')].map((el) => el.textContent);
/** Die grauen Zeilen über den Antworten, alle Runden. */
const stepLines = (host: HTMLElement) => [...host.querySelectorAll('.frag-schritte > li')].map((el) => el.textContent);
/** Die Zeile zur Kopie unter den Knöpfen. */
const brainLine = (host: HTMLElement) => host.querySelector('.frag-gehirn')?.textContent ?? null;

/** Eine ganze Antwort in einem Stück, mit 5000 Token hinein und 100 hinaus. */
const reply = (text: string) => [messageStart(5000, 1), textDelta(text), messageDelta('end_turn', 100), messageStop()];
/** Erst `Hal`, dann der Rest `lo` mit dem Ende der Antwort. */
const halThenLo = () => [messageStart(5000, 1) + textDelta('Hal'), textDelta('lo') + messageDelta('end_turn', 100) + messageStop()];

/** Der Körper einer Anfrage an Claude. */
const bodyOf = (call: Call) => JSON.parse(call.init.body as string);

/** Ein Versprechen, das der Test selbst erfüllt: So lange hält ein Strom mit `release` nach dem ersten Stück an. */
function gate(): { promise: Promise<void>; open(): void } {
  let open!: () => void;
  const promise = new Promise<void>((resolve) => (open = resolve));
  return { promise, open };
}

/** Wartet, bis die Bedingung gilt: Die Antwort kommt über Versprechen und Zeichnen in mehreren Runden der Ereignisschleife. */
async function until(cond: () => boolean, what = 'Bedingung'): Promise<void> {
  for (let i = 0; i < 500; i++) {
    if (cond()) return;
    await act(() => wait(1));
  }
  throw new Error(`${what} wurde nie erfüllt`);
}

const press = (host: HTMLElement, name: string) => act(() => tap(button(host, name), 'mouse', performance.now()));

/** Die Frage ins Feld, dann „Fragen“. */
async function ask(host: HTMLElement, text: string): Promise<void> {
  await type(host, text);
  await press(host, 'Fragen');
}

/** Öffnet ein neues Fenster mit der Seite `page`. */
async function opened(o: { page?: AskPage | null; engine?: SyncEngine; client?: CopyClient } = {}) {
  const mounted = mount(o);
  await act(() => mounted.control.current!.open());
  return mounted;
}

const IMAGE_BLOCK = { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } };
/** Der letzte Block der letzten Nutzer-Nachricht trägt die Marke für den Zwischenspeicher. */
const CACHE = { type: 'ephemeral' };

test('a question streams in and ends with its cost', async () => {
  const later = gate();
  const f = streamOf(halThenLo(), { release: later.promise });
  vi.stubGlobal('fetch', f);
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  // Das Feld ist leer und verlassen, oben steht die neue Runde mit der Frage.
  expect(field(host).value).toBe('');
  expect(document.activeElement).not.toBe(field(host));
  expect(rounds(host)).toHaveLength(1);
  expect(host.querySelector('.frag-frage')!.textContent).toBe('Was steht an?');

  await until(() => answers(host)[0] === 'Hal', 'Hal');
  expect(button(host, 'Stopp')).toBeDefined();
  expect(button(host, 'Fragen')).toBeUndefined();
  expect(costs(host)).toEqual([]);

  later.open();
  await until(() => costs(host).length === 1, 'Kosten');
  expect(answers(host)).toEqual(['Hallo']);
  expect(costs(host)).toEqual(['≈ 1,1 Cent']);
  expect(field(host).value).toBe('');
  expect(button(host, 'Fragen')).toBeDefined();
  expect(f.calls).toHaveLength(1);
});

test('the page goes along when the switch is on', async () => {
  const f = streamOf(reply('Hallo'));
  vi.stubGlobal('fetch', f);
  const page = fakePage();
  const { host } = await opened({ page });
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'Antwort');
  const body = bodyOf(f.calls[0]);
  expect(body.messages).toHaveLength(1);
  expect(body.messages.at(-1).content).toEqual([IMAGE_BLOCK, { type: 'text', text: 'Offene Seite: Tagesseite Do 29.10.2026\n\nFrage: Was steht an?', cache_control: CACHE }]);
  expect(body.system[0].text.startsWith('Du bist Claude')).toBe(true);
  // Claude darf in der Kopie suchen, und die Regeln nennen ihren Stand beim Fragen.
  expect(body.tools.map((tool: { name: string }) => tool.name)).toEqual(['suchen', 'lesen', 'auflisten']);
  expect(body.tool_choice).toEqual({ type: 'auto' });
  expect(body.system[1].text).toContain('Die Kopie des Vaults ist vollständig (2 Notizen).');
  expect(body.model).toBe('claude-sonnet-5-5');
  expect((f.calls[0].init.headers as Record<string, string>)['x-api-key']).toBe('sk-ant-test-0000');
  expect(page.describe).toHaveBeenCalledTimes(1);
  expect(pageImage).toHaveBeenCalledWith('<svg xmlns="http://www.w3.org/2000/svg"/>');
  expect(host.querySelector('.frag-wann')!.textContent).toMatch(/^\d\d:\d\d · Do 29\.10\.2026$/);
});

test('without the switch only the question goes', async () => {
  const f = streamOf(reply('Hallo'));
  vi.stubGlobal('fetch', f);
  const page = fakePage();
  const { host } = await opened({ page });
  await act(() => tap(toggle(host), 'mouse', performance.now()));
  expect(toggle(host).getAttribute('aria-checked')).toBe('false');
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'Antwort');
  expect(bodyOf(f.calls[0]).messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Frage: Was steht an?', cache_control: CACHE }] }]);
  expect(page.describe).not.toHaveBeenCalled();
  expect(pageImage).not.toHaveBeenCalled();
  expect(host.querySelector('.frag-wann')!.textContent).toMatch(/^\d\d:\d\d · ohne Seite$/);
});

test('a failed picture still sends the text and says so', async () => {
  vi.mocked(pageImage).mockResolvedValueOnce(null);
  const f = streamOf(reply('Hallo'));
  vi.stubGlobal('fetch', f);
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'Antwort');
  expect(bodyOf(f.calls[0]).messages.at(-1).content).toEqual([{ type: 'text', text: 'Offene Seite: Tagesseite Do 29.10.2026\n\nFrage: Was steht an?', cache_control: CACHE }]);
  expect(host.querySelector('.frag-runde')!.textContent).toContain('Das Bild der Seite ließ sich nicht erstellen. Claude bekam nur die Angaben zur Seite.');
  expect(answers(host)).toEqual(['Hallo']);
});

test('a cut answer says so, an answer without numbers has no cost line', async () => {
  vi.stubGlobal('fetch', streamOf([messageStart(5000, 1), textDelta('Erster Teil'), messageDelta('max_tokens', 100), messageStop()]));
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'Antwort');
  expect(answers(host)).toEqual(['Erster Teil']);
  expect(host.querySelector('.frag-runde')!.textContent).toContain('Die Antwort war zu lang und ist hier abgeschnitten.');
  expect(costs(host)).toEqual(['≈ 1,1 Cent']);

  vi.stubGlobal('fetch', streamOf([textDelta('Ohne Zahlen'), messageStop()]));
  await ask(host, 'Und jetzt?');
  await until(() => answers(host)[0] === 'Ohne Zahlen' && button(host, 'Fragen') !== undefined, 'zweite Antwort');
  expect(costs(host)).toEqual(['≈ 1,1 Cent']);
  expect(rounds(host)[0].querySelector('.frag-kosten')).toBeNull();
  expect(rounds(host)[0].textContent).not.toContain('abgeschnitten');
});

test('every failure has its sentence and the question comes back', async () => {
  const errorBody = (type: string, message: string) => JSON.stringify({ type: 'error', error: { type, message } });
  // Ohne Netz sagt das auch der Browser, und fetch lehnt mit TypeError ab.
  const offline = (async () => {
    Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  // Unter dem Satz steht die Spur zur Ursache, der Status der Antwort. Ohne Netz gibt es keine.
  const failures: [typeof fetch, string, string | null][] = [
    [streamOf([errorBody('authentication_error', 'invalid x-api-key')], { status: 401 }), 'Der KI-Schlüssel passt nicht. Bitte in den Einstellungen prüfen.', 'Fehlercode 401'],
    [
      streamOf([errorBody('invalid_request_error', 'You have reached your specified workspace API usage limits.')], { status: 400 }),
      'Das KI-Guthaben ist für diesen Monat aufgebraucht oder das Limit ist erreicht.',
      'Fehlercode 400',
    ],
    [streamOf([errorBody('overloaded_error', 'Overloaded')], { status: 529 }), 'Claude ist gerade nicht erreichbar. Bitte gleich noch einmal.', 'Fehlercode 529'],
    [offline, 'Ohne Netz kann Claude nicht antworten.', null],
  ];
  const { host } = await opened();
  await type(host, 'Was steht an?');
  for (const [fetchFn, sentence, code] of failures) {
    vi.stubGlobal('fetch', fetchFn);
    await press(host, 'Fragen');
    await until(() => errorLine(host) === sentence, sentence);
    expect(errorCode(host)).toBe(code);
    expect(field(host).value).toBe('Was steht an?');
    expect(rounds(host)).toHaveLength(0);
    expect(button(host, 'Fragen').disabled).toBe(false);
  }
  // Ein neues „Fragen“ leert den Fehler.
  vi.stubGlobal('fetch', streamOf(reply('Hallo')));
  await press(host, 'Fragen');
  await until(() => answers(host)[0] === 'Hallo', 'Antwort');
  expect(errorLine(host)).toBe('');
  expect(errorCode(host)).toBeNull();
});

test('Stopp keeps what arrived', async () => {
  const f = streamOf([messageStart(5000, 1) + textDelta('Hal'), textDelta('lo')], { hold: true });
  vi.stubGlobal('fetch', f);
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => answers(host)[0] === 'Hal', 'Hal');
  await press(host, 'Stopp');
  await until(() => button(host, 'Fragen') !== undefined, 'Fragen');
  expect(f.calls[0].init.signal!.aborted).toBe(true);
  expect(answers(host)).toEqual(['Hal']);
  expect(host.querySelector('.frag-runde')!.textContent).toContain('Gestoppt.');
  expect(costs(host)).toEqual([]);
  expect(field(host).value).toBe('');

  // Vor dem ersten Text: Die Runde verschwindet, und die Frage steht wieder im Feld.
  const empty = streamOf([messageStart(5000, 1), textDelta('x')], { hold: true });
  vi.stubGlobal('fetch', empty);
  const other = await opened();
  await ask(other.host, 'Was steht an?');
  await until(() => empty.calls.length === 1 && answers(other.host)[0] === '…', 'Anfrage');
  await press(other.host, 'Stopp');
  await until(() => button(other.host, 'Fragen') !== undefined, 'Fragen');
  expect(rounds(other.host)).toHaveLength(0);
  expect(field(other.host).value).toBe('Was steht an?');
  expect(errorLine(other.host)).toBe('');
});

test('Stopp while the page is read sends nothing', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  const read = gate();
  // Die Seite wird noch beschrieben (Notiz und Termine lesen), als „Stopp“ kommt.
  const page = fakePage({
    describe: vi.fn(async () => {
      await read.promise;
      return 'Offene Seite: Tagesseite Do 29.10.2026';
    }),
  });
  const { host } = await opened({ page });
  await ask(host, 'Was steht an?');
  expect(answers(host)).toEqual(['…']);
  await press(host, 'Stopp');
  read.open();
  await until(() => button(host, 'Fragen') !== undefined, 'Fragen');
  await act(() => wait(10));
  expect(f).not.toHaveBeenCalled();
  expect(rounds(host)).toHaveLength(0);
  expect(field(host).value).toBe('Was steht an?');
  expect(errorLine(host)).toBe('');
});

test('a follow-up knows the conversation and sends the page open now', async () => {
  const f = streamOf(reply('Hallo'));
  vi.stubGlobal('fetch', f);
  const b = fakePage({ label: 'Fr 30.10.2026', day: '2026-10-30', describe: vi.fn(async () => 'Offene Seite: Tagesseite Fr 30.10.2026') });
  const { host, set } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'erste Antwort');
  await set({ page: b });
  await ask(host, 'Und morgen?');
  await until(() => costs(host).length === 2, 'zweite Antwort');

  const { messages } = bodyOf(f.calls[1]);
  expect(messages).toHaveLength(3);
  const blocks = messages.flatMap((m: { content: unknown }) => (Array.isArray(m.content) ? m.content : []));
  expect(blocks.filter((block: { type: string }) => block.type === 'image')).toHaveLength(1);
  expect(messages[2]).toEqual({ role: 'user', content: [IMAGE_BLOCK, { type: 'text', text: 'Offene Seite: Tagesseite Fr 30.10.2026\n\nFrage: Und morgen?', cache_control: CACHE }] });
  expect(messages[0]).toEqual({ role: 'user', content: [{ type: 'text', text: `Offene Seite: Tagesseite Do 29.10.2026\n\n${EARLIER_IMAGE}\n\nFrage: Was steht an?` }] });
  expect(messages[1]).toEqual({ role: 'assistant', content: 'Hallo' });
  // Die neueste Runde steht oben, mit der Seite, die mit ihr ging.
  expect([...host.querySelectorAll('.frag-frage')].map((el) => el.textContent)).toEqual(['Und morgen?', 'Was steht an?']);
  expect([...host.querySelectorAll('.frag-wann')].map((el) => el.textContent!.slice(5))).toEqual([' · Fr 30.10.2026', ' · Do 29.10.2026']);

  // Noch eine Frage: Das ganze Gespräch geht mit, die älteste Runde zuerst.
  const third = streamOf(reply('Drei'));
  vi.stubGlobal('fetch', third);
  await ask(host, 'Und dann?');
  await until(() => costs(host).length === 3, 'dritte Antwort');
  const all = bodyOf(third.calls[0]).messages;
  expect(all.map((m: { role: string }) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant', 'user']);
  expect(all[0].content.at(-1).text.endsWith('Frage: Was steht an?')).toBe(true);
  expect(all[2].content.at(-1).text).toBe(`Offene Seite: Tagesseite Fr 30.10.2026\n\n${EARLIER_IMAGE}\n\nFrage: Und morgen?`);
  expect(all[4].content.at(-1).text.endsWith('Frage: Und dann?')).toBe(true);
});

test('paging during an answer keeps the answer with its page', async () => {
  const later = gate();
  vi.stubGlobal('fetch', streamOf(halThenLo(), { release: later.promise }));
  const { host, set } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => answers(host)[0] === 'Hal', 'Hal');
  await set({ page: fakePage({ label: 'Fr 30.10.2026', day: '2026-10-30' }) });
  later.open();
  await until(() => costs(host).length === 1, 'Ende der Antwort');
  expect(answers(host)).toEqual(['Hallo']);
  expect(host.querySelector('.frag-wann')!.textContent).toMatch(/^\d\d:\d\d · Do 29\.10\.2026$/);
  expect(toggle(host).getAttribute('aria-label')).toBe('Seite mitschicken: Fr 30.10.2026');
});

test('Neue Frage starts over and Schließen forgets', async () => {
  const f = streamOf(reply('Hallo'));
  vi.stubGlobal('fetch', f);
  const { host, control } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'Antwort');
  await type(host, 'Und morgen?');
  await press(host, 'Neue Frage');
  expect(rounds(host)).toHaveLength(0);
  expect(field(host).value).toBe('Und morgen?');
  expect(document.activeElement).toBe(field(host));
  await press(host, 'Fragen');
  await until(() => costs(host).length === 1, 'zweite Antwort');
  expect(bodyOf(f.calls[1]).messages).toHaveLength(1);

  // „Schließen“ während einer Antwort, noch vor ihrem ersten Text: Sie bricht ab, und das Fenster beginnt beim nächsten Öffnen leer,
  // mit dem Schalter an. Die Frage kommt nicht zurück ins Feld, sie gehört zu einem Gespräch, das es nicht mehr gibt.
  const held = streamOf([messageStart(5000, 1), textDelta('Hal')], { hold: true });
  vi.stubGlobal('fetch', held);
  await act(() => tap(toggle(host), 'mouse', performance.now()));
  await ask(host, 'Noch was?');
  await until(() => held.calls.length === 1 && answers(host)[0] === '…', 'Anfrage');
  await press(host, 'Schließen');
  expect(held.calls[0].init.signal!.aborted).toBe(true);
  expect(win(host).hidden).toBe(true);
  await act(() => wait(20)); // was nach dem Abbruch noch von der Anfrage kommt, ändert nichts mehr
  await act(() => control.current!.open());
  expect(rounds(host)).toHaveLength(0);
  expect(field(host).value).toBe('');
  expect(errorLine(host)).toBe('');
  expect(toggle(host).getAttribute('aria-checked')).toBe('true');
  expect(button(host, 'Fragen')).toBeDefined();
});

test('leaving the app aborts the answer', async () => {
  const f = streamOf([messageStart(5000, 1) + textDelta('Hal'), textDelta('lo')], { hold: true });
  vi.stubGlobal('fetch', f);
  const engine = { readOnly: false, write: vi.fn(async () => undefined), lookupFresh: vi.fn(async () => ({ text: null, unknown: false })) };
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    const { host } = await opened({ engine: engine as unknown as SyncEngine });
    await ask(host, 'Was steht an?');
    await until(() => answers(host)[0] === 'Hal', 'Hal');
    // Der Schlüssel ist weg, das Gerät ist ein Firmen-PC oder das Fenster darf nicht mehr schreiben: Die App baut das Fenster ab.
    await act(() => render(null, host));
    expect(f.calls[0].init.signal!.aborted).toBe(true);
    await act(() => wait(20));
    expect(engine.write).not.toHaveBeenCalled();
    expect(engine.lookupFresh).not.toHaveBeenCalled();
    expect(errors).not.toHaveBeenCalled();
  } finally {
    errors.mockRestore();
  }
});

test('an answer stays text', async () => {
  const text = '---\n<img src=x onerror="alert(1)"><script>alert(2)</script> **fett** %%sichtbar%%\n---\nEnde';
  vi.stubGlobal('fetch', streamOf(reply(text)));
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => costs(host).length === 1, 'Antwort');
  const answer = host.querySelector('.frag-antwort')!;
  expect(host.querySelector('img')).toBeNull();
  expect(host.querySelector('script')).toBeNull();
  expect(answer.querySelector('strong')!.textContent).toBe('fett');
  expect(answer.textContent).toContain('<img src=x onerror="alert(1)"><script>alert(2)</script>');
  expect(answer.textContent).toContain('sichtbar');
  expect(answer.textContent).toContain('Ende');
});

test('Enter sends, Shift+Enter makes a new line', async () => {
  const f = streamOf(reply('Hallo'));
  vi.stubGlobal('fetch', f);
  const { host } = await opened();
  const enter = (o: KeyboardEventInit = {}) => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...o });
    field(host).dispatchEvent(ev);
    return ev;
  };
  await type(host, 'Was steht an?');
  const newLine = enter({ shiftKey: true });
  await act(() => wait(10));
  expect(newLine.defaultPrevented).toBe(false);
  expect(f.calls).toHaveLength(0);
  expect(field(host).value).toBe('Was steht an?');

  const sent = enter();
  expect(sent.defaultPrevented).toBe(true);
  await until(() => costs(host).length === 1, 'Antwort');
  expect(f.calls).toHaveLength(1);
  expect(bodyOf(f.calls[0]).messages.at(-1).content.at(-1).text).toBe('Offene Seite: Tagesseite Do 29.10.2026\n\nFrage: Was steht an?');
  expect(field(host).value).toBe('');

  // Ohne Frage im Feld schickt Enter nichts.
  enter();
  await act(() => wait(10));
  expect(f.calls).toHaveLength(1);
});

test('nothing goes out without Fragen', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  const page = fakePage();
  const { host, set } = await opened({ page });
  await type(host, 'Was steht an?');
  await act(() => tap(toggle(host), 'mouse', performance.now()));
  await act(() => tap(toggle(host), 'mouse', performance.now()));
  await set({ page: fakePage({ label: 'Fr 30.10.2026', day: '2026-10-30' }) });
  await set({ page: null });
  await press(host, 'Neue Frage');
  await act(() => wait(20));
  expect(f).not.toHaveBeenCalled();
  expect(page.describe).not.toHaveBeenCalled();
  expect(pageImage).not.toHaveBeenCalled();
});

// Unter der Antwort: „Kopieren“ und „In Ergänzungen übernehmen“. Nur das Übernehmen ändert eine Notiz.

const TAKE = 'In Ergänzungen übernehmen';
const NOTE_PATH = '05 Daily Notes/2026-10-29.md';

/** Eine Engine mit einer Notiz, die sich merkt, was geschrieben wird. */
function noteEngine(first: { text: string | null; unknown: boolean }) {
  const state = { answer: first };
  const engine = {
    readOnly: false,
    lookupFresh: vi.fn(async (_path: string) => state.answer),
    write: vi.fn(async (_path: string, text: string, _kind: string) => {
      state.answer = { text, unknown: false };
    }),
  };
  return { engine, state, as: engine as unknown as SyncEngine };
}

/** Eine fertige Runde mit dieser Antwort. */
async function answered(o: { page?: AskPage | null; engine: SyncEngine; answer: string; question?: string }) {
  vi.stubGlobal('fetch', streamOf(reply(o.answer)));
  const mounted = await opened({ page: o.page, engine: o.engine });
  await ask(mounted.host, o.question ?? 'Was steht an?');
  await until(() => costs(mounted.host).length === 1, 'Antwort');
  return mounted;
}

test('taking over writes the answer once into its day', async () => {
  const notes = noteEngine({ text: '---\ndate: 2026-10-29\n---\n# 2026-10-29\n', unknown: false });
  const { host } = await answered({ engine: notes.as, answer: 'Zwei Punkte:\n- [ ] Angebot prüfen' });
  const at = timeVienna(new Date());
  const heard = vi.fn();
  onNoteWrite(notes.as, heard);
  // Zwei schnelle Tipps hintereinander.
  act(() => {
    tap(button(host, TAKE), 'mouse', performance.now());
    tap(button(host, TAKE), 'mouse', performance.now() + 100);
  });
  await until(() => button(host, 'Übernommen') !== undefined, 'Übernommen');
  expect(notes.engine.write).toHaveBeenCalledTimes(1);
  expect(notes.engine.write.mock.calls[0][0]).toBe(NOTE_PATH);
  expect(notes.engine.write.mock.calls[0][2]).toBe('md');
  const written = notes.engine.write.mock.calls[0][1];
  const order = [`- Claude, ${at}: Was steht an?`, '- Zwei Punkte:', '- [ ] Angebot prüfen'].map((line) => written.indexOf(line));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect((button(host, 'Übernommen') as HTMLButtonElement).disabled).toBe(true);
  expect(heard).toHaveBeenCalledWith(NOTE_PATH);
});

test('offline nothing is written and it says so', async () => {
  const notes = noteEngine({ text: null, unknown: true });
  const { host } = await answered({ engine: notes.as, answer: 'Ok' });
  await press(host, TAKE);
  await until(() => host.querySelector('.frag-runde')!.textContent!.includes(FAILED), 'Fehlertext');
  expect(notes.engine.write).not.toHaveBeenCalled();
  expect(button(host, TAKE)).toBeDefined();
  expect((button(host, TAKE) as HTMLButtonElement).disabled).toBe(false);
});

test('the answer goes to the day it belongs to', async () => {
  const notes = noteEngine({ text: null, unknown: false });
  const pageA = fakePage();
  const { host, set } = await answered({ engine: notes.as, page: pageA, answer: 'Ok' });
  // Seite B: Die Antwort gehört trotzdem zum 29.10.
  await set({ page: fakePage({ day: '2026-10-30', label: 'Fr 30.10.2026' }) });
  await press(host, TAKE);
  await until(() => notes.engine.write.mock.calls.length === 1, 'Schreiben');
  expect(notes.engine.write.mock.calls[0][0]).toBe(NOTE_PATH);
});

test('an answer on the week goes to the day of the question', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-29T12:00:00+01:00'));
    const notes = noteEngine({ text: null, unknown: false });
    const { host } = await answered({ engine: notes.as, page: fakePage({ day: null, label: 'KW 44 2026' }), answer: 'Ok' });
    await press(host, TAKE);
    await until(() => notes.engine.write.mock.calls.length === 1, 'Schreiben');
    expect(notes.engine.write.mock.calls[0][0]).toBe(NOTE_PATH);
  } finally {
    vi.useRealTimers();
  }
});

test('copy takes the answer as written', async () => {
  const writeText = vi.fn(async (_text: string) => undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const { host } = await answered({ engine: fakeEngine, answer: '## Titel\n- **fett**' });
  await press(host, 'Kopieren');
  await until(() => button(host, 'Kopiert') !== undefined, 'Kopiert');
  expect(writeText).toHaveBeenCalledWith('## Titel\n- **fett**');
  expect(button(host, 'Kopieren')).toBeUndefined();
  await act(() => wait(2100));
  expect(button(host, 'Kopieren')).toBeDefined();
});

test('a failed copy says so', async () => {
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => Promise.reject(new Error('nein'))) } });
  const { host } = await answered({ engine: fakeEngine, answer: 'Ok' });
  await press(host, 'Kopieren');
  await until(() => button(host, 'Kopieren ging nicht.') !== undefined, 'Fehlertext');
});

test('a running round shows neither button', async () => {
  const later = gate();
  vi.stubGlobal('fetch', streamOf(halThenLo(), { release: later.promise }));
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => answers(host)[0] === 'Hal', 'Hal');
  expect(button(host, 'Kopieren')).toBeUndefined();
  expect(button(host, TAKE)).toBeUndefined();
  later.open();
  await until(() => button(host, TAKE) !== undefined, 'Knöpfe');
  expect(button(host, 'Kopieren')).toBeDefined();
});

test('a resting hand takes nothing over', async () => {
  const notes = noteEngine({ text: null, unknown: false });
  const page = fakePage();
  const { host } = await answered({ engine: notes.as, page, answer: 'Ok' });
  page.filter.penDown(performance.now());
  await act(() => tap(button(host, TAKE), 'touch', performance.now(), 10));
  await act(() => wait(20));
  expect(notes.engine.write).not.toHaveBeenCalled();
  expect(notes.engine.lookupFresh).not.toHaveBeenCalled();
});

// ---------- Die Kopie des Vaults und die Suche ----------

/**
 * Ein Werkzeugschritt wie von Sonnet: Denkblock mit Signatur, wahlweise Text (`notiz`), dann der Aufruf `suchen` mit `text`.
 * Ohne `start: null` mit 5000 Token hinein und 100 hinaus.
 */
function suchSchritt(text: string, o: { notiz?: string } = {}): string[] {
  const teile = [messageStart(5000, 1), blockStart(0, { type: 'thinking', thinking: '', signature: '' }), thinkingDelta(0, 'Ich suche.'), signatureDelta(0, 'sig-test'), blockStop(0)];
  let i = 1;
  if (o.notiz !== undefined) teile.push(blockStart(i, { type: 'text', text: '' }), textDeltaAt(i, o.notiz), blockStop(i++));
  const json = JSON.stringify({ text });
  teile.push(blockStart(i, { type: 'tool_use', id: 'toolu_1', name: 'suchen', input: {} }), inputJsonDelta(i, json.slice(0, 4)), inputJsonDelta(i, json.slice(4)), blockStop(i));
  teile.push(messageDelta('tool_use', 100), messageStop());
  return teile;
}

/** Leert die Warteschlange der Versprechen, ohne eine Uhr zu brauchen (`setImmediate` ist nie falsch). */
const flush = () => act(() => new Promise<void>((resolve) => setImmediate(resolve)));

test('the copy opens with the window, open refreshes it, unmounting closes it', async () => {
  const copy = fakeCopy();
  const { host, control } = mount({ client: copy.client });
  await until(() => kopieImSpeicher() !== null, 'Kopie offen');
  await act(() => wait(20));
  // Das Einhängen öffnet nur die Datenbank, gefragt wird GitHub erst beim Öffnen des Fensters.
  expect(copy.calls).toEqual({ head: 0, tree: 0, text: 0 });
  await act(() => control.current!.open());
  await until(() => kopieImSpeicher()!.dateien().length === 2, 'Kopie geladen');
  expect(copy.calls).toEqual({ head: 1, tree: 1, text: 2 });
  expect(kopieImSpeicher()!.stand()).toEqual({ geladen: 2, gesamt: 2, vollstaendig: true, ohneNetz: false });

  await act(() => render(null, host));
  expect(kopieImSpeicher()).toBeNull();
  // Ist die Verbindung zu, lässt sich die Datenbank löschen, ohne dass etwas blockiert.
  const deleted = await new Promise<string>((resolve) => {
    const request = indexedDB.deleteDatabase('notizbuch-gehirn');
    request.onsuccess = () => resolve('gelöscht');
    request.onblocked = () => resolve('blockiert');
  });
  expect(deleted).toBe('gelöscht');
});

test('the line under the buttons shows the first load and what is missing without net', async () => {
  const held = gate();
  let online = false;
  let calls = 0;
  const copy = fakeCopy({
    copyText: async (entry) => {
      calls++;
      if (online) return NOTIZEN[entry.path];
      if (calls > 1) throw new OfflineError('kein Netz');
      await held.promise;
      return NOTIZEN[entry.path];
    },
  });
  const { host, control } = await opened({ client: copy.client });
  expect(brainLine(host)).not.toBeNull();
  expect(host.querySelector('.frag-gehirn')!.getAttribute('role')).toBe('status');
  // Unter den Knöpfen, über der Fehlerzeile.
  expect(host.querySelector('.frag-knoepfe')!.nextElementSibling!.className).toBe('frag-gehirn');
  await until(() => brainLine(host) === 'Gehirn wird geladen … 0 von 2', 'Laden');
  held.open();
  await until(() => brainLine(host) === 'Gehirn: 1 von 2 Notizen da, der Rest kommt mit Netz.', 'ohne Netz');

  // Mit Netz lädt der Rest, danach steht keine Zeile mehr da, auch nicht beim nächsten Öffnen.
  online = true;
  await press(host, 'Schließen');
  await act(() => control.current!.open());
  await until(() => kopieImSpeicher()!.stand().vollstaendig, 'vollständig');
  await until(() => brainLine(host) === '', 'keine Zeile');
  const before = copy.calls.head;
  await press(host, 'Schließen');
  await act(() => control.current!.open());
  expect(brainLine(host)).toBe('');
  await until(() => copy.calls.head === before + 1, 'Kopf gefragt');
  await act(() => wait(20));
  expect(brainLine(host)).toBe('');
  expect(copy.calls.tree).toBe(2);
});

test('Suchzeilen: a search step shows its grey line above the answer, the answer is the last step', async () => {
  const f = stepsOf([suchSchritt('Beispiel'), reply('Gefunden.')]);
  vi.stubGlobal('fetch', f);
  const { host } = await opened();
  await ask(host, 'Was gibt es zu Beispiel?');
  await until(() => costs(host).length === 1, 'Antwort');
  expect(stepLines(host)).toEqual(['Sucht „Beispiel“ … 1 Treffer']);
  expect(answers(host)).toEqual(['Gefunden.']);
  // Die Zeilen stehen zwischen der Frage (mit Uhrzeit und Seite) und der Antwort.
  const lines = host.querySelector('.frag-runde > ol.frag-schritte')!;
  expect(lines.previousElementSibling!.className).toBe('frag-wann');
  expect(lines.nextElementSibling!.className).toBe('frag-antwort');
  // Gesucht wurde in der Kopie: Das Ergebnis geht mit der zweiten Anfrage hinaus.
  expect(f.calls).toHaveLength(2);
  const [result] = bodyOf(f.calls[1]).messages.at(-1).content;
  expect(result).toMatchObject({ type: 'tool_result', tool_use_id: 'toolu_1' });
  expect(result.content).toContain('02 Projekte/Beispiel Projekt.md');
  expect(result.content).toContain('Die Bestellung ging am 25.11. hinaus.');
});

test('Notiz zwischen Schritten: text before a tool is a grey line, not part of the answer', async () => {
  vi.stubGlobal('fetch', stepsOf([suchSchritt('Beispiel', { notiz: 'Ich schaue in den Projekten nach.' }), reply('Gefunden.')]));
  const { host } = await opened();
  await ask(host, 'Was gibt es zu Beispiel?');
  await until(() => costs(host).length === 1, 'Antwort');
  expect(stepLines(host)).toEqual(['Ich schaue in den Projekten nach.', 'Sucht „Beispiel“ … 1 Treffer']);
  expect(answers(host)).toEqual(['Gefunden.']);
});

test('Kosten aller Schritte: the cost line adds up every step, missing numbers make it a minimum', async () => {
  vi.stubGlobal('fetch', stepsOf([suchSchritt('Beispiel'), reply('Gefunden.')]));
  const { host } = await opened();
  await ask(host, 'Was gibt es zu Beispiel?');
  await until(() => costs(host).length === 1, 'Antwort');
  // Je Schritt 5000 Token hinein und 100 hinaus, also je 1,1 Cent.
  expect(costs(host)).toEqual(['≈ 2,2 Cent']);

  vi.stubGlobal('fetch', stepsOf([suchSchritt('Beispiel'), [textDelta('Ohne Zahlen'), messageDelta('end_turn', 100), messageStop()]]));
  await ask(host, 'Und noch einmal?');
  await until(() => costs(host).length === 2, 'zweite Antwort');
  expect(costs(host)).toEqual(['mindestens ≈ 1,1 Cent', '≈ 2,2 Cent']);
});

test('Fehler nach Text: the text that came stays, the sentence and the code come below it', async () => {
  vi.stubGlobal('fetch', stepsOf([[messageStart(5000, 1), textDelta('Teil der Antwort'), errorEvent('overloaded_error', 'Overloaded')]]));
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => button(host, 'Fragen') !== undefined, 'Ende');
  expect(rounds(host)).toHaveLength(1);
  expect(answers(host)).toEqual(['Teil der Antwort']);
  const round = rounds(host)[0];
  const alert = round.querySelector('[role="alert"]')!;
  expect(alert.textContent).toBe('Claude ist gerade nicht erreichbar. Bitte gleich noch einmal.');
  expect(alert.previousElementSibling!.className).toBe('frag-antwort');
  expect(alert.nextElementSibling!.className).toBe('frag-code');
  expect(round.querySelector('.frag-code')!.textContent).toBe('Fehlercode overloaded_error');
  // Das Fenster selbst meldet nichts, und die Frage bleibt bei ihrer Runde.
  expect(errorLine(host)).toBe('');
  expect(errorCode(host)).toBeNull();
  expect(field(host).value).toBe('');
});

test('Fehler ohne Text: the round goes, the question comes back, the error line has the sentence and the code', async () => {
  const badRequest = JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'Ungültige Anfrage' } });
  vi.stubGlobal('fetch', stepsOf([[badRequest]], { status: { 0: 400 } }));
  const { host } = await opened();
  await ask(host, 'Was steht an?');
  await until(() => errorLine(host) !== '', 'Fehler');
  expect(errorLine(host)).toBe('Claude ist gerade nicht erreichbar. Bitte gleich noch einmal.');
  expect(errorCode(host)).toBe('Fehlercode 400');
  expect(host.querySelector('.frag-fehler')!.nextElementSibling!.className).toBe('frag-code');
  expect(rounds(host)).toHaveLength(0);
  expect(field(host).value).toBe('Was steht an?');
});

test('Stopp after a search step keeps the round with its grey line', async () => {
  const f = stepsOf([suchSchritt('Beispiel'), reply('Nie.')], { hold: 1 });
  vi.stubGlobal('fetch', f);
  const { host } = await opened();
  await ask(host, 'Was gibt es zu Beispiel?');
  await until(() => f.calls.length === 2 && stepLines(host).length === 1, 'zweite Anfrage');
  expect(answers(host)).toEqual(['…']);
  await press(host, 'Stopp');
  await until(() => button(host, 'Fragen') !== undefined, 'Fragen');
  expect(f.calls[1].init.signal!.aborted).toBe(true);
  expect(rounds(host)).toHaveLength(1);
  expect(stepLines(host)).toEqual(['Sucht „Beispiel“ … 1 Treffer']);
  expect(rounds(host)[0].textContent).toContain('Gestoppt.');
  expect(costs(host)).toEqual([]);
  expect(field(host).value).toBe('');
  await act(() => wait(20));
  expect(f.calls).toHaveLength(2);
});

test('Stopp während der Beschreibung der Seite: the round goes at once and nothing goes out', async () => {
  const f = vi.fn();
  vi.stubGlobal('fetch', f);
  // Die Seite wird nie fertig beschrieben.
  const page = fakePage({ describe: vi.fn(() => new Promise<string>(() => undefined)) });
  const { host } = await opened({ page });
  await ask(host, 'Was steht an?');
  expect(answers(host)).toEqual(['…']);
  await press(host, 'Stopp');
  await flush();
  expect(rounds(host)).toHaveLength(0);
  expect(field(host).value).toBe('Was steht an?');
  expect(button(host, 'Fragen')).toBeDefined();
  expect(errorLine(host)).toBe('');
  await act(() => wait(20));
  expect(f).not.toHaveBeenCalled();
});

test('wartet höchstens 3 Sekunden auf die Kopie', async () => {
  const copy = fakeCopy({ hang: true });
  const f = stepsOf([reply('Hallo')]);
  vi.stubGlobal('fetch', f);
  const { host } = await opened({ client: copy.client });
  await until(() => copy.calls.head === 1, 'Auffrischen beim Öffnen');
  // Nur die Uhr der Wartezeit ist falsch: Die Datenbank im Speicher arbeitet mit setImmediate weiter.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  await ask(host, 'Was steht an?');
  await vi.advanceTimersByTimeAsync(2999);
  await flush();
  expect(f.calls).toHaveLength(0);
  expect(answers(host)).toEqual(['…']);
  await vi.advanceTimersByTimeAsync(1);
  await flush();
  expect(f.calls).toHaveLength(1);
  vi.useRealTimers();
  await until(() => costs(host).length === 1, 'Antwort');
  expect(answers(host)).toEqual(['Hallo']);
});
