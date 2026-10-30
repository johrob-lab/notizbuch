import { base64ToUtf8, utf8ToBase64 } from './base64';
import { assertAllowedPath, hasBlockedWordPart, normalizePath, PathNotAllowedError, type Mode } from './paths';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const BRANCH = 'main';
const ACCEPT = 'application/vnd.github+json';
// Dateien zwischen 1 und 100 MB liefert die Contents-API nur im Objektformat, und dort ohne Inhalt (`encoding` ist `none`).
const ACCEPT_OBJECT = 'application/vnd.github.object+json';
// Die Contents-API liefert Dateien über 1 MB nicht mit Inhalt. Dann holt die Blob-API sie.
const MAX_INLINE_SIZE = 1_000_000;
// Die Contents-API liefert höchstens 1000 Einträge je Ordner und sagt nicht, ob sie damit abgeschnitten hat.
const CONTENTS_DIR_LIMIT = 1000;
const EXPIRY_HEADER = 'github-authentication-token-expiration';

// Die Namen der Fehlerklassen stehen als Text da, damit sie auch nach dem Verkleinern des Codes stimmen.
export class AuthError extends Error {
  constructor(message = 'Der Zugang zu GitHub wurde abgelehnt.') {
    super(message);
    this.name = 'AuthError';
  }
}

export class ConflictError extends Error {
  constructor(message = 'Die Datei wurde inzwischen geändert.') {
    super(message);
    this.name = 'ConflictError';
  }
}

export class OfflineError extends Error {
  // Der ursprüngliche Fehler von fetch gehört in `options.cause`, nie in die Meldung.
  constructor(message = 'Keine Verbindung zu GitHub.', options?: ErrorOptions) {
    super(message, options);
    this.name = 'OfflineError';
  }
}

export class RateLimitError extends Error {
  constructor(message = 'GitHub nimmt gerade keine weiteren Anfragen an.') {
    super(message);
    this.name = 'RateLimitError';
  }
}

export type DirEntry = { name: string; path: string; sha: string; type: 'file' | 'dir' };

/** Die Dateiliste eines Ordners im Vault. */
export type ListDir = (folder: string) => Promise<DirEntry[]>;

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function unexpected(): Error {
  return new Error('Unerwartete Antwort von GitHub.');
}

function parseJson(text: string): unknown {
  if (text === '') return null;
  try {
    return JSON.parse(text);
  } catch {
    throw unexpected();
  }
}

/** Jeder Pfadteil einzeln, die Schrägstriche dazwischen bleiben. */
function encodePath(path: string): string {
  return path.split('/').map(encodeURIComponent).join('/');
}

// `2027-10-29 10:00:00 UTC` oder mit Versatz wie `2027-10-29 10:00:00 +0200`. Gruppen: Datum und Uhrzeit, Vorzeichen, Stunden, Minuten.
const EXPIRY_FORMAT = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2}) (?:UTC|([+-])(\d{2})(\d{2}))$/;

/** Liest das Ablaufdatum aus der Kopfzeile von GitHub. Alles, was nicht passt oder kein echtes Datum ist, ergibt `null`. */
function parseTokenExpiry(value: string): Date | null {
  const m = EXPIRY_FORMAT.exec(value.trim());
  if (!m) return null;
  const [year, month, day, hour, minute, second] = m.slice(1, 7).map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;
  const utc = Date.UTC(year, month - 1, day, hour, minute, second);
  const date = new Date(utc);
  // Date.UTC rechnet den 30.02. still in den März um und Jahre unter 100 in 19xx. Beides gilt hier als unlesbar.
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  if (m[7] === undefined) return date;
  const offsetHours = Number(m[8]);
  const offsetMinutes = Number(m[9]);
  if (offsetHours > 14 || offsetMinutes > 59) return null;
  // Die Uhrzeit gilt im Versatz. UTC ist also Uhrzeit minus Versatz.
  const offset = (m[7] === '+' ? 1 : -1) * (offsetHours * 60 + offsetMinutes) * 60_000;
  return new Date(utc - offset);
}

/**
 * Anzeichen eines Ratenlimits in den Kopfzeilen: Das Kontingent ist verbraucht (`x-ratelimit-remaining: 0`), oder GitHub
 * nennt mit `retry-after`, wann es weitergeht (so meldet es das sekundäre Limit).
 */
function hasRateLimitSignal(headers: Headers): boolean {
  return headers.get('x-ratelimit-remaining') === '0' || headers.has('retry-after');
}

/** 429 ist immer ein Ratenlimit, 403 nur mit einem Anzeichen. Ein 403 ohne Anzeichen heißt: kein Recht. */
function isRateLimited(status: number, headers: Headers): boolean {
  return status === 429 || (status === 403 && hasRateLimitSignal(headers));
}

/**
 * Der HTTP-Status hinter einem Fehler, soweit er aus einer Antwort von GitHub stammt: Konflikte (409, 422) und alle
 * Status ohne eigene Fehlerklasse. Wer wissen muss, ob es ein 404 war, liest ihn hier, statt die Meldung zu zerlegen.
 */
export function statusOf(error: unknown): number | undefined {
  const status = (error as { status?: unknown } | null | undefined)?.status;
  return typeof status === 'number' ? status : undefined;
}

/** Der Fehler zu einer Fehlerantwort. Auch die Tests bauen ihre Fakes damit, damit sie genau so scheitern wie der Client. */
export function errorFor(status: number, headers: Headers, bodyText: string): Error {
  if (status === 401) return new AuthError();
  if (isRateLimited(status, headers)) return new RateLimitError();
  if (status === 403) return new AuthError();
  if (status === 409 || (status === 422 && /sha/i.test(bodyText))) return Object.assign(new ConflictError(), { status });
  return Object.assign(new Error(`GitHub antwortete mit Status ${status}.`), { status });
}

/** Gesperrte Namen sollen nie bis zur Oberfläche kommen, egal über welche API die Liste kam. */
function dirEntry(name: string, path: string, sha: string, type: DirEntry['type']): DirEntry | null {
  if (hasBlockedWordPart(name) || hasBlockedWordPart(path)) return null;
  return { name, path, sha, type };
}

/** Ein Eintrag der Contents-API. */
function toDirEntry(raw: unknown): DirEntry | null {
  if (!isObject(raw)) return null;
  const { name, path, sha, type } = raw;
  if (typeof name !== 'string' || typeof path !== 'string' || typeof sha !== 'string') return null;
  // Verknüpfungen und Submodule kann die App nicht brauchen.
  if (type !== 'file' && type !== 'dir') return null;
  return dirEntry(name, path, sha, type);
}

/** Ein Eintrag der Git-Trees-API. Dort ist `path` nur der Name, `blob` eine Datei und `tree` ein Unterordner. */
function treeEntryToDirEntry(raw: unknown, folder: string): DirEntry | null {
  if (!isObject(raw)) return null;
  const { path: name, sha, type } = raw;
  if (typeof name !== 'string' || typeof sha !== 'string') return null;
  // Submodule (`commit`) kann die App nicht brauchen.
  if (type !== 'blob' && type !== 'tree') return null;
  return dirEntry(name, `${folder}/${name}`, sha, type === 'blob' ? 'file' : 'dir');
}

export class GitHubClient {
  /** Ablaufdatum des Tokens laut der letzten Antwort, die es enthielt. `null`, solange keine Antwort es genannt hat. */
  lastTokenExpiry: Date | null = null;

  // Der Token steht in einem privaten Feld: Er taucht weder in der Konsolenausgabe noch in JSON.stringify auf.
  readonly #token: string;
  readonly #fetch: typeof fetch;
  readonly #repoUrl: string;

  constructor(o: { token: string; repo: string; fetchFn?: typeof fetch }) {
    this.#token = o.token;
    // Nicht `o.fetchFn ?? fetch`: Ein ungebundenes window.fetch wirft in Safari "Illegal invocation", sobald es als Methode läuft.
    this.#fetch = o.fetchFn ?? ((input, init) => fetch(input, init));
    this.#repoUrl = `${API}/repos/${encodePath(o.repo)}`;
  }

  /** Datei lesen. `null`, wenn es sie nicht gibt. */
  async getFile(path: string): Promise<{ text: string; sha: string } | null> {
    const url = `${this.#contentsUrl(path, 'read')}?ref=${BRANCH}`;
    let { status, data } = await this.#request('GET', url, undefined, [403, 404]);
    if (status === 403) {
      // Eine Datei über 1 MB beantwortet GitHub mit dem Standard-Accept mit 403 (`too_large`). Im Objektformat kommt sie
      // ohne Inhalt, den holt dann die Blob-API. Es bleibt bei dieser einen Wiederholung: Ein zweites 403 ist ein echtes
      // und wird wie sonst abgebildet. Dieselbe URL, also derselbe Pfad, den die Sperre eben freigegeben hat.
      ({ status, data } = await this.#request('GET', url, undefined, [404], ACCEPT_OBJECT));
    }
    if (status === 404) return null;
    if (!isObject(data)) throw unexpected();
    const sha = data.sha;
    if (typeof sha !== 'string') throw unexpected();
    const { content, encoding, size } = data;
    const tooBig = typeof size === 'number' && size > MAX_INLINE_SIZE;
    if (typeof content === 'string' && content !== '' && encoding !== 'none' && !tooBig) {
      return { text: base64ToUtf8(content), sha };
    }
    return { text: await this.#blobText(sha), sha };
  }

  /** Datei anlegen (`sha` ist `null`) oder ändern (`sha` der bisherigen Fassung). Liefert die sha der neuen Fassung. */
  async putFile(path: string, text: string, sha: string | null, message: string): Promise<{ sha: string }> {
    const url = this.#contentsUrl(path, 'write');
    const body: Record<string, string> = { message, content: utf8ToBase64(text), branch: BRANCH };
    if (sha) body.sha = sha;
    const { data } = await this.#request('PUT', url, body);
    const content = isObject(data) ? data.content : undefined;
    const newSha = isObject(content) ? content.sha : undefined;
    if (typeof newSha !== 'string') throw unexpected();
    return { sha: newSha };
  }

  /** Datei löschen. `sha` ist die der Fassung, die gelöscht werden soll. Ist sie veraltet, wirft das `ConflictError`. */
  async deleteFile(path: string, sha: string, message: string): Promise<void> {
    const url = this.#contentsUrl(path, 'write');
    await this.#request('DELETE', url, { message, sha, branch: BRANCH });
  }

  /**
   * Dateien und Unterordner eines Ordners. Einen Ordner, den es nicht gibt, meldet GitHub mit 404, das ergibt `[]`.
   * Bei 1000 oder mehr Einträgen kommt die Liste aus der Git-Trees-API, weil die Contents-API dann abschneidet.
   */
  async listDir(path: string): Promise<DirEntry[]> {
    const url = `${this.#contentsUrl(path, 'list')}?ref=${BRANCH}`;
    const { status, data } = await this.#request('GET', url, undefined, [404]);
    if (status === 404 || !Array.isArray(data)) return [];
    if (data.length >= CONTENTS_DIR_LIMIT) return this.#listDirViaTree(path);
    return data.flatMap((raw) => {
      const entry = toDirEntry(raw);
      return entry ? [entry] : [];
    });
  }

  /** sha des neuesten Commits auf `main`. */
  async headSha(): Promise<string> {
    const { data } = await this.#request('GET', `${this.#repoUrl}/branches/${BRANCH}`);
    const commit = isObject(data) ? data.commit : undefined;
    const sha = isObject(commit) ? commit.sha : undefined;
    if (typeof sha !== 'string') throw unexpected();
    return sha;
  }

  /**
   * Dateien, die sich zwischen zwei Commits geändert haben, bei Umbenennungen neuer und alter Name. Namen mit
   * gesperrten Wortteilen lässt sie weg.
   */
  async changedFiles(base: string, head: string): Promise<string[]> {
    if (base === head) return [];
    const url = `${this.#repoUrl}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`;
    const { data } = await this.#request('GET', url);
    const files = isObject(data) && Array.isArray(data.files) ? data.files : [];
    const names: string[] = [];
    for (const file of files) {
      if (!isObject(file)) continue;
      for (const name of [file.filename, file.previous_filename]) {
        if (typeof name === 'string' && !hasBlockedWordPart(name)) names.push(name);
      }
    }
    return names;
  }

  /** Ob der Token im Repo schreiben darf. Ein falscher oder abgelaufener Token wirft `AuthError`. */
  async checkAccess(): Promise<{ canWrite: boolean }> {
    const { data } = await this.#request('GET', this.#repoUrl);
    const permissions = isObject(data) ? data.permissions : undefined;
    return { canWrite: isObject(permissions) && permissions.push === true };
  }

  /**
   * URL einer Datei oder eines Ordners. Die Pfadsperre läuft hier und nirgends sonst: Es gibt keinen Weg zu einer
   * Contents-URL, der an ihr vorbeiführt. Gebaut wird aus der NFC-Form, also aus genau dem Pfad, den die Sperre geprüft hat.
   */
  #contentsUrl(path: string, mode: Mode): string {
    assertAllowedPath(path, mode);
    return `${this.#repoUrl}/contents/${encodePath(normalizePath(path))}`;
  }

  /**
   * Die ganze Liste eines Ordners mit 1000 oder mehr Einträgen, ohne Rekursion. Die sha des Ordners steht in der Liste
   * seines Elternordners. Gibt die Pfadsperre den nicht frei, gibt es keine vollständige Liste, und das ist ein Fehler
   * statt einer stillschweigend abgeschnittenen Liste. Ist die Antwort mit `truncated: true` selbst abgeschnitten (über
   * 100.000 Einträge), gilt, was kam. Die Anfrage an die Trees-API nennt nur diese sha, nie einen Pfad, wie die
   * Blob-Anfrage. Der Ordner und sein Elternordner sind vorher über `listDir` durch die Pfadsperre gegangen.
   */
  async #listDirViaTree(path: string): Promise<DirEntry[]> {
    const folder = normalizePath(path);
    const slash = folder.lastIndexOf('/');
    const parent = slash === -1 ? '' : folder.slice(0, slash);
    let siblings: DirEntry[];
    try {
      siblings = await this.listDir(parent);
    } catch (error) {
      if (error instanceof PathNotAllowedError) {
        throw new Error('Der Ordner hat 1000 oder mehr Einträge, und die vollständige Liste ist nicht freigegeben.', {
          cause: error,
        });
      }
      throw error;
    }
    const self = siblings.find((entry) => entry.type === 'dir' && entry.path === folder);
    if (!self) throw unexpected();
    const { data } = await this.#request('GET', `${this.#repoUrl}/git/trees/${encodeURIComponent(self.sha)}`);
    if (!isObject(data) || !Array.isArray(data.tree)) throw unexpected();
    return data.tree.flatMap((raw) => {
      const entry = treeEntryToDirEntry(raw, folder);
      return entry ? [entry] : [];
    });
  }

  /** Inhalt einer Datei über die Blob-API, für Dateien, die die Contents-API nicht mitliefert. */
  async #blobText(sha: string): Promise<string> {
    const { data } = await this.#request('GET', `${this.#repoUrl}/git/blobs/${encodeURIComponent(sha)}`);
    const content = isObject(data) ? data.content : undefined;
    if (typeof content !== 'string') throw unexpected();
    return base64ToUtf8(content);
  }

  /**
   * Schickt eine Anfrage und bildet Fehler ab. Antworten mit einem Status aus `passStatuses` (bei Dateien 404) gibt
   * sie ohne Fehler zurück, jeder andere Fehlerstatus wird geworfen. Ein Ratenlimit wird nie durchgereicht, auch wenn
   * sein Status (403) in der Liste steht. Das Ablaufdatum des Tokens liest sie aus jeder Antwort. `accept` ersetzt nur
   * den Accept-Header.
   */
  async #request(
    method: 'GET' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    passStatuses: readonly number[] = [],
    accept = ACCEPT,
  ): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
      Accept: accept,
      'X-GitHub-Api-Version': API_VERSION,
    };
    // no-store: Der Browser darf nie einen älteren Stand aus dem Cache liefern, der einen neueren auf GitHub verdeckt.
    const init: RequestInit = { method, headers, cache: 'no-store' };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }

    let response: Response;
    let text: string;
    try {
      const send = this.#fetch; // als einfacher Funktionsaufruf, nicht als Methode von this
      response = await send(url, init);
      text = await response.text();
    } catch (cause) {
      // fetch lehnt nur bei Netzproblemen ab (kein Netz, Verbindung abgebrochen). HTTP-Fehler kommen als Antwort.
      // Der ursprüngliche Fehler bleibt als `cause` erhalten und steht nie in der Meldung.
      throw new OfflineError(undefined, { cause });
    }

    this.#noteTokenExpiry(response.headers);
    if (response.ok) return { status: response.status, data: parseJson(text) };
    if (passStatuses.includes(response.status) && !isRateLimited(response.status, response.headers)) {
      return { status: response.status, data: null };
    }
    throw errorFor(response.status, response.headers, text);
  }

  #noteTokenExpiry(headers: Headers): void {
    const value = headers.get(EXPIRY_HEADER);
    if (value === null) return;
    const expiry = parseTokenExpiry(value);
    if (expiry !== null) this.lastTokenExpiry = expiry;
  }
}
