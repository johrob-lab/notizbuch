import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { OfflineError, type CopyClient, type CopyEntry } from '../sync/github';
import { isCopyPath } from '../sync/paths';

// Die Kopie des Vaults am iPad: Text jeder Notiz, die Claude durchsuchen darf, in einer eigenen IndexedDB.
// Sie liegt nie im Vault und nie im Repo und hat mit der Datenbank der App nichts zu tun.

/** Eine Datei der Kopie. `sha` ist die des Blobs auf GitHub, damit das Auffrischen nur Geändertes holt. */
export type KopieDatei = { path: string; sha: string; text: string };

export type KopieStand = {
  /** Dateien, die in der Kopie liegen. */
  geladen: number;
  /** Dateien laut letztem Baum (vor dem ersten Baum gleich `geladen`). */
  gesamt: number;
  /** `meta.head` ist der zuletzt gesehene Kopf. */
  vollstaendig: boolean;
  /** Das letzte Auffrischen scheiterte an fehlendem Netz. */
  ohneNetz: boolean;
};

interface GehirnDB extends DBSchema {
  dateien: { key: string; value: KopieDatei };
  /** `head` (Commit, bis zu dem die Kopie vollständig ist) und `gesamt` (Zahl der Dateien im letzten Baum). */
  meta: { key: string; value: string | number };
}

type Db = IDBPDatabase<GehirnDB>;

const VORGABE = 'notizbuch-gehirn';
/** So viele Blobs sind höchstens zugleich unterwegs. */
const ZUGLEICH = 4;

const nachPfad = (a: KopieDatei, b: KopieDatei) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

export class Kopie {
  #db: Db;
  readonly #name: string;
  /** `close()` kam: Die Datenbank wird nicht neu geöffnet. */
  #geschlossen = false;
  /** Nach Pfad sortiert, wird nach jedem Speichern ersetzt (kein Umbau bei jedem Lesen). */
  #dateien: readonly KopieDatei[];
  #nachPfad = new Map<string, KopieDatei>();
  /** Der Kopf, bis zu dem die Kopie vollständig ist (`meta.head`). */
  #head: string | undefined;
  /** Der zuletzt bei GitHub gesehene Kopf. */
  #gesehen: string | undefined;
  #gesamt: number | undefined;
  #ohneNetz = false;
  #lauf: Promise<KopieStand> | null = null;

  private constructor(name: string, db: Db, dateien: KopieDatei[], head: string | undefined, gesamt: number | undefined) {
    this.#name = name;
    this.#db = db;
    this.#dateien = [...dateien].sort(nachPfad);
    for (const d of this.#dateien) this.#nachPfad.set(d.path, d);
    this.#head = head;
    this.#gesehen = head;
    this.#gesamt = gesamt;
  }

  static #verbinde(name: string): Promise<Db> {
    return openDB<GehirnDB>(name, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore('dateien', { keyPath: 'path' });
        upgrading.createObjectStore('meta');
      },
    });
  }

  static async open(name = VORGABE): Promise<Kopie> {
    const db = await Kopie.#verbinde(name);
    const [dateien, head, gesamt] = await Promise.all([db.getAll('dateien'), db.get('meta', 'head'), db.get('meta', 'gesamt')]);
    return new Kopie(name, db, dateien, typeof head === 'string' ? head : undefined, typeof gesamt === 'number' ? gesamt : undefined);
  }

  dateien(): readonly KopieDatei[] {
    return this.#dateien;
  }

  text(path: string): string | null {
    return this.#nachPfad.get(path)?.text ?? null;
  }

  stand(): KopieStand {
    const geladen = this.#dateien.length;
    return {
      geladen,
      gesamt: this.#gesamt ?? geladen,
      vollstaendig: this.#head !== undefined && this.#head === this.#gesehen,
      ohneNetz: this.#ohneNetz,
    };
  }

  /**
   * Bringt die Kopie auf den Stand von GitHub. Wirft nie: Netzfehler setzen `ohneNetz`, andere Fehler lassen die Kopie,
   * wie sie ist. Läuft schon ein Auffrischen, bekommt der Aufruf dasselbe Versprechen (so geht keine Änderung verloren).
   */
  auffrischen(client: CopyClient, onStand?: (s: KopieStand) => void): Promise<KopieStand> {
    this.#lauf ??= this.#auffrischen(client, onStand).finally(() => {
      this.#lauf = null;
    });
    return this.#lauf;
  }

  async #auffrischen(client: CopyClient, onStand?: (s: KopieStand) => void, nochmal = true): Promise<KopieStand> {
    const melden = () => {
      try {
        onStand?.(this.stand());
      } catch {
        // ein Fehler in der Oberfläche darf das Laden nicht stoppen
      }
    };
    try {
      const kopf = await client.headSha();
      this.#gesehen = kopf;
      this.#ohneNetz = false;
      if (kopf === this.#head) {
        melden();
        return this.stand();
      }
      const baum = await client.vaultTree(kopf);
      // Die Pfadregel gilt hier noch einmal, auch wenn der Client sie schon angewendet hat.
      const entries = baum.entries.filter((e) => isCopyPath(e.path));
      this.#gesamt = entries.length;
      await this.#db.put('meta', entries.length, 'gesamt');
      if (!baum.truncated) await this.#entferneFehlende(new Set(entries.map((e) => e.path)));
      melden();
      const offen = entries.filter((e) => this.#nachPfad.get(e.path)?.sha !== e.sha);
      await this.#hole(client, offen, melden);
      // Erst nach dem letzten Blob. Ein gekürzter Baum ist nie vollständig.
      if (!baum.truncated) {
        await this.#db.put('meta', kopf, 'head');
        this.#head = kopf;
      }
    } catch (fehler) {
      if (fehler instanceof OfflineError) this.#ohneNetz = true;
      else if (nochmal && !this.#geschlossen && (fehler as { name?: unknown } | null)?.name === 'InvalidStateError') {
        // Safari hat die Verbindung im Hintergrund beendet. Jeder Schritt ist wiederholbar, also neu öffnen und einmal noch.
        try {
          const neu = await Kopie.#verbinde(this.#name);
          if (this.#geschlossen) {
            neu.close();
          } else {
            const alt = this.#db;
            this.#db = neu;
            try {
              alt.close();
            } catch {
              // war schon zu
            }
            return await this.#auffrischen(client, onStand, false);
          }
        } catch {
          // das Neuöffnen scheiterte: Die Kopie bleibt, wie sie ist
        }
      }
    }
    melden();
    return this.stand();
  }

  /** Was im Baum fehlt (oder nicht in die Kopie darf), fliegt aus Speicher und Datenbank. */
  async #entferneFehlende(imBaum: Set<string>): Promise<void> {
    const weg = this.#dateien.filter((d) => !imBaum.has(d.path) || !isCopyPath(d.path)).map((d) => d.path);
    if (weg.length === 0) return;
    const tx = this.#db.transaction('dateien', 'readwrite');
    await Promise.all([...weg.map((p) => tx.store.delete(p)), tx.done]);
    for (const p of weg) this.#nachPfad.delete(p);
    this.#dateien = this.#dateien.filter((d) => this.#nachPfad.has(d.path));
  }

  /** Holt die Blobs, höchstens `ZUGLEICH` auf einmal, und speichert jeden sofort. Der erste Fehler stoppt neue Anfragen. */
  async #hole(client: CopyClient, offen: CopyEntry[], melden: () => void): Promise<void> {
    let nächste = 0;
    let fehler: unknown;
    let fehlgeschlagen = false;
    const arbeiter = async () => {
      while (!fehlgeschlagen && nächste < offen.length) {
        const eintrag = offen[nächste++]!;
        try {
          const text = await client.copyText(eintrag);
          await this.#speichere({ path: eintrag.path, sha: eintrag.sha, text });
          melden();
        } catch (e) {
          if (!fehlgeschlagen) fehler = e;
          fehlgeschlagen = true;
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(ZUGLEICH, offen.length) }, arbeiter));
    if (fehlgeschlagen) throw fehler;
  }

  async #speichere(datei: KopieDatei): Promise<void> {
    if (!isCopyPath(datei.path)) return;
    await this.#db.put('dateien', datei);
    this.#nachPfad.set(datei.path, datei);
    this.#dateien = [...this.#nachPfad.values()].sort(nachPfad);
  }

  close(): void {
    this.#geschlossen = true;
    this.#db.close();
  }
}

let imSpeicher: Kopie | null = null;

/** Die Kopie dieser Sitzung, für die Tagesnotiz der offenen Seite. */
export function kopieImSpeicher(): Kopie | null {
  return imSpeicher;
}

export function setzeKopieImSpeicher(k: Kopie | null): void {
  imSpeicher = k;
}
