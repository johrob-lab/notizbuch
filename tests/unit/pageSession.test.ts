import { afterEach, expect, test } from 'vitest';
import { parsePage, serializePage } from '../../src/ink/svg';
import type { FieldBox, Page, Stroke } from '../../src/ink/types';
import { PathNotAllowedError } from '../../src/sync/paths';
import {
  draftsSettled,
  forgetDraftsForTests,
  holdsDrafts,
  PageSession,
  parkedDrafts,
  type PageSurface,
  type Phase,
  type SessionEngine,
} from '../../src/ui/pageSession';

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
    /** Wie oft jemand `flush` aufrief. Die Sitzung tut es nie: Hochladen ist Sache der Engine. */
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

type OpenOptions = {
  readOnly?: boolean;
  path?: string;
  cues?: ReturnType<typeof fakeCues>;
  fields?: FieldBox[];
  background?: string;
  completePage?: (page: Page) => Page;
  layoutFor?: (meta: Record<string, string>) => { fields: FieldBox[]; background: string };
  headerWritable?: boolean;
  draft?: boolean;
};

function open(engine: ReturnType<typeof fakeEngine>, surface: ReturnType<typeof fakeSurface>, o: OpenOptions = {}) {
  const phases: Phase[] = [];
  const saveFailed: boolean[] = [];
  const session = new PageSession({
    engine,
    path: o.path ?? PATH,
    emptyPage: empty,
    readOnly: o.readOnly ?? false,
    fields: o.fields ?? FIELDS,
    background: o.background ?? BACKGROUND,
    completePage: o.completePage,
    layoutFor: o.layoutFor,
    headerWritable: o.headerWritable,
    draft: o.draft,
    surface,
    retryCues: o.cues?.subscribe,
    onPhase: (p) => phases.push(p),
    onSaveFailed: (f) => saveFailed.push(f),
  });
  return { session, phases, saveFailed };
}

/** Lässt alle schon möglichen Fortsetzungen laufen. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

// Was eine Seite im Entwurf beim Verlassen hinterlässt, gilt für alle Sitzungen derselben Datei, auch über einen Test hinaus.
// Nach jedem Test muss es abgeholt sein (einen geparkten Entwurf nimmt genau eine Sitzung). Was liegen blieb, lässt den Test
// scheitern und wird vergessen, damit es den nächsten nicht stört.
afterEach(() => {
  expect(forgetDraftsForTests()).toEqual({ finishing: [], parked: [] });
});

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

test('a page from a newer version is locked as too new and never written', async () => {
  const engine = fakeEngine('<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="3" data-seite="tag"/>');
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  expect(phases).toEqual(['zuNeu']);
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

test('a page whose path the path guard refuses is locked as blocked, never written and never tried again', async () => {
  // Zum Beispiel eine Besprechung, deren Adresse jemand von Hand mit einem gesperrten Wort im Thema getippt hat.
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  engine.readError = new PathNotAllowedError(PATH);
  const cues = fakeCues();
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface, { cues });
  await session.reload();
  expect(phases).toEqual(['gesperrt']);
  expect(cues.listening).toBe(0); // kein neuer Versuch, wenn das Netz zurückkommt oder alle 3 Minuten
  expect(surface.readOnly).toBe(true);
  expect(surface.sets).toEqual([]);
  session.changed(pageOf(stroke('x', 5)));
  await settle();
  expect(engine.writes).toEqual([]);
  expect(engine.reads).toBe(1);
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
  expect(engine.log.slice(-2)).toEqual(['write', 'written']); // nur gespeichert, das Hochladen macht die Engine
  expect(engine.flushes).toBe(0);
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

test('closing a page saves but leaves the upload to the engine', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  const slow = engine.holdWrite();
  session.changed(pageOf(stroke('a', 1)));
  await slow.reached;
  session.close(); // während das Speichern noch läuft
  slow.release();
  await settle();
  expect(ids(engine.text!)).toEqual(['a']);
  expect(engine.log.at(-1)).toBe('written');
  // Hochgeladen wird nach der Wartezeit der Engine oder beim Verlassen der App, nicht beim Wechsel der Seite.
  expect(engine.flushes).toBe(0);
});

test('closing stops listening for changes from other devices', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const { session } = open(engine, fakeSurface());
  await session.reload();
  expect(engine.listenerCount).toBe(1);

  session.close();
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

// ---------- Kopfdaten (Besprechungen) ----------

/** Eine Seite mit Kopfdaten: Das Thema steht in den Angaben der Seite, der Hintergrund zeigt es (siehe `headLayout`). */
const withThema = (thema: string, ...strokes: Stroke[]): Page => ({ ...empty(), meta: { thema }, strokes });
const headLayout = (meta: Record<string, string>) => ({ fields: FIELDS, background: `<rect id="kopf-${meta.thema ?? ''}"/>` });
const completeThema = (page: Page): Page => ({ ...page, meta: { thema: 'Muster', ...page.meta } });

test('a page without header data is shown completed, and the completed header is written with the next change, not before', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface, { completePage: completeThema });
  await session.reload();
  expect(surface.page.meta).toEqual({ thema: 'Muster' });
  expect(engine.writes).toEqual([]); // Lesen allein schreibt nichts

  engine.notify([PATH]);
  await settle();
  expect(surface.sets).toHaveLength(1); // dieselbe Seite, also bleibt der Verlauf für Rückgängig

  session.changed({ ...surface.page, strokes: [...surface.page.strokes, stroke('b', 2000)] });
  await settle();
  expect(parsePage(engine.writes[0]).meta).toEqual({ thema: 'Muster' });
});

test('a page that is read keeps the header it has, and only what is missing is completed', async () => {
  const engine = fakeEngine(serializePage(withThema('Eigenes', stroke('a', 1000)), FIELDS, BACKGROUND));
  const surface = fakeSurface();
  await open(engine, surface, { completePage: completeThema }).session.reload();
  expect(surface.page.meta).toEqual({ thema: 'Eigenes' });
});

test('every write carries the fields and the background that belong to the header of the page it writes', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface, { layoutFor: headLayout });
  await session.reload();
  session.changed(withThema('Eins', stroke('a', 1000)));
  await settle();
  expect(engine.writes[0]).toContain('<g data-hintergrund="1"><rect id="kopf-Eins"/></g>');

  session.changed(withThema('Zwei', stroke('a', 1000)));
  await settle();
  const second = engine.writes[1];
  expect(second).toContain('<rect id="kopf-Zwei"/>');
  expect(second).not.toContain('kopf-Eins');
  expect(parsePage(second).meta).toEqual({ thema: 'Zwei' });
  expect(ids(second)).toEqual(['a']);
});

test('what was read and what is unsaved are united under the header of the page that is shown, so a header change is not undone', async () => {
  const engine = fakeEngine(serializePage(withThema('Eins', stroke('a', 1000, 100)), FIELDS, '<rect id="kopf-Eins"/>'));
  const surface = fakeSurface();
  const { session } = open(engine, surface, { layoutFor: headLayout });
  await session.reload();
  engine.failWrites = 2;
  surface.page = withThema('Zwei', stroke('a', 1000, 100), stroke('mine', 5000, 400)); // neuer Kopf und ein neuer Strich zugleich
  session.changed(surface.page);
  await settle();

  // ein anderes Gerät hat 'b' ergänzt, mit dem alten Kopf
  engine.text = serializePage(withThema('Eins', stroke('a', 1000, 100), stroke('b', 500, 200)), FIELDS, '<rect id="kopf-Eins"/>');
  engine.notify([PATH]);
  await settle();
  const saved = engine.writes.at(-1)!;
  expect(ids(saved).sort()).toEqual(['a', 'b', 'mine']);
  expect(parsePage(saved).meta).toEqual({ thema: 'Zwei' });
  expect(saved).toContain('<rect id="kopf-Zwei"/>');
  expect(saved).not.toContain('kopf-Eins');
  expect(surface.page.meta).toEqual({ thema: 'Zwei' });
});

test('on a device that only views, a change of the header is written, and the page stays locked', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface, { readOnly: true, headerWritable: true });
  await session.reload();
  expect(surface.readOnly).toBe(true);
  session.changed(withThema('Neu', stroke('a', 1000)));
  await settle();
  expect(engine.writes).toHaveLength(1);
  expect(parsePage(engine.writes[0]).meta).toEqual({ thema: 'Neu' });
  expect(ids(engine.writes[0])).toEqual(['a']);
  expect(surface.readOnly).toBe(true);
});

test('a header change before the page is read is not written, even where the header may be written', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface, { readOnly: true, headerWritable: true });
  session.changed(withThema('Zu früh'));
  await settle();
  expect(engine.writes).toEqual([]);
});

// ---------- Löschen ----------

test('a retired session writes nothing any more: no change, no save that failed before, nothing on closing', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  engine.failWrites = 1;
  session.changed(pageOf(stroke('a', 1)));
  await settle();
  expect(engine.writes).toHaveLength(1); // gescheitert, der Text wartet auf einen neuen Versuch

  await session.retire();
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('a', 1), stroke('b', 2)));
  session.close();
  await settle();
  expect(engine.writes).toHaveLength(1);
  expect(engine.text).toBeNull();
  expect(engine.flushes).toBe(0); // was in der Warteschlange steht, auch das Löschen, lädt die Engine nach ihrer Wartezeit hoch
});

test('retiring waits for the save that is running, and drops the change that waits behind it', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const slow = engine.holdWrite();
  session.changed(pageOf(stroke('a', 1)));
  await slow.reached;
  session.changed(pageOf(stroke('a', 1), stroke('b', 2))); // wartet hinter dem laufenden Auftrag

  let retired = false;
  const retiring = session.retire().then(() => {
    retired = true;
  });
  await settle();
  expect(retired).toBe(false); // der Auftrag läuft noch: Die Datei darf erst danach gelöscht werden
  slow.release();
  await retiring;
  expect(retired).toBe(true);
  await settle();
  expect(engine.writes.map(ids)).toEqual([['a']]);
});

test('a retired session neither reads nor unlocks the page again', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  await session.retire();
  const reads = engine.reads;
  const shown = phases.length;

  engine.notify([PATH]);
  await session.reload();
  await settle();
  expect(engine.reads).toBe(reads);
  expect(surface.readOnly).toBe(true);
  expect(phases).toHaveLength(shown);
});

test('a read that is running when the page is retired does not unlock it', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  await session.retire();
  slow.release();
  await reading;
  expect(surface.readOnly).toBe(true);
  expect(surface.sets).toHaveLength(1); // nur das erste Anzeigen
});

// ---------- Zusammenführen mit dem Stand, den die Sitzung zuletzt kannte ----------
// Die Sitzung merkt sich den Text, den sie zuletzt gelesen oder gespeichert hat. Davon aus sieht sie, wer was geändert hat:
// Kopfdaten und Striche, die hier nicht angefasst wurden, kommen von der Engine, und was hier radiert wurde, bleibt es.

test('a header change made elsewhere is not undone by a stroke made while the page is being read', async () => {
  const engine = fakeEngine(serializePage(withThema('Eins', stroke('a', 1000)), FIELDS, BACKGROUND));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  // Ein anderes Gerät hat das Thema geändert und hochgeladen, die Engine hat es übernommen. Die Seite liest es gerade.
  engine.text = serializePage(withThema('Zwei', stroke('a', 1000)), FIELDS, BACKGROUND);
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = withThema('Eins', stroke('a', 1000), stroke('mine', 5000, 400)); // der Stift schreibt noch mit dem alten Kopf
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(surface.page.meta).toEqual({ thema: 'Zwei' });
  expect(ids(surface.page)).toEqual(['a', 'mine']);
  const saved = engine.writes.at(-1)!;
  expect(parsePage(saved).meta).toEqual({ thema: 'Zwei' });
  expect(ids(saved).sort()).toEqual(['a', 'mine']);
});

test('a header change made here while the page is read stays, and the strokes made elsewhere come along', async () => {
  const engine = fakeEngine(serializePage(withThema('Eins', stroke('a', 1000)), FIELDS, BACKGROUND));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  engine.text = serializePage(withThema('Eins', stroke('a', 1000), stroke('b', 500, 200)), FIELDS, BACKGROUND);
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = withThema('Zwei', stroke('a', 1000));
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(surface.page.meta).toEqual({ thema: 'Zwei' });
  expect(ids(surface.page)).toEqual(['b', 'a']);
  expect(parsePage(engine.writes.at(-1)!).meta).toEqual({ thema: 'Zwei' });
});

test('a stroke erased while the page is being read stays erased when another device has added one', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000), stroke('b', 2000, 300)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  engine.text = svgOf(stroke('a', 1000), stroke('b', 2000, 300), stroke('c', 500, 500));
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = pageOf(stroke('a', 1000)); // b wird radiert
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(ids(surface.page)).toEqual(['c', 'a']);
  expect(ids(engine.text ?? '').sort()).toEqual(['a', 'c']);
});

test('what the session saved is the base of the next merge: a stroke saved here and erased elsewhere stays erased', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  surface.page = pageOf(stroke('a', 1000), stroke('b', 2000, 300));
  session.changed(surface.page);
  await settle();
  expect(ids(engine.text ?? '')).toEqual(['a', 'b']);

  // Ein anderes Gerät hat b radiert, die Engine hat das übernommen. Hier entsteht währenddessen ein neuer Strich.
  engine.text = svgOf(stroke('a', 1000));
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = pageOf(stroke('a', 1000), stroke('b', 2000, 300), stroke('c', 3000, 500));
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(ids(surface.page)).toEqual(['a', 'c']);
  expect(ids(engine.text ?? '')).toEqual(['a', 'c']);
});

test('a header that the session completed is no change against the page it read: a header change elsewhere is not undone', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000))); // eine Seite aus der Zeit vor den Kopfdaten
  const surface = fakeSurface();
  const { session } = open(engine, surface, { completePage: completeThema });
  await session.reload();
  expect(surface.page.meta).toEqual({ thema: 'Muster' }); // beim Lesen ergänzt, nicht geschrieben

  // Ein anderes Gerät hat die Seite ebenfalls ergänzt und das Thema geändert.
  engine.text = serializePage(withThema('Zwei', stroke('a', 1000)), FIELDS, BACKGROUND);
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = withThema('Muster', stroke('a', 1000), stroke('mine', 5000, 400));
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(surface.page.meta).toEqual({ thema: 'Zwei' });
  expect(ids(surface.page)).toEqual(['a', 'mine']);
});

test('a page that could not be read before has no base: strokes of both come together and the header of the page that was read wins', async () => {
  const engine = fakeEngine(null); // die Datei gibt es noch nicht
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  // Ein anderes Gerät legt die Seite an. Hier wird währenddessen schon geschrieben.
  engine.text = serializePage(withThema('Deren', stroke('r', 500, 200)), FIELDS, BACKGROUND);
  const slow = engine.holdRead();
  const reading = session.reload();
  await slow.reached;
  surface.page = withThema('Meins', stroke('mine', 5000, 400));
  session.changed(surface.page);
  slow.release();
  await reading;

  expect(ids(surface.page)).toEqual(['r', 'mine']);
  // Ohne Ausgangspunkt kannte diese Sitzung die Datei nicht: Die Kopfdaten der Datei gelten, wo sie etwas angeben.
  expect(surface.page.meta).toEqual({ thema: 'Deren' });
});

// Eine Seite, die sich zwischendurch nicht lesen ließ, hat keinen Ausgangspunkt mehr: Was inzwischen mit ihr geschah, weiß
// die Sitzung nicht. Ein Strich, den die wieder lesbare Seite nicht hat, gilt deshalb nicht als radiert (ein verlorener
// Strich wöge schwerer als einer, der wiederkommt).
for (const cause of [
  { name: 'unreadable', phase: 'unlesbar', lock: (e: ReturnType<typeof fakeEngine>) => void (e.text = BROKEN), unlock: (e: ReturnType<typeof fakeEngine>) => e.notify([PATH]) },
  { name: 'not loaded', phase: 'nichtGeladen', lock: (e: ReturnType<typeof fakeEngine>) => void (e.readError = new Error('GitHub antwortete mit Status 500.')), unlock: (e: ReturnType<typeof fakeEngine>) => void (e.readError = undefined) },
]) {
  test(`a page that was ${cause.name} in between has no base any more: a stroke the repaired page lacks is not taken for erased`, async () => {
    const engine = fakeEngine(svgOf(stroke('a', 1000), stroke('x', 2000, 300)));
    const cues = fakeCues();
    const surface = fakeSurface();
    const { session, phases } = open(engine, surface, { cues });
    await session.reload();
    engine.failWrites = 2;
    surface.page = pageOf(stroke('a', 1000), stroke('x', 2000, 300), stroke('mine', 5000, 400));
    session.changed(surface.page);
    await settle(); // das Speichern scheitert, die Striche warten

    cause.lock(engine);
    engine.notify([PATH]);
    await settle();
    expect(phases.at(-1)).toBe(cause.phase);

    // Die Seite ist wieder da. Was sie enthält, ging nicht aus dem Text von vorhin hervor: 'x' fehlt, 'b' ist neu.
    engine.text = svgOf(stroke('a', 1000), stroke('b', 3000, 200));
    cause.unlock(engine);
    cues.fire();
    await settle();
    expect(phases.at(-1)).toBe('bereit');
    expect(ids(surface.page).sort()).toEqual(['a', 'b', 'mine', 'x']);
    expect(ids(engine.text ?? '').sort()).toEqual(['a', 'b', 'mine', 'x']);
  });
}

// ---------- Entwurf (Weiterscrollen) ----------

test('a draft page is free at once and writes only after it is read', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const read = engine.holdRead();
  const { session, phases } = open(engine, surface, { draft: true });
  expect(surface.readOnly).toBe(false);
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('neu', 3000));
  session.changed(surface.page);
  await settle();
  expect(engine.writes).toEqual([]);
  read.release();
  await loading;
  await settle();
  expect(phases).toEqual(['bereit']);
  expect(engine.writes.map(ids)).toEqual([['neu']]);
});

test('a draft is merged from the page it showed: new strokes stay, erased ones stay gone, foreign ones come in', async () => {
  // Die Vorschau zeigte a und b. Im Entwurf kommt c dazu, b wird radiert. Die Datei hat inzwischen auch d (anderes Gerät).
  const engine = fakeEngine(svgOf(stroke('a', 1000), stroke('b', 2000), stroke('d', 2500)));
  const surface = fakeSurface(pageOf(stroke('a', 1000), stroke('b', 2000)));
  const read = engine.holdRead();
  const { session } = open(engine, surface, { draft: true });
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('a', 1000), stroke('c', 3000));
  session.changed(surface.page);
  read.release();
  await loading;
  await settle();
  expect(ids(surface.page).sort()).toEqual(['a', 'c', 'd']);
  expect(ids(engine.writes.at(-1)!).sort()).toEqual(['a', 'c', 'd']);
});

test('a draft page that gets no change writes nothing and is not set again', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface(pageOf(stroke('a', 1000)));
  const { session, phases } = open(engine, surface, { draft: true });
  await session.reload();
  await settle();
  expect(phases).toEqual(['bereit']);
  expect(engine.writes).toEqual([]);
  expect(surface.sets).toEqual([]);
});

test('when the read fails, the draft stays and joins the page at the next read', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface(pageOf(stroke('a', 1000)));
  const cues = fakeCues();
  engine.readError = new Error('GitHub 500');
  const read = engine.holdRead();
  const { session, phases } = open(engine, surface, { draft: true, cues });
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('a', 1000), stroke('c', 3000));
  session.changed(surface.page);
  read.release();
  await loading;
  expect(phases).toEqual(['nichtGeladen']);
  expect(surface.readOnly).toBe(true);
  expect(ids(surface.page)).toEqual(['a', 'c']);
  expect(engine.writes).toEqual([]);
  engine.readError = undefined;
  cues.fire();
  await settle();
  await settle();
  expect(phases).toEqual(['nichtGeladen', 'bereit']);
  expect(ids(engine.writes.at(-1)!).sort()).toEqual(['a', 'c']);
});

test('a draft page left before it is read is still read, merged and saved', async () => {
  const engine = fakeEngine(svgOf(stroke('d', 2500)));
  const surface = fakeSurface();
  const read = engine.holdRead();
  const { session, phases, saveFailed } = open(engine, surface, { draft: true });
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('neu', 3000));
  session.changed(surface.page);
  session.close();
  read.release();
  await loading;
  await settle();
  expect(ids(engine.writes.at(-1)!).sort()).toEqual(['d', 'neu']);
  expect(phases).toEqual([]);
  expect(saveFailed).toEqual([]);
  expect(surface.sets).toEqual([]);
});

test('a new session of the same page reads only after the left draft is saved', async () => {
  const engine = fakeEngine(null);
  const first = fakeSurface();
  const read = engine.holdRead();
  const a = open(engine, first, { draft: true });
  const loadingA = a.session.reload();
  await read.reached;
  first.page = pageOf(stroke('alt', 3000));
  a.session.changed(first.page);
  a.session.close();

  const second = fakeSurface();
  const b = open(engine, second, { draft: true });
  const loadingB = b.session.reload();
  await settle();
  expect(engine.reads).toBe(1); // die neue Sitzung wartet auf die alte
  read.release();
  await loadingA;
  await loadingB;
  await settle();
  expect(ids(second.page)).toEqual(['alt']);
  expect(b.phases).toEqual(['bereit']);
  expect(engine.writes.map(ids)).toEqual([['alt']]);
});

test('the draft of a left page whose read failed goes to the next session of that page', async () => {
  const engine = fakeEngine(null);
  const first = fakeSurface();
  engine.readError = new Error('GitHub 500');
  const a = open(engine, first, { draft: true });
  const loadingA = a.session.reload();
  first.page = pageOf(stroke('alt', 3000));
  a.session.changed(first.page);
  a.session.close();
  await loadingA;
  await settle();
  expect(engine.writes).toEqual([]);

  engine.readError = undefined;
  const second = fakeSurface();
  const b = open(engine, second); // über ‹ › geöffnet: ohne Entwurf
  await b.session.reload();
  await settle();
  expect(ids(second.page)).toEqual(['alt']);
  expect(engine.writes.map(ids)).toEqual([['alt']]);
});

test('draft strokes on an unreadable page are never written', async () => {
  const engine = fakeEngine(BROKEN);
  const surface = fakeSurface();
  const read = engine.holdRead();
  const { session, phases } = open(engine, surface, { draft: true });
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('neu', 3000));
  session.changed(surface.page);
  read.release();
  await loading;
  await settle();
  expect(phases).toEqual(['unlesbar']);
  expect(surface.readOnly).toBe(true);
  expect(engine.writes).toEqual([]);
});

test('a read-only session has no draft and stays locked', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const { session } = open(engine, surface, { draft: true, readOnly: true });
  expect(surface.readOnly).toBe(true);
  await session.reload();
  expect(surface.readOnly).toBe(true);
  expect(engine.writes).toEqual([]);
});

/**
 * Eine Seite im Entwurf, deren Lesen scheitert, wird verlassen: Ihr Entwurf (der Strich `draft`) liegt danach geparkt bereit.
 * Nach dem Schließen meldet ihre Sitzung nichts mehr und wartet auf keinen Anlass. Ohne `path` ist es die Seite `PATH`.
 */
async function leaveUnloaded(engine: ReturnType<typeof fakeEngine>, draft: Stroke, path = PATH) {
  engine.readError = new Error('GitHub 500');
  const surface = fakeSurface();
  const cues = fakeCues();
  const { session, phases } = open(engine, surface, { draft: true, cues, path });
  const loading = session.reload();
  surface.page = pageOf(draft);
  session.changed(surface.page);
  session.close();
  await loading;
  await settle();
  expect(phases).toEqual([]);
  expect(cues.listening).toBe(0);
  engine.readError = undefined;
}

test('a draft page that could not be loaded parks its draft as soon as it is left, without reading again', async () => {
  const engine = fakeEngine(null);
  const first = fakeSurface();
  const cues = fakeCues();
  engine.readError = new Error('GitHub 500');
  const read = engine.holdRead();
  const a = open(engine, first, { draft: true, cues });
  const loading = a.session.reload();
  await read.reached;
  first.page = pageOf(stroke('alt', 3000));
  a.session.changed(first.page);
  read.release();
  await loading;
  expect(a.phases).toEqual(['nichtGeladen']);
  a.session.close();
  await settle();
  expect(a.phases).toEqual(['nichtGeladen']); // nach dem Schließen meldet sie nichts mehr
  expect(cues.listening).toBe(0);
  expect(engine.reads).toBe(1);
  expect(engine.writes).toEqual([]);

  engine.readError = undefined;
  const second = fakeSurface();
  await open(engine, second).session.reload();
  await settle();
  expect(ids(second.page)).toEqual(['alt']);
  expect(engine.writes.map(ids)).toEqual([['alt']]);
});

test('the draft of a left page whose file is broken is given up, also for the next session', async () => {
  const engine = fakeEngine(BROKEN);
  const first = fakeSurface();
  const cues = fakeCues();
  const read = engine.holdRead();
  const { session, phases } = open(engine, first, { draft: true, cues });
  const loading = session.reload();
  await read.reached;
  first.page = pageOf(stroke('neu', 3000));
  session.changed(first.page);
  session.close();
  read.release();
  await loading;
  await settle();
  expect(phases).toEqual([]); // nach dem Schließen meldet sie nichts mehr
  expect(cues.listening).toBe(0);
  expect(engine.writes).toEqual([]);

  engine.text = svgOf(stroke('a', 1000)); // ein anderes Gerät hat die Seite repariert
  const second = fakeSurface();
  await open(engine, second).session.reload();
  await settle();
  expect(ids(second.page)).toEqual(['a']);
  expect(engine.writes).toEqual([]);
});

test('a retired draft page writes nothing and leaves no draft for the next session', async () => {
  const engine = fakeEngine(null);
  const first = fakeSurface();
  engine.readError = new Error('GitHub 500');
  const { session } = open(engine, first, { draft: true });
  const loading = session.reload();
  first.page = pageOf(stroke('weg', 3000));
  session.changed(first.page);
  await loading; // nicht geladen, der Entwurf wartet
  await session.retire();
  session.close();
  await settle();

  engine.readError = undefined;
  const second = fakeSurface();
  await open(engine, second).session.reload();
  await settle();
  expect(second.page.strokes).toEqual([]);
  expect(engine.writes).toEqual([]);
});

test('when the next session of a left page cannot load it either, both drafts wait together', async () => {
  const engine = fakeEngine(null);
  await leaveUnloaded(engine, stroke('eins', 3000));
  await leaveUnloaded(engine, stroke('zwei', 4000));
  expect(engine.writes).toEqual([]);

  const third = fakeSurface();
  await open(engine, third).session.reload();
  await settle();
  expect(ids(third.page)).toEqual(['eins', 'zwei']);
  expect(engine.writes.map((text) => ids(text).sort())).toEqual([['eins', 'zwei']]);
});

test('a parked draft waits for a session that writes: one that only views leaves it where it is', async () => {
  const engine = fakeEngine(null);
  await leaveUnloaded(engine, stroke('alt', 3000));

  const viewing = fakeSurface();
  const v = open(engine, viewing, { readOnly: true });
  await v.session.reload();
  v.session.close();
  expect(viewing.page.strokes).toEqual([]);

  const second = fakeSurface();
  await open(engine, second).session.reload();
  await settle();
  expect(ids(second.page)).toEqual(['alt']);
  expect(engine.writes.map(ids)).toEqual([['alt']]);
});

test('a parked draft goes to one session only: what that session erased does not come back with the next one', async () => {
  const engine = fakeEngine(null);
  await leaveUnloaded(engine, stroke('alt', 3000));

  const second = fakeSurface();
  const b = open(engine, second);
  await b.session.reload();
  expect(ids(second.page)).toEqual(['alt']);
  second.page = pageOf(); // dort wieder radiert
  b.session.changed(second.page);
  b.session.close();
  await settle();
  expect(engine.writes.map(ids)).toEqual([['alt'], []]);

  const third = fakeSurface();
  await open(engine, third).session.reload();
  await settle();
  expect(third.page.strokes).toEqual([]);
  expect(engine.writes).toHaveLength(2); // die dritte Sitzung schreibt nichts
});

test('a draft page left before anyone asked it to read is read and saved all the same', async () => {
  const engine = fakeEngine(svgOf(stroke('d', 2500)));
  const surface = fakeSurface();
  const { session } = open(engine, surface, { draft: true });
  surface.page = pageOf(stroke('neu', 3000));
  session.changed(surface.page);
  session.close();
  await settle();
  expect(ids(engine.writes.at(-1)!).sort()).toEqual(['d', 'neu']);
});

// ---------- Entwürfe gehören zu ihrer Engine (Wechsel des Repositorys) ----------
// Der Pfad eines Tages ist in jedem Repository derselbe. Was eine verlassene Seite hinterlässt, bekommt darum nur eine Sitzung
// derselben Engine: Nach einem Wechsel des Repositorys arbeitet die App mit einer neuen.

/** Die Datei des nächsten Tages, für Tests mit zwei Seiten in einer Engine. */
const NEXT_PATH = '07 Anhänge/Notizbuch/2026/2026-10-30 Tag.svg';

test('a parked draft stays out of the page of another engine and goes to the next session of its own', async () => {
  const engine = fakeEngine(null);
  await leaveUnloaded(engine, stroke('alt', 3000));

  // Das Repository wird gewechselt: In der neuen Engine hat dieselbe Datei einen eigenen Strich.
  const other = fakeEngine(svgOf(stroke('fremd', 1000)));
  const there = fakeSurface();
  const b = open(other, there);
  await b.session.reload();
  await settle();
  expect(ids(there.page)).toEqual(['fremd']);
  expect(other.writes).toEqual([]);
  there.page = pageOf(stroke('fremd', 1000), stroke('neu', 5000));
  b.session.changed(there.page);
  expect(other.writes.map(ids)).toEqual([['fremd', 'neu']]);

  // In der Engine, zu der er gehört, kommt er beim nächsten Öffnen der Seite dazu.
  const back = fakeSurface();
  await open(engine, back).session.reload();
  await settle();
  expect(ids(back.page)).toEqual(['alt']);
  expect(engine.writes.map(ids)).toEqual([['alt']]);
});

test('a session of another engine reads at once and does not wait for a page left in this one', async () => {
  const engine = fakeEngine(null);
  const read = engine.holdRead();
  const first = fakeSurface();
  const a = open(engine, first, { draft: true });
  const loadingA = a.session.reload();
  await read.reached;
  first.page = pageOf(stroke('alt', 3000));
  a.session.changed(first.page);
  a.session.close();

  const other = fakeEngine(svgOf(stroke('fremd', 1000)));
  const there = fakeSurface();
  const b = open(other, there);
  const loadingB = b.session.reload();
  await settle();
  expect(other.reads).toBe(1); // die verlassene Seite gehört zur anderen Engine
  await loadingB;
  expect(ids(there.page)).toEqual(['fremd']);

  read.release();
  await loadingA;
  await settle();
  expect(engine.writes.map(ids)).toEqual([['alt']]);
  expect(other.writes).toEqual([]);
});

test('each engine keeps its own parked draft of a file: the two are not united', async () => {
  const engine = fakeEngine(null);
  const other = fakeEngine(null);
  await leaveUnloaded(engine, stroke('hier', 3000));
  await leaveUnloaded(other, stroke('dort', 4000));

  const one = fakeSurface();
  await open(other, one).session.reload();
  await settle();
  expect(ids(one.page)).toEqual(['dort']);
  expect(other.writes.map(ids)).toEqual([['dort']]);

  const two = fakeSurface();
  await open(engine, two).session.reload();
  await settle();
  expect(ids(two.page)).toEqual(['hier']);
  expect(engine.writes.map(ids)).toEqual([['hier']]);
});

test('draftsSettled waits for every page left in its engine, also for one left while it waits, and for no other engine', async () => {
  const engine = fakeEngine(null, { [NEXT_PATH]: null });
  const other = fakeEngine(null);
  await draftsSettled(engine); // keine verlassene Seite: gleich erfüllt

  /** Eine Seite im Entwurf bekommt einen Strich und wird verlassen, solange ihr Lesen noch wartet. */
  const leaveWhileReading = async (path: string, id: string) => {
    const read = engine.holdRead();
    const surface = fakeSurface();
    const { session } = open(engine, surface, { draft: true, path });
    void session.reload();
    await read.reached;
    surface.page = pageOf(stroke(id, 3000));
    session.changed(surface.page);
    session.close();
    return read;
  };
  const first = await leaveWhileReading(PATH, 'eins');
  let settled = false;
  void draftsSettled(engine).then(() => (settled = true));
  let otherSettled = false;
  void draftsSettled(other).then(() => (otherSettled = true));
  const second = await leaveWhileReading(NEXT_PATH, 'zwei');
  await settle();
  expect(otherSettled).toBe(true);
  expect(settled).toBe(false);

  first.release();
  await settle();
  expect(engine.writes.map(ids)).toEqual([['eins']]);
  expect(settled).toBe(false); // die zweite Seite liest noch

  second.release();
  await settle();
  expect(engine.writes.map(ids)).toEqual([['eins'], ['zwei']]);
  expect(settled).toBe(true);
});

test('parkedDrafts counts the parked drafts of its engine, one per file, until a session takes them', async () => {
  const engine = fakeEngine(null, { [NEXT_PATH]: null });
  const other = fakeEngine(null);
  expect(parkedDrafts(engine)).toBe(0);
  await leaveUnloaded(engine, stroke('eins', 3000));
  expect(parkedDrafts(engine)).toBe(1);
  await leaveUnloaded(engine, stroke('zwei', 4000)); // dieselbe Datei: beide in einem Entwurf
  expect(parkedDrafts(engine)).toBe(1);
  await leaveUnloaded(engine, stroke('drei', 5000), NEXT_PATH);
  expect(parkedDrafts(engine)).toBe(2);
  expect(parkedDrafts(other)).toBe(0);

  await open(engine, fakeSurface()).session.reload();
  expect(parkedDrafts(engine)).toBe(1);
  await open(engine, fakeSurface(), { path: NEXT_PATH }).session.reload();
  expect(parkedDrafts(engine)).toBe(0);
  await settle();
  expect(engine.writes.map((text) => ids(text).sort())).toEqual([['eins', 'zwei'], ['drei']]);
});

// ---------- Ein verlassener Entwurf, der sich nicht speichern lässt ----------

test('a left draft whose last save fails too is parked, and the next session of the page saves it', async () => {
  const engine = fakeEngine(null);
  const first = fakeSurface();
  const read = engine.holdRead();
  const a = open(engine, first, { draft: true });
  const loading = a.session.reload();
  await read.reached;
  first.page = pageOf(stroke('alt', 3000));
  a.session.changed(first.page);
  a.session.close();
  // Der Speicher des Geräts ist gestört: Das Speichern nach dem Lesen scheitert, der letzte Versuch beim Schließen auch.
  engine.failWrites = 2;
  read.release();
  await loading;
  await settle();
  expect(engine.writes.map(ids)).toEqual([['alt'], ['alt']]);
  expect(engine.text).toBeNull();
  expect(a.saveFailed).toEqual([]); // die Seite ist verlassen, ihre Meldung sähe niemand

  const second = fakeSurface();
  await open(engine, second).session.reload();
  await settle();
  expect(ids(second.page)).toEqual(['alt']);
  expect(engine.writes.map(ids)).toEqual([['alt'], ['alt'], ['alt']]);
  expect(ids(engine.text!)).toEqual(['alt']);
});

test('a page left twice before it is read is saved in turn: the next session shows both drafts, and none wrote before reading', async () => {
  // A: Weiterscrollen auf die Seite, das Lesen wartet noch auf GitHub, ein Strich, dann verlassen.
  const engine = fakeEngine(null);
  const readA = engine.holdRead();
  const first = fakeSurface();
  const a = open(engine, first, { draft: true });
  void a.session.reload();
  await readA.reached;
  first.page = pageOf(stroke('a1', 1000));
  a.session.changed(first.page);
  a.session.close();

  // B: wieder auf die Seite, die Vorschau zeigt den Strich aus der Übergabe. B wartet auf A, bekommt einen Strich und wird
  // verlassen, noch während es wartet.
  const second = fakeSurface(pageOf(stroke('a1', 1000)));
  const b = open(engine, second, { draft: true });
  void b.session.reload();
  await settle();
  second.page = pageOf(stroke('a1', 1000), stroke('b1', 2000));
  b.session.changed(second.page);
  b.session.close();

  // C: die Seite noch einmal, ohne Entwurf.
  const third = fakeSurface();
  const c = open(engine, third);
  const loadingC = c.session.reload();
  await settle();
  expect(engine.reads).toBe(1); // B und C warten

  readA.release();
  await loadingC;
  await settle();
  // Jede Sitzung liest, bevor sie schreibt, und erst nach der davor: A, dann B, dann C.
  expect(engine.log).toEqual(['read', 'write', 'written', 'read', 'write', 'written', 'read']);
  expect(engine.writes.map(ids)).toEqual([['a1'], ['a1', 'b1']]);
  expect(ids(third.page)).toEqual(['a1', 'b1']);
  expect(ids(engine.text!)).toEqual(['a1', 'b1']);
});

// ---------- Entwürfe, die nur im Arbeitsspeicher liegen (kein Neuladen von selbst) ----------

test('an open draft page holds a draft from its first change until the page is read', async () => {
  expect(holdsDrafts()).toBe(false);
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const read = engine.holdRead();
  const { session } = open(engine, surface, { draft: true });
  const loading = session.reload();
  await read.reached;
  expect(holdsDrafts()).toBe(false); // ohne Änderung gibt es nichts, was verloren gehen könnte
  surface.page = pageOf(stroke('neu', 3000));
  session.changed(surface.page);
  expect(holdsDrafts()).toBe(true);
  read.release();
  await loading;
  expect(holdsDrafts()).toBe(false); // gelesen: Der Entwurf steht im Schreibauftrag
  await settle();
  expect(engine.writes.map(ids)).toEqual([['neu']]);
});

test('a draft page that could not be loaded holds its draft, also once it is left, until a session saves it', async () => {
  const engine = fakeEngine(null);
  engine.readError = new Error('GitHub 500');
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface, { draft: true, cues: fakeCues() });
  const loading = session.reload();
  surface.page = pageOf(stroke('alt', 3000));
  session.changed(surface.page);
  await loading;
  expect(phases).toEqual(['nichtGeladen']);
  expect(holdsDrafts()).toBe(true);
  session.close();
  await settle();
  expect(holdsDrafts()).toBe(true); // aufgehoben

  engine.readError = undefined;
  await open(engine, fakeSurface()).session.reload();
  expect(holdsDrafts()).toBe(false);
  await settle();
  expect(engine.writes.map(ids)).toEqual([['alt']]);
});

test('a draft page left before it is read holds its draft until it is saved', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const read = engine.holdRead();
  const { session } = open(engine, surface, { draft: true });
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('neu', 3000));
  session.changed(surface.page);
  session.close();
  expect(holdsDrafts()).toBe(true);
  read.release();
  await loading;
  await settle();
  expect(engine.writes.map(ids)).toEqual([['neu']]);
  expect(holdsDrafts()).toBe(false);
});

for (const { kind, file, readError, phase } of [
  { kind: 'broken', file: BROKEN, readError: undefined, phase: 'unlesbar' },
  { kind: 'from a newer version', file: '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="3" data-seite="tag"/>', readError: undefined, phase: 'zuNeu' },
  { kind: 'refused by the path guard', file: null, readError: new PathNotAllowedError(PATH), phase: 'gesperrt' },
] as const) {
  test(`a draft on a page that is ${kind} is never saved and is not held, open or left`, async () => {
    const engine = fakeEngine(file);
    const surface = fakeSurface();
    const read = engine.holdRead();
    const { session, phases } = open(engine, surface, { draft: true });
    const loading = session.reload();
    await read.reached;
    surface.page = pageOf(stroke('neu', 3000));
    session.changed(surface.page);
    expect(holdsDrafts()).toBe(true);
    engine.readError = readError;
    read.release();
    await loading;
    expect(phases).toEqual([phase]);
    expect(holdsDrafts()).toBe(false);
    session.close();
    await settle();
    expect(holdsDrafts()).toBe(false);
    expect(engine.writes).toEqual([]);
  });
}

test('a draft page that is being deleted holds no draft', async () => {
  const engine = fakeEngine(null);
  const surface = fakeSurface();
  const read = engine.holdRead();
  const { session } = open(engine, surface, { draft: true });
  const loading = session.reload();
  await read.reached;
  surface.page = pageOf(stroke('weg', 3000));
  session.changed(surface.page);
  expect(holdsDrafts()).toBe(true);
  const retiring = session.retire();
  expect(holdsDrafts()).toBe(false);
  read.release();
  await loading;
  await retiring;
  session.close();
  await settle();
  expect(holdsDrafts()).toBe(false);
  expect(engine.writes).toEqual([]);
});
