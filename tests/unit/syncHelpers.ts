import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { vi } from 'vitest';
import { serializePage } from '../../src/ink/svg';
import type { Stroke } from '../../src/ink/types';
import { AuthError, ConflictError, errorFor, OfflineError, RateLimitError } from '../../src/sync/github';
import { PathNotAllowedError } from '../../src/sync/paths';
import { SyncEngine, type SyncClient } from '../../src/sync/engine';
import { openStore, type Store } from '../../src/sync/store';

// Alles hier ist erfunden. Es geht keine Anfrage ins Netz: Der Client ist ein Fake mit Dateien im Speicher.

export const A = '05 Daily Notes/2026-10-29.md';
export const B = '05 Daily Notes/2026-10-30.md';
export const S = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';

type Op = 'get' | 'put' | 'delete' | 'head' | 'changed';

/** Der Fehler, den der echte Client für eine Antwort mit diesem Status wirft (zum Beispiel 404 oder 500). */
export const httpError = (status: number, body = ''): Error => errorFor(status, new Headers(), body);

/** Echte Ereignisschleife: setImmediate gehört nicht zu den gefälschten Timern, fake-indexeddb läuft damit weiter. */
export const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Ein paar echte Runden, damit Arbeit im Hintergrund fertig wird, die nichts Sichtbares auslöst. */
export async function quiet(rounds = 40): Promise<void> {
  for (let i = 0; i < rounds; i++) await tick();
}

/** Wartet (ohne Fake-Zeit), bis die Bedingung gilt. Die Engine arbeitet mit IndexedDB und braucht dafür echte Runden. */
export async function until(cond: () => boolean | Promise<boolean>, what = 'Bedingung'): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (await cond()) return;
    await tick();
  }
  throw new Error(`${what} wurde nie erfüllt`);
}

/**
 * Fake für GitHub: wie bei GitHub schlägt `putFile` mit `ConflictError` fehl, wenn die sha nicht zum Stand der Datei
 * passt (auch beim Anlegen einer Datei, die es schon gibt). `files` darf der Test direkt ändern.
 */
export class FakeClient implements SyncClient {
  files: Record<string, { text: string; sha: string }> = {};
  offline = false;
  auth = true;
  rateLimit = false;
  /** Pfade, für die jede Anfrage `PathNotAllowedError` wirft. */
  forbidden = new Set<string>();
  /** Pfade, die sich nicht als UTF-8 lesen lassen (`getFile` wirft einen TypeError wie der echte Client). */
  broken = new Set<string>();
  /** Fehler, den `putFile` für einen Pfad immer wirft. */
  putErrors = new Map<string, Error>();
  /** Fehler, den `putFile` für einen Pfad nur beim nächsten Mal wirft (zum Beispiel ein 409, obwohl die sha stimmt). */
  putErrorOnce = new Map<string, Error>();
  /** Wird bei jeder Anfrage aufgerufen, bevor sie antwortet. Die Zeile ist der Logeintrag, zum Beispiel `get <Pfad>`. */
  before?: (line: string) => void;
  /** Anfragearten, die nie antworten. */
  hang = new Set<Op>();
  head = 'h0';
  changes: string[] = [];
  /** Fehler, den `changedFiles` wirft (zum Beispiel, weil GitHub den alten Commit nicht mehr kennt). */
  changedError?: Error;
  /** Alle Anfragen in der Reihenfolge, zum Beispiel `put 05 Daily Notes/2026-10-29.md s1`. */
  log: string[] = [];
  /** Die Anfragen, die zu Ende sind (beantwortet oder gescheitert), in der Reihenfolge ihres Endes. */
  done: string[] = [];
  messages: string[] = [];
  changedArgs: [string, string][] = [];
  maxActive = 0;

  private active = 0;
  private counter = 0;
  private holds = new Map<Op, { reached: () => void; gate: Promise<void> }>();
  private pauses = new Map<Op, { reached: () => void; gate: Promise<void> }>();

  /** Hält die nächste Anfrage dieser Art nach getaner Arbeit an, bis `release()` aufgerufen wird. */
  hold(op: Op): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
    this.holds.set(op, { reached, gate });
    return { reached: reachedPromise, release };
  }

  /**
   * Hält die nächste Anfrage dieser Art an, noch bevor sie ankommt: Sie ist unterwegs, und was dann gilt, entscheidet
   * sich erst nach `release()`. (`hold` dagegen hält an, nachdem GitHub die Anfrage schon bearbeitet hat.)
   */
  pause(op: Op): { reached: Promise<void>; release: () => void } {
    let release!: () => void;
    let reached!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const reachedPromise = new Promise<void>((resolve) => (reached = resolve));
    this.pauses.set(op, { reached, gate });
    return { reached: reachedPromise, release };
  }

  count(op: Op): number {
    return this.log.filter((line) => line === op || line.startsWith(`${op} `)).length;
  }

  /** Wie viele Anfragen dieser Art zu Ende sind. Wer auf Abwesenheit prüft, wartet erst, bis die Arbeit sicher durch ist. */
  finished(op: Op): number {
    return this.done.filter((line) => line === op || line.startsWith(`${op} `)).length;
  }

  private async run<T>(op: Op, path: string | undefined, work: () => T, detail = ''): Promise<T> {
    const line = path === undefined ? op : `${op} ${path}${detail}`;
    this.log.push(line);
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    try {
      await Promise.resolve();
      this.before?.(line);
      const pause = this.pauses.get(op);
      if (pause) {
        this.pauses.delete(op);
        pause.reached();
        await pause.gate;
      }
      if (this.offline) throw new OfflineError();
      if (!this.auth) throw new AuthError();
      if (this.rateLimit) throw new RateLimitError();
      if (path !== undefined && this.forbidden.has(path)) throw new PathNotAllowedError(path);
      if (this.hang.has(op)) await new Promise<never>(() => undefined);
      const result = work();
      const hold = this.holds.get(op);
      if (hold) {
        this.holds.delete(op);
        hold.reached();
        await hold.gate;
      }
      return result;
    } finally {
      this.active--;
      this.done.push(line);
    }
  }

  getFile(path: string) {
    return this.run('get', path, () => {
      if (this.broken.has(path)) throw new TypeError('The encoded data was not valid for encoding utf-8');
      const file = this.files[path];
      return file ? { text: file.text, sha: file.sha } : null;
    });
  }

  putFile(path: string, text: string, sha: string | null, message: string) {
    return this.run('put', path, () => {
      const once = this.putErrorOnce.get(path);
      if (once) {
        this.putErrorOnce.delete(path);
        throw once;
      }
      const error = this.putErrors.get(path);
      if (error) throw error;
      // Wie GitHub: Eine Datei, die es nicht gibt, lässt sich mit einer sha nicht ändern (404). Ohne sha wird sie angelegt.
      if (sha !== null && !this.files[path]) throw httpError(404);
      if ((this.files[path]?.sha ?? null) !== sha) throw new ConflictError();
      const next = `s${++this.counter + 100}`;
      this.files[path] = { text, sha: next };
      this.messages.push(message);
      return { sha: next };
    }, ` ${sha}`);
  }

  deleteFile(path: string, sha: string, message: string) {
    return this.run('delete', path, () => {
      const file = this.files[path];
      // Wie der echte Client: Eine fehlende Datei ist ein allgemeiner Fehler mit Status 404.
      if (!file) throw httpError(404);
      if (file.sha !== sha) throw new ConflictError();
      delete this.files[path];
      this.messages.push(message);
    }, ` ${sha}`);
  }

  listDir() {
    return Promise.resolve([]);
  }

  headSha() {
    return this.run('head', undefined, () => this.head);
  }

  changedFiles(base: string, head: string) {
    return this.run('changed', undefined, () => {
      this.changedArgs.push([base, head]);
      if (this.changedError) throw this.changedError;
      return [...this.changes];
    });
  }
}

/** Ein Strich für Seiten in Tests. */
export function stroke(id: string, x = 10, y = 10): Stroke {
  return {
    id,
    tool: 'kugel',
    color: 'schwarz',
    widthMm: 0.2,
    t: 1,
    w: 1.2,
    pts: [
      { x, y, w: 1.2 },
      { x: x + 10, y: y + 5, w: 1.2 },
    ],
  };
}

/** Eine Tagesseite mit Strichen, so wie die App sie schreibt (ohne Felder, alle Striche in der Gruppe „frei“). */
export function svgPage(...ids: string[]): string {
  const strokes = ids.map((id, i) => stroke(id, 10 + i * 20, 10 + i * 20));
  return serializePage({ kind: 'tag', key: '2026-10-29', meta: {}, strokes }, [], '<rect width="10" height="10"/>');
}

/** Die erste Seite einer Besprechung am selben Tag. */
export const M = '07 Anhänge/Notizbuch/2026/2026-10-29 0800 Abstimmung Beispiel 2027 S1.svg';
const MEETING = '2026-10-29 0800 Abstimmung Beispiel 2027';

/** Eine Besprechungsseite mit den Kopfdaten, die die App schreibt, und Strichen (ohne Felder, wie `svgPage`). */
export function meetingPage(meta: Record<string, string>, ...ids: string[]): string {
  const full = { thema: 'Abstimmung Beispiel 2027', datum: '2026-10-29', zeit: '08:00', ort: '', projekt: '', seitennr: '1', ...meta };
  const strokes = ids.map((id, i) => stroke(id, 10 + i * 20, 10 + i * 20));
  return serializePage({ kind: 'besprechung', key: MEETING, meta: full, strokes }, [], '<rect width="10" height="10"/>');
}

export type Harness = {
  fake: FakeClient;
  store: Store;
  e: SyncEngine;
  conflicts: { path: string; copyPath: string }[];
  remoteChanges: string[][];
  errors: { path: string; error: unknown }[];
  /** Zweite Engine auf derselben Datenbank, wie nach einem Neustart der App oder in einem zweiten Tab. */
  restart(): Promise<SyncEngine>;
  dispose(): Promise<void>;
};

/**
 * Frischer Speicher (neue IDBFactory), Fake-Timer ohne setImmediate und eine Engine mit Fake-Client.
 * `Date` ist gefälscht und steht auf dem 29.10.2026, 08:00 Uhr Wiener Zeit.
 */
export async function setupHarness(): Promise<Harness> {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date('2026-10-29T07:00:00Z'));
  const fake = new FakeClient();
  const store = await openStore();
  const e = new SyncEngine({ client: fake, store, device: 'iPad' });
  const conflicts: Harness['conflicts'] = [];
  const remoteChanges: string[][] = [];
  const errors: Harness['errors'] = [];
  const wire = (engine: SyncEngine) => {
    engine.onConflict = (i) => conflicts.push(i);
    engine.onRemoteChange = (paths) => remoteChanges.push(paths);
    engine.onError = (i) => errors.push(i);
  };
  wire(e);
  const engines = [e];
  const stores = [store];
  return {
    fake,
    store,
    e,
    conflicts,
    remoteChanges,
    errors,
    async restart() {
      const opened = await openStore();
      stores.push(opened);
      const next = new SyncEngine({ client: fake, store: opened, device: 'iPad' });
      wire(next);
      engines.push(next);
      return next;
    },
    async dispose() {
      for (const engine of engines) engine.stop();
      await quiet(20); // Abgleiche im Hintergrund laufen noch aus, bevor die Datenbank schließt
      for (const opened of stores) opened.close();
      vi.useRealTimers();
    },
  };
}
