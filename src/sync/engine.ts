import { signal, type Signal } from '@preact/signals';
import { mergePages } from '../ink/svg';
import { conflictPath } from '../lib/filenames';
import { mergeText } from '../lib/merge';
import { AuthError, ConflictError, OfflineError, RateLimitError, type GitHubClient } from './github';
import { PathNotAllowedError } from './paths';
import type { FileRecord, OutboxEntry, Store } from './store';

/**
 * Was die Engine vom Client braucht. `GitHubClient` hat private Felder, ein Fake kann die Klasse selbst darum nicht
 * erfüllen, ihre öffentlichen Methoden schon.
 */
export type SyncClient = Pick<GitHubClient, 'getFile' | 'putFile' | 'deleteFile' | 'listDir' | 'headSha' | 'changedFiles'>;

export type SyncState = 'gesichert' | 'wartet' | 'zugang';
export type SyncStatus = { state: SyncState; pending: number };

export function statusLabel(s: SyncStatus): string {
  if (s.state === 'gesichert') return 'Gesichert';
  if (s.state === 'zugang') return 'Zugang erneuern';
  return `Wartet auf Netz · ${s.pending} ${s.pending === 1 ? 'Änderung' : 'Änderungen'}`;
}

const TEXT_DELAY_MS = 2000;
const INK_DELAY_MS = 10_000;
const POLL_INTERVAL_MS = 180_000;
const CALL_TIMEOUT_MS = 30_000;
/** So oft versucht ein Abgleich eine Datei zusammenzuführen, die sich währenddessen schon wieder geändert hat. */
const CONFLICT_ATTEMPTS = 3;
const MAX_COPY_NUMBER = 99;

type Remote = { text: string; sha: string };
type Timer = ReturnType<typeof setTimeout>;

/** Fehler, bei denen der Abgleich anhält und alles in der Warteschlange bleibt: kein Netz, Ratenlimit, kein Zugang. */
function isStop(error: unknown): boolean {
  return error instanceof AuthError || error instanceof OfflineError || error instanceof RateLimitError;
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
  /** Die lokale Fassung dieser Dateien hat sich durch fremde Änderungen geändert. Die Oberfläche soll sie neu lesen. */
  onRemoteChange?: (paths: string[]) => void;
  /** Eine Datei ließ sich nicht abgleichen (nicht erlaubter Pfad, kaputte Datei). Ohne Datei ist `path` leer. */
  onError?: (i: { path: string; error: unknown }) => void;

  readonly #client: SyncClient;
  readonly #store: Store;
  readonly #device: string;
  #state: SyncState = 'gesichert';
  #pending = 0;
  #flushing: Promise<void> | null = null;
  #flushAgain = false;
  /** Pfad der Änderung, die gerade hochgeladen wird. */
  #current: string | null = null;
  #textTimer: Timer | undefined;
  #inkTimer: Timer | undefined;
  #pollTimer: ReturnType<typeof setInterval> | undefined;
  #stopListening: (() => void) | undefined;
  #started = false;

  constructor(o: { client: SyncClient; store: Store; device: string }) {
    this.#client = o.client;
    this.#store = o.store;
    this.#device = o.device;
  }

  // ---------- Start und Ende ----------

  /** Lädt die Warteschlange, bittet den Browser, die Daten zu behalten, gleicht ab und wacht über Sichtbarkeit und Netz. */
  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    await this.#refreshPending();
    // Nicht abwarten: Safari fragt unter Umständen nach, die App läuft auch ohne Antwort.
    Promise.resolve(navigator.storage?.persist?.()).catch(() => undefined);

    const onVisibility = () => void (document.visibilityState === 'hidden' ? this.flush() : this.pollRemote());
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
    this.#stopListening?.();
    this.#stopListening = undefined;
    clearInterval(this.#pollTimer);
    clearTimeout(this.#textTimer);
    clearTimeout(this.#inkTimer);
    this.#started = false;
  }

  // ---------- Lesen und Schreiben ----------

  /**
   * Die lokale Kopie sofort, im Hintergrund wird sie aufgefrischt (nur ohne offene Änderung). Ohne Kopie kommt der Text
   * von GitHub: `null`, wenn es die Datei nicht gibt oder GitHub nicht erreichbar ist. Ein Lesefehler (zum Beispiel
   * Text, der kein UTF-8 ist) geht an den Aufrufer und wird nie gemerkt, damit eine kaputte Datei nicht wie eine leere
   * aussieht und überschrieben wird.
   */
  async read(path: string): Promise<string | null> {
    const local = await this.#store.get('files', path);
    if (local) {
      void this.#refreshInBackground(path);
      return local.text;
    }
    if ((await this.#store.get('outbox', path))?.deleted) return null; // gelöscht, das Löschen steht noch aus
    let remote: Remote | null;
    try {
      remote = await this.#call(() => this.#client.getFile(path));
    } catch (error) {
      if (isStop(error)) {
        this.#noteStop(error);
        return null;
      }
      throw error;
    }
    if (!remote) return null;
    // Während der Anfrage kann jemand geschrieben haben, dann gilt dessen Fassung.
    const tx = this.#store.transaction('files', 'readwrite');
    const existing = await tx.store.get(path);
    if (!existing) await tx.store.put({ path, text: remote.text, sha: remote.sha, base: remote.text, syncedAt: Date.now() });
    await tx.done;
    return existing ? existing.text : remote.text;
  }

  /** Speichert sofort lokal und stellt die Änderung in die Warteschlange. Hochgeladen wird nach 2 s (Text) bzw. 10 s (Handschrift). */
  async write(path: string, text: string, kind: 'md' | 'svg'): Promise<void> {
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const [record, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
    // Die erste Grundlage bleibt: Bei mehreren Änderungen vor dem Hochladen zählt der Stand, den GitHub zuletzt hatte.
    const baseSha = queued ? queued.baseSha : (record?.sha ?? null);
    const baseText = queued ? queued.baseText : (record?.base ?? null);
    await Promise.all([
      tx.objectStore('outbox').put({ path, text, kind, baseSha, baseText, queuedAt: queued?.queuedAt ?? Date.now() }),
      tx.objectStore('files').put({ path, text, sha: baseSha, base: baseText, syncedAt: record?.syncedAt ?? 0 }),
      tx.done,
    ]);
    this.#schedule(kind);
    await this.#refreshPending();
  }

  /** Löscht die Datei: lokal sofort, auf GitHub beim nächsten Abgleich. Eine Datei, die nie hochgeladen war, verschwindet einfach. */
  async remove(path: string): Promise<void> {
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const [record, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
    if (queued?.deleted) return;
    const baseSha = queued ? queued.baseSha : (record?.sha ?? null);
    // Kennt GitHub die Datei nicht und läuft gerade kein Upload von ihr, gibt es dort nichts zu löschen.
    const neverSent = (queued || record) && baseSha === null && this.#current !== path;
    const entry: OutboxEntry = {
      path,
      text: '',
      kind: queued?.kind ?? (path.endsWith('.svg') ? 'svg' : 'md'),
      baseSha, // `null` heißt: beim Abgleich erst nachsehen, welche Fassung auf GitHub liegt
      baseText: queued ? queued.baseText : (record?.base ?? null),
      queuedAt: queued?.queuedAt ?? Date.now(),
      deleted: true,
    };
    await Promise.all([
      tx.objectStore('files').delete(path),
      neverSent ? tx.objectStore('outbox').delete(path) : tx.objectStore('outbox').put(entry),
      tx.done,
    ]);
    this.#schedule('md');
    await this.#refreshPending();
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

  /** Jede Anfrage bekommt 30 s. Danach gilt sie als fehlende Verbindung. Eine gelungene Anfrage beweist, dass der Zugang geht. */
  #call<T>(run: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new OfflineError('Zeitüberschreitung bei der Verbindung zu GitHub.')), CALL_TIMEOUT_MS);
      const done = () => clearTimeout(timer);
      let request: Promise<T>;
      try {
        request = run();
      } catch (error) {
        done();
        reject(error);
        return;
      }
      request.then(
        (value) => {
          done();
          if (this.#state === 'zugang') this.#setState('gesichert');
          resolve(value);
        },
        (error: unknown) => {
          done();
          reject(error);
        },
      );
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
   * Lädt die Warteschlange hoch, eine Datei nach der anderen. Es läuft immer nur ein Abgleich. Wer währenddessen
   * `flush` aufruft (die Wartezeit ist abgelaufen, das Netz ist zurück), bekommt einen weiteren Durchgang danach,
   * auch wenn der laufende am Netz scheiterte. Der Aufruf endet erst, wenn alle Durchgänge fertig sind, und
   * wirft nie.
   */
  flush(): Promise<void> {
    if (this.#flushing) {
      this.#flushAgain = true;
      return this.#flushing;
    }
    const run = (async () => {
      try {
        do {
          this.#flushAgain = false;
          await this.#refreshPending(); // die Warteschlange kann aus einer früheren Sitzung stammen
          await this.#flushOnce();
          await this.#refreshPending();
          // Zwischen dieser Prüfung und `#flushing = null` gibt es kein await: Ein Aufruf geht nie verloren.
        } while (this.#flushAgain);
      } catch (error) {
        this.onError?.({ path: '', error });
      } finally {
        this.#flushing = null;
      }
    })();
    this.#flushing = run;
    return run;
  }

  /** Ein Durchgang über die Warteschlange. */
  async #flushOnce(): Promise<void> {
    const seen = new Set<string>();
    for (;;) {
      // Jedes Mal neu lesen: Neue Einträge (zum Beispiel Konfliktkopien) kommen im selben Durchgang dran.
      const next = (await this.#store.getAll('outbox')).filter((e) => !seen.has(e.path)).sort(byQueueTime)[0];
      if (!next) return;
      seen.add(next.path);
      if (await this.#send(next.path)) return; // Netz oder Zugang fehlen: Alles bleibt in der Warteschlange
    }
  }

  /** Eine Änderung hochladen. Wahr, wenn der Abgleich anhalten muss. */
  async #send(path: string): Promise<boolean> {
    const entry = await this.#store.get('outbox', path);
    if (!entry) return false;
    this.#current = path;
    try {
      if (entry.deleted) await this.#sendDelete(entry);
      else await this.#sendWrite(entry);
      return false;
    } catch (error) {
      if (this.#noteStop(error)) return true;
      // Ein nicht erlaubter Pfad wird nie erlaubt: Die Änderung bleibt nicht ewig in der Warteschlange.
      if (error instanceof PathNotAllowedError) await this.#store.delete('outbox', path);
      this.onError?.({ path, error });
      return false;
    } finally {
      this.#current = null;
    }
  }

  async #sendWrite(entry: OutboxEntry): Promise<void> {
    // Steht wieder der Text von GitHub da (Haken gesetzt und zurückgenommen), gibt es nichts hochzuladen.
    if (entry.baseSha !== null && entry.text === entry.baseText) {
      return this.#settle(entry, { sha: entry.baseSha, text: entry.text });
    }
    try {
      const { sha } = await this.#call(() => this.#client.putFile(entry.path, entry.text, entry.baseSha, this.#message(entry.path)));
      await this.#settle(entry, { sha, text: entry.text });
    } catch (error) {
      if (!(error instanceof ConflictError)) throw error;
      await this.#resolveConflict(entry.path);
    }
  }

  /**
   * Auf GitHub liegt jetzt `uploaded` (oder war schon). Ist seit dem Start nichts geschrieben worden, wird das die
   * lokale Kopie und die Änderung erledigt. Wurde währenddessen weitergeschrieben, bleibt die neuere Fassung in der
   * Warteschlange: Beruht sie auf dem Hochgeladenen, wird dies ihre neue Grundlage. Wurde dagegen zusammengeführt,
   * beruht sie auf dem alten Stand und wird beim nächsten Abgleich selbst zusammengeführt.
   */
  async #settle(sent: OutboxEntry, uploaded: Remote): Promise<void> {
    const { path } = sent;
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const [record, current] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
    const writes: Promise<unknown>[] = [];
    let pageChanged = false;
    if (!current || (current.text === sent.text && !current.deleted)) {
      if (current) writes.push(tx.objectStore('outbox').delete(path));
      writes.push(tx.objectStore('files').put({ path, text: uploaded.text, sha: uploaded.sha, base: uploaded.text, syncedAt: Date.now() }));
      pageChanged = uploaded.text !== sent.text;
    } else if (uploaded.text === sent.text) {
      writes.push(tx.objectStore('outbox').put({ ...current, baseSha: uploaded.sha, baseText: uploaded.text }));
      if (record) writes.push(tx.objectStore('files').put({ ...record, sha: uploaded.sha, base: uploaded.text, syncedAt: Date.now() }));
    }
    await Promise.all([...writes, tx.done]);
    if (pageChanged) this.onRemoteChange?.([path]);
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
        const merged = this.#merge(entry, remote.text);
        if (merged === null) return this.#keepRemote(entry, remote);
        if (merged === remote.text) return this.#settle(entry, remote); // GitHub hat schon alles, nichts hochzuladen
        text = merged;
        baseSha = remote.sha;
      }
      try {
        const { sha } = await this.#call(() => this.#client.putFile(path, text, baseSha, this.#message(path)));
        return await this.#settle(entry, { sha, text });
      } catch (error) {
        if (!(error instanceof ConflictError)) throw error; // sonst hat sich die Datei schon wieder geändert: noch einmal
      }
    }
    throw new Error('Die Datei auf GitHub ändert sich laufend. Der Abgleich versucht es später noch einmal.');
  }

  /** Der zusammengeführte Text, oder `null`, wenn sich beide Fassungen nicht sicher vereinen lassen. */
  #merge(entry: OutboxEntry, remoteText: string): string | null {
    if (entry.text === remoteText) return remoteText;
    if (entry.kind === 'md') {
      const result = mergeText(entry.baseText ?? '', entry.text, remoteText);
      return result.ok ? result.text : null;
    }
    try {
      return mergePages(entry.text, remoteText);
    } catch {
      return null; // eine der beiden Seiten ist nicht lesbar
    }
  }

  /**
   * Der fremde Stand bleibt, die eigene Fassung geht als Kopie in die Warteschlange. Das geschieht in einem Zug, damit
   * auch bei einem Absturz oder Netzausfall nach der Entscheidung nichts fehlt. Die Kopie enthält die neueste eigene Fassung.
   */
  async #keepRemote(entry: OutboxEntry, remote: Remote): Promise<void> {
    const { path } = entry;
    const copyPath = await this.#freeCopyPath(path);
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const current = await tx.objectStore('outbox').get(path);
    const wantsCopy = !current?.deleted; // wer die Seite inzwischen gelöscht hat, braucht keine Kopie
    const ours = current && !current.deleted ? current.text : entry.text;
    const writes: Promise<unknown>[] = [
      tx.objectStore('files').put({ path, text: remote.text, sha: remote.sha, base: remote.text, syncedAt: Date.now() }),
      tx.objectStore('outbox').delete(path),
    ];
    if (wantsCopy) {
      writes.push(
        tx.objectStore('outbox').put({ path: copyPath, text: ours, kind: entry.kind, baseSha: null, baseText: null, queuedAt: Date.now() }),
        tx.objectStore('files').put({ path: copyPath, text: ours, sha: null, base: null, syncedAt: 0 }),
      );
    }
    await Promise.all([...writes, tx.done]);
    if (wantsCopy) this.onConflict?.({ path, copyPath });
    this.onRemoteChange?.([path]);
  }

  /** Name für die Konfliktkopie: `(Konflikt)`, dann `(Konflikt 2)` und so weiter. Eine ältere Kopie wird nie überschrieben. */
  async #freeCopyPath(path: string): Promise<string> {
    const first = conflictPath(path);
    const marker = ' (Konflikt)';
    const at = first.lastIndexOf(marker);
    for (let n = 1; n <= MAX_COPY_NUMBER; n++) {
      const candidate = n === 1 ? first : `${first.slice(0, at)} (Konflikt ${n})${first.slice(at + marker.length)}`;
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
        sha = remote.sha;
      }
      const version = sha;
      await this.#call(() => this.#client.deleteFile(path, version, this.#message(path)));
      await this.#settleDelete(entry);
    } catch (error) {
      if (error instanceof ConflictError) return this.#cancelDelete(entry);
      if (isStop(error) || error instanceof PathNotAllowedError) throw error;
      // Eine fehlende Datei meldet der Client als allgemeinen Fehler (404). Ist sie weg, ist das Löschen erledigt.
      if ((await this.#call(() => this.#client.getFile(path))) === null) return this.#settleDelete(entry);
      throw error;
    }
  }

  /** Die Datei ist auf GitHub weg. Wurde danach wieder geschrieben, ist das jetzt eine neue Datei. */
  async #settleDelete(sent: OutboxEntry): Promise<void> {
    const { path } = sent;
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const [record, current] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
    const writes: Promise<unknown>[] = [];
    if (current?.deleted) writes.push(tx.objectStore('outbox').delete(path));
    else if (current) {
      writes.push(tx.objectStore('outbox').put({ ...current, baseSha: null, baseText: null }));
      if (record) writes.push(tx.objectStore('files').put({ ...record, sha: null, base: null }));
    }
    await Promise.all([...writes, tx.done]);
  }

  /** Die Datei hat sich auf GitHub geändert, seit das Löschen vorgemerkt wurde: Das Löschen entfällt, der neue Stand bleibt. */
  async #cancelDelete(sent: OutboxEntry): Promise<void> {
    const { path } = sent;
    const remote = await this.#call(() => this.#client.getFile(path));
    if (!remote) return this.#settleDelete(sent);
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const current = await tx.objectStore('outbox').get(path);
    const writes: Promise<unknown>[] = [];
    if (current?.deleted) {
      writes.push(
        tx.objectStore('outbox').delete(path),
        tx.objectStore('files').put({ path, text: remote.text, sha: remote.sha, base: remote.text, syncedAt: Date.now() }),
      );
    }
    await Promise.all([...writes, tx.done]);
    if (current?.deleted) this.onRemoteChange?.([path]);
  }

  // ---------- Fremde Änderungen ----------

  /**
   * Fragt GitHub, ob sich seit der letzten Abfrage etwas geändert hat, und frischt die Kopien auf, die keine offene
   * Änderung haben. Beim ersten Mal merkt sie sich nur den Stand. Fehler kommen nie nach außen.
   */
  async pollRemote(): Promise<void> {
    try {
      const head = await this.#call(() => this.#client.headSha());
      const last = await this.#store.get('meta', 'lastHead');
      if (last === undefined) {
        await this.#store.put('meta', head, 'lastHead');
        return;
      }
      if (last === head) return;
      let changed: string[] = [];
      try {
        changed = await this.#call(() => this.#client.changedFiles(last, head));
      } catch (error) {
        // Kennt GitHub den alten Stand nicht mehr, soll die Abfrage nicht für immer hängen. Geöffnete Dateien frischt `read` auf.
        if (isStop(error)) throw error;
      }
      const refreshed: string[] = [];
      for (const path of new Set(changed)) {
        try {
          if (await this.#refreshCopy(path)) refreshed.push(path);
        } catch (error) {
          if (isStop(error)) throw error;
          this.onError?.({ path, error }); // eine kaputte Datei hält die anderen nicht auf
        }
      }
      if (refreshed.length > 0) this.onRemoteChange?.(refreshed);
      await this.#store.put('meta', head, 'lastHead');
    } catch (error) {
      if (!this.#noteStop(error)) this.onError?.({ path: '', error });
    }
  }

  /** Holt eine Datei, die lokal vorliegt und keine offene Änderung hat, neu. Wahr, wenn die Kopie dadurch neu ist. */
  async #refreshCopy(path: string): Promise<boolean> {
    const record = await this.#store.get('files', path);
    if (!record || (await this.#store.get('outbox', path))) return false;
    const remote = await this.#call(() => this.#client.getFile(path));
    if (!remote || remote.sha === record.sha) return false;
    return this.#adopt(path, record, remote);
  }

  /** Übernimmt den fremden Stand, wenn in der Zwischenzeit weder geschrieben noch hochgeladen wurde. */
  async #adopt(path: string, seen: FileRecord, remote: Remote): Promise<boolean> {
    const tx = this.#store.transaction(['files', 'outbox'], 'readwrite');
    const [record, queued] = await Promise.all([tx.objectStore('files').get(path), tx.objectStore('outbox').get(path)]);
    const fresh = !queued && record !== undefined && record.sha === seen.sha;
    if (fresh) await tx.objectStore('files').put({ path, text: remote.text, sha: remote.sha, base: remote.text, syncedAt: Date.now() });
    await tx.done;
    return fresh;
  }

  async #refreshInBackground(path: string): Promise<void> {
    try {
      if (await this.#refreshCopy(path)) this.onRemoteChange?.([path]);
    } catch (error) {
      if (!this.#noteStop(error)) this.onError?.({ path, error });
    }
  }
}
