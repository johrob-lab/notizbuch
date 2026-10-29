import { base64ToUtf8, utf8ToBase64 } from './base64';
import { assertAllowedPath, hasBlockedWordPart, normalizePath, type Mode } from './paths';

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const BRANCH = 'main';
// Die Contents-API liefert Dateien über 1 MB ohne Inhalt. Dann holt die Blob-API sie.
const MAX_INLINE_SIZE = 1_000_000;
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
  constructor(message = 'Keine Verbindung zu GitHub.') {
    super(message);
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

function errorFor(status: number, headers: Headers, bodyText: string): Error {
  if (status === 401) return new AuthError();
  const limitReached = headers.get('x-ratelimit-remaining') === '0';
  if (status === 429 || (status === 403 && limitReached)) return new RateLimitError();
  if (status === 403) return new AuthError();
  if (status === 409 || (status === 422 && /sha/i.test(bodyText))) return new ConflictError();
  return new Error(`GitHub antwortete mit Status ${status}.`);
}

function toDirEntry(raw: unknown): DirEntry | null {
  if (!isObject(raw)) return null;
  const { name, path, sha, type } = raw;
  if (typeof name !== 'string' || typeof path !== 'string' || typeof sha !== 'string') return null;
  // Verknüpfungen und Submodule kann die App nicht brauchen, und gesperrte Namen sollen nie bis zur Oberfläche kommen.
  if (type !== 'file' && type !== 'dir') return null;
  if (hasBlockedWordPart(name) || hasBlockedWordPart(path)) return null;
  return { name, path, sha, type };
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
    const { status, data } = await this.#request('GET', url, undefined, [404]);
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

  /** Dateien und Unterordner eines Ordners. Einen Ordner, den es nicht gibt, meldet GitHub mit 404, das ergibt `[]`. */
  async listDir(path: string): Promise<DirEntry[]> {
    const url = `${this.#contentsUrl(path, 'list')}?ref=${BRANCH}`;
    const { status, data } = await this.#request('GET', url, undefined, [404]);
    if (status === 404 || !Array.isArray(data)) return [];
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

  /** Inhalt einer Datei über die Blob-API, für Dateien, die die Contents-API nicht mitliefert. */
  async #blobText(sha: string): Promise<string> {
    const { data } = await this.#request('GET', `${this.#repoUrl}/git/blobs/${encodeURIComponent(sha)}`);
    const content = isObject(data) ? data.content : undefined;
    if (typeof content !== 'string') throw unexpected();
    return base64ToUtf8(content);
  }

  /**
   * Schickt eine Anfrage und bildet Fehler ab. Antworten mit einem Status aus `passStatuses` (bei Dateien 404) gibt
   * sie ohne Fehler zurück, jeder andere Fehlerstatus wird geworfen. Das Ablaufdatum des Tokens liest sie aus jeder Antwort.
   */
  async #request(
    method: 'GET' | 'PUT' | 'DELETE',
    url: string,
    body?: unknown,
    passStatuses: readonly number[] = [],
  ): Promise<{ status: number; data: unknown }> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.#token}`,
      Accept: 'application/vnd.github+json',
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
    } catch {
      // fetch lehnt nur bei Netzproblemen ab (kein Netz, Verbindung abgebrochen). HTTP-Fehler kommen als Antwort.
      throw new OfflineError();
    }

    this.#noteTokenExpiry(response.headers);
    if (response.ok) return { status: response.status, data: parseJson(text) };
    if (passStatuses.includes(response.status)) return { status: response.status, data: null };
    throw errorFor(response.status, response.headers, text);
  }

  #noteTokenExpiry(headers: Headers): void {
    const value = headers.get(EXPIRY_HEADER);
    if (value === null) return;
    const expiry = parseTokenExpiry(value);
    if (expiry !== null) this.lastTokenExpiry = expiry;
  }
}
