import { expect, test } from 'vitest';
import { parsePage, serializePage } from '../../src/ink/svg';
import type { FieldBox, Page, Stroke } from '../../src/ink/types';
import { PageSession, type PageSurface, type Phase, type SessionEngine } from '../../src/ui/pageSession';

// Die Sitzung einer Seite: lesen, speichern, fremde Änderungen übernehmen. Engine und Fläche sind Fakes, die Seiten
// sind echte SVG-Texte. Alles hier ist erfunden.

const PATH = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const DAY = '2026-10-29';
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';
/** Felder und Hintergrund der Seite. Die Striche der Tests liegen im linken Feld (um 130, 110). */
const FIELDS: FieldBox[] = [
  { id: 'notizen', rect: [0, 0, 600, 800], datum: DAY },
  { id: 'aufgaben', rect: [600, 0, 500, 800], datum: DAY },
];
const BACKGROUND = '<rect id="papier" x="0" y="0" width="1192" height="1590" fill="#fffefa"/>';

function stroke(id: string, t: number, y = 100): Stroke {
  return {
    id,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t,
    w: 1.2,
    pts: [
      { x: 100, y, w: 1.2 },
      { x: 160, y: y + 20, w: 1.2 },
    ],
  };
}

const empty = (): Page => ({ kind: 'tag', key: DAY, meta: {}, strokes: [] });
const pageOf = (...strokes: Stroke[]): Page => ({ ...empty(), strokes });
const svgOf = (...strokes: Stroke[]): string => serializePage(pageOf(...strokes), [], '');
const ids = (p: Page | string): string[] => (typeof p === 'string' ? parsePage(p) : p).strokes.map((s) => s.id);

/** Ein Tor, das eine Anfrage anhält, bis der Test es öffnet. `reached` meldet, dass die Anfrage am Tor angekommen ist. */
function gate() {
  let release!: () => void;
  let reached!: () => void;
  return {
    wait: new Promise<void>((resolve) => (release = resolve)),
    reached: new Promise<void>((resolve) => (reached = resolve)),
    release: () => release(),
    arrive: () => reached(),
  };
}

type Gate = ReturnType<typeof gate>;

function fakeEngine(initial: string | null = null, others: Record<string, string | null> = {}) {
  const readGates: Gate[] = [];
  const writeGates: Gate[] = [];
  const files = new Map<string, string | null>([[PATH, initial], ...Object.entries(others)]);
  const listeners = new Set<(paths: string[]) => void>();
  const e = {
    /** Die Fassung von `PATH`, die `read` liefert und `write` ersetzt, wie die lokale Kopie der echten Engine. */
    get text(): string | null {
      return files.get(PATH) ?? null;
    },
    set text(value: string | null) {
      files.set(PATH, value);
    },
    files,
    log: [] as string[],
    reads: 0,
    writes: [] as string[],
    active: 0,
    maxActive: 0,
    flushes: 0,
    /** So viele der nächsten Schreibaufträge scheitern. Ein gescheiterter Auftrag ändert die Kopie nicht. */
    failWrites: 0,
    readError: undefined as Error | undefined,
    get listenerCount(): number {
      return listeners.size;
    },
    /** Fremde Änderungen an diesen Dateien kommen an. */
    notify(paths: string[]): void {
      for (const listener of [...listeners]) listener(paths);
    },
    addRemoteChangeListener(listener: (paths: string[]) => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Die nächste `read`-Anfrage liest sofort, antwortet aber erst nach `release()`. */
    holdRead(): Gate {
      const g = gate();
      readGates.push(g);
      return g;
    },
    holdWrite(): Gate {
      const g = gate();
      writeGates.push(g);
      return g;
    },
    async read(path: string): Promise<string | null> {
      expect(files.has(path)).toBe(true);
      e.reads++;
      e.log.push('read');
      const value = files.get(path) ?? null;
      const g = readGates.shift();
      if (g) {
        g.arrive();
        await g.wait;
      }
      if (e.readError) throw e.readError;
      return value;
    },
    async write(path: string, text: string, kind: 'md' | 'svg'): Promise<void> {
      expect(files.has(path)).toBe(true);
      expect(kind).toBe('svg');
      e.log.push('write');
      e.active++;
      e.maxActive = Math.max(e.maxActive, e.active);
      e.writes.push(text);
      try {
        const g = writeGates.shift();
        if (g) {
          g.arrive();
          await g.wait;
        }
        if (e.failWrites > 0) {
          e.failWrites--;
          throw new Error('Speicher voll');
        }
        files.set(path, text);
      } finally {
        e.active--;
        e.log.push('written');
      }
    },
    async flush(): Promise<void> {
      e.flushes++;
      e.log.push('flush');
    },
  };
  return e satisfies SessionEngine;
}

function fakeSurface(start: Page = empty()) {
  const s = {
    page: start,
    readOnly: false,
    sets: [] as Page[],
    getPage: () => s.page,
    setPage: (p: Page) => {
      s.page = p;
      s.sets.push(p);
    },
    setReadOnly: (on: boolean) => {
      s.readOnly = on;
    },
  };
  return s satisfies PageSurface;
}

/** Die Anlässe für einen neuen Versuch, von Hand ausgelöst: `fire()` heißt, das Netz ist zurück. */
function fakeCues() {
  const subscribed = new Set<() => void>();
  return {
    subscribe(retry: () => void): () => void {
      subscribed.add(retry);
      return () => {
        subscribed.delete(retry);
      };
    },
    /** Wie viele Zuhörer gerade auf einen Anlass warten. */
    get listening(): number {
      return subscribed.size;
    },
    fire(): void {
      for (const retry of [...subscribed]) retry();
    },
  };
}

function open(
  engine: ReturnType<typeof fakeEngine>,
  surface: ReturnType<typeof fakeSurface>,
  o: { readOnly?: boolean; path?: string; cues?: ReturnType<typeof fakeCues>; fields?: FieldBox[]; background?: string } = {},
) {
  const phases: Phase[] = [];
  const saveFailed: boolean[] = [];
  const session = new PageSession({
    engine,
    path: o.path ?? PATH,
    emptyPage: empty,
    readOnly: o.readOnly ?? false,
    fields: o.fields ?? FIELDS,
    background: o.background ?? BACKGROUND,
    surface,
    retryCues: o.cues?.subscribe,
    onPhase: (p) => phases.push(p),
    onSaveFailed: (f) => saveFailed.push(f),
  });
  return { session, phases, saveFailed };
}

/** Lässt alle schon möglichen Fortsetzungen laufen. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// ---------- Laden ----------

test('the page stays locked until it is read, then shows the stored strokes', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  expect(surface.readOnly).toBe(true);
  expect(phases).toEqual([]);

  await session.reload();
  expect(ids(surface.page)).toEqual(['a']);
  expect(surface.readOnly).toBe(false);
  expect(phases).toEqual(['bereit']);
});

test('a page that does not exist yet is an empty page of the day', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  expect(surface.page).toEqual(empty());
  expect(surface.readOnly).toBe(false);
  expect(phases).toEqual(['bereit']);
});

test('strokes are ordered by the time they were begun, not by their place in the file', async () => {
  const engine = fakeEngine(svgOf(stroke('late', 2000), stroke('early', 500)));
  const surface = fakeSurface();
  await open(engine, surface).session.reload();
  expect(ids(surface.page)).toEqual(['early', 'late']);
});

test('a read-only session never unlocks the page and never writes', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface, { readOnly: true });
  await session.reload();
  expect(ids(surface.page)).toEqual(['a']);
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('a', 1000), stroke('b', 2000)));
  await settle();
  expect(engine.writes).toEqual([]);
});

test('nothing is written while the page is still being read', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  const slow = engine.holdRead();
  const loading = session.reload();
  await slow.reached;
  session.changed(pageOf(stroke('x', 5)));
  await settle();
  expect(engine.writes).toEqual([]);
  slow.release();
  await loading;
  expect(ids(surface.page)).toEqual(['a']);
});

// ---------- Felder und Hintergrund ----------

test('every write carries the background of the page and puts each stroke in the field it lies in', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const right: Stroke = { ...stroke('r', 3000), pts: [{ x: 700, y: 100, w: 1.2 }, { x: 760, y: 120, w: 1.2 }] };
  surface.page = pageOf(stroke('l', 1000), right);
  session.changed(surface.page);
  await settle();
  const text = engine.writes.at(-1)!;
  expect(text).toContain(`<g data-hintergrund="1">${BACKGROUND}</g>`);
  expect(text).toMatch(/<g data-feld="notizen" data-datum="2026-10-29">\s*<path data-id="l"/);
  expect(text).toMatch(/<g data-feld="aufgaben" data-datum="2026-10-29">\s*<path data-id="r"/);
  expect(ids(text).sort()).toEqual(['l', 'r']);
});

test('a page that was stored with an older background gets the current one with the next change', async () => {
  const engine = fakeEngine(serializePage(pageOf(stroke('a', 1000)), FIELDS, '<rect id="alt"/>'));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  expect(engine.writes).toEqual([]); // Lesen allein schreibt nichts
  surface.page = pageOf(stroke('a', 1000), stroke('b', 2000));
  session.changed(surface.page);
  await settle();
  const text = engine.writes.at(-1)!;
  expect(text).toContain(BACKGROUND);
  expect(text).not.toContain('id="alt"');
});

test('what was read and what is still unsaved are united under the background and the fields of this page', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000, 100)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  engine.failWrites = 2;
  surface.page = pageOf(stroke('a', 1000, 100), stroke('mine', 5000, 400));
  session.changed(surface.page);
  await settle();

  // ein anderes Gerät hat 'b' ergänzt und seinen eigenen Hintergrund geschrieben
  engine.text = serializePage(pageOf(stroke('a', 1000, 100), stroke('b', 500, 200)), [], '<rect id="fremd"/>');
  engine.notify([PATH]);
  await settle();
  const saved = engine.writes.at(-1)!;
  expect(ids(saved).sort()).toEqual(['a', 'b', 'mine']);
  expect(saved).toContain(`<g data-hintergrund="1">${BACKGROUND}</g>`);
  expect(saved).not.toContain('id="fremd"');
  expect(saved).toMatch(/<g data-feld="notizen" data-datum="2026-10-29">/);
  expect(engine.text).toBe(saved);
});

test('a session writes only the fields and background it was opened with', async () => {
  const other: FieldBox[] = [{ id: 'woche', rect: [0, 0, 1192, 1590], datum: DAY }];
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface, { fields: other, background: '<g id="woche-papier"/>' });
  await session.reload();
  surface.page = pageOf(stroke('a', 1000));
  session.changed(surface.page);
  await settle();
  const text = engine.writes.at(-1)!;
  expect(text).toContain('<g id="woche-papier"/>');
  expect(text).not.toContain('id="papier"');
  expect(text).toMatch(/<g data-feld="woche"/);
  expect(text).not.toContain('data-feld="notizen"');
});

// ---------- Unlesbare Seiten ----------

test('an unreadable page is locked, announced and never written', async () => {
  const engine = fakeEngine(BROKEN);
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  expect(phases).toEqual(['unlesbar']);
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('x', 5)));
  await settle();
  expect(engine.writes).toEqual([]);
});

test('an error while reading is no broken page: it is announced as not loaded, locked and never written', async () => {
  const engine = fakeEngine('egal');
  engine.readError = new Error('GitHub antwortete mit Status 500.');
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  expect(phases).toEqual(['nichtGeladen']);
  expect(surface.readOnly).toBe(true);
  expect(surface.sets).toEqual([]);
  session.changed(pageOf(stroke('x', 5)));
  await settle();
  expect(engine.writes).toEqual([]);
});

test('a page that could not be loaded loads when a retry cue comes, and then stops waiting for cues', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  engine.readError = new Error('GitHub antwortete mit Status 500.');
  const cues = fakeCues();
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface, { cues });
  await session.reload();
  expect(phases).toEqual(['nichtGeladen']);
  expect(cues.listening).toBe(1);

  engine.readError = undefined;
  cues.fire();
  await settle();
  expect(phases).toEqual(['nichtGeladen', 'bereit']);
  expect(ids(surface.page)).toEqual(['a']);
  expect(surface.readOnly).toBe(false);
  expect(cues.listening).toBe(0);
});

test('a page that still cannot be loaded keeps waiting, with one subscription and no writing', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  engine.readError = new Error('GitHub antwortete mit Status 500.');
  const cues = fakeCues();
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface, { cues });
  await session.reload();
  cues.fire();
  await settle();
  cues.fire();
  await settle();
  expect(engine.reads).toBe(3);
  expect(phases.every((phase) => phase === 'nichtGeladen')).toBe(true);
  expect(cues.listening).toBe(1);
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('x', 5)));
  await settle();
  expect(engine.writes).toEqual([]);
});

test('a broken page is no reason to try again, only a change from another device is', async () => {
  const engine = fakeEngine(BROKEN);
  const cues = fakeCues();
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface, { cues });
  await session.reload();
  expect(phases).toEqual(['unlesbar']);
  expect(cues.listening).toBe(0);
});

test('closing stops waiting for retry cues', async () => {
  const engine = fakeEngine('egal');
  engine.readError = new Error('GitHub antwortete mit Status 500.');
  const cues = fakeCues();
  const { session } = open(engine, fakeSurface(), { cues });
  await session.reload();
  session.close();
  expect(cues.listening).toBe(0);
});

test('a page that was shown and then cannot be read again is locked, and loads again on a cue', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const cues = fakeCues();
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface, { cues });
  await session.reload();
  expect(cues.listening).toBe(0);

  engine.readError = new Error('GitHub antwortete mit Status 500.');
  engine.notify([PATH]);
  await settle();
  expect(phases).toEqual(['bereit', 'nichtGeladen']);
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('late', 9000)));
  await settle();
  expect(engine.writes).toEqual([]);

  engine.readError = undefined;
  engine.text = svgOf(stroke('a', 1000), stroke('b', 3000));
  cues.fire();
  await settle();
  expect(phases).toEqual(['bereit', 'nichtGeladen', 'bereit']);
  expect(surface.readOnly).toBe(false);
  expect(ids(surface.page)).toEqual(['a', 'b']);
  expect(cues.listening).toBe(0);
});

test('a page that becomes unreadable is locked, and unlocked again once it can be read', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();

  engine.text = BROKEN;
  engine.notify([PATH]);
  await settle();
  expect(phases).toEqual(['bereit', 'unlesbar']);
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('late', 9000)));
  await settle();
  expect(engine.writes).toEqual([]);

  engine.text = svgOf(stroke('a', 1000), stroke('b', 3000));
  engine.notify([PATH]);
  await settle();
  expect(phases).toEqual(['bereit', 'unlesbar', 'bereit']);
  expect(surface.readOnly).toBe(false);
  expect(ids(surface.page)).toEqual(['a', 'b']);
});

// ---------- Speichern ----------

test('a change is handed to the engine in the same call', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  session.changed(pageOf(stroke('a', 1000)));
  // Noch im Ereignis des Stifts, nicht erst danach: Beendet Safari die App, steht der Strich schon in der Warteschlange.
  expect(engine.writes).toHaveLength(1);
  expect(ids(engine.writes[0])).toEqual(['a']);
  expect(parsePage(engine.writes[0])).toMatchObject({ kind: 'tag', key: DAY });
});

test('writes go one at a time and the newest page wins', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const slow = engine.holdWrite();
  session.changed(pageOf(stroke('a', 1)));
  await slow.reached;
  session.changed(pageOf(stroke('a', 1), stroke('b', 2)));
  session.changed(pageOf(stroke('a', 1), stroke('b', 2), stroke('c', 3)));
  expect(engine.writes).toHaveLength(1); // die erste ist noch unterwegs
  slow.release();
  await settle();
  expect(engine.writes.map(ids)).toEqual([['a'], ['a', 'b', 'c']]);
  expect(engine.maxActive).toBe(1);
});

test('a failed save is reported, and the next change saves the whole page again', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session, saveFailed } = open(engine, surface);
  await session.reload();
  engine.failWrites = 1;
  session.changed(pageOf(stroke('a', 1)));
  await settle();
  expect(saveFailed).toEqual([true]);
  session.changed(pageOf(stroke('a', 1), stroke('b', 2)));
  await settle();
  expect(saveFailed).toEqual([true, false]);
  expect(ids(engine.writes[1])).toEqual(['a', 'b']);
});

test('a failed save is tried once more when the page is closed', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  engine.failWrites = 1;
  session.changed(pageOf(stroke('a', 1)));
  await settle();
  expect(engine.writes).toHaveLength(1);
  expect(engine.text).toBeNull(); // gescheitert: nichts gespeichert

  session.close();
  await settle();
  expect(engine.writes).toHaveLength(2);
  expect(engine.writes[1]).toBe(engine.writes[0]);
  expect(ids(engine.text!)).toEqual(['a']);
  expect(engine.log.slice(-2)).toEqual(['written', 'flush']);
});

test('a change that arrives while a save fails is saved right away', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session, saveFailed } = open(engine, surface);
  await session.reload();
  engine.failWrites = 1;
  const slow = engine.holdWrite();
  session.changed(pageOf(stroke('a', 1)));
  await slow.reached;
  session.changed(pageOf(stroke('a', 1), stroke('b', 2))); // kommt, während der erste Auftrag noch läuft
  slow.release(); // und der erste scheitert
  await settle();
  expect(engine.writes.map(ids)).toEqual([['a'], ['a', 'b']]);
  expect(saveFailed).toEqual([true, false]);
  expect(ids(engine.text!)).toEqual(['a', 'b']);
});

test('a failed save is not repeated on its own', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session, saveFailed } = open(engine, surface);
  await session.reload();
  engine.failWrites = 100;
  session.changed(pageOf(stroke('a', 1)));
  await settle();
  await settle();
  expect(engine.writes).toHaveLength(1);
  expect(saveFailed).toEqual([true]);
});

test('a failed save is tried again before the page is read again, so the strokes are not lost', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  engine.failWrites = 1;
  surface.page = pageOf(stroke('a', 1000), stroke('mine', 5000));
  session.changed(surface.page);
  await settle();
  expect(engine.writes).toHaveLength(1);

  engine.notify([PATH]);
  await settle();
  expect(engine.writes).toHaveLength(2);
  expect(engine.log.slice(-3)).toEqual(['write', 'written', 'read']); // erst speichern, dann lesen
  expect(ids(surface.page)).toEqual(['a', 'mine']);
  expect(phases.at(-1)).toBe('bereit');
});

test('when that second try fails too, the strokes of the page stay and are saved together with what was read', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000, 100)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  engine.failWrites = 2;
  surface.page = pageOf(stroke('a', 1000, 100), stroke('mine', 5000, 400));
  session.changed(surface.page);
  await settle();

  engine.text = svgOf(stroke('a', 1000, 100), stroke('b', 500, 200)); // ein anderes Gerät hat 'b' ergänzt
  engine.notify([PATH]);
  await settle();
  expect(ids(surface.page)).toEqual(['b', 'a', 'mine']);
  const saved = engine.writes[engine.writes.length - 1];
  expect(ids(saved).sort()).toEqual(['a', 'b', 'mine']);
  expect(engine.text).toBe(saved);
});

test('a failed save is not written into a broken page, and not lost: it joins the page once that can be read again', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  engine.failWrites = 2;
  surface.page = pageOf(stroke('a', 1000), stroke('mine', 5000));
  session.changed(surface.page);
  await settle();

  engine.text = BROKEN;
  engine.notify([PATH]);
  await settle();
  expect(phases.at(-1)).toBe('unlesbar');
  const attempts = engine.writes.length;
  session.changed(pageOf(stroke('late', 9000))); // eine gesperrte Fläche meldet nichts, aber falls doch: nichts wird geschrieben
  await settle();
  expect(engine.writes).toHaveLength(attempts);
  expect(engine.text).toBe(BROKEN);

  engine.text = svgOf(stroke('a', 1000), stroke('b', 3000)); // ein anderes Gerät hat die Seite repariert
  engine.notify([PATH]);
  await settle();
  expect(phases.at(-1)).toBe('bereit');
  expect(ids(surface.page)).toEqual(['a', 'b', 'mine']);
  expect(ids(engine.text ?? '')).toEqual(['a', 'b', 'mine']);
});

test('a failed save is not written when the page is closed while it is locked', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  engine.failWrites = 2;
  session.changed(pageOf(stroke('a', 1000), stroke('mine', 5000)));
  await settle();

  engine.text = BROKEN;
  engine.notify([PATH]);
  await settle();
  expect(phases.at(-1)).toBe('unlesbar');
  const attempts = engine.writes.length;
  session.close();
  await settle();
  expect(engine.writes).toHaveLength(attempts);
  expect(engine.text).toBe(BROKEN);
});

test('a change that waits behind a running save is not written once the page was locked, and joins the page later', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();

  engine.text = BROKEN; // ein anderes Gerät macht die Seite kaputt ...
  const read = engine.holdRead();
  engine.notify([PATH]);
  await read.reached; // ... und die Sitzung liest sie gerade
  const running = engine.holdWrite();
  surface.page = pageOf(stroke('a', 1000), stroke('one', 5000));
  session.changed(surface.page); // das Speichern läuft
  await running.reached;
  surface.page = pageOf(stroke('a', 1000), stroke('one', 5000), stroke('two', 6000));
  session.changed(surface.page); // die neuere Fassung wartet dahinter

  read.release(); // jetzt zeigt sich: Die Seite ist kaputt
  await settle();
  expect(phases.at(-1)).toBe('unlesbar');
  running.release();
  await settle();
  expect(engine.writes).toHaveLength(1); // nur das, was schon lief
  expect(ids(engine.writes[0])).toEqual(['a', 'one']);

  engine.text = svgOf(stroke('a', 1000), stroke('b', 3000)); // repariert
  engine.notify([PATH]);
  await settle();
  expect(phases.at(-1)).toBe('bereit');
  expect(ids(surface.page)).toEqual(['a', 'b', 'one', 'two']);
  expect(ids(engine.text ?? '')).toEqual(['a', 'b', 'one', 'two']);
});

// ---------- Fremde Änderungen ----------

test('a change from another device replaces the page', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  engine.text = svgOf(stroke('a', 1000), stroke('b', 500));
  engine.notify([PATH]);
  await settle();
  expect(ids(surface.page)).toEqual(['b', 'a']);
  expect(engine.writes).toEqual([]); // ansehen ist kein Schreiben
});

test('changes to other files are none of its business', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const reads = engine.reads;

  engine.notify(['05 Daily Notes/2026-10-29.md']);
  await settle();
  expect(engine.reads).toBe(reads);
  engine.notify([PATH]);
  await settle();
  expect(engine.reads).toBe(reads + 1);
});

test('sessions of several pages on one engine hear their own page and can close in any order', async () => {
  const OTHER = '07 Anhänge/Notizbuch/2026/2026-10-30 Tag.svg';
  const engine = fakeEngine(svgOf(stroke('a', 1000)), { [OTHER]: svgOf(stroke('x', 1000)) });
  const first = fakeSurface();
  const second = fakeSurface();
  const one = open(engine, first);
  const two = open(engine, second, { path: OTHER });
  await one.session.reload();
  await two.session.reload();
  expect(engine.listenerCount).toBe(2);

  // Die erste Sitzung schließt zuerst, obwohl die zweite später kam.
  one.session.close();
  expect(engine.listenerCount).toBe(1);
  const reads = engine.reads;
  engine.files.set(OTHER, svgOf(stroke('x', 1000), stroke('y', 2000)));
  engine.notify([OTHER]);
  await settle();
  expect(engine.reads).toBe(reads + 1);
  expect(ids(second.page)).toEqual(['x', 'y']);
  expect(ids(first.page)).toEqual(['a']); // die geschlossene Seite bleibt, wie sie war

  two.session.close();
  expect(engine.listenerCount).toBe(0);
});

test('the path is compared in its composed form', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const reads = engine.reads;
  engine.notify([PATH.normalize('NFD')]);
  await settle();
  expect(engine.reads).toBe(reads + 1);
});

test('the same strokes do not reset the page, so undo keeps working', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  expect(surface.sets).toHaveLength(1);
  engine.notify([PATH]);
  await settle();
  expect(surface.sets).toHaveLength(1);
});

test('a second request during a read reads once more', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  const slow = engine.holdRead();
  const first = session.reload();
  await slow.reached;
  engine.text = svgOf(stroke('a', 1000), stroke('b', 2000));
  const second = session.reload();
  slow.release();
  await Promise.all([first, second]);
  expect(engine.reads).toBe(2);
  expect(ids(surface.page)).toEqual(['a', 'b']);
});

// ---------- Zugleich geschrieben und gelesen ----------

test('a read starts only after everything written before it is in the engine', async () => {
  const engine = fakeEngine(svgOf());
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const reads = engine.reads;

  const slow = engine.holdWrite();
  surface.page = pageOf(stroke('mine', 1000));
  session.changed(surface.page);
  await slow.reached;
  const reading = session.reload(); // eine fremde Änderung kommt an, während der Strich noch gespeichert wird
  await settle();
  expect(engine.reads).toBe(reads);
  slow.release();
  await reading;
  expect(engine.log.slice(-3)).toEqual(['write', 'written', 'read']);
  expect(ids(surface.page)).toEqual(['mine']);
});

test('strokes made while the page is being read stay next to the strokes that were read', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000, 100)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  // Ein anderes Gerät hat einen Strich ergänzt. Die Engine liest ihn schon, antwortet aber erst nach dem Abheben des Stifts.
  engine.text = svgOf(stroke('a', 1000, 100), stroke('b', 500, 200));
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = pageOf(stroke('a', 1000, 100), stroke('mine', 5000, 400));
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(ids(surface.page)).toEqual(['b', 'a', 'mine']);
  // Und was gespeichert ist, enthält ebenfalls alles: Die Engine hält die gelesene Fassung für den Stand der Seite.
  const saved = engine.writes[engine.writes.length - 1];
  expect(ids(saved).sort()).toEqual(['a', 'b', 'mine']);
  expect(engine.text).toBe(saved);
});

test('a stroke made while a vanished page was being read is kept', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  engine.text = null; // die Datei wurde auf einem anderen Gerät gelöscht
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = pageOf(stroke('a', 1000), stroke('mine', 5000));
  session.changed(surface.page);
  slow.release();
  await reading;
  expect(ids(surface.page)).toEqual(['a', 'mine']);
});

// ---------- Beenden ----------

test('closing uploads once everything is saved and stops listening', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  expect(engine.listenerCount).toBe(1);

  const slow = engine.holdWrite();
  session.changed(pageOf(stroke('a', 1)));
  await slow.reached;
  session.close();
  await settle();
  expect(engine.flushes).toBe(0); // das Speichern ist noch nicht fertig
  slow.release();
  await settle();
  expect(engine.flushes).toBe(1);
  expect(engine.log.slice(-2)).toEqual(['written', 'flush']);

  expect(engine.listenerCount).toBe(0);
  const reads = engine.reads;
  engine.notify([PATH]);
  await settle();
  expect(engine.reads).toBe(reads);
});

test('a session that is closed does not touch the page any more', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  const slow = engine.holdRead();
  const loading = session.reload();
  await slow.reached;
  session.close();
  slow.release();
  await loading;
  expect(surface.sets).toEqual([]);
  expect(phases).toEqual([]);
});
