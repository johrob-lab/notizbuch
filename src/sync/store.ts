import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
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
  /** Die neueste Fassung. */
  text: string;
  kind: 'md' | 'svg';
  /** sha und Text der Fassung auf GitHub, aus der die Änderung entstand (beim ersten Schreiben festgehalten). */
  baseSha: string | null;
  baseText: string | null;
  queuedAt: number;
  /** Die Datei soll auf GitHub gelöscht werden. */
  deleted?: boolean;
};

export interface NotizbuchDB extends DBSchema {
  files: { key: string; value: FileRecord };
  outbox: { key: string; value: OutboxEntry };
  /** Ein einziger Eintrag unter dem Schlüssel `settings`. */
  settings: { key: string; value: Settings };
  /** Zum Beispiel `lastHead`: der letzte Commit auf `main`, den die Abfrage gesehen hat. */
  meta: { key: string; value: string };
}

export type Store = IDBPDatabase<NotizbuchDB>;

export function openStore(name = 'notizbuch'): Promise<Store> {
  return openDB<NotizbuchDB>(name, 1, {
    upgrade(db) {
      db.createObjectStore('files', { keyPath: 'path' });
      db.createObjectStore('outbox', { keyPath: 'path' });
      db.createObjectStore('settings');
      db.createObjectStore('meta');
    },
  });
}
