import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, Route } from '@playwright/test';
import type { Page as InkPage } from '../../../src/ink/types';

// Alles hier ist erfunden: Token, Repo und Dateien. Es geht keine Anfrage ins Netz, GitHub wird über page.route
// aus dem Mini-Vault in tests/fixtures/vault/ gespielt.

declare global {
  interface Window {
    /** Testzugang der App. Er enthält keine Geheimnisse und ist nur da, solange eine Seite offen ist. */
    __notizbuch: {
      currentPage(): InkPage;
      /** Seiteneinheiten in Bildschirmkoordinaten (clientX, clientY), wie sie ein Zeigerereignis braucht. */
      toClient(x: number, y: number): { x: number; y: number };
    };
  }
}

const VAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'fixtures', 'vault');
const REPO = 'muster/vault-test';
const TOKEN = 'test-zugang-0123456789';
/** Eine Datei, die der Preview-Server ausliefert, ohne dass App-Code läuft: Hier ist die Seite schon auf der Origin der App. */
const STATIC_URL = '/notizbuch/icons/icon-192.png';

export type Device = 'iPad' | 'Firmen-PC';
export type OpenOptions = {
  /** Jede Anfrage an GitHub scheitert wie ohne Netz. */
  offline?: boolean;
  /** Anfragen nach einer Datei antworten mit einem Serverfehler (500), bis `RepoMock.failReads` wieder `false` ist. */
  failReads?: boolean;
  /** Schreiben und Löschen (PUT, DELETE) antworten mit einem Serverfehler (500), bis `RepoMock.failWrites` wieder `false` ist. */
  failWrites?: boolean;
  device?: Device;
  /** Dateien, die zusätzlich im Repo liegen (oder die Fassung aus dem Mini-Vault ersetzen). */
  files?: Record<string, string>;
};

export type Put = { path: string; text: string; message: string; sha: string | null };
export type Delete = { path: string; sha: string; message: string };

/** Das Repo im Speicher. `puts` und `deletes` sind die Schreibzugriffe der App, in der Reihenfolge, in der sie ankamen. */
export type RepoMock = {
  puts: Put[];
  deletes: Delete[];
  /** Anfragen, die der Mock nicht kennt. Sie bekommen den Status 501. */
  unhandled: string[];
  /** Solange das `true` ist, antwortet GitHub auf jede Anfrage nach einer Datei mit einem Serverfehler (500). */
  failReads: boolean;
  /** Solange das `true` ist, antwortet GitHub auf jedes Schreiben und Löschen einer Datei mit einem Serverfehler (500). */
  failWrites: boolean;
  read(path: string): string | undefined;
  /** Eine Änderung von einem anderen Gerät: neuer Stand und neuer Commit, aber kein Eintrag in `puts`. */
  commit(path: string, text: string): void;
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

/** Die sha, die Git für diesen Inhalt vergibt. Gleicher Text, gleiche sha. */
function blobSha(text: string): string {
  const bytes = Buffer.from(text, 'utf8');
  return createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
}

/** Base64 mit Zeilenumbruch alle 60 Zeichen, so liefert GitHub Dateien aus. */
function githubBase64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64').replace(/(.{60})/g, '$1\n');
}

function createRepo(extra: Record<string, string>): RepoMock & { files: Map<string, string>; handle(route: Route): Promise<void> } {
  const files = new Map<string, string>();
  for (const full of walk(VAULT_DIR)) {
    const path = relative(VAULT_DIR, full).split(sep).join('/').normalize('NFC');
    files.set(path, readFileSync(full, 'utf8'));
  }
  for (const [path, text] of Object.entries(extra)) files.set(path.normalize('NFC'), text);

  const commits: { sha: string; paths: string[] }[] = [{ sha: blobSha('start'), paths: [] }];
  const puts: Put[] = [];
  const deletes: Delete[] = [];
  const unhandled: string[] = [];

  const head = () => commits[commits.length - 1].sha;
  const addCommit = (path: string) => {
    commits.push({ sha: blobSha(`commit ${commits.length} ${path}`), paths: [path] });
    return head();
  };
  const json = (route: Route, status: number, body: unknown) =>
    route.fulfill({
      status,
      contentType: 'application/json',
      headers: { 'access-control-allow-origin': '*' },
      body: JSON.stringify(body),
    });

  const contentsPrefix = `/repos/${REPO}/contents/`;

  /** Die Einträge eines Ordners, so wie die Contents-API sie liefert (Name, Pfad, sha, Art). Leer, wenn es den Ordner nicht gibt. */
  const folderEntries = (folder: string) => {
    const prefix = `${folder}/`;
    const entries = new Map<string, Record<string, string | number>>();
    for (const [filePath, fileText] of files) {
      if (!filePath.startsWith(prefix)) continue;
      const rest = filePath.slice(prefix.length);
      const slash = rest.indexOf('/');
      const name = slash === -1 ? rest : rest.slice(0, slash);
      if (entries.has(name)) continue;
      entries.set(
        name,
        slash === -1
          ? { type: 'file', name, path: filePath, sha: blobSha(fileText), size: Buffer.byteLength(fileText, 'utf8') }
          : { type: 'dir', name, path: `${folder}/${name}`, sha: blobSha(`tree ${folder}/${name}`), size: 0 },
      );
    }
    return [...entries.values()];
  };

  const mock: ReturnType<typeof createRepo> = {
    files,
    puts,
    deletes,
    unhandled,
    failReads: false,
    failWrites: false,
    read: (path) => files.get(path),
    commit(path, text) {
      files.set(path, text);
      addCommit(path);
    },
    async handle(route) {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const fail = () => {
        unhandled.push(`${method} ${url.pathname}`);
        return json(route, 501, { message: `Der Mock kennt ${method} ${url.pathname} nicht.` });
      };

      if (url.pathname.startsWith(contentsPrefix)) {
        const path = url.pathname
          .slice(contentsPrefix.length)
          .split('/')
          .map((part) => decodeURIComponent(part))
          .join('/')
          .normalize('NFC');
        const text = files.get(path);
        if (method === 'GET') {
          if (mock.failReads) return json(route, 500, { message: 'Server Error' });
          if (text === undefined) {
            // Ein Ordner: GitHub liefert die Liste seiner Dateien und Unterordner. Einen leeren oder fehlenden Ordner gibt es nicht (404).
            const entries = folderEntries(path);
            if (entries.length > 0) return json(route, 200, entries);
            return json(route, 404, { message: 'Not Found' });
          }
          return json(route, 200, {
            type: 'file',
            path,
            name: path.slice(path.lastIndexOf('/') + 1),
            sha: blobSha(text),
            size: Buffer.byteLength(text, 'utf8'),
            encoding: 'base64',
            content: githubBase64(text),
          });
        }
        if (mock.failWrites && (method === 'PUT' || method === 'DELETE')) return json(route, 500, { message: 'Server Error' });
        const body = request.postDataJSON() as { message: string; content?: string; sha?: string };
        if (method === 'PUT') {
          const newText = Buffer.from(body.content ?? '', 'base64').toString('utf8');
          if (text === undefined && body.sha) return json(route, 404, { message: 'Not Found' });
          if (text !== undefined && !body.sha) return json(route, 422, { message: 'Invalid request. "sha" wasn\'t supplied.' });
          if (text !== undefined && body.sha !== blobSha(text)) return json(route, 409, { message: `${path} does not match ${body.sha}` });
          files.set(path, newText);
          puts.push({ path, text: newText, message: body.message, sha: body.sha ?? null });
          return json(route, text === undefined ? 201 : 200, { content: { path, sha: blobSha(newText) }, commit: { sha: addCommit(path) } });
        }
        if (method === 'DELETE') {
          if (text === undefined) return json(route, 404, { message: 'Not Found' });
          if (body.sha !== blobSha(text)) return json(route, 409, { message: `${path} does not match ${body.sha}` });
          files.delete(path);
          deletes.push({ path, sha: body.sha, message: body.message });
          return json(route, 200, { commit: { sha: addCommit(path) } });
        }
        return fail();
      }

      if (method === 'GET' && url.pathname === `/repos/${REPO}/branches/main`) {
        return json(route, 200, { name: 'main', commit: { sha: head() } });
      }

      const compare = new RegExp(`^/repos/${REPO}/compare/([0-9a-f]+)\\.\\.\\.([0-9a-f]+)$`).exec(url.pathname);
      if (method === 'GET' && compare) {
        const from = commits.findIndex((c) => c.sha === compare[1]);
        const to = commits.findIndex((c) => c.sha === compare[2]);
        if (from < 0 || to < 0) return json(route, 404, { message: 'Not Found' });
        const paths = commits.slice(from + 1, to + 1).flatMap((c) => c.paths);
        return json(route, 200, { files: [...new Set(paths)].map((filename) => ({ filename })) });
      }

      const blob = new RegExp(`^/repos/${REPO}/git/blobs/([0-9a-f]+)$`).exec(url.pathname);
      if (method === 'GET' && blob) {
        const found = [...files.values()].find((t) => blobSha(t) === blob[1]);
        if (found === undefined) return json(route, 404, { message: 'Not Found' });
        return json(route, 200, { sha: blob[1], encoding: 'base64', content: githubBase64(found) });
      }

      return fail();
    },
  };
  return mock;
}

/**
 * Spielt die Einstellungen in die IndexedDB des Geräts, bevor die App startet, und öffnet dann `hash` (zum Beispiel
 * `#/tag/2026-10-29`). Dafür gibt es keinen Testcode in der App: Die Seite steht zuerst auf einer Datei des
 * Preview-Servers, schreibt dort mit `page.evaluate` und lädt dann erst die App.
 * GitHub antwortet aus dem Repo im Speicher, das der Rückgabewert beschreibt.
 */
export async function openSeeded(page: Page, hash: string, o: OpenOptions = {}): Promise<RepoMock> {
  const repo = createRepo(o.files ?? {});
  repo.failReads = o.failReads ?? false;
  repo.failWrites = o.failWrites ?? false;
  await page.route('https://api.github.com/**', (route) => (o.offline ? route.abort('internetdisconnected') : repo.handle(route)));

  const settings = {
    token: TOKEN,
    repo: REPO,
    device: o.device ?? 'iPad',
    smoothing: 'mittel',
    prediction: true,
  };
  await page.goto(STATIC_URL);
  await page.evaluate(
    (value) =>
      new Promise<void>((resolve, reject) => {
        // Muss zu src/sync/store.ts passen: Name, Version 1 und die vier Bereiche. Ändert sich dort etwas, hier ebenso.
        const open = indexedDB.open('notizbuch', 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          db.createObjectStore('files', { keyPath: 'path' });
          db.createObjectStore('outbox', { keyPath: 'path' });
          db.createObjectStore('settings');
          db.createObjectStore('meta');
        };
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('settings', 'readwrite');
          tx.objectStore('settings').put(value, 'settings');
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
      }),
    settings,
  );

  await page.goto(`/notizbuch/${hash}`);
  await page.waitForFunction(() => 'currentPage' in (window.__notizbuch ?? {}));
  return repo;
}

/**
 * Liest aus der IndexedDB der App, nur lesen. Ohne Schlüssel kommt die ganze Liste, ohne Datenbank `null`.
 * (`indexedDB.open` ohne Version würde eine fehlende Datenbank leer anlegen und der App den Start verderben.)
 */
function idbRead(page: Page, store: 'files' | 'outbox' | 'settings' | 'meta', key?: string): Promise<unknown> {
  return page.evaluate(
    ({ store: area, key: id }) =>
      new Promise<unknown>((resolve, reject) => {
        void indexedDB.databases().then((list) => {
          if (!list.some((d) => d.name === 'notizbuch')) return resolve(null);
          const open = indexedDB.open('notizbuch');
          open.onerror = () => reject(open.error);
          open.onsuccess = () => {
            const db = open.result;
            const objects = db.transaction(area, 'readonly').objectStore(area);
            const request = id === undefined ? objects.getAll() : objects.get(id);
            request.onerror = () => {
              db.close();
              reject(request.error);
            };
            request.onsuccess = () => {
              db.close();
              resolve(request.result ?? null);
            };
          };
        });
      }),
    { store, key },
  );
}

/** Die Warteschlange der App: Pfad und Text jeder Änderung, die noch nicht hochgeladen ist. */
export async function queued(page: Page): Promise<Record<string, string>> {
  const entries = ((await idbRead(page, 'outbox')) ?? []) as { path: string; text: string }[];
  return Object.fromEntries(entries.map((e) => [e.path, e.text]));
}

/** Die gespeicherten Einstellungen dieses Geräts. */
export async function savedSettings(page: Page): Promise<Record<string, unknown> | null> {
  return (await idbRead(page, 'settings', 'settings')) as Record<string, unknown> | null;
}

/** Der letzte Commit, den die Abfrage nach fremden Änderungen gesehen hat. `null`, solange sie noch nichts gemerkt hat. */
export async function lastHead(page: Page): Promise<string | null> {
  return (await idbRead(page, 'meta', 'lastHead')) as string | null;
}

/** Die App geht in den Hintergrund: Die Engine lädt dann sofort hoch, ohne die 10 Sekunden Wartezeit für Handschrift. */
export async function sendToBackground(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Die App kommt zurück in den Vordergrund: Die Engine fragt dann GitHub nach fremden Änderungen. */
export async function bringToForeground(page: Page): Promise<void> {
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

/** Das Netz ist wieder da: Das Gerät meldet `online`. */
export async function networkBack(page: Page): Promise<void> {
  await page.evaluate(() => {
    window.dispatchEvent(new Event('online'));
  });
}
