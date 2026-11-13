import { mergePages, PageTooNewError, parsePage, serializePage } from '../ink/svg';
import type { FieldBox, Page, Stroke } from '../ink/types';
import type { SyncEngine } from '../sync/engine';
import { normalizePath, PathNotAllowedError } from '../sync/paths';

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
export type SessionEngine = Pick<SyncEngine, 'read' | 'write' | 'addRemoteChangeListener'>;

/**
 * `bereit`: die Seite ist gelesen. `unlesbar`: die Datei ist kaputt (sie lässt sich nicht als Seite lesen) und wird nie
 * geschrieben. `zuNeu`: die Datei stammt aus einer neueren Version der App, die diese nicht lesen kann. Sie wird wie eine
 * unlesbare nie geschrieben. `gesperrt`: Die Pfadsperre lässt die Datei nicht zu (zum Beispiel eine von Hand getippte Adresse einer
 * Besprechung mit einem Wort wie Passwort im Thema). Sie wird nie gelesen und nie geschrieben, ein neuer Versuch ändert
 * daran nichts. `nichtGeladen`: das Lesen ist gescheitert (zum Beispiel ein Fehler von GitHub). Die Seite bleibt gesperrt,
 * bis ein neuer Versuch gelingt.
 */
export type Phase = 'laden' | 'bereit' | 'unlesbar' | 'zuNeu' | 'gesperrt' | 'nichtGeladen';

type Options = {
  engine: SessionEngine;
  /** Pfad der Seitendatei im Vault. */
  path: string;
  /** Die Seite, solange es die Datei noch nicht gibt. */
  emptyPage: () => Page;
  /** Nur ansehen: Die Fläche bleibt gesperrt, es wird nie geschrieben. */
  readOnly: boolean;
  /**
   * Die Fläche zeigt beim Anlegen schon einen gelesenen Stand der Seite (die Vorschau beim Weiterscrollen). Dann ist sie
   * sofort frei (Entwurf), geschrieben wird aber erst nach dem ersten gelungenen Lesen. Gilt nicht mit `readOnly`.
   */
  draft?: boolean;
  /** Felder und Hintergrund der Seite, so wie sie in die Datei geschrieben wird (siehe `serializePage`). Jede Seite hat ihre eigenen. */
  fields: FieldBox[];
  background: string;
  /**
   * Ergänzt eine Seite, die gelesen wurde, um das, was ihr fehlt (bei Besprechungen Kopfdaten, die eine ältere Datei nicht
   * hat). Auf ihr Ergebnis angewendet, muss es dieselbe Seite ergeben. Gelesen wird dadurch nichts geschrieben: Die
   * Ergänzung kommt mit der nächsten Änderung in die Datei.
   */
  completePage?: (page: Page) => Page;
  /**
   * Felder und Hintergrund passend zu den Kopfdaten einer Seite, für Seiten, deren Hintergrund ihre Kopfdaten zeigt. Jede
   * Fassung, die geschrieben wird, bekommt die zu ihren eigenen Kopfdaten. Ohne diese Angabe gelten `fields` und `background`.
   */
  layoutFor?: (meta: Record<string, string>) => { fields: FieldBox[]; background: string };
  /**
   * Auch bei `readOnly` wird geschrieben, was über `changed` kommt: Kopfdaten lassen sich am Firmen-PC tippen. Die Fläche
   * bleibt gesperrt, Striche kann es dort also nicht geben.
   */
  headerWritable?: boolean;
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

/**
 * Die Striche, die die Vorschau eines Nachbarn aus dem Text seiner Datei zeigt (`null`: es gibt sie nicht), in der Reihenfolge,
 * in der die Sitzung sie liest (`readPage`). Wird der Nachbar durch Weiterscrollen zur offenen Seite, beginnt sein Entwurf damit:
 * Bringt das Lesen nichts Neues, zeigt die Fläche dieselbe Seite, und der Verlauf für Rückgängig bleibt (siehe `samePage`).
 */
export function previewStrokes(text: string | null): Stroke[] {
  return text === null ? [] : readPage(text).strokes;
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

// Die Sitzung einer Seite, die im Entwurf verlassen wird, bevor ihre Datei gelesen ist, macht ihn noch fertig (siehe `close`).
// Was sie dabei hinterlässt, gilt für die nächsten Sitzungen derselben Datei, aber nur mit derselben Engine: Jeder Eintrag führt
// die Engine seiner Sitzung mit, denn sie gehört zu einem Repository, und der Pfad eines Tages ist in jedem derselbe. Eine
// Sitzung einer anderen Engine wartet nicht auf ihn, übernimmt nichts daraus und ändert ihn nicht. Pfade werden mit
// `normalizePath` verglichen.

/** Wozu ein Eintrag gehört: zur Datei `path` (mit `normalizePath`) in der Engine `engine`. */
type Owner = { engine: SessionEngine; path: string };

/**
 * Verlassene Sitzungen, die ihren Entwurf noch fertig machen. `done` ist erfüllt, wenn er geschrieben und der Schreibauftrag
 * beendet ist, oder wenn er aufgehoben oder aufgegeben ist. Dann ist der Eintrag weg. Eine neue Sitzung derselben Datei und
 * Engine liest erst danach: Sonst schrieben zwei Sitzungen dieselbe Datei, und die spätere überschriebe die frühere.
 */
const finishing: (Owner & { done: Promise<void> })[] = [];

/**
 * Entwürfe verlassener Seiten, die sich nicht laden oder nicht speichern ließen, je Datei und Engine höchstens einer. Die
 * nächste Sitzung derselben Datei und Engine, die schreibt, nimmt ihn beim ersten gelungenen Lesen heraus. Sie liegen nur im
 * Arbeitsspeicher: Wird die App vorher beendet, sind sie weg.
 */
const parked: (Owner & { page: Page })[] = [];

/** Findet die Einträge der Datei `path` in der Engine `engine`. */
const ownedBy =
  (engine: SessionEngine, path: string) =>
  (entry: Owner): boolean =>
    entry.engine === engine && entry.path === path;

/** Nimmt einen Eintrag aus seiner Liste, wenn er noch darin steht. */
function remove<T>(list: T[], entry: T): void {
  const at = list.indexOf(entry);
  if (at !== -1) list.splice(at, 1);
}

/**
 * Erfüllt, sobald keine verlassene Sitzung der Engine `engine` mehr ihren Entwurf fertig macht, auch keine, die erst während des
 * Wartens dazukam. Dann steht jeder dieser Entwürfe in der Warteschlange der Engine, ist aufgehoben (siehe `parkedPaths`) oder
 * aufgegeben (eine kaputte Datei). Für den Wechsel des Repositorys. Wirft nie.
 */
export async function draftsSettled(engine: SessionEngine): Promise<void> {
  let left = finishing.filter((entry) => entry.engine === engine);
  while (left.length > 0) {
    await Promise.all(left.map((entry) => entry.done));
    left = finishing.filter((entry) => entry.engine === engine);
  }
}

/**
 * Die Dateien (mit `normalizePath`, sortiert), deren Entwurf eine verlassene Seite der Engine `engine` aufgehoben hat, je Datei
 * einer. Diese Entwürfe stehen in keiner Warteschlange.
 */
export function parkedPaths(engine: SessionEngine): string[] {
  return parked
    .filter((entry) => entry.engine === engine)
    .map((entry) => entry.path)
    .sort();
}

/**
 * Offene Sitzungen, die im Entwurf eine Änderung bekommen haben: je eine Abfrage, ob die Sitzung ihren Entwurf noch hält (siehe
 * `holdsDrafts`). Beim Schließen trägt sich eine Sitzung aus, dann zählt ihr Eintrag in `finishing`.
 */
const holding = new Set<() => boolean>();

/**
 * Ob irgendwo ein Entwurf nur im Arbeitsspeicher liegt, der noch gespeichert werden kann: auf einer offenen Seite, die noch nicht
 * gelesen ist oder sich nicht laden ließ, bei einer verlassenen Seite, die ihn noch fertig macht, oder aufgehoben. Ein Neuladen
 * der App verwürfe ihn. Ein Entwurf, der nie gespeichert wird, zählt nicht: auf einer kaputten oder gesperrten Seite, auf einer
 * aus einer neueren Version und auf einer, die gelöscht wird.
 */
export function holdsDrafts(): boolean {
  return finishing.length > 0 || parked.length > 0 || [...holding].some((holds) => holds());
}

/**
 * Nur für Tests: Gibt zurück, was verlassene Seiten hinterlassen haben (die Pfade je Wert), und vergisst es. Nach einem Test
 * muss beides leer sein: Was dort liegen bleibt, bekäme die nächste Sitzung derselben Datei. Offene Sitzungen eines Tests
 * vergisst es ohne Meldung: Sie dürfen offen bleiben, sollen aber `holdsDrafts` im nächsten Test nicht beeinflussen.
 */
export function forgetDraftsForTests(): { finishing: string[]; parked: string[] } {
  holding.clear();
  return { finishing: finishing.splice(0).map((entry) => entry.path), parked: parked.splice(0).map((entry) => entry.path) };
}

export class PageSession {
  readonly #o: Options;
  readonly #stopListening: () => void;
  #closed = false;
  /** Die Seite wird gelöscht: Von ihr wird nichts mehr geschrieben und nichts mehr gelesen. */
  #retired = false;
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
  /**
   * Der Text, den die Sitzung zuletzt von der Engine gelesen oder dorthin geschrieben hat, und von dem aus die Fläche
   * weiterentwickelt wurde. Beim Zusammenführen ist er der gemeinsame Ausgangspunkt: Daran sieht `mergePages`, was hier
   * und was anderswo geändert wurde. Ein Speichern, das scheiterte, rückt ihn nicht weiter. `null`, solange es ihn nicht
   * gibt und solange die Seite gesperrt ist. Im Entwurf ist er bis zum ersten Lesen die Seite, die die Fläche beim Anlegen
   * zeigte.
   */
  #base: string | null = null;
  /**
   * Die letzte Änderung im Entwurf, solange die Seite noch nicht gelesen ist. Die Engine kennt sie nicht: Beim ersten
   * gelungenen Lesen kommt sie zur Seite dazu und wird gespeichert.
   */
  #draft: Page | null = null;
  /** Die Seite war schon einmal gelesen (`bereit`). */
  #loaded = false;
  /** Worauf das erste Lesen wartet: verlassene Sitzungen derselben Datei und Engine, die beim Anlegen noch ihren Entwurf fertig machten. */
  #before: Promise<void> | undefined;
  /**
   * Ob die Sitzung einen Entwurf hält, der noch gespeichert werden kann (siehe `holdsDrafts`): Die Seite ist noch nicht gelesen
   * oder ließ sich nicht laden. Eine kaputte, gesperrte oder zu neue Seite wird nie geschrieben. Eine gelöschte hat keinen
   * Entwurf mehr (siehe `retire`).
   */
  readonly #holdsDraft = (): boolean => this.#draft !== null && (this.#phase === 'laden' || this.#phase === 'nichtGeladen');

  constructor(o: Options) {
    this.#o = o;
    const left = finishing.filter(ownedBy(o.engine, normalizePath(o.path)));
    if (left.length > 0) this.#before = Promise.all(left.map((entry) => entry.done)).then(() => undefined);
    if (this.#drafting()) {
      // Ausgangspunkt für das Zusammenführen beim ersten Lesen ist die Seite, die die Fläche jetzt zeigt.
      this.#base = this.#serialize(o.surface.getPage());
      o.surface.setReadOnly(false);
    } else o.surface.setReadOnly(true);
    this.#stopListening = o.engine.addRemoteChangeListener((paths) => {
      if (paths.some((changed) => normalizePath(changed) === normalizePath(o.path))) void this.reload();
    });
  }

  /**
   * Die Fläche meldet eine Änderung. Sie geht sofort an die Engine, noch im Ereignis des Stifts. Im Entwurf merkt sich die
   * Sitzung die Seite, bis sie gelesen ist.
   */
  changed(page: Page): void {
    this.#version++;
    if (this.#writable()) this.#save(page);
    else if (this.#drafting()) {
      this.#draft = page;
      holding.add(this.#holdsDraft);
    }
  }

  /**
   * Liest die Seite (neu) und zeigt sie. Anfragen, die während eines Lesens eintreffen, lösen genau ein weiteres Lesen
   * aus. Der Aufruf endet, wenn alles gelesen ist, und wirft nie.
   */
  reload(): Promise<void> {
    if (this.#retired) return Promise.resolve();
    if (this.#reloading) {
      this.#again = true;
      return this.#reloading;
    }
    const run = (async () => {
      try {
        do {
          this.#again = false;
          await this.#readAndShow();
        } while (this.#again && !this.#stopped());
      } finally {
        this.#reloading = null;
      }
    })();
    this.#reloading = run;
    return run;
  }

  /**
   * Die Seite wird verlassen: Was noch zu speichern ist, wird gespeichert. Hochladen macht die Engine nach ihrer Wartezeit oder
   * sofort, wenn die App in den Hintergrund geht. Ein Wechsel der Seite allein lädt nichts hoch. Ein Entwurf, dessen Seite
   * noch nicht gelesen ist, wird noch fertig (siehe `#finishDraft`), ohne dass die Sitzung die Fläche noch anfasst. Lässt er
   * sich auch beim letzten Versuch nicht speichern, wird er aufgehoben (siehe `#park`).
   */
  close(): void {
    this.#closed = true;
    this.#stopListening();
    this.#stopWaitingForCue();
    holding.delete(this.#holdsDraft); // ein Entwurf, den sie noch fertig macht, zählt in `finishing`
    const hasDraft = this.#draft !== null;
    const done = (async () => {
      if (hasDraft) await this.#finishDraft();
      await this.#idle();
      // Was sich nicht speichern ließ, bekommt einen letzten Versuch, bevor die Seite verschwindet.
      if (this.#next !== null) await this.#startWriting();
      // Scheitert auch der bei einem Entwurf, wird er aufgehoben wie nach einem gescheiterten Lesen: Die Meldung, dass das
      // Speichern scheiterte, kann eine Seite nie zeigen, die vor dem Lesen verlassen wurde.
      if (hasDraft && this.#next !== null) {
        this.#park(readPage(this.#next));
        this.#next = null;
      }
    })().catch(() => undefined);
    if (!hasDraft) return;
    // Bis dahin wartet eine neue Sitzung derselben Datei und Engine mit dem Lesen.
    const entry = { engine: this.#o.engine, path: normalizePath(this.#o.path), done };
    finishing.push(entry);
    void done.then(() => remove(finishing, entry));
  }

  /**
   * Die Seite wird gelöscht. Von jetzt an schreibt die Sitzung nichts mehr, auch nicht, was noch auf einen neuen Versuch
   * wartete oder im Entwurf steht, und sie liest nicht mehr. Der Aufruf endet, wenn kein Schreibauftrag mehr läuft: Erst
   * danach darf die Datei gelöscht werden, sonst legte ihn der laufende Auftrag wieder an. Die Fläche bleibt gesperrt.
   */
  async retire(): Promise<void> {
    this.#retired = true;
    this.#next = null;
    this.#draft = null;
    this.#o.surface.setReadOnly(true);
    await this.#idle();
  }

  /**
   * Die Sitzung hat nichts mehr mit der Seite zu tun: Sie ist geschlossen und hat keinen Entwurf mehr fertig zu machen, oder
   * die Seite wird gelöscht.
   */
  #stopped(): boolean {
    return this.#retired || (this.#closed && this.#draft === null);
  }

  /**
   * Im Entwurf, bis die Seite zum ersten Mal gelesen ist: Änderungen werden nicht geschrieben, sondern gemerkt (`#draft`).
   * Nach dem Schließen kommt keine mehr dazu.
   */
  #drafting(): boolean {
    return this.#o.draft === true && !this.#o.readOnly && !this.#loaded && !this.#closed && !this.#retired;
  }

  /** Ob die Sitzung schreibt, sobald die Seite gelesen ist. Wo nur angesehen wird, schreibt sie höchstens Kopfdaten. */
  #writer(): boolean {
    return !this.#retired && (!this.#o.readOnly || this.#o.headerWritable === true);
  }

  #writable(): boolean {
    return this.#phase === 'bereit' && this.#writer();
  }

  // ---------- Speichern ----------
  // Immer nur ein Schreibauftrag an die Engine zugleich, in der Reihenfolge der Änderungen. Kommt während eines
  // Auftrags eine neuere Fassung, zählt allein sie. Der erste Auftrag startet noch im Aufruf von `changed`. Nur
  // `#drain` ruft `engine.write` auf, und nur, solange die Seite beschreibbar ist.

  /** Der Text der Datei: Felder und Hintergrund der Seite sind bei jedem Schreiben dabei, auch beim Zusammenführen. */
  #serialize(page: Page): string {
    const { fields, background } = this.#o.layoutFor?.(page.meta) ?? this.#o;
    return serializePage(page, fields, background);
  }

  /**
   * Der Ausgangspunkt für `mergePages`, gelesen wie die Seite, die gezeigt wird: Was `completePage` ergänzt (Kopfdaten, die
   * eine ältere Datei nicht hat), ist keine Änderung dieser Sitzung und darf nicht gegen die Änderung eines anderen Geräts
   * gewinnen. Ohne Ausgangspunkt, oder wenn er sich nicht lesen lässt, gibt es keinen: Dann werden die Striche vereint, und
   * bei den Kopfdaten gilt, was der gelesene Text angibt.
   */
  #baseText(base: string | null): string | undefined {
    if (base === null) return undefined;
    try {
      const page = readPage(base);
      return this.#serialize(this.#o.completePage ? this.#o.completePage(page) : page);
    } catch {
      return undefined;
    }
  }

  #save(page: Page): void {
    this.#next = this.#serialize(page);
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
          // Ist die Seite inzwischen gesperrt, steht in der Engine keine Fassung, auf der dieser Text beruht (siehe `#lock`).
          if (this.#phase === 'bereit') this.#base = text;
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
  // währenddessen geschrieben, bleiben beide Fassungen erhalten: Zusammengeführt wird vom Text aus, den die Sitzung vor dem
  // Lesen zuletzt kannte (`#base`). Was hier geändert wurde, bleibt, was nur die Engine geändert hat, kommt dazu, und ein
  // Strich, der auf einer Seite radiert wurde, bleibt weg. Ein Entwurf kommt beim ersten gelungenen Lesen ebenso dazu.

  async #readAndShow(): Promise<void> {
    if (this.#stopped()) return;
    // Macht eine verlassene Sitzung derselben Datei und Engine noch ihren Entwurf fertig, wird erst danach gelesen (siehe `finishing`).
    const before = this.#before;
    if (before) {
      this.#before = undefined;
      await before;
      if (this.#stopped()) return;
    }
    const seen = this.#version;
    if (this.#next !== null) void this.#startWriting(); // ein Text, der nicht gespeichert werden konnte
    await this.#idle(); // alles, was schon geschrieben wurde, steht dann in der Engine
    // Steht jetzt noch etwas aus, kennt die Engine die neuesten Striche der Fläche nicht: Sie bleiben zusätzlich zur Seite.
    const unsaved = this.#next !== null;
    // Der Ausgangspunkt gilt von jetzt an, nicht erst nach dem Lesen: Was während des Lesens geschrieben wird, steht in
    // `#base` schon, in dem gelesenen Text aber vielleicht noch nicht. Es wäre sonst ein Strich, den die Engine nicht hat,
    // und der Strich zählte als dort radiert.
    const base = this.#base;
    let text: string | null;
    try {
      text = await this.#o.engine.read(this.#o.path);
    } catch (error) {
      this.#lock(error instanceof PathNotAllowedError ? 'gesperrt' : 'nichtGeladen');
      return;
    }
    if (this.#stopped()) return;
    this.#base = text;
    // Einen Entwurf kennt die Engine so wenig wie einen Text, der nicht gespeichert werden konnte.
    const draft = this.#draft;
    // Der aufgehobene Entwurf einer verlassenen Seite (siehe `#parkedEntry`). Er gehört zur gelesenen Seite wie Striche, die
    // dieses Gerät noch nicht gespeichert hat: vereint, ohne Ausgangspunkt.
    const waiting = this.#parkedEntry();
    const parkedDraft = waiting?.page;
    let page: Page;
    let united = false;
    try {
      let theirs = text;
      if (parkedDraft) theirs = text === null ? this.#serialize(parkedDraft) : mergePages(this.#serialize(parkedDraft), text);
      page = theirs === null ? this.#o.emptyPage() : readPage(theirs);
      if (this.#version !== seen || unsaved || draft) {
        // Unsere Fassung ist die Fläche. Eine geschlossene Sitzung kommt nur mit Entwurf bis hierher, und die Fläche gibt es
        // dann nicht mehr: Dann ist es der Entwurf, das, was sie zuletzt gemeldet hat.
        const ours = this.#closed && draft ? draft : this.#o.surface.getPage();
        if (theirs === null) page = ours;
        else {
          page = readPage(mergePages(this.#serialize(ours), theirs, this.#baseText(base)));
          united = true;
        }
      }
      if (this.#o.completePage) page = this.#o.completePage(page);
    } catch (error) {
      this.#lock(error instanceof PageTooNewError ? 'zuNeu' : 'unlesbar');
      return;
    }
    if (waiting) remove(parked, waiting);
    this.#phase = 'bereit';
    this.#loaded = true;
    this.#stopWaitingForCue();
    if (!this.#closed) {
      // Hat sich nichts geändert, bleibt der Verlauf für Rückgängig erhalten.
      if (!samePage(this.#o.surface.getPage(), page)) this.#o.surface.setPage(page);
      this.#o.surface.setReadOnly(this.#o.readOnly);
    }
    if ((united || unsaved || draft || parkedDraft) && this.#writable()) this.#save(page);
    this.#draft = null; // er steht jetzt im Schreibauftrag
    if (!this.#closed) this.#o.onPhase('bereit');
  }

  /**
   * Die Seite ist nicht benutzbar. Sie bleibt gesperrt und wird nicht geschrieben. Was noch vorgemerkt war, geht nicht
   * verloren: Es bleibt vorgemerkt und kommt zur Seite, sobald sie sich wieder lesen lässt (siehe `#readAndShow`), ebenso
   * ein Entwurf. Ist die Datei kaputt, bleibt es gesperrt, bis ein anderes Gerät sie ändert. Lässt die Pfadsperre sie nicht
   * zu, bleibt es für immer gesperrt. Ließ sie sich nur nicht laden, wird neu versucht, sobald es Sinn hat.
   */
  #lock(phase: 'unlesbar' | 'zuNeu' | 'gesperrt' | 'nichtGeladen'): void {
    if (this.#stopped()) return;
    this.#phase = phase;
    // Eine Seite, die sich nicht lesen lässt, hat keinen Ausgangspunkt: Was die Fläche zeigt, beruht nicht auf dem, was jetzt
    // in der Engine steht. Gelingt das Lesen wieder, kommt zusammen, was beide haben, und nichts gilt als radiert.
    this.#base = null;
    // Eine verlassene Seite im Entwurf: Ließ sie sich nicht laden, wartet der Entwurf auf die nächste Sitzung derselben Datei
    // und Engine (siehe `#park`), in eine kaputte oder gesperrte Datei kommt er nie. So oder so hört die Sitzung auf und wartet
    // auf keinen Anlass.
    if (this.#closed) {
      if (phase === 'nichtGeladen') this.#parkDraft();
      else this.#draft = null;
      return;
    }
    this.#o.surface.setReadOnly(true);
    if (phase === 'nichtGeladen') this.#waitForCue();
    else this.#stopWaitingForCue();
    this.#o.onPhase(phase);
  }

  /**
   * Die Seite wird im Entwurf verlassen, bevor sie gelesen ist. Das Lesen, das läuft oder noch aussteht, macht ihn fertig:
   * Gelingt es, wird zusammengeführt und gespeichert, sonst geparkt oder aufgegeben (siehe `#lock`). Ließ sich die Seite
   * schon nicht laden, wird er gleich geparkt. Ist die Datei kaputt oder gesperrt, wird er nie geschrieben.
   */
  async #finishDraft(): Promise<void> {
    if (this.#reloading || this.#phase === 'laden') await (this.#reloading ?? this.reload());
    else if (this.#phase === 'nichtGeladen') this.#parkDraft();
    else this.#draft = null;
  }

  /** Hebt den Entwurf auf (siehe `#park`), wenn es einen gibt. Die Sitzung hat ihn danach nicht mehr. */
  #parkDraft(): void {
    const draft = this.#draft;
    this.#draft = null;
    if (draft) this.#park(draft);
  }

  /**
   * Hebt `draft` für die nächste Sitzung derselben Datei und Engine auf (siehe `parked`). Liegt dort schon einer derselben
   * Engine (auch die nächste Sitzung konnte die Seite nicht laden), kommen beide zusammen: alle Striche, die einer von beiden hat.
   */
  #park(draft: Page): void {
    const engine = this.#o.engine;
    const path = normalizePath(this.#o.path);
    const waiting = parked.find(ownedBy(engine, path));
    if (!waiting) {
      parked.push({ engine, path, page: draft });
      return;
    }
    const mine = new Set(draft.strokes.map((s) => s.id));
    waiting.page = { ...draft, strokes: [...draft.strokes, ...waiting.page.strokes.filter((s) => !mine.has(s.id))] };
  }

  /**
   * Der aufgehobene Entwurf einer verlassenen Seite derselben Datei und Engine (siehe `#park`), der beim ersten gelungenen Lesen
   * dazukommt, oder `undefined`. Nur eine Sitzung, die schreibt, nimmt ihn: Eine, die nur ansieht, ließe ihn sonst fallen.
   */
  #parkedEntry(): (Owner & { page: Page }) | undefined {
    if (this.#loaded || !this.#writer()) return undefined;
    return parked.find(ownedBy(this.#o.engine, normalizePath(this.#o.path)));
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
