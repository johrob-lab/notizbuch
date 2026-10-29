import { expect, test } from 'vitest';
import { parsePage, serializePage } from '../../src/ink/svg';
import type { Page, Stroke } from '../../src/ink/types';
import { PageSession, type PageSurface, type Phase, type SessionEngine } from '../../src/ui/pageSession';

// Die Sitzung einer Seite: lesen, speichern, fremde Änderungen übernehmen. Engine und Fläche sind Fakes, die Seiten
// sind echte SVG-Texte. Alles hier ist erfunden.

const PATH = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
const DAY = '2026-10-29';
const BROKEN = '<svg xmlns="http://www.w3.org/2000/svg" data-notizbuch="1"';

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

function fakeEngine(initial: string | null = null) {
  const readGates: Gate[] = [];
  const writeGates: Gate[] = [];
  const e = {
    /** Die Fassung, die `read` liefert und `write` ersetzt, wie die lokale Kopie der echten Engine. */
    text: initial,
    log: [] as string[],
    reads: 0,
    writes: [] as string[],
    active: 0,
    maxActive: 0,
    flushes: 0,
    failWrites: 0,
    readError: undefined as Error | undefined,
    onRemoteChange: undefined as ((paths: string[]) => void) | undefined,
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
      expect(path).toBe(PATH);
      e.reads++;
      e.log.push('read');
      const value = e.text;
      const g = readGates.shift();
      if (g) {
        g.arrive();
        await g.wait;
      }
      if (e.readError) throw e.readError;
      return value;
    },
    async write(path: string, text: string, kind: 'md' | 'svg'): Promise<void> {
      expect(path).toBe(PATH);
      expect(kind).toBe('svg');
      e.log.push('write');
      e.active++;
      e.maxActive = Math.max(e.maxActive, e.active);
      e.writes.push(text);
      e.text = text;
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

function open(engine: ReturnType<typeof fakeEngine>, surface: ReturnType<typeof fakeSurface>, o: { readOnly?: boolean } = {}) {
  const phases: Phase[] = [];
  const saveFailed: boolean[] = [];
  const session = new PageSession({
    engine,
    path: PATH,
    emptyPage: empty,
    readOnly: o.readOnly ?? false,
    surface,
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

test('text the engine cannot read is just as unreadable', async () => {
  const engine = fakeEngine('egal');
  engine.readError = new TypeError('Kein UTF-8');
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();
  expect(phases).toEqual(['unlesbar']);
  expect(surface.readOnly).toBe(true);
  expect(surface.sets).toEqual([]);
});

test('a page that becomes unreadable is locked, and unlocked again once it can be read', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session, phases } = open(engine, surface);
  await session.reload();

  engine.text = BROKEN;
  engine.onRemoteChange?.([PATH]);
  await settle();
  expect(phases).toEqual(['bereit', 'unlesbar']);
  expect(surface.readOnly).toBe(true);
  session.changed(pageOf(stroke('late', 9000)));
  await settle();
  expect(engine.writes).toEqual([]);

  engine.text = svgOf(stroke('a', 1000), stroke('b', 3000));
  engine.onRemoteChange?.([PATH]);
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

// ---------- Fremde Änderungen ----------

test('a change from another device replaces the page', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

  engine.text = svgOf(stroke('a', 1000), stroke('b', 500));
  engine.onRemoteChange?.([PATH]);
  await settle();
  expect(ids(surface.page)).toEqual(['b', 'a']);
  expect(engine.writes).toEqual([]); // ansehen ist kein Schreiben
});

test('changes to other files are none of its business, but the previous handler hears them', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const heard: string[][] = [];
  engine.onRemoteChange = (paths) => heard.push(paths);
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const reads = engine.reads;

  engine.onRemoteChange?.(['05 Daily Notes/2026-10-29.md']);
  await settle();
  expect(engine.reads).toBe(reads);
  engine.onRemoteChange?.([PATH]);
  await settle();
  expect(engine.reads).toBe(reads + 1);
  expect(heard).toEqual([['05 Daily Notes/2026-10-29.md'], [PATH]]);
});

test('the path is compared in its composed form', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  const reads = engine.reads;
  engine.onRemoteChange?.([PATH.normalize('NFD')]);
  await settle();
  expect(engine.reads).toBe(reads + 1);
});

test('the same strokes do not reset the page, so undo keeps working', async () => {
  const engine = fakeEngine(svgOf(stroke('a', 1000)));
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();
  expect(surface.sets).toHaveLength(1);
  engine.onRemoteChange?.([PATH]);
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
  const previous = (_paths: string[]) => undefined;
  engine.onRemoteChange = previous;
  const surface = fakeSurface();
  const { session } = open(engine, surface);
  await session.reload();

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

  expect(engine.onRemoteChange).toBe(previous);
  const reads = engine.reads;
  engine.onRemoteChange?.([PATH]);
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
