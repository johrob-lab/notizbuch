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
  /** Sperrt die Fläche (`true`) oder gibt sie frei. Beim Sperren endet, was gerade entsteht, ohne gespeichert zu werden. */
  setReadOnly(on: boolean): void;
};

/** Was die Sitzung von der Engine braucht. */
export type SessionEngine = Pick<SyncEngine, 'read' | 'write' | 'flush' | 'addRemoteChangeListener'>;

/**
 * `bereit`: die Seite ist gelesen. `unlesbar`: die Datei ist kaputt (sie lässt sich nicht als Seite lesen) und wird nie
 * geschrieben. `nichtGeladen`: das Lesen ist gescheitert (zum Beispiel ein Fehler von GitHub). Die Seite bleibt gesperrt,
 * bis ein neuer Versuch gelingt.
 */
export type Phase = 'laden' | 'bereit' | 'unlesbar' | 'nichtGeladen';

type Options = {
  engine: SessionEngine;
  /** Pfad der Seitendatei im Vault. */
  path: string;
  /** Die Seite, solange es die Datei noch nicht gibt. */
  emptyPage: () => Page;
  /** Nur ansehen: Die Fläche bleibt gesperrt, es wird nie geschrieben. */
  readOnly: boolean;
  surface: PageSurface;
  /**
   * Meldet `retry`, sobald ein neuer Versuch Sinn hat, eine Seite zu laden, die sich nicht laden ließ, und gibt die
   * Abmeldung zurück. Die Sitzung hört nur zu, solange die Seite `nichtGeladen` ist. Ohne diese Angabe gibt es nur
   * die Versuche, die jemand mit `reload()` anstößt (fremde Änderungen).
   */
  retryCues?: (retry: () => void) => () => void;
  /** Die Seite wurde gelesen (und gezeigt) oder ließ sich nicht lesen. Kommt nach jedem Lesen, auch nach fremden Änderungen. */
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
  readonly #stopListening: () => void;
  #closed = false;
  /** Bis die Seite gelesen ist, wird nicht geschrieben: Sonst entstünde neben einer Seite, die man noch nicht sieht, eine zweite. */
  #phase: Phase = 'laden';
  /** Zählt die Änderungen, die die Fläche meldet (Strich, Radieren, Rückgängig, Wiederholen). */
  #version = 0;
  /** Die neueste Fassung, die noch nicht in der Engine steht (neu, oder weil das Speichern scheiterte). */
  #next: string | null = null;
  #writing: Promise<void> | null = null;
  #reloading: Promise<void> | null = null;
  #again = false;
  /** Meldet sich ab, wenn die Sitzung nicht mehr auf einen Anlass für einen neuen Versuch wartet. */
  #stopWaiting: (() => void) | undefined;

  constructor(o: Options) {
    this.#o = o;
    o.surface.setReadOnly(true);
    this.#stopListening = o.engine.addRemoteChangeListener((paths) => {
      if (paths.some((changed) => normalizePath(changed) === normalizePath(o.path))) void this.reload();
    });
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
    this.#stopListening();
    this.#stopWaitingForCue();
    void (async () => {
      await this.#idle();
      // Was sich nicht speichern ließ, bekommt einen letzten Versuch, bevor die Seite verschwindet.
      if (this.#next !== null) await this.#startWriting();
      await this.#o.engine.flush();
    })().catch(() => undefined);
  }

  #writable(): boolean {
    return !this.#o.readOnly && this.#phase === 'bereit';
  }

  // ---------- Speichern ----------
  // Immer nur ein Schreibauftrag an die Engine zugleich, in der Reihenfolge der Änderungen. Kommt während eines
  // Auftrags eine neuere Fassung, zählt allein sie. Der erste Auftrag startet noch im Aufruf von `changed`. Nur
  // `#drain` ruft `engine.write` auf, und nur, solange die Seite beschreibbar ist.

  #save(page: Page): void {
    this.#next = serializePage(page, [], '');
    void this.#startWriting();
  }

  /**
   * Startet das Schreiben, wenn etwas vorgemerkt ist und die Seite beschreibbar ist, und gibt zurück, worauf man warten
   * kann. Sonst endete `#drain` sofort und räumte `#writing` noch auf, bevor es hier gesetzt wird: Es bliebe für immer stehen.
   */
  #startWriting(): Promise<void> {
    if (this.#next === null || !this.#writable()) return this.#idle();
    this.#writing ??= this.#drain();
    return this.#writing;
  }

  async #drain(): Promise<void> {
    try {
      // Wird die Seite währenddessen gesperrt, bleibt, was noch wartet, vorgemerkt: Es kommt nicht in eine kaputte Seite.
      while (this.#next !== null && this.#writable()) {
        const text = this.#next;
        this.#next = null;
        try {
          await this.#o.engine.write(this.#o.path, text, 'svg');
          if (!this.#closed) this.#o.onSaveFailed(false);
        } catch {
          if (!this.#closed) this.#o.onSaveFailed(true);
          // Kam währenddessen etwas Neueres, geht es sofort weiter damit. Sonst bleibt der Text vorgemerkt und wird nicht
          // in einer Schleife wiederholt, sondern bei der nächsten Änderung, vor dem nächsten Lesen und beim Schließen.
          if (this.#next === null) {
            this.#next = text;
            return;
          }
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
    if (this.#next !== null) void this.#startWriting(); // ein Text, der nicht gespeichert werden konnte
    await this.#idle(); // alles, was schon geschrieben wurde, steht dann in der Engine
    // Steht jetzt noch etwas aus, kennt die Engine die neuesten Striche der Fläche nicht: Sie bleiben zusätzlich zur Seite.
    const unsaved = this.#next !== null;
    let text: string | null;
    try {
      text = await this.#o.engine.read(this.#o.path);
    } catch {
      this.#lock('nichtGeladen');
      return;
    }
    if (this.#closed) return;
    let page: Page;
    let united = false;
    try {
      page = text === null ? this.#o.emptyPage() : readPage(text);
      if (this.#version !== seen || unsaved) {
        if (text === null) page = this.#o.surface.getPage();
        else {
          page = readPage(mergePages(serializePage(this.#o.surface.getPage(), [], ''), text));
          united = true;
        }
      }
    } catch {
      this.#lock('unlesbar');
      return;
    }
    this.#phase = 'bereit';
    this.#stopWaitingForCue();
    // Hat sich nichts geändert, bleibt der Verlauf für Rückgängig erhalten.
    if (!samePage(this.#o.surface.getPage(), page)) this.#o.surface.setPage(page);
    this.#o.surface.setReadOnly(this.#o.readOnly);
    if ((united || unsaved) && this.#writable()) this.#save(page);
    this.#o.onPhase('bereit');
  }

  /**
   * Die Seite ist nicht benutzbar. Sie bleibt gesperrt und wird nicht geschrieben. Was noch vorgemerkt war, geht nicht
   * verloren: Es bleibt vorgemerkt und kommt zur Seite, sobald sie sich wieder lesen lässt (siehe `#readAndShow`).
   * Ist die Datei kaputt, bleibt es gesperrt, bis ein anderes Gerät sie ändert. Ließ sie sich nur nicht laden, wird neu
   * versucht, sobald es Sinn hat.
   */
  #lock(phase: 'unlesbar' | 'nichtGeladen'): void {
    if (this.#closed) return;
    this.#phase = phase;
    this.#o.surface.setReadOnly(true);
    if (phase === 'nichtGeladen') this.#waitForCue();
    else this.#stopWaitingForCue();
    this.#o.onPhase(phase);
  }

  #waitForCue(): void {
    if (this.#stopWaiting || !this.#o.retryCues) return;
    this.#stopWaiting = this.#o.retryCues(() => void this.reload());
  }

  #stopWaitingForCue(): void {
    this.#stopWaiting?.();
    this.#stopWaiting = undefined;
  }
}
