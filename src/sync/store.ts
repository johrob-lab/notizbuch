import { openDB, type DBSchema, type IDBPDatabase, type IDBPTransaction, type StoreKey, type StoreNames, type StoreValue } from 'idb';
import type { Settings } from '../lib/settings';

// Der lokale Speicher im Browser (IndexedDB). Nur hier liegen Dateien, Warteschlange, Einstellungen und der Token.

/** Eine Datei, wie dieses Gerät sie kennt. */
export type FileRecord = {
  path: string;
  /** Lokale Fassung, auch mit Änderungen, die noch nicht hochgeladen sind. */
  text: string;
  /** sha der Fassung auf GitHub, auf der `base` beruht. `null`, solange es die Datei dort nicht gibt. */
  sha: string | null;
  /** Text dieser Fassung auf GitHub. Beim Zusammenführen ist das der gemeinsame Ausgangspunkt. */
  base: string | null;
  /** Zeitpunkt des letzten Abgleichs mit GitHub (ms seit 1970), 0 für eine Datei, die noch nie oben war. */
  syncedAt: number;
};

/** Eine Änderung, die noch nicht auf GitHub ist. Je Pfad gibt es höchstens eine. */
export type OutboxEntry = {
  path: string;
  /** Die neueste Fassung. Bei einer Löschung die letzte lokale Fassung: Ohne bekannte sha löscht der Abgleich nur genau sie. */
  text: string;
  kind: 'md' | 'svg';
  /** sha und Text der Fassung auf GitHub, aus der die Änderung entstand (beim ersten Schreiben festgehalten). */
  baseSha: string | null;
  baseText: string | null;
  queuedAt: number;
  /** Die Datei soll auf GitHub gelöscht werden. */
  deleted?: boolean;
};

/** Die Kopie einer Datei, die genau dem Stand entspricht, der auf GitHub liegt. */
export function syncedRecord(path: string, remote: { text: string; sha: string }): FileRecord {
  return { path, text: remote.text, sha: remote.sha, base: remote.text, syncedAt: Date.now() };
}

export interface NotizbuchDB extends DBSchema {
  files: { key: string; value: FileRecord };
  outbox: { key: string; value: OutboxEntry };
  /** Ein einziger Eintrag unter dem Schlüssel `settings`. */
  settings: { key: string; value: Settings };
  /** Zum Beispiel `lastHead`: der letzte Commit auf `main`, den die Abfrage gesehen hat. */
  meta: { key: string; value: string };
}

type Db = IDBPDatabase<NotizbuchDB>;
type Area = StoreNames<NotizbuchDB>;
/** Eine Schreib-Transaktion, in der eine Funktion Bereiche der Datenbank liest und ändert. */
export type StoreTx = IDBPTransaction<NotizbuchDB, Area[], 'readwrite'>;

const VERSION = 1;

function nameOf(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
}

/** Ist die Verbindung zu? Dann wirft jeder Zugriff darauf `InvalidStateError`. */
function isClosedConnection(error: unknown): boolean {
  return nameOf(error) === 'InvalidStateError';
}

/** So bricht der Browser einen laufenden Zugriff ab, wenn er die Verbindung beendet (WebKit meldet `UnknownError`). */
function isAbort(error: unknown): boolean {
  return nameOf(error) === 'AbortError' || nameOf(error) === 'UnknownError';
}

/** Wartet auf die nächste Aufgabe der Ereignisschleife. */
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Der lokale Speicher. Safari beendet die Verbindung zur IndexedDB gern, wenn die App im Hintergrund war, und kein
 * Zugriff geht danach mehr. Darum öffnet der Speicher sie neu: sofort, wenn der Browser das Beenden meldet (Ereignis
 * `close`), sonst beim ersten Zugriff, der an einem `InvalidStateError` scheitert. Ein Zugriff, den der Browser beim
 * Beenden mitten im Lauf abbricht (`AbortError`, in WebKit `UnknownError`), wartet noch die Meldung ab, die erst
 * danach kommt. Der Zugriff läuft dann noch einmal. Das ist sicher, weil jeder Zugriff der App ganze Werte schreibt oder
 * löscht: Zweimal ausgeführt ergibt er dasselbe wie einmal. Wer den Speicher mit `close()` selbst schließt, will ihn zu
 * haben und bekommt ihn nicht neu geöffnet, auch nicht, wenn das Schließen mitten in ein Neuöffnen fällt.
 */
export class Store {
  readonly #name: string;
  #db!: Db;
  /** Zählt die Verbindungen: Das `close`-Ereignis einer älteren sagt nichts über die jetzige. */
  #generation = 0;
  /** Der Browser hat die jetzige Verbindung beendet, der nächste Zugriff öffnet neu. */
  #lost = false;
  #closed = false;
  #connecting: Promise<void> | null = null;

  private constructor(name: string) {
    this.#name = name;
  }

  static async open(name: string): Promise<Store> {
    const store = new Store(name);
    await store.#connect();
    return store;
  }

  async #connect(): Promise<void> {
    const generation = ++this.#generation;
    this.#lost = false;
    const previous = this.#db as Db | undefined;
    const db = await openDB<NotizbuchDB>(this.#name, VERSION, {
      upgrade(upgrading) {
        upgrading.createObjectStore('files', { keyPath: 'path' });
        upgrading.createObjectStore('outbox', { keyPath: 'path' });
        upgrading.createObjectStore('settings');
        upgrading.createObjectStore('meta');
      },
      terminated: () => {
        if (generation === this.#generation) this.#lost = true;
      },
    });
    if (this.#closed) {
      // `close()` kam, während geöffnet wurde: Die neue Verbindung darf nicht offen bleiben, und der Zugriff scheitert wie jeder andere.
      db.close();
      throw new DOMException('Der Speicher wurde geschlossen.', 'InvalidStateError');
    }
    this.#db = db;
    // Die ersetzte Verbindung darf nicht offen bleiben, sonst hielte sie spätere Änderungen an der Datenbank auf.
    try {
      previous?.close();
    } catch {
      // war schon zu
    }
  }

  /** Öffnet neu, wenn `failed` noch die jetzige Verbindung ist. Gleichzeitige Zugriffe teilen sich einen Versuch. */
  #reconnect(failed: Db): Promise<void> {
    if (this.#db !== failed) return Promise.resolve(); // ein anderer Zugriff war schneller
    this.#connecting ??= this.#connect().finally(() => {
      this.#connecting = null;
    });
    return this.#connecting;
  }

  /**
   * Führt `work` mit der Verbindung aus. Ist sie zu, oder hat der Browser sie währenddessen beendet, wird neu geöffnet
   * und `work` noch einmal ausgeführt.
   */
  async run<T>(work: (db: Db) => Promise<T>): Promise<T> {
    if (this.#lost && !this.#closed) await this.#reconnect(this.#db);
    const db = this.#db;
    const generation = this.#generation;
    try {
      return await work(db);
    } catch (error) {
      if (this.#closed) throw error;
      let connectionLost = isClosedConnection(error) || (this.#lost && this.#db === db);
      if (!connectionLost && isAbort(error)) {
        // Beendet der Browser die Verbindung, bricht er zuerst die laufenden Zugriffe ab und meldet das Ende (`close`) erst
        // danach. Der Abbruch ist hier also früher als die Meldung: Eine Aufgabe abzuwarten, schafft die Reihenfolge.
        // Hat ein anderer Zugriff die Meldung inzwischen gesehen und schon neu geöffnet, steht `#lost` wieder auf falsch.
        // Dass die Zählung der Verbindungen weitergerückt ist, zeigt dasselbe.
        await nextTask();
        connectionLost = !this.#closed && (this.#generation !== generation || this.#lost);
      }
      if (!connectionLost) throw error;
      await this.#reconnect(db);
      return work(this.#db);
    }
  }

  /**
   * Eine Schreib-Transaktion über `areas`. Gelingt `work`, gilt alles, was es geschrieben hat, sonst nichts davon. Wegen
   * des zweiten Versuchs darf `work` außer der Datenbank nichts verändern: Meldungen an die Oberfläche kommen danach.
   */
  transact<T>(areas: Area[], work: (tx: StoreTx) => Promise<T>): Promise<T> {
    return this.run(async (db) => {
      const tx = db.transaction(areas, 'readwrite');
      try {
        const result = await work(tx);
        await tx.done;
        return result;
      } catch (error) {
        tx.done.catch(() => undefined); // der Abbruch unten soll nicht als unbehandelter Fehler enden
        try {
          tx.abort();
        } catch {
          // schon übernommen oder abgebrochen
        }
        throw error;
      }
    });
  }

  get<A extends Area>(area: A, key: StoreKey<NotizbuchDB, A> | IDBKeyRange): Promise<StoreValue<NotizbuchDB, A> | undefined> {
    return this.run((db) => db.get(area, key));
  }

  getAll<A extends Area>(area: A): Promise<StoreValue<NotizbuchDB, A>[]> {
    return this.run((db) => db.getAll(area));
  }

  count(area: Area): Promise<number> {
    return this.run((db) => db.count(area));
  }

  put<A extends Area>(area: A, value: StoreValue<NotizbuchDB, A>, key?: StoreKey<NotizbuchDB, A> | IDBKeyRange): Promise<StoreKey<NotizbuchDB, A>> {
    return this.run((db) => db.put(area, value, key));
  }

  delete<A extends Area>(area: A, key: StoreKey<NotizbuchDB, A> | IDBKeyRange): Promise<void> {
    return this.run((db) => db.delete(area, key));
  }

  get objectStoreNames(): Db['objectStoreNames'] {
    return this.#db.objectStoreNames;
  }

  /** Schließt den Speicher für immer. Danach scheitert jeder Zugriff. */
  close(): void {
    this.#closed = true;
    this.#db.close();
  }
}

export function openStore(name = 'notizbuch'): Promise<Store> {
  return Store.open(name);
}
