import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import { isNotUtf8 } from '../sync/base64';
import { OfflineError, withTimeout, type CopyClient, type CopyEntry } from '../sync/github';
import { isCopyPath } from '../sync/paths';

// Die Kopie des Vaults am iPad: Text jeder Notiz, die Claude durchsuchen darf, in einer eigenen IndexedDB.
// Sie liegt nie im Vault und nie im Repo und hat mit der Datenbank der App nichts zu tun. Sie gehört zu genau einem Repo.

/** Eine Datei der Kopie. `sha` ist die des Blobs auf GitHub, damit das Auffrischen nur Geändertes holt. */
export type KopieDatei = { path: string; sha: string; text: string };

export type KopieStand = {
  /** Dateien, die in der Kopie liegen. */
  geladen: number;
  /** Dateien laut letztem Baum ohne die, die kein UTF-8 sind (vor dem ersten Baum gleich `geladen`). */
  gesamt: number;
  /** `meta.head` ist der zuletzt gesehene Kopf. */
  vollstaendig: boolean;
  /** Das letzte Auffrischen scheiterte an fehlendem Netz. */
  ohneNetz: boolean;
};

interface GehirnDB extends DBSchema {
  dateien: { key: string; value: KopieDatei };
  /**
   * `repo` (das Repo der Kopie, `owner/name`), `head` (Commit, bis zu dem die Kopie vollständig ist), `gesamt` (Zahl der lesbaren
   * Dateien im letzten Baum) und `unlesbar` (die shas der Dateien, die kein UTF-8 sind).
   */
  meta: { key: string; value: string | number | string[] };
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
  /** Die shas der Dateien, die kein UTF-8 sind: Sie kommen nicht in die Kopie und werden nicht noch einmal geholt. */
  #unlesbar: Set<string>;
  #ohneNetz = false;
  #lauf: Promise<KopieStand> | null = null;

  private constructor(
    name: string,
    db: Db,
    dateien: KopieDatei[],
    head: string | undefined,
    gesamt: number | undefined,
    unlesbar: Set<string>,
  ) {
    this.#name = name;
    this.#db = db;
    this.#dateien = [...dateien].sort(nachPfad);
    for (const d of this.#dateien) this.#nachPfad.set(d.path, d);
    this.#head = head;
    this.#gesehen = head;
    this.#gesamt = gesamt;
    this.#unlesbar = unlesbar;
  }

  static #verbinde(name: string): Promise<Db> {
    return openDB<GehirnDB>(name, 1, {
      upgrade(upgrading) {
        upgrading.createObjectStore('dateien', { keyPath: 'path' });
        upgrading.createObjectStore('meta');
      },
    });
  }

  /**
   * Öffnet die Kopie für `repo` (`owner/name` aus den Einstellungen). Gehört sie zu einem anderen Repo oder steht keines dabei, wird
   * sie zuerst ganz geleert: So lässt sich nichts aus dem alten Vault lesen oder finden, und das nächste Auffrischen lädt wie beim
   * ersten Mal.
   */
  static async open(repo: string, name = VORGABE): Promise<Kopie> {
    const db = await Kopie.#verbinde(name);
    try {
      if ((await db.get('meta', 'repo')) !== repo) {
        const tx = db.transaction(['dateien', 'meta'], 'readwrite');
        const meta = tx.objectStore('meta');
        await Promise.all([tx.objectStore('dateien').clear(), meta.clear(), meta.put(repo, 'repo'), tx.done]);
      }
      const [dateien, head, gesamt, unlesbar] = await Promise.all([
        db.getAll('dateien'),
        db.get('meta', 'head'),
        db.get('meta', 'gesamt'),
        db.get('meta', 'unlesbar'),
      ]);
      return new Kopie(
        name,
        db,
        dateien,
        typeof head === 'string' ? head : undefined,
        typeof gesamt === 'number' ? gesamt : undefined,
        new Set(Array.isArray(unlesbar) ? unlesbar : []),
      );
    } catch (fehler) {
      db.close();
      throw fehler;
    }
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
   * Jede Anfrage an GitHub hat die Zeitgrenze `CALL_TIMEOUT_MS`: Antwortet die Verbindung nie (das iPad kommt aus dem
   * Hintergrund), gilt das als fehlendes Netz, und der Lauf endet. Sonst bekäme jedes weitere Auffrischen diesen Lauf.
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
      const kopf = await withTimeout(() => client.headSha());
      this.#gesehen = kopf;
      this.#ohneNetz = false;
      if (kopf === this.#head) {
        melden();
        return this.stand();
      }
      const baum = await withTimeout(() => client.vaultTree(kopf));
      // Die Pfadregel gilt hier noch einmal, auch wenn der Client sie schon angewendet hat.
      const entries = baum.entries.filter((e) => isCopyPath(e.path));
      // Als unlesbar gemerkt bleibt nur, was der Baum noch nennt. Ein gekürzter Baum nennt nicht alles, dann bleibt alles gemerkt.
      const unlesbar = baum.truncated ? this.#unlesbar : new Set(entries.filter((e) => this.#unlesbar.has(e.sha)).map((e) => e.sha));
      const lesbar = entries.filter((e) => !unlesbar.has(e.sha));
      await this.#merke(lesbar.length, unlesbar);
      if (!baum.truncated) await this.#entferneFehlende(new Set(lesbar.map((e) => e.path)));
      melden();
      const offen = lesbar.filter((e) => this.#nachPfad.get(e.path)?.sha !== e.sha);
      await this.#hole(client, offen, entries, melden);
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

  /** Merkt `gesamt` und die unlesbaren shas, zuerst im Speicher, dann in einem Zug in der Datenbank. */
  async #merke(gesamt: number, unlesbar: Set<string>): Promise<void> {
    this.#gesamt = gesamt;
    this.#unlesbar = unlesbar;
    const tx = this.#db.transaction('meta', 'readwrite');
    await Promise.all([tx.store.put(gesamt, 'gesamt'), tx.store.put([...unlesbar], 'unlesbar'), tx.done]);
  }

  /** Was im Baum fehlt, nicht in die Kopie darf oder dort jetzt kein UTF-8 ist (`behalten` nennt es nicht), fliegt hinaus. */
  async #entferneFehlende(behalten: Set<string>): Promise<void> {
    const weg = this.#dateien.filter((d) => !behalten.has(d.path) || !isCopyPath(d.path)).map((d) => d.path);
    if (weg.length === 0) return;
    const tx = this.#db.transaction('dateien', 'readwrite');
    await Promise.all([...weg.map((p) => tx.store.delete(p)), tx.done]);
    for (const p of weg) this.#nachPfad.delete(p);
    this.#dateien = this.#dateien.filter((d) => this.#nachPfad.has(d.path));
  }

  /**
   * Holt die Blobs, höchstens `ZUGLEICH` auf einmal, und speichert jeden sofort. Eine Datei, die kein UTF-8 ist, bleibt draußen,
   * und das Holen geht weiter. Jeder andere Fehler (Netz, Server) stoppt neue Anfragen. `entries` ist der ganze Baum, nach ihm
   * zählt `gesamt`.
   */
  async #hole(client: CopyClient, offen: CopyEntry[], entries: readonly CopyEntry[], melden: () => void): Promise<void> {
    let nächste = 0;
    let fehler: unknown;
    let fehlgeschlagen = false;
    const arbeiter = async () => {
      while (!fehlgeschlagen && nächste < offen.length) {
        const eintrag = offen[nächste++]!;
        try {
          const text = await this.#lies(client, eintrag);
          if (text === null) await this.#unlesbarGefunden(eintrag, entries);
          else await this.#speichere({ path: eintrag.path, sha: eintrag.sha, text });
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

  /**
   * Der Text einer Datei, `null`, wenn sie kein UTF-8 ist. Das bleibt so, bis sich ihre sha ändert: Eine sha, die schon als unlesbar
   * bekannt ist (dieselbe Datei unter einem zweiten Pfad), wird nicht noch einmal geholt. Andere Fehler gehen weiter.
   */
  async #lies(client: CopyClient, eintrag: CopyEntry): Promise<string | null> {
    if (this.#unlesbar.has(eintrag.sha)) return null;
    try {
      return await withTimeout(() => client.copyText(eintrag));
    } catch (fehler) {
      if (isNotUtf8(fehler)) return null;
      throw fehler;
    }
  }

  /**
   * Die Datei ist kein UTF-8: Ihre sha wird gemerkt, eine ältere Fassung unter ihrem Pfad fliegt hinaus, und sie zählt nicht mehr
   * zu `gesamt`. So wird die Kopie trotzdem vollständig. Zuerst ändert sich alles im Speicher, ohne Warten dazwischen (finden zwei
   * Arbeiter zugleich eine unlesbare Datei, geht so keine verloren), dann schreibt ein Zug die Datenbank.
   */
  async #unlesbarGefunden(eintrag: CopyEntry, entries: readonly CopyEntry[]): Promise<void> {
    this.#unlesbar.add(eintrag.sha);
    if (this.#nachPfad.delete(eintrag.path)) this.#dateien = this.#dateien.filter((d) => d.path !== eintrag.path);
    const gesamt = entries.filter((e) => !this.#unlesbar.has(e.sha)).length;
    this.#gesamt = gesamt;
    const tx = this.#db.transaction(['dateien', 'meta'], 'readwrite');
    const meta = tx.objectStore('meta');
    await Promise.all([
      tx.objectStore('dateien').delete(eintrag.path),
      meta.put(gesamt, 'gesamt'),
      meta.put([...this.#unlesbar], 'unlesbar'),
      tx.done,
    ]);
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
