import { signal, type Signal } from '@preact/signals';
import { copyPathFor, mergeByKind } from './conflicts';
import { AuthError, ConflictError, OfflineError, RateLimitError, statusOf, withTimeout, type GitHubClient } from './github';
import { normalizePath, PathNotAllowedError } from './paths';
import type { SyncState, SyncStatus } from './status';
import { syncedRecord, type FileRecord, type OutboxEntry, type Store, type StoreTx } from './store';

export { statusLabel, type SyncState, type SyncStatus } from './status';

/**
 * Was die Engine vom Client braucht. `GitHubClient` hat private Felder, ein Fake kann die Klasse selbst darum nicht
 * erfüllen, ihre öffentlichen Methoden schon.
 */
export type SyncClient = Pick<GitHubClient, 'getFile' | 'putFile' | 'deleteFile' | 'listDir' | 'headSha' | 'changedFiles'>;

const TEXT_DELAY_MS = 2000;
const INK_DELAY_MS = 10_000;
const POLL_INTERVAL_MS = 180_000;
/** So oft versucht ein Abgleich eine Datei zusammenzuführen, die sich währenddessen schon wieder geändert hat. */
const CONFLICT_ATTEMPTS = 3;
const MAX_COPY_NUMBER = 99;
/** Alle Tabs einer Origin teilen sich die Datenbank, darum gleicht immer nur einer von ihnen ab. */
const LOCK_NAME = 'notizbuch-sync';

/**
 * Diese Engine darf nicht schreiben: Sie gehört dem zweiten Fenster eines Geräts (nur das erste schreibt), oder sie ist
 * beendet, weil das Repository gewechselt wurde. Nichts davon landet in der Warteschlange, im Speicher oder auf GitHub.
 */
export class ReadOnlyError extends Error {
  constructor(message = 'Dieses Fenster darf nicht schreiben.') {
    super(message);
    this.name = 'ReadOnlyError';
  }
}

type Remote = { text: string; sha: string };
/** Die Fassung auf GitHub, aus der der Text entstand, den die Seite gerade hält. */
type PageVersion = { sha: string | null; baseText: string | null };
type Timer = ReturnType<typeof setTimeout>;

/** Fehler, bei denen der Abgleich anhält und alles in der Warteschlange bleibt: kein Netz, Ratenlimit, kein Zugang. */
function isStop(error: unknown): boolean {
  return error instanceof AuthError || error instanceof OfflineError || error instanceof RateLimitError;
}

/** Die Bereiche, über die eine Schreib-Transaktion des Speichers geht. */
type Areas = Parameters<Store['transact']>[0];

/** Kennt GitHub den alten Commit nicht mehr, kann der Vergleich nichts liefern: 404, bei einer unbekannten sha auch 422. */
function isUnknownCommit(error: unknown): boolean {
  const status = statusOf(error);
  return status === 404 || status === 422;
}

/**
 * Der Upload beruhte auf einem Stand, den es so nicht mehr gibt: Die Datei hat sich geändert (Konflikt) oder ist weg
 * (404 auf eine sha). Ohne sha ist ein 404 nichts davon, dann stimmt etwas anderes nicht, zum Beispiel der Repo-Name.
 */
function isStaleBase(error: unknown, sentSha: string | null): boolean {
  return error instanceof ConflictError || (sentSha !== null && statusOf(error) === 404);
}

const byQueueTime = (a: OutboxEntry, b: OutboxEntry) => a.queuedAt - b.queuedAt || (a.path < b.path ? -1 : 1);

/**
 * Hält Dateien lokal und gleicht sie mit GitHub ab. Jede Änderung steht zuerst in der Warteschlange (IndexedDB) und
 * geht erst dann hoch, nichts geht beim Schließen der App verloren. Bei gleichzeitigen Änderungen wird zusammengeführt
 * oder die eigene Fassung als Konfliktkopie angelegt, nie still überschrieben.
 */
export class SyncEngine {
  readonly status: Signal<SyncStatus> = signal({ state: 'gesichert', pending: 0 });
  /** Die eigene Fassung liegt jetzt unter `copyPath`, der fremde Stand bleibt unter `path`. */
  onConflict?: (i: { path: string; copyPath: string }) => void;
  /**
   * Die lokale Fassung dieser Dateien hat sich durch fremde Änderungen geändert. Die Oberfläche soll sie neu lesen.
   * Es gibt einen Zuhörer; wer neben anderen zuhören will (mehrere Seiten sind zugleich offen), nimmt
   * `addRemoteChangeListener`.
   */
  onRemoteChange?: (paths: string[]) => void;
  /** Eine Datei ließ sich nicht abgleichen (nicht erlaubter Pfad, kaputte Datei). Ohne Datei ist `path` leer. */
  onError?: (i: { path: string; error: unknown }) => void;

  readonly #remoteListeners = new Set<(paths: string[]) => void>();
  /** Zugang und Gerät können sich ändern, während die Engine läuft (neuer Token, anderes Gerät in den Einstellungen). */
  #client: SyncClient;
  readonly #store: Store;
  #device: string;
  /** Das zweite Fenster eines Geräts: liest nur. */
  readonly #readOnly: boolean;
  /** Beendet für immer (`close`). */
  #closed = false;
  #state: SyncState = 'gesichert';
  #pending = 0;
  #flushing: Promise<void> | null = null;
  #flushAgain = false;
  /** Pfad der Änderung, die gerade hochgeladen wird. */
  #current: string | null = null;
  /**
   * Die Fassung, aus der der Text entstand, den die Seite je Datei zuletzt bekommen hat (durch `read`) oder hochgeladen
   * hat. Nur im Arbeitsspeicher: Nach einem Neustart liest die Seite neu.
   */
  readonly #page = new Map<string, PageVersion>();
  /**
   * Der Text, den die Seite dieses Fensters je Datei hält: der zuletzt gelesene (`read`) oder geschriebene (`write`).
   * Der Ausgang gehört allen Fenstern. Lädt dieses Fenster eine Änderung hoch, die ein anderes schrieb, hält die Seite
   * hier etwas anderes als das Hochgeladene, und die Fassung in `#page` darf nicht darauf vorrücken.
   */
  readonly #pageText = new Map<string, string>();
  #textTimer: Timer | undefined;
  #inkTimer: Timer | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #stopListening: (() => void) | undefined;
  #started = false;
  /** Zählt die Starts: Ein `stop()` während `start()` wartet, macht diesen Start ungültig. */
  #session = 0;

  constructor(o: { client: SyncClient; store: Store; device: string; readOnly?: boolean }) {
    this.#client = o.client;
    this.#store = o.store;
    this.#device = o.device;
    this.#readOnly = o.readOnly ?? false;
  }

  /**
   * Ob diese Engine nur liest: im zweiten Fenster eines Geräts und nach `close`. Eine solche Engine startet nichts (keine
   * Abfrage, kein Hochladen, kein Zuhören), nimmt keine Änderung an und legt nichts im Speicher an. Lesen geht weiter: aus
   * der lokalen Kopie, sonst von GitHub, ohne sich den Text zu merken.
   */
  get readOnly(): boolean {
    return this.#frozen;
  }

  get #frozen(): boolean {
    return this.#readOnly || this.#closed;
  }

  /** Das Gerät in den Commit-Texten ändert sich sofort, auch für Änderungen, die schon warten. */
  setDevice(device: string): void {
    this.#device = device;
  }

  /**
   * Ab jetzt gehen alle Anfragen über diesen Client (ein neuer Token). Die Warteschlange bleibt, wie sie ist. Der Aufrufer hat
   * den Zugang geprüft, darum gilt „Zugang erneuern“ nicht mehr; scheitert auch der neue, setzt der nächste Aufruf es wieder.
   */
  setClient(client: SyncClient): void {
    this.#client = client;
    if (this.#state === 'zugang') this.#setState('gesichert');
  }

  // ---------- Start und Ende ----------

  /** Lädt die Warteschlange, bittet den Browser, die Daten zu behalten, gleicht ab und wacht über Sichtbarkeit und Netz. */
  async start(): Promise<void> {
    if (this.#started || this.#frozen) return;
    this.#started = true;
    const session = ++this.#session;
    await this.#refreshPending();
    if (session !== this.#session) return; // `stop()` kam dazwischen: nichts einrichten, ein späteres `start()` tut es einmal
    // Nicht abwarten: Safari fragt unter Umständen nach, die App läuft auch ohne Antwort.
    Promise.resolve(navigator.storage?.persist?.()).catch(() => undefined);

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void this.flush();
        return;
      }
      // Wieder sichtbar: nachsehen, was es Neues gibt, und hochladen, was noch wartet. Das Hochladen beim Verlassen kann
      // abgebrochen worden sein, als die App in den Hintergrund ging, sonst wartete es bis zum Netz oder zum nächsten Takt.
      void this.pollRemote();
      if (this.#pending > 0) void this.flush();
    };
    const onOnline = () => void this.flush();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    this.#stopListening = () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
    this.#pollTimer = setInterval(() => {
      void this.pollRemote();
      if (this.#pending > 0) void this.flush();
    }, POLL_INTERVAL_MS);

    void this.pollRemote();
    void this.flush();
  }

  stop(): void {
    this.#session++;
    this.#stopListening?.();
    this.#stopListening = undefined;
    clearInterval(this.#pollTimer);
    clearTimeout(this.#textTimer);
    clearTimeout(this.#inkTimer);
    this.#started = false;
  }

  /**
   * Beendet die Engine für immer, zum Beispiel weil das Repository gewechselt wird. Von da an startet sie nicht mehr, nimmt
   * keine Änderung an, lädt nichts hoch und legt nichts im Speicher an: Was gerade unterwegs ist (ein Hochladen, das aufs
   * Schloss wartet, eine Antwort von GitHub), wird weder abgeschickt noch übernommen. Gelesen wird weiter, ohne zu merken.
   */
  close(): void {
    this.#closed = true;
    this.stop();
  }

  // ---------- Fremde Änderungen melden ----------

  /**
   * Meldet fremde Änderungen (wie `onRemoteChange`) an einen weiteren Zuhörer, unabhängig von allen anderen. Gibt die
   * Abmeldung zurück; sie darf beliebig oft und in beliebiger Reihenfolge gerufen werden. Wirft ein Zuhörer, geht die
   * Meldung an die anderen trotzdem, und der Fehler kommt als `onError` (ohne Datei).
   */
  addRemoteChangeListener(listener: (paths: string[]) => void): () => void {
    this.#remoteListeners.add(listener);
    return () => {
      this.#remoteListeners.delete(listener);
    };
  }

  #remoteChanged(paths: string[]): void {
    this.onRemoteChange?.(paths);
    for (const listener of [...this.#remoteListeners]) {
      try {
        listener(paths);
      } catch (error) {
        this.onError?.({ path: '', error });
      }
    }
  }

  // ---------- Lesen und Schreiben ----------

  /**
   * Die lokale Kopie sofort, im Hintergrund wird sie aufgefrischt (nur ohne offene Änderung, und eine Datei, die es auf
   * GitHub nicht mehr gibt, lässt die Kopie stehen: Das übernimmt nur die Abfrage). Ohne Kopie kommt der Text von
   * GitHub: `null`, wenn es die Datei nicht gibt oder GitHub nicht erreichbar ist. Ein Lesefehler (zum Beispiel Text,
   * der kein UTF-8 ist) geht an den Aufrufer und wird nie gemerkt, damit eine kaputte Datei nicht wie eine leere
   * aussieht und überschrieben wird.
   */
  async read(path: string): Promise<string | null> {
    return (await this.lookup(path)).text;
  }

  /**
   * Wie `read`, sagt aber auch, ob `null` heißt „die Datei gibt es nicht“ oder „GitHub ließ sich nicht fragen“ (kein Netz,
   * Ratenlimit, kein Zugang): Dann ist `unknown` wahr, und ob es die Datei gibt, ist offen. Wer sie anlegen will, wenn sie
   * fehlt, darf das nur bei `unknown: false` tun, sonst entstünde neben einer Datei, die man nicht sieht, eine zweite.
   * Mit lokaler Kopie ist `unknown` nie wahr.
   */
  async lookup(path: string): Promise<{ text: string | null; unknown: boolean }> {
    const local = await this.#store.get('files', path);
    if (local) {
      this.#pageGets(path, local.text, { sha: local.sha, baseText: local.base });
      if (!this.#frozen) void this.#refreshInBackground(path);
      return { text: local.text, unknown: false };
    }
    // Gelöscht, das Löschen steht noch aus.
    if ((await this.#store.get('outbox', path))?.deleted) return { text: this.#pageGetsNothing(path), unknown: false };
    let remote: Remote | null;
    try {
      remote = await this.#call(() => this.#client.getFile(path));
    } catch (error) {
      if (isStop(error)) {
        if (!this.#frozen) this.#noteStop(error);
        return { text: null, unknown: true };
      }
      throw error;
    }
    if (!remote) return { text: this.#pageGetsNothing(path), unknown: false };
    const fetched = remote;
    // Ein Fenster ohne Schreibrecht und eine beendete Engine zeigen, was auf GitHub liegt, und merken sich nichts davon.
    if (this.#frozen) return { text: fetched.text, unknown: false };
    // Während der Anfrage kann jemand geschrieben oder gelöscht haben, dann gilt das.
    const kept = await this.#transact(['files', 'outbox'], async (tx) => {
      const [existing, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
      if (existing) return existing;
      if (queued?.deleted) return null;
      const record = syncedRecord(path, fetched);
      await tx.objectStore('files').put(record);
      return record;
    });
    if (!kept) return { text: this.#pageGetsNothing(path), unknown: false };
    this.#pageGets(path, kept.text, { sha: kept.sha, baseText: kept.base });
    return { text: kept.text, unknown: false };
  }

  /** Die Seite bekommt diesen Text, der auf dieser Fassung beruht. */
  #pageGets(path: string, text: string, version: PageVersion): void {
    this.#page.set(path, version);
    this.#pageText.set(path, text);
  }

  /** Die Seite bekommt nichts (die Datei gibt es nicht oder nicht mehr) und hält danach keinen Text mehr. */
  #pageGetsNothing(path: string): null {
    this.#page.delete(path);
    this.#pageText.delete(path);
    return null;
  }

  /**
   * Speichert sofort lokal und stellt die Änderung in die Warteschlange. Hochgeladen wird nach 2 s (Text) bzw. 10 s (Handschrift).
   * Wirft, wenn sich der Text nicht mit einer wartenden Änderung vereinen lässt, die die Seite noch nicht gelesen hat (siehe unten).
   */
  async write(path: string, text: string, kind: 'md' | 'svg'): Promise<void> {
    if (this.#frozen) throw new ReadOnlyError();
    const held = this.#pageText.get(path); // der Text, auf dem die Seite diese Änderung gemacht hat
    await this.#transact(['files', 'outbox'], async (tx) => {
      const [record, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
      // Die erste Grundlage bleibt: Bei mehreren Änderungen vor dem Hochladen zählt der Stand, den GitHub zuletzt hatte.
      // Ohne offene Änderung zählt die Fassung, aus der der Text der Seite entstand. Das ist nicht unbedingt die lokale
      // Kopie: Hat sie sich seit dem Lesen geändert (fremde Änderung, Konflikt), muss der Upload das merken und
      // zusammenführen, statt die fremde Änderung mit dem Stand der Kopie still zu überschreiben.
      const from: PageVersion = queued
        ? { sha: queued.baseSha, baseText: queued.baseText }
        : (this.#page.get(path) ?? { sha: record?.sha ?? null, baseText: record?.base ?? null });
      // Wartet ein anderer Text als der, den die Seite hält, wurde die wartende Änderung unter ihr auf das Hochgeladene gesetzt
      // (siehe `#rebase`), und die Seite hat das noch nicht gelesen. Ihr Text beruht dann auf ihrem alten und kommt in den
      // wartenden dazu, statt ihn zu ersetzen: Sonst ginge verloren, was das andere Gerät beigetragen hat.
      const next = queued && !queued.deleted && held !== undefined && held !== queued.text ? mergeByKind(kind, held, text, queued.text) : text;
      if (next === null) throw new Error('Die Änderung ließ sich nicht mit dem neuen Stand vereinen. Die Seite liest ihn gleich neu.');
      await Promise.all([
        tx.objectStore('outbox').put({ path, text: next, kind, baseSha: from.sha, baseText: from.baseText, queuedAt: queued?.queuedAt ?? Date.now() }),
        tx.objectStore('files').put({ path, text: next, sha: from.sha, base: from.baseText, syncedAt: record?.syncedAt ?? 0 }),
      ]);
    });
    this.#pageText.set(path, text);
    if (!this.#frozen) this.#schedule(kind);
    await this.#refreshPending();
  }

  /**
   * Löscht die Datei: lokal sofort, auf GitHub beim nächsten Abgleich. Eine Datei, die nie hochgeladen war, verschwindet
   * einfach. Kennt dieses Gerät die Fassung auf GitHub nicht, löscht der Abgleich nur, was genau die letzte lokale
   * Fassung ist. Alles andere hat dieses Gerät nie gesehen und bleibt.
   */
  async remove(path: string): Promise<void> {
    if (this.#frozen) throw new ReadOnlyError();
    this.#pageGetsNothing(path);
    const alreadyQueued = await this.#transact(['files', 'outbox'], async (tx) => {
      const [record, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
      if (queued?.deleted) return true;
      const baseSha = queued ? queued.baseSha : (record?.sha ?? null);
      // Kennt GitHub die Datei nicht und läuft gerade kein Upload von ihr, gibt es dort nichts zu löschen.
      const neverSent = (queued || record) && baseSha === null && this.#current !== path;
      const entry: OutboxEntry = {
        path,
        text: queued?.text ?? record?.text ?? '', // die letzte lokale Fassung, siehe oben
        kind: queued?.kind ?? (path.endsWith('.svg') ? 'svg' : 'md'),
        baseSha, // `null` heißt: beim Abgleich erst nachsehen, welche Fassung auf GitHub liegt
        baseText: queued ? queued.baseText : (record?.base ?? null),
        queuedAt: queued?.queuedAt ?? Date.now(),
        deleted: true,
      };
      await Promise.all([
        tx.objectStore('files').delete(path),
        neverSent ? tx.objectStore('outbox').delete(path) : tx.objectStore('outbox').put(entry),
      ]);
      return false;
    });
    if (alreadyQueued) return;
    if (!this.#frozen) this.#schedule('md');
    await this.#refreshPending();
  }

  /**
   * Die Dateien unter `prefix` (ein Ordner mit `/` am Ende), wie dieses Gerät sie kennt. GitHub wird nicht gefragt, es geht
   * also auch ohne Netz. `present` sind die lokalen Kopien, auch Seiten, die noch nicht hochgeladen sind und in keiner
   * Dateiliste von GitHub stehen. `deleted` sind die Dateien, deren Löschen noch auf den Abgleich wartet: GitHub listet sie
   * bis dahin weiter, sie zählen nicht mehr mit. Verglichen wird in der Schreibweise des Vaults (Umlaute als ein Zeichen),
   * zurück kommen die Pfade, wie die Engine sie führt.
   */
  async localPaths(prefix: string): Promise<{ present: string[]; deleted: string[] }> {
    const folder = normalizePath(prefix);
    // Von den Kopien genügen die Pfade: Ihre Texte (viele Seiten mit Handschrift) brauchen hier nicht in den Speicher.
    const [copies, queued] = await Promise.all([this.#store.run((db) => db.getAllKeys('files')), this.#store.getAll('outbox')]);
    const deleted = new Set(queued.filter((entry) => entry.deleted).map((entry) => entry.path));
    const present = new Set([...copies, ...queued.map((entry) => entry.path)]);
    for (const path of deleted) present.delete(path); // ein wartendes Löschen schlägt jede Kopie
    const under = (path: string) => normalizePath(path).startsWith(folder);
    return { present: [...present].filter(under), deleted: [...deleted].filter(under) };
  }

  // ---------- Status ----------

  async #refreshPending(): Promise<void> {
    this.#pending = await this.#store.count('outbox');
    this.#publish();
  }

  #publish(): void {
    // Wartet nichts mehr, gibt es auch nichts mehr abzuwarten. Ohne Netz wartet dagegen jede Änderung.
    if (this.#pending === 0 && this.#state === 'wartet') this.#state = 'gesichert';
    if (this.#pending > 0 && this.#state === 'gesichert' && navigator.onLine === false) this.#state = 'wartet';
    const { state, pending } = this.status.value;
    if (state !== this.#state || pending !== this.#pending) this.status.value = { state: this.#state, pending: this.#pending };
  }

  #setState(state: SyncState): void {
    this.#state = state;
    this.#publish();
  }

  /** Hält ein Fehler den Abgleich an? Dann merkt sich der Status, warum. */
  #noteStop(error: unknown): boolean {
    if (error instanceof AuthError) this.#setState('zugang');
    else if (error instanceof OfflineError || error instanceof RateLimitError) {
      if (this.#pending > 0) this.#setState('wartet');
    } else return false;
    return true;
  }

  // ---------- Zugriff auf GitHub ----------

  /** Jede Anfrage bekommt 30 s (`withTimeout`). Danach gilt sie als fehlende Verbindung. Eine gelungene Anfrage beweist, dass der Zugang geht. */
  async #call<T>(run: () => Promise<T>): Promise<T> {
    const value = await withTimeout(run);
    if (this.#state === 'zugang') this.#setState('gesichert');
    return value;
  }

  /**
   * Jede Änderung an GitHub geht hier durch. Geprüft wird in dem Augenblick, in dem die Anfrage abgeschickt wird, nicht
   * früher: Ein Hochladen, das auf das Schloss oder auf eine Antwort gewartet hat, während die Engine beendet wurde, geht nie raus.
   */
  #upload<T>(run: () => Promise<T>): Promise<T> {
    return this.#call(() => {
      if (this.#frozen) throw new ReadOnlyError();
      return run();
    });
  }

  /**
   * Jede Änderung am Speicher geht hier durch. Die Prüfung und das Anlegen der Transaktion folgen ohne Pause aufeinander, und
   * eine Transaktion steht in der Reihenfolge, in der sie angelegt wird: Wer `close` ruft und danach den Speicher leert,
   * sieht entweder alles, was diese Engine zuvor geschrieben hat, oder sie schreibt nichts mehr.
   */
  #transact<T>(areas: Areas, work: (tx: StoreTx) => Promise<T>): Promise<T> {
    if (this.#frozen) return Promise.reject(new ReadOnlyError());
    // Verliert der Speicher die Verbindung mitten im Lauf, führt er `work` ein zweites Mal aus (`Store.run`), und bis dahin kann
    // die Engine beendet worden sein: Auch dieser Versuch schreibt nichts mehr.
    return this.#store.transact(areas, (tx) => {
      if (this.#frozen) throw new ReadOnlyError();
      return work(tx);
    });
  }

  #message(path: string): string {
    return `Notizbuch: ${path.slice(path.lastIndexOf('/') + 1)} (${this.#device})`;
  }

  // ---------- Hochladen ----------

  #schedule(kind: 'md' | 'svg'): void {
    // Zwei Wartezeiten, jede beginnt mit der letzten Änderung ihrer Art neu.
    if (kind === 'md') {
      clearTimeout(this.#textTimer);
      this.#textTimer = setTimeout(() => void this.flush(), TEXT_DELAY_MS);
    } else {
      clearTimeout(this.#inkTimer);
      this.#inkTimer = setTimeout(() => void this.flush(), INK_DELAY_MS);
    }
  }

  /**
   * Lädt die Warteschlange hoch, eine Datei nach der anderen. Es läuft immer nur ein Abgleich, auch über Tabs hinweg
   * (Schloss). Wer währenddessen `flush` aufruft (die Wartezeit ist abgelaufen, das Netz ist zurück), bekommt einen
   * weiteren Durchgang danach, auch wenn der laufende am Netz scheiterte. Der Aufruf endet erst, wenn alle Durchgänge
   * fertig sind, und wirft nie.
   */
  flush(): Promise<void> {
    if (this.#frozen) return Promise.resolve();
    if (this.#flushing) {
      this.#flushAgain = true;
      return this.#flushing;
    }
    const run = (async () => {
      try {
        do {
          await this.#exclusive(() => this.#flushPass());
          // Zwischen dieser Prüfung und `#flushing = null` gibt es kein await: Ein Aufruf geht nie verloren.
        } while (this.#flushAgain);
      } catch (error) {
        if (!(error instanceof ReadOnlyError)) this.onError?.({ path: '', error });
      } finally {
        this.#flushing = null;
      }
    })();
    this.#flushing = run;
    return run;
  }

  /** Nur ein Tab gleichzeitig: Zwei Tabs hätten dieselbe Warteschlange und würden jede Änderung doppelt hochladen. */
  #exclusive<T>(work: () => Promise<T>): Promise<T> {
    return navigator.locks ? navigator.locks.request(LOCK_NAME, work) : work();
  }

  /** Ein Durchgang unter dem Schloss. Wer ab jetzt `flush` ruft, bekommt einen weiteren. */
  async #flushPass(): Promise<void> {
    this.#flushAgain = false;
    if (this.#frozen) return; // beendet, während der Durchgang auf das Schloss wartete
    await this.#refreshPending(); // die Warteschlange kann aus einer früheren Sitzung oder einem anderen Tab stammen
    await this.#flushOnce();
    await this.#refreshPending();
  }

  /** Ein Durchgang über die Warteschlange. */
  async #flushOnce(): Promise<void> {
    const seen = new Set<string>();
    for (;;) {
      // Jedes Mal neu lesen: Neue Einträge (zum Beispiel Konfliktkopien) kommen im selben Durchgang dran.
      const next = (await this.#store.getAll('outbox')).filter((e) => !seen.has(e.path)).sort(byQueueTime)[0];
      if (!next || this.#frozen) return;
      seen.add(next.path);
      if (await this.#send(next.path)) return; // Netz oder Zugang fehlen: Alles bleibt in der Warteschlange
    }
  }

  /** Eine Änderung hochladen. Wahr, wenn der Abgleich anhalten muss. */
  async #send(path: string): Promise<boolean> {
    const entry = await this.#store.get('outbox', path);
    if (!entry) return false;
    if (this.#frozen) return true;
    this.#current = path;
    try {
      if (entry.deleted) await this.#sendDelete(entry);
      else await this.#sendWrite(entry);
      return false;
    } catch (error) {
      if (this.#noteStop(error) || error instanceof ReadOnlyError) return true;
      // Ein nicht erlaubter Pfad wird nie erlaubt: Die Änderung bleibt nicht ewig in der Warteschlange.
      if (error instanceof PathNotAllowedError) await this.#dropQueued(path);
      this.onError?.({ path, error });
      return false;
    } finally {
      this.#current = null;
    }
  }

  /** Nimmt eine Änderung aus der Warteschlange, die nie hochgeladen werden kann (nicht erlaubter Pfad). */
  async #dropQueued(path: string): Promise<void> {
    await this.#transact(['outbox'], async (tx) => {
      await tx.objectStore('outbox').delete(path);
    });
  }

  async #sendWrite(entry: OutboxEntry): Promise<void> {
    // Steht wieder der Text von GitHub da (Haken gesetzt und zurückgenommen), gibt es nichts hochzuladen.
    if (entry.baseSha !== null && entry.text === entry.baseText) {
      return this.#settle(entry, { sha: entry.baseSha, text: entry.text });
    }
    try {
      const { sha } = await this.#upload(() => this.#client.putFile(entry.path, entry.text, entry.baseSha, this.#message(entry.path)));
      await this.#settle(entry, { sha, text: entry.text });
    } catch (error) {
      if (!isStaleBase(error, entry.baseSha)) throw error;
      await this.#resolveConflict(entry.path);
    }
  }

  /**
   * Auf GitHub liegt jetzt `uploaded` (oder war schon). Ist seit dem Start nichts geschrieben worden, wird das die
   * lokale Kopie und die Änderung erledigt. Wurde währenddessen weitergeschrieben, bleibt die neuere Fassung in der
   * Warteschlange: Beruht sie auf dem Hochgeladenen, wird dies ihre neue Grundlage. Wurde dagegen zusammengeführt, beruht
   * sie auf dem Geschickten und wird auf das Hochgeladene gesetzt (siehe `#rebase`).
   */
  async #settle(sent: OutboxEntry, uploaded: Remote): Promise<void> {
    const { path } = sent;
    const localText = await this.#transact(['files', 'outbox'], async (tx) => {
      const [record, current] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
      const writes: Promise<unknown>[] = [];
      let text = record?.text ?? null; // die lokale Kopie danach
      if (!current || (current.text === sent.text && !current.deleted)) {
        if (current) writes.push(tx.objectStore('outbox').delete(path));
        writes.push(tx.objectStore('files').put(syncedRecord(path, uploaded)));
        text = uploaded.text;
      } else if (uploaded.text === sent.text) {
        writes.push(tx.objectStore('outbox').put({ ...current, baseSha: uploaded.sha, baseText: uploaded.text }));
        if (record) writes.push(tx.objectStore('files').put({ ...record, sha: uploaded.sha, base: uploaded.text, syncedAt: Date.now() }));
      } else if (!current.deleted) {
        // Ein Löschen bleibt, wie es ist: Es trifft auf den neuen Stand und entfällt, der Stand von GitHub bleibt.
        const rebased = this.#rebase(sent, current, uploaded);
        const syncedAt = rebased.baseSha === uploaded.sha ? Date.now() : (record?.syncedAt ?? 0);
        writes.push(tx.objectStore('outbox').put(rebased));
        writes.push(tx.objectStore('files').put({ path, text: rebased.text, sha: rebased.baseSha, base: rebased.baseText, syncedAt }));
        text = rebased.text;
      }
      await Promise.all(writes);
      return text;
    });
    const held = this.#pageText.get(path);
    // Hält die Seite genau den Text, den sie geschickt hat, und liegt er jetzt auf GitHub, ist das ihre neue Grundlage.
    // Wurde zusammengeführt, beruht ihr Text weiter auf der alten: Schreibt sie darauf weiter, wird wieder zusammengeführt.
    // Hält sie etwas anderes (ein anderes Fenster hat die Änderung geschrieben, oder die neuere Fassung kam eben auf das
    // Hochgeladene), rückt nichts vor: Ihr nächstes Schreiben nimmt `write` in den wartenden Text auf, oder es trifft auf den
    // 409 und wird zusammengeführt, statt die Änderung des anderen Fensters oder Geräts zu überschreiben. Ihre Fassung rückt
    // vor, sobald sie neu liest.
    if (held === sent.text) {
      this.#page.set(path, uploaded.text === sent.text ? { sha: uploaded.sha, baseText: uploaded.text } : { sha: sent.baseSha, baseText: sent.baseText });
    }
    // Zeigt die Seite etwas anderes, als die lokale Kopie jetzt ist (zusammengeführt, auf das Hochgeladene gesetzt, oder von
    // einem anderen Fenster hochgeladen), soll sie neu lesen. Hat sie die Datei nie geholt, gibt es nichts zu lesen. Schrieb
    // sie schon weiter, ist die lokale Kopie ihr Text, und es bleibt still.
    if (held !== undefined && localText !== null && held !== localText) this.#remoteChanged([path]);
  }

  /**
   * Die neuere Fassung `current` entstand aus dem Geschickten, hochgeladen wurde aber das Zusammengeführte `uploaded`. Sie
   * kommt auf das Hochgeladene: zusammengeführt mit dem Geschickten als Ausgangspunkt. So bleibt zurückgenommen, was hier
   * nach dem Schicken zurückgenommen wurde (ein Strich, ein Haken), und was das andere Gerät beigetragen hat, bleibt auch.
   * Lässt sich das nicht vereinen, bleibt der Text, wie er ist, und der Ausgangspunkt ist das Geschickte mit der alten sha:
   * Der Upload trifft dann auf den neuen Stand (409) und wird wie jeder andere zusammengeführt oder zur Konfliktkopie. Nie gilt
   * er als „nichts hochzuladen“, weil er zufällig wieder dem alten Stand gleicht.
   */
  #rebase(sent: OutboxEntry, current: OutboxEntry, uploaded: Remote): OutboxEntry {
    const rebased = mergeByKind(current.kind, sent.text, current.text, uploaded.text);
    if (rebased === null) return { ...current, baseText: sent.text };
    return { ...current, text: rebased, baseSha: uploaded.sha, baseText: uploaded.text };
  }

  // ---------- Gleichzeitige Änderungen ----------

  /** Der Stand auf GitHub hat sich geändert: zusammenführen und hochladen, oder die eigene Fassung als Kopie ablegen. */
  async #resolveConflict(path: string): Promise<void> {
    for (let attempt = 0; attempt < CONFLICT_ATTEMPTS; attempt++) {
      const entry = await this.#store.get('outbox', path);
      if (!entry || entry.deleted) return;
      const remote = await this.#call(() => this.#client.getFile(path));
      let text = entry.text;
      let baseSha: string | null = null; // Ist die Datei auf GitHub weg, wird die eigene als neue Datei hochgeladen.
      if (remote) {
        const merged = mergeByKind(entry.kind, entry.baseText, entry.text, remote.text);
        if (merged === null) return this.#keepRemote(entry, remote);
        if (merged === remote.text) return this.#settle(entry, remote); // GitHub hat schon alles, nichts hochzuladen
        text = merged;
        baseSha = remote.sha;
      }
      try {
        const { sha } = await this.#upload(() => this.#client.putFile(path, text, baseSha, this.#message(path)));
        return await this.#settle(entry, { sha, text });
      } catch (error) {
        if (!isStaleBase(error, baseSha)) throw error; // sonst hat sich die Datei schon wieder geändert: noch einmal
      }
    }
    throw new Error('Die Datei auf GitHub ändert sich laufend. Der Abgleich versucht es später noch einmal.');
  }

  /**
   * Der fremde Stand bleibt, die eigene Fassung geht als Kopie in die Warteschlange. Das geschieht in einem Zug, damit
   * auch bei einem Absturz oder Netzausfall nach der Entscheidung nichts fehlt. Die Kopie enthält die neueste eigene Fassung.
   */
  async #keepRemote(entry: OutboxEntry, remote: Remote): Promise<void> {
    const { path } = entry;
    const copyPath = await this.#freeCopyPath(path);
    const wantsCopy = await this.#transact(['files', 'outbox'], async (tx) => {
      const current = await tx.objectStore('outbox').get(path);
      const wants = !current?.deleted; // wer die Seite inzwischen gelöscht hat, braucht keine Kopie
      const ours = current && !current.deleted ? current.text : entry.text;
      const writes: Promise<unknown>[] = [
        tx.objectStore('files').put(syncedRecord(path, remote)),
        tx.objectStore('outbox').delete(path),
      ];
      if (wants) {
        writes.push(
          tx.objectStore('outbox').put({ path: copyPath, text: ours, kind: entry.kind, baseSha: null, baseText: null, queuedAt: Date.now() }),
          tx.objectStore('files').put({ path: copyPath, text: ours, sha: null, base: null, syncedAt: 0 }),
        );
      }
      await Promise.all(writes);
      return wants;
    });
    // Die Seite hält weiter ihren Text, der auf dem alten Stand beruht. Schreibt sie darauf weiter, trifft der Upload auf
    // den fremden Stand und wird zusammengeführt oder wieder zur Kopie, statt ihn zu überschreiben.
    this.#page.set(path, { sha: entry.baseSha, baseText: entry.baseText });
    if (wantsCopy) this.onConflict?.({ path, copyPath });
    this.#remoteChanged([path]);
  }

  /** Name für die Konfliktkopie: `(Konflikt)`, dann `(Konflikt 2)` und so weiter. Eine ältere Kopie wird nie überschrieben. */
  async #freeCopyPath(path: string): Promise<string> {
    for (let n = 1; n <= MAX_COPY_NUMBER; n++) {
      const candidate = copyPathFor(path, n);
      if (!(await this.#exists(candidate))) return candidate;
    }
    throw new Error('Zu viele Konfliktkopien für diese Datei.');
  }

  async #exists(path: string): Promise<boolean> {
    if ((await this.#store.get('files', path)) || (await this.#store.get('outbox', path))) return true;
    return (await this.#call(() => this.#client.getFile(path))) !== null;
  }

  // ---------- Löschen ----------

  async #sendDelete(entry: OutboxEntry): Promise<void> {
    const { path } = entry;
    try {
      let sha = entry.baseSha;
      if (sha === null) {
        const remote = await this.#call(() => this.#client.getFile(path));
        if (!remote) return await this.#settleDelete(entry);
        // Ohne bekannte Fassung wird nur gelöscht, was genau unsere letzte Fassung ist. Alles andere hat dieses Gerät nie gesehen.
        if (remote.text !== entry.text) return await this.#cancelDelete(entry, remote);
        sha = remote.sha;
      }
      const version = sha;
      await this.#upload(() => this.#client.deleteFile(path, version, this.#message(path)));
      await this.#settleDelete(entry);
    } catch (error) {
      if (error instanceof ConflictError) return this.#cancelDelete(entry);
      if (isStop(error) || error instanceof PathNotAllowedError || error instanceof ReadOnlyError) throw error; // beendet: keine Anfrage mehr
      // Eine fehlende Datei meldet der Client als allgemeinen Fehler (404). Ist sie weg, ist das Löschen erledigt.
      if ((await this.#call(() => this.#client.getFile(path))) === null) return this.#settleDelete(entry);
      throw error;
    }
  }

  /** Die Datei ist auf GitHub weg. Wurde danach wieder geschrieben, ist das jetzt eine neue Datei. */
  async #settleDelete(sent: OutboxEntry): Promise<void> {
    const { path } = sent;
    await this.#transact(['files', 'outbox'], async (tx) => {
      const [record, current] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
      const writes: Promise<unknown>[] = [];
      if (current?.deleted) writes.push(tx.objectStore('outbox').delete(path));
      else if (current) {
        writes.push(tx.objectStore('outbox').put({ ...current, baseSha: null, baseText: null }));
        if (record) writes.push(tx.objectStore('files').put({ ...record, sha: null, base: null }));
      }
      await Promise.all(writes);
    });
  }

  /**
   * Die Datei hat sich auf GitHub geändert, seit das Löschen vorgemerkt wurde, oder sie war nie bei diesem Gerät: Das
   * Löschen entfällt, der Stand von GitHub bleibt (`known`, sonst wird er geholt).
   */
  async #cancelDelete(sent: OutboxEntry, known?: Remote): Promise<void> {
    const { path } = sent;
    const remote = known ?? (await this.#call(() => this.#client.getFile(path)));
    if (!remote) return this.#settleDelete(sent);
    const wasBasedOn = await this.#transact(['files', 'outbox'], async (tx) => {
      const current = await tx.objectStore('outbox').get(path);
      if (!current?.deleted) return null;
      await Promise.all([
        tx.objectStore('outbox').delete(path),
        tx.objectStore('files').put(syncedRecord(path, remote)),
      ]);
      return { sha: current.baseSha, baseText: current.baseText };
    });
    if (wasBasedOn) {
      // Die Seite hält weiter ihren Text, der auf der alten Fassung beruht. Schreibt sie darauf weiter, trifft der Upload
      // auf den fremden Stand und wird zusammengeführt, statt ihn mit der lokalen Kopie als Grundlage zu überschreiben.
      this.#page.set(path, wasBasedOn);
      this.#remoteChanged([path]);
    }
  }

  // ---------- Fremde Änderungen ----------

  /**
   * Fragt GitHub, ob sich seit der letzten Abfrage etwas geändert hat, und frischt die Kopien auf, die keine offene
   * Änderung haben. Beim ersten Mal merkt sie sich nur den Stand. Der neue Stand wird erst gemerkt, wenn alles
   * durch ist: Scheitert etwas, fragt die nächste Abfrage noch einmal, und was schon übernommen ist, erfährt die Seite
   * trotzdem sofort. Fehler kommen nie nach außen.
   */
  async pollRemote(): Promise<void> {
    if (this.#frozen) return;
    try {
      const head = await this.#call(() => this.#client.headSha());
      const last = await this.#store.get('meta', 'lastHead');
      if (last === undefined) {
        await this.#rememberHead(head);
        return;
      }
      if (last === head) return;
      let changed: string[] = [];
      try {
        changed = await this.#call(() => this.#client.changedFiles(last, head));
      } catch (error) {
        // Kennt GitHub den alten Stand nicht mehr, soll die Abfrage nicht für immer hängen. Geöffnete Dateien frischt
        // `read` auf. Jeder andere Fehler lässt den Stand stehen, die nächste Abfrage versucht es wieder.
        if (!isUnknownCommit(error)) throw error;
      }
      const refreshed: string[] = [];
      try {
        for (const path of new Set(changed)) {
          try {
            if (await this.#refreshCopy(path, true)) refreshed.push(path);
          } catch (error) {
            if (isStop(error) || error instanceof ReadOnlyError) throw error;
            this.onError?.({ path, error }); // eine kaputte Datei hält die anderen nicht auf
          }
        }
      } finally {
        // Was schon übernommen ist, muss die Seite erfahren, auch wenn ein späterer Pfad die Abfrage anhält. Sonst
        // schriebe sie weiter auf den alten Text, und der Upload überschriebe die fremde Änderung.
        if (refreshed.length > 0) this.#remoteChanged(refreshed);
      }
      await this.#rememberHead(head);
    } catch (error) {
      if (error instanceof ReadOnlyError) return; // beendet, während die Abfrage lief
      if (!this.#noteStop(error)) this.onError?.({ path: '', error });
    }
  }

  /** Der Stand von `main`, bis zu dem die Abfrage alles gesehen hat. Gehört zum Repository der Engine, nie zu einem anderen. */
  async #rememberHead(head: string): Promise<void> {
    await this.#transact(['meta'], async (tx) => {
      await tx.objectStore('meta').put(head, 'lastHead');
    });
  }

  /**
   * Holt eine Datei, die lokal vorliegt und keine offene Änderung hat, neu. Wahr, wenn die Kopie dadurch neu ist oder weg.
   * Dass es die Datei auf GitHub nicht mehr gibt, zählt nur, wenn die Abfrage es beweist (`dropIfGone`): Sie hat vorher
   * den Stand von `main` geholt, der Zugang geht also. Ohne diesen Beweis kann "nicht gefunden" auch heißen, dass der
   * Zugang fehlt, GitHub antwortet darauf wie auf eine fehlende Datei. Dann bliebe nach und nach keine Kopie übrig.
   */
  async #refreshCopy(path: string, dropIfGone: boolean): Promise<boolean> {
    const record = await this.#store.get('files', path);
    if (!record || (await this.#store.get('outbox', path))) return false;
    const remote = await this.#call(() => this.#client.getFile(path));
    if (remote === null && !dropIfGone) return false;
    // Gleicher Stand: dieselbe sha, oder keine Seite kennt die Datei. Eine Kopie, die nie auf GitHub war, bleibt also.
    if ((remote?.sha ?? null) === record.sha) return false;
    return this.#adopt(path, record, remote);
  }

  /**
   * Übernimmt den fremden Stand (`null`: die Datei ist gelöscht, das kommt nur von der Abfrage), wenn in der Zwischenzeit
   * weder geschrieben noch hochgeladen wurde. Die Fassung, die die Seite hält, bleibt unberührt: Erst `read` ändert sie.
   */
  async #adopt(path: string, seen: FileRecord, remote: Remote | null): Promise<boolean> {
    return this.#transact(['files', 'outbox'], async (tx) => {
      const [record, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
      const fresh = !queued && record !== undefined && record.sha === seen.sha;
      if (fresh) {
        if (remote) await tx.objectStore('files').put(syncedRecord(path, remote));
        else await tx.objectStore('files').delete(path);
      }
      return fresh;
    });
  }

  async #refreshInBackground(path: string): Promise<void> {
    try {
      if (await this.#refreshCopy(path, false)) this.#remoteChanged([path]);
    } catch (error) {
      if (error instanceof ReadOnlyError) return;
      if (!this.#noteStop(error)) this.onError?.({ path, error });
    }
  }
}
