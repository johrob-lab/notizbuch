import { mergePages, parsePage, serializePage } from '../ink/svg';
import type { Page } from '../ink/types';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';

// Die Sitzung einer Seite zwischen Schreibfläche und SyncEngine: Sie liest die Seite, speichert jede Änderung sofort
// lokal und übernimmt Änderungen von anderen Geräten. Sie kennt weder DOM noch Canvas und lässt sich darum einzeln prüfen.

/** Was die Sitzung von der Schreibfläche braucht. */
export type PageSurface = {
  getPage(): Page;
  /** Ersetzt die Seite (Striche und Kopfdaten). */
  setPage(page: Page): void;
  setReadOnly(on: boolean): void;
};

/** Was die Sitzung von der Engine braucht. */
export type SessionEngine = Pick<SyncEngine, 'read' | 'write' | 'flush' | 'onRemoteChange'>;

/** `bereit`: die Seite ist gelesen. `unlesbar`: die Datei lässt sich nicht lesen, die Seite wird nie geschrieben. */
export type Phase = 'laden' | 'bereit' | 'unlesbar';

type Options = {
  engine: SessionEngine;
  /** Pfad der Seitendatei im Vault. */
  path: string;
  /** Die Seite, solange es die Datei noch nicht gibt. */
  emptyPage: () => Page;
  /** Nur ansehen: Die Fläche bleibt gesperrt, es wird nie geschrieben. */
  readOnly: boolean;
  surface: PageSurface;
  /** Die Seite wurde gelesen (und gezeigt). Kommt nach jedem Lesen, auch nach fremden Änderungen. */
  onPhase: (phase: Exclude<Phase, 'laden'>) => void;
  /** Das Speichern auf diesem Gerät ist gescheitert (`true`) oder wieder gelungen (`false`). */
  onSaveFailed: (failed: boolean) => void;
};

/** Die Seite mit den Strichen in der Reihenfolge ihrer Entstehung. Die Datei ordnet sie nach Feldern, nicht nach der Zeit. */
function readPage(svg: string): Page {
  const page = parsePage(svg);
  return { ...page, strokes: page.strokes.slice().sort((a, b) => a.t - b.t) };
}

/** Gleiche Seite, gleiche Striche (die `id` genügt, sie ist über alle Geräte eindeutig). */
function samePage(a: Page, b: Page): boolean {
  return (
    a.kind === b.kind &&
    a.key === b.key &&
    JSON.stringify(a.meta) === JSON.stringify(b.meta) &&
    a.strokes.length === b.strokes.length &&
    a.strokes.every((s, i) => s.id === b.strokes[i].id)
  );
}

export class PageSession {
  readonly #o: Options;
  readonly #previousHandler: SessionEngine['onRemoteChange'];
  #closed = false;
  /** Bis die Seite gelesen ist, wird nicht geschrieben: Sonst entstünde neben einer Seite, die man noch nicht sieht, eine zweite. */
  #loading = true;
  #unreadable = false;
  /** Zählt die Änderungen, die die Fläche meldet (Strich, Radieren, Rückgängig, Wiederholen). */
  #version = 0;
  /** Die neueste Fassung, die noch nicht an die Engine gegangen ist. */
  #next: string | null = null;
  #writing: Promise<void> | null = null;
  #reloading: Promise<void> | null = null;
  #again = false;

  constructor(o: Options) {
    this.#o = o;
    o.surface.setReadOnly(true);
    this.#previousHandler = o.engine.onRemoteChange;
    o.engine.onRemoteChange = (paths) => {
      this.#previousHandler?.(paths);
      if (paths.some((changed) => normalizePath(changed) === normalizePath(o.path))) void this.reload();
    };
  }

  /** Die Fläche meldet eine Änderung. Sie geht sofort an die Engine, noch im Ereignis des Stifts. */
  changed(page: Page): void {
    this.#version++;
    if (this.#writable()) this.#save(page);
  }

  /**
   * Liest die Seite (neu) und zeigt sie. Anfragen, die während eines Lesens eintreffen, lösen genau ein weiteres Lesen
   * aus. Der Aufruf endet, wenn alles gelesen ist, und wirft nie.
   */
  reload(): Promise<void> {
    if (this.#reloading) {
      this.#again = true;
      return this.#reloading;
    }
    const run = (async () => {
      try {
        do {
          this.#again = false;
          await this.#readAndShow();
        } while (this.#again && !this.#closed);
      } finally {
        this.#reloading = null;
      }
    })();
    this.#reloading = run;
    return run;
  }

  /** Die Seite wird verlassen: Die Engine lädt hoch, sobald alles lokal gespeichert ist. */
  close(): void {
    this.#closed = true;
    this.#o.engine.onRemoteChange = this.#previousHandler;
    void this.#idle().then(() => this.#o.engine.flush());
  }

  #writable(): boolean {
    return !this.#o.readOnly && !this.#loading && !this.#unreadable;
  }

  // ---------- Speichern ----------
  // Immer nur ein Schreibauftrag an die Engine zugleich, in der Reihenfolge der Änderungen. Kommt während eines
  // Auftrags eine neuere Fassung, zählt allein sie. Der erste Auftrag startet noch im Aufruf von `changed`.

  #save(page: Page): void {
    this.#next = serializePage(page, [], '');
    this.#writing ??= this.#drain();
  }

  async #drain(): Promise<void> {
    try {
      while (this.#next !== null) {
        const text = this.#next;
        this.#next = null;
        try {
          await this.#o.engine.write(this.#o.path, text, 'svg');
          if (!this.#closed) this.#o.onSaveFailed(false);
        } catch {
          if (!this.#closed) this.#o.onSaveFailed(true);
        }
      }
    } finally {
      this.#writing = null;
    }
  }

  #idle(): Promise<void> {
    return this.#writing ?? Promise.resolve();
  }

  // ---------- Lesen ----------
  // Was `engine.read` liefert, gilt für die Engine als der Stand der Seite: Es muss auf der Fläche landen. Wurde
  // währenddessen geschrieben, bleiben beide Fassungen erhalten (alle Striche beider, wie beim Abgleich).

  async #readAndShow(): Promise<void> {
    if (this.#closed) return;
    const seen = this.#version;
    await this.#idle(); // alles, was schon geschrieben wurde, steht dann in der Engine
    let text: string | null;
    try {
      text = await this.#o.engine.read(this.#o.path);
    } catch {
      this.#lock();
      return;
    }
    if (this.#closed) return;
    let page: Page;
    let united = false;
    try {
      page = text === null ? this.#o.emptyPage() : readPage(text);
      if (this.#version !== seen) {
        if (text === null) page = this.#o.surface.getPage();
        else {
          page = readPage(mergePages(serializePage(this.#o.surface.getPage(), [], ''), text));
          united = true;
        }
      }
    } catch {
      this.#lock();
      return;
    }
    this.#loading = false;
    this.#unreadable = false;
    // Hat sich nichts geändert, bleibt der Verlauf für Rückgängig erhalten.
    if (!samePage(this.#o.surface.getPage(), page)) this.#o.surface.setPage(page);
    this.#o.surface.setReadOnly(this.#o.readOnly);
    if (united && this.#writable()) this.#save(page);
    this.#o.onPhase('bereit');
  }

  /** Die Seite lässt sich nicht lesen. Sie bleibt gesperrt und wird nie geschrieben. */
  #lock(): void {
    if (this.#closed) return;
    this.#loading = false;
    this.#unreadable = true;
    this.#o.surface.setReadOnly(true);
    this.#o.onPhase('unlesbar');
  }
}
