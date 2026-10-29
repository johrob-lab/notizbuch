import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { utf8ToBase64 } from '../../src/sync/base64';
import { AuthError, ConflictError, GitHubClient, OfflineError, RateLimitError } from '../../src/sync/github';
import { PathNotAllowedError } from '../../src/sync/paths';

// Alles hier ist erfunden: Token, Repo und Dateien. Es geht keine Anfrage ins Netz, fetch ist ein Fake.
const TOKEN = 'test-zugang-0123456789';
const REPO = 'johrob-lab/2-gehirn-test';
const API = `https://api.github.com/repos/${REPO}`;
const EXPIRY_HEADER = 'github-authentication-token-expiration';

type Call = {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  cache: string | undefined;
};

type Reply =
  | { kind: 'http'; status: number; body: string; headers: Record<string, string> }
  | { kind: 'network' }
  | { kind: 'bodyFails' };

let client: GitHubClient;
let calls: Call[];
let replies: Reply[];

// Ohne eingereihte Antwort sagt GitHub "nicht gefunden".
const NOT_FOUND: Reply = { kind: 'http', status: 404, body: '{"message":"Not Found"}', headers: {} };

const fetchFake: typeof fetch = async (input, init) => {
  calls.push({
    url: String(input),
    method: init?.method ?? 'GET',
    headers: { ...(init?.headers as Record<string, string>) },
    body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    cache: init?.cache,
  });
  const reply = replies.shift() ?? NOT_FOUND;
  if (reply.kind === 'network') throw new TypeError('Failed to fetch');
  if (reply.kind === 'bodyFails') {
    // Verbindung bricht beim Lesen der Antwort ab.
    return {
      ok: true,
      status: 200,
      headers: new Headers(),
      text: () => Promise.reject(new TypeError('network error')),
    } as unknown as Response;
  }
  return new Response(reply.body, { status: reply.status, headers: reply.headers });
};

/** Reiht eine oder zwei Antworten mit Status 200 ein. `second = null` heißt: keine zweite Antwort. */
function respond(first: unknown, second: unknown = null, headers: Record<string, string> = {}) {
  replies.push({ kind: 'http', status: 200, body: JSON.stringify(first), headers });
  if (second !== null) replies.push({ kind: 'http', status: 200, body: JSON.stringify(second), headers });
}

function respondStatus(status: number, body = '', headers: Record<string, string> = {}) {
  replies.push({ kind: 'http', status, body, headers });
}

function failNetwork() {
  replies.push({ kind: 'network' });
}

/** Der Fehler, mit dem das Versprechen abgelehnt wird, oder `null`, wenn es gelingt. */
async function errorOf(promise: Promise<unknown>): Promise<Error | null> {
  return promise.then(
    () => null,
    (e: unknown) => e as Error,
  );
}

beforeEach(() => {
  calls = [];
  replies = [];
  client = new GitHubClient({ token: TOKEN, repo: REPO, fetchFn: fetchFake });
});

afterEach(() => {
  // Jede eingereihte Antwort muss auch abgeholt worden sein, sonst fehlt eine Anfrage.
  expect(replies, 'nicht abgeholte Antworten').toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// Tests aus dem Brief
// ---------------------------------------------------------------------------------------------

test('encodes path segments', async () => {
  await client.getFile('05 Daily Notes/2026-10-29.md');
  expect(calls[0].url).toBe('https://api.github.com/repos/johrob-lab/2-gehirn-test/contents/05%20Daily%20Notes/2026-10-29.md?ref=main');
});

test('large file via blob', async () => {
  respond({ size: 1500000, content: '', sha: 'abc' }, { content: utf8ToBase64('<svg/>'), encoding: 'base64' });
  expect(await client.getFile('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg')).toEqual({ text: '<svg/>', sha: 'abc' });
  expect(calls[1].url).toContain('/git/blobs/abc');
});

test('errors', async () => {
  respondStatus(404);
  expect(await client.getFile('05 Daily Notes/2026-11-05.md')).toBeNull();
  respondStatus(409);
  await expect(client.putFile('05 Daily Notes/x.md', 'a', 'old', 'm')).rejects.toBeInstanceOf(ConflictError);
  respondStatus(401);
  await expect(client.headSha()).rejects.toBeInstanceOf(AuthError);
  failNetwork();
  await expect(client.headSha()).rejects.toBeInstanceOf(OfflineError);
});

test('reads token expiry', async () => {
  respond({ commit: { sha: 'h1' } }, null, { 'github-authentication-token-expiration': '2027-10-29 10:00:00 UTC' });
  await client.headSha();
  expect(client.lastTokenExpiry?.toISOString()).toBe('2027-10-29T10:00:00.000Z');
});

// ---------------------------------------------------------------------------------------------
// Pfadsperre: jede Methode prüft zuerst, danach geht nichts raus
// ---------------------------------------------------------------------------------------------

test('every method asks the path guard first, nothing is sent for a refused path', async () => {
  const refused = [
    '00 Kontext/Über mich.md',
    '02 Projekte/Beispiel.md',
    '05 Daily Notes/../00 Kontext/x.md',
    '07 Anhänge/Notizbuch/Recovery Codes.md',
    '05 Daily Notes/Passwort.md',
    '07 Anhänge/Notizbuch/2026/api.KEY',
    '05 Daily Notes/Token.md',
    '',
    '/05 Daily Notes/x.md',
    '05 Daily Notes\\x.md',
  ];
  for (const path of refused) {
    await expect(client.getFile(path), `getFile ${path}`).rejects.toBeInstanceOf(PathNotAllowedError);
    await expect(client.putFile(path, 'x', null, 'm'), `putFile ${path}`).rejects.toBeInstanceOf(PathNotAllowedError);
    await expect(client.deleteFile(path, 's', 'm'), `deleteFile ${path}`).rejects.toBeInstanceOf(PathNotAllowedError);
    await expect(client.listDir(path), `listDir ${path}`).rejects.toBeInstanceOf(PathNotAllowedError);
  }
  expect(calls).toEqual([]);
});

test('the guard uses the right mode per method', async () => {
  // Kalender: lesen ja, schreiben und löschen nein
  await expect(client.putFile('04 Ressourcen/Kalender/Termine.md', 'x', null, 'm')).rejects.toBeInstanceOf(PathNotAllowedError);
  await expect(client.deleteFile('04 Ressourcen/Kalender/Termine.md', 's', 'm')).rejects.toBeInstanceOf(PathNotAllowedError);
  // Projekte: nur die Dateiliste des Ordners selbst
  await expect(client.getFile('02 Projekte')).rejects.toBeInstanceOf(PathNotAllowedError);
  await expect(client.putFile('02 Projekte', 'x', null, 'm')).rejects.toBeInstanceOf(PathNotAllowedError);
  await expect(client.listDir('02 Projekte/Unterordner')).rejects.toBeInstanceOf(PathNotAllowedError);
  // Der Ordner Anhänge selbst wird nicht aufgelistet, nur Notizbuch darin
  await expect(client.listDir('07 Anhänge')).rejects.toBeInstanceOf(PathNotAllowedError);
  expect(calls).toEqual([]);

  respond({ type: 'file', encoding: 'base64', size: 2, sha: 's1', content: utf8ToBase64('ok') });
  expect(await client.getFile('04 Ressourcen/Kalender/Termine.md')).toEqual({ text: 'ok', sha: 's1' });
  respond([]);
  await client.listDir('02 Projekte');
  respond([]);
  await client.listDir('04 Ressourcen/Kalender');
  respond({ content: { sha: 'n1' } });
  await client.putFile('07 Anhänge/Notizbuch/2026/x.svg', '<svg/>', null, 'm');
  respond({ commit: { sha: 'c1' } });
  await client.deleteFile('05 Daily Notes/x.md', 's1', 'm');
  expect(calls).toHaveLength(5);
});

test('the request goes to the normalized (NFC) path that the guard checked', async () => {
  // "ä" als a plus Trema, so wie manche Eingaben es liefern. Im Vault steht "Anhänge" mit ä als einem Zeichen.
  await client.getFile('07 Anha\u0308nge/Notizbuch/2026/2026-10-29 Tag.svg');
  expect(calls[0].url).toBe(`${API}/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main`);
  expect(calls[0].url).not.toContain('%CC%88');
});

test('encodes every path segment on its own, also special characters', async () => {
  await client.getFile('05 Daily Notes/a#b?c&d+e%f.md');
  expect(calls[0].url).toBe(`${API}/contents/05%20Daily%20Notes/a%23b%3Fc%26d%2Be%25f.md?ref=main`);
  await client.getFile('07 Anhänge/Notizbuch/2026/2026-10-29 0800 Sperren & "Muster" <2027> S1.svg');
  expect(calls[1].url).toBe(
    `${API}/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%200800%20Sperren%20%26%20%22Muster%22%20%3C2027%3E%20S1.svg?ref=main`,
  );
  // Ein Prozentzeichen im Namen bleibt ein Name und wird kein Verzeichniswechsel
  await client.getFile('05 Daily Notes/%2e%2e/x.md');
  expect(calls[2].url).toBe(`${API}/contents/05%20Daily%20Notes/%252e%252e/x.md?ref=main`);
});

// ---------------------------------------------------------------------------------------------
// Anfragen: Kopfzeilen, Cache, Standard-fetch
// ---------------------------------------------------------------------------------------------

test('every request carries the GitHub headers, bypasses the cache and keeps the token out of the URL', async () => {
  respond({ type: 'file', encoding: 'base64', size: 2, sha: 's1', content: utf8ToBase64('hi') });
  await client.getFile('05 Daily Notes/x.md');
  respond({ commit: { sha: 'h1' } });
  await client.headSha();
  respond({ content: { sha: 'n1' } });
  await client.putFile('05 Daily Notes/x.md', 'a', 's1', 'm');
  respond({ content: null, commit: { sha: 'c1' } });
  await client.deleteFile('05 Daily Notes/x.md', 'n1', 'm');
  respond([]);
  await client.listDir('05 Daily Notes');
  respond({ files: [] });
  await client.changedFiles('h1', 'h2');
  respond({ permissions: { push: true } });
  await client.checkAccess();

  expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'PUT', 'DELETE', 'GET', 'GET', 'GET']);
  for (const call of calls) {
    expect(call.cache, call.url).toBe('no-store');
    expect(call.headers.Authorization, call.url).toBe(`Bearer ${TOKEN}`);
    expect(call.headers.Accept, call.url).toBe('application/vnd.github+json');
    expect(call.headers['X-GitHub-Api-Version'], call.url).toBe('2022-11-28');
    expect(call.url.startsWith('https://api.github.com/repos/'), call.url).toBe(true);
    expect(call.url, call.url).not.toContain(TOKEN);
    if (call.method === 'GET') {
      expect(Object.keys(call.headers).sort(), call.url).toEqual(['Accept', 'Authorization', 'X-GitHub-Api-Version']);
    } else {
      expect(call.headers['Content-Type'], call.url).toBe('application/json');
    }
  }
});

test('the default fetch is looked up when called and runs unbound, like a plain function (Safari rejects it as a method)', async () => {
  const seen: string[] = [];
  try {
    // Der Client entsteht, solange fetch noch ein Platzhalter ist. Wer fetch schon im Konstruktor festhält, landet hier.
    vi.stubGlobal('fetch', () => Promise.reject(new TypeError('Kein Netz im Test')));
    const own = new GitHubClient({ token: TOKEN, repo: REPO });
    vi.stubGlobal('fetch', function (this: unknown, input: RequestInfo | URL) {
      // Ein ungebundenes window.fetch wirft in Safari "Illegal invocation", wenn es als Methode eines Objekts läuft.
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      seen.push(String(input));
      return Promise.resolve(new Response(JSON.stringify({ commit: { sha: 'h1' } })));
    });
    expect(await own.headSha()).toBe('h1');
    expect(seen).toEqual([`${API}/branches/main`]);
  } finally {
    vi.unstubAllGlobals();
  }
});

test('a fetchFn handed in, such as window.fetch itself, is also called as a plain function', async () => {
  const sensitiveFetch = function (this: unknown) {
    if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
    return Promise.resolve(new Response(JSON.stringify({ commit: { sha: 'h2' } })));
  } as typeof fetch;
  const own = new GitHubClient({ token: TOKEN, repo: REPO, fetchFn: sensitiveFetch });
  expect(await own.headSha()).toBe('h2');
});

test('special characters in the repo name cannot change the structure of the URL', async () => {
  const odd = new GitHubClient({ token: TOKEN, repo: 'konto/repo?x=1#y', fetchFn: fetchFake });
  respond({ commit: { sha: 'h1' } });
  await odd.headSha();
  expect(calls[0].url).toBe('https://api.github.com/repos/konto/repo%3Fx%3D1%23y/branches/main');
});

test('the token is not exposed when the client is logged or serialized', () => {
  expect(JSON.stringify(client)).not.toContain(TOKEN);
  expect(String(client)).not.toContain(TOKEN);
  for (const value of Object.values(client)) expect(String(value)).not.toContain(TOKEN);
});

// ---------------------------------------------------------------------------------------------
// getFile
// ---------------------------------------------------------------------------------------------

test('getFile decodes inline content with the line breaks GitHub inserts', async () => {
  const text = '## Ergänzungen\n- [ ] Aufgabe äöü € „x“\n';
  const wrapped = utf8ToBase64(text).replace(/(.{20})/g, '$1\n') + '\n';
  respond({ type: 'file', encoding: 'base64', size: 60, sha: 's1', content: wrapped });
  expect(await client.getFile('05 Daily Notes/2026-10-29.md')).toEqual({ text, sha: 's1' });
  expect(calls).toHaveLength(1);
});

test('getFile takes the blob route for big, empty or undelivered content, and the inline route up to 1 MB', async () => {
  const blob = { content: utf8ToBase64('<svg>Ü</svg>'), encoding: 'base64' };
  const path = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';

  // zu groß: Inhalt fehlt
  respond({ size: 1_500_000, content: '', sha: 'big', encoding: 'none' }, blob);
  expect(await client.getFile(path)).toEqual({ text: '<svg>Ü</svg>', sha: 'big' });
  // zu groß, obwohl ein Inhalt mitgeschickt wird
  respond({ size: 1_000_001, content: 'aGk=', encoding: 'base64', sha: 'over' }, blob);
  expect(await client.getFile(path)).toEqual({ text: '<svg>Ü</svg>', sha: 'over' });
  // Kodierung "none", auch bei kleiner Größe
  respond({ size: 10, content: 'aGk=', encoding: 'none', sha: 'none' }, blob);
  expect(await client.getFile(path)).toEqual({ text: '<svg>Ü</svg>', sha: 'none' });
  // leerer Inhalt: auch eine leere Datei holt der Blob (der liefert wieder nichts)
  respond({ size: 0, content: '', encoding: 'base64', sha: 'empty' }, { content: '', encoding: 'base64' });
  expect(await client.getFile(path)).toEqual({ text: '', sha: 'empty' });
  expect(calls.map((c) => c.url.replace(API, ''))).toEqual([
    `/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main`,
    '/git/blobs/big',
    `/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main`,
    '/git/blobs/over',
    `/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main`,
    '/git/blobs/none',
    `/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main`,
    '/git/blobs/empty',
  ]);

  // genau 1 MB kommt noch direkt, ohne Blob
  calls.length = 0;
  respond({ size: 1_000_000, content: utf8ToBase64('direkt'), encoding: 'base64', sha: 'edge' });
  expect(await client.getFile(path)).toEqual({ text: 'direkt', sha: 'edge' });
  expect(calls).toHaveLength(1);
});

test('the blob request carries the same headers, decodes line breaks and maps errors like every other request', async () => {
  const path = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
  const wrapped = utf8ToBase64('<svg>€</svg>').replace(/(.{8})/g, '$1\n');
  respond({ size: 2_000_000, content: '', sha: 'abc' }, { content: wrapped, encoding: 'base64' });
  expect(await client.getFile(path)).toEqual({ text: '<svg>€</svg>', sha: 'abc' });
  expect(calls[1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  expect(calls[1].cache).toBe('no-store');

  respond({ size: 2_000_000, content: '', sha: 'abc' });
  respondStatus(401);
  await expect(client.getFile(path)).rejects.toBeInstanceOf(AuthError);

  respond({ size: 2_000_000, content: '', sha: 'abc' });
  failNetwork();
  await expect(client.getFile(path)).rejects.toBeInstanceOf(OfflineError);

  // Der Blob ist inzwischen weg: kein stilles "null", sondern ein Fehler mit dem Status
  respond({ size: 2_000_000, content: '', sha: 'abc' });
  respondStatus(404);
  const gone = await errorOf(client.getFile(path));
  expect(gone).not.toBeNull();
  expect(gone?.message).toContain('404');
});

test('getFile: 404 is "no such file", every other failure is an error', async () => {
  respondStatus(404);
  expect(await client.getFile('05 Daily Notes/2026-11-05.md')).toBeNull();
  respondStatus(500);
  await expect(client.getFile('05 Daily Notes/2026-11-05.md')).rejects.toThrow('500');
});

test('getFile does not turn a folder answer or a broken answer into a file', async () => {
  respond([{ name: 'x.md', path: '07 Anhänge/Notizbuch/2026/x.md', sha: 's', type: 'file' }]);
  await expect(client.getFile('07 Anhänge/Notizbuch/2026')).rejects.toThrow('Unerwartete Antwort');
  respond({ size: 3 });
  await expect(client.getFile('05 Daily Notes/x.md')).rejects.toThrow('Unerwartete Antwort');
  replies.push({ kind: 'http', status: 200, body: '<html>Anmeldung</html>', headers: {} });
  await expect(client.getFile('05 Daily Notes/x.md')).rejects.toThrow('Unerwartete Antwort');
  replies.push({ kind: 'http', status: 200, body: '', headers: {} });
  await expect(client.getFile('05 Daily Notes/x.md')).rejects.toThrow('Unerwartete Antwort');
  // der Blob kommt ohne Inhalt zurück
  respond({ size: 2_000_000, content: '', sha: 'abc' }, { encoding: 'base64' });
  await expect(client.getFile('05 Daily Notes/x.md')).rejects.toThrow('Unerwartete Antwort');
});

test('getFile refuses content that is not valid UTF-8 instead of replacing characters', async () => {
  respond({ type: 'file', encoding: 'base64', size: 1, sha: 's1', content: Buffer.from([0xe4]).toString('base64') });
  await expect(client.getFile('05 Daily Notes/x.md')).rejects.toThrow();
});

// ---------------------------------------------------------------------------------------------
// putFile und deleteFile
// ---------------------------------------------------------------------------------------------

test('putFile creates a file: no sha in the body, content as Base64, branch main', async () => {
  respond({ content: { sha: 'new1', path: '05 Daily Notes/2026-10-29.md' }, commit: { sha: 'c1' } });
  const text = '## Ergänzungen\n- Umlaute äöüß € „x“\n';
  const result = await client.putFile('05 Daily Notes/2026-10-29.md', text, null, 'Notizbuch: 2026-10-29.md (iPad)');
  expect(result).toEqual({ sha: 'new1' });
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('PUT');
  expect(calls[0].url).toBe(`${API}/contents/05%20Daily%20Notes/2026-10-29.md`);
  expect(calls[0].body).toEqual({
    message: 'Notizbuch: 2026-10-29.md (iPad)',
    content: utf8ToBase64(text),
    branch: 'main',
  });
  expect(Object.keys(calls[0].body as object)).not.toContain('sha');
});

test('putFile updates a file: the old sha goes into the body and the new sha comes back', async () => {
  respond({ content: { sha: 'new2' }, commit: { sha: 'c2' } });
  const result = await client.putFile('07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg', '<svg/>', 'old1', 'Notizbuch: 2026-10-29 Tag.svg (Firmen-PC)');
  expect(result).toEqual({ sha: 'new2' });
  expect(calls[0].url).toBe(`${API}/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg`);
  expect(calls[0].body).toEqual({
    message: 'Notizbuch: 2026-10-29 Tag.svg (Firmen-PC)',
    content: utf8ToBase64('<svg/>'),
    branch: 'main',
    sha: 'old1',
  });
});

test('putFile without a sha in the answer is an error, not a made-up sha', async () => {
  respond({ commit: { sha: 'c1' } });
  await expect(client.putFile('05 Daily Notes/x.md', 'a', null, 'm')).rejects.toThrow('Unerwartete Antwort');
});

test('deleteFile sends message, sha and branch main to the contents endpoint', async () => {
  respond({ content: null, commit: { sha: 'c3' } });
  await expect(client.deleteFile('07 Anhänge/Notizbuch/2026/2026-10-29 0800 Thema S1.svg', 'sha9', 'Notizbuch: Seite gelöscht (iPad)')).resolves.toBeUndefined();
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('DELETE');
  expect(calls[0].url).toBe(`${API}/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%200800%20Thema%20S1.svg`);
  expect(calls[0].body).toEqual({ message: 'Notizbuch: Seite gelöscht (iPad)', sha: 'sha9', branch: 'main' });
});

// ---------------------------------------------------------------------------------------------
// Fehlerabbildung
// ---------------------------------------------------------------------------------------------

test('maps status codes and rate limit headers to the right error class', async () => {
  type ErrorClass = new (...args: never[]) => Error;
  const all: ErrorClass[] = [AuthError, ConflictError, OfflineError, RateLimitError];
  const table: Array<[number, Record<string, string>, ErrorClass]> = [
    [401, {}, AuthError],
    [401, { 'x-ratelimit-remaining': '0' }, AuthError],
    [403, {}, AuthError],
    [403, { 'x-ratelimit-remaining': '12' }, AuthError],
    [403, { 'x-ratelimit-remaining': '0' }, RateLimitError],
    [429, {}, RateLimitError],
    [429, { 'x-ratelimit-remaining': '0' }, RateLimitError],
    [429, { 'x-ratelimit-remaining': '7' }, RateLimitError],
    [409, {}, ConflictError],
  ];
  for (const [status, headers, expected] of table) {
    respondStatus(status, '', headers);
    const error = await errorOf(client.headSha());
    const label = `${status} ${JSON.stringify(headers)}`;
    expect(error, label).toBeInstanceOf(expected);
    for (const other of all) if (other !== expected) expect(error, label).not.toBeInstanceOf(other);
  }
});

test('422 is a conflict only when the answer talks about the sha', async () => {
  respondStatus(422, JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }));
  await expect(client.putFile('05 Daily Notes/x.md', 'a', null, 'm')).rejects.toBeInstanceOf(ConflictError);
  respondStatus(422, JSON.stringify({ message: 'Validation Failed', errors: [{ resource: 'Commit', field: 'sha', code: 'invalid' }] }));
  await expect(client.putFile('05 Daily Notes/x.md', 'a', 'old', 'm')).rejects.toBeInstanceOf(ConflictError);
  respondStatus(422, 'Sha does not match');
  await expect(client.deleteFile('05 Daily Notes/x.md', 'old', 'm')).rejects.toBeInstanceOf(ConflictError);

  respondStatus(422, JSON.stringify({ message: 'Validation Failed: content is not valid Base64' }));
  const other = await errorOf(client.putFile('05 Daily Notes/x.md', 'a', null, 'm'));
  expect(other).not.toBeInstanceOf(ConflictError);
  expect(other?.message).toContain('422');
  respondStatus(422);
  expect(await errorOf(client.putFile('05 Daily Notes/x.md', 'a', null, 'm'))).not.toBeInstanceOf(ConflictError);
});

test('409 on delete is a conflict too', async () => {
  respondStatus(409);
  await expect(client.deleteFile('05 Daily Notes/x.md', 'old', 'm')).rejects.toBeInstanceOf(ConflictError);
});

test('any other status is a plain Error that names the status', async () => {
  for (const status of [400, 404, 500, 502, 503]) {
    respondStatus(status, '{"message":"x"}');
    const error = await errorOf(client.headSha());
    expect(error, String(status)).not.toBeNull();
    expect(Object.getPrototypeOf(error), String(status)).toBe(Error.prototype);
    expect(error?.message, String(status)).toContain(String(status));
  }
});

test('a lost connection is an OfflineError for every method, also while the answer is being read', async () => {
  const operations: Array<() => Promise<unknown>> = [
    () => client.getFile('05 Daily Notes/x.md'),
    () => client.putFile('05 Daily Notes/x.md', 'a', null, 'm'),
    () => client.deleteFile('05 Daily Notes/x.md', 's', 'm'),
    () => client.listDir('05 Daily Notes'),
    () => client.headSha(),
    () => client.changedFiles('a', 'b'),
    () => client.checkAccess(),
  ];
  for (const operation of operations) {
    failNetwork();
    await expect(operation()).rejects.toBeInstanceOf(OfflineError);
    replies.push({ kind: 'bodyFails' });
    await expect(operation()).rejects.toBeInstanceOf(OfflineError);
  }
});

test('error classes are Errors with stable names and German messages', () => {
  const samples: Array<[Error, string]> = [
    [new AuthError(), 'AuthError'],
    [new ConflictError(), 'ConflictError'],
    [new OfflineError(), 'OfflineError'],
    [new RateLimitError(), 'RateLimitError'],
  ];
  for (const [error, name] of samples) {
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe(name);
    expect(error.message.length).toBeGreaterThan(0);
    expect(error.message).not.toMatch(/[\u2013\u2014]/); // keine Gedankenstriche
  }
  expect(new AuthError('eigener Text').message).toBe('eigener Text');
});

test('no error message contains the token', async () => {
  const messages: string[] = [];
  const collect = async (promise: Promise<unknown>) => {
    const error = await errorOf(promise);
    expect(error).not.toBeNull();
    messages.push(String(error), error?.message ?? '');
  };
  for (const [status, headers] of [
    [401, {}],
    [403, {}],
    [403, { 'x-ratelimit-remaining': '0' }],
    [409, {}],
    [422, {}],
    [429, {}],
    [500, {}],
  ] as Array<[number, Record<string, string>]>) {
    // GitHub-Antworten, die den Token zurückspielen würden, landen trotzdem nie in der Fehlermeldung
    respondStatus(status, JSON.stringify({ message: `Bad credentials for ${TOKEN}` }), headers);
    await collect(client.headSha());
  }
  failNetwork();
  await collect(client.headSha());
  await collect(client.getFile('00 Kontext/x.md'));
  expect(messages.length).toBeGreaterThan(10);
  for (const message of messages) expect(message).not.toContain(TOKEN);
});

// ---------------------------------------------------------------------------------------------
// Ablaufdatum des Tokens
// ---------------------------------------------------------------------------------------------

test('token expiry starts empty and reads UTC and offset formats', async () => {
  expect(client.lastTokenExpiry).toBeNull();
  const formats: Array<[string, string]> = [
    ['2027-10-29 10:00:00 UTC', '2027-10-29T10:00:00.000Z'],
    ['2027-10-29 10:00:00 +0200', '2027-10-29T08:00:00.000Z'],
    ['2027-10-29 10:00:00 -0600', '2027-10-29T16:00:00.000Z'],
    ['2027-10-29 10:00:00 +0530', '2027-10-29T04:30:00.000Z'],
    ['2027-01-01 01:00:00 +0200', '2026-12-31T23:00:00.000Z'],
    ['2028-02-29 23:59:59 UTC', '2028-02-29T23:59:59.000Z'],
    ['2021-02-15 08:48:00 -0600', '2021-02-15T14:48:00.000Z'],
  ];
  for (const [header, iso] of formats) {
    respond({ commit: { sha: 'h' } }, null, { [EXPIRY_HEADER]: header });
    await client.headSha();
    expect(client.lastTokenExpiry?.toISOString(), header).toBe(iso);
    expect(client.lastTokenExpiry).toBeInstanceOf(Date);
  }
});

test('an unreadable expiry header leaves the value unchanged', async () => {
  const unreadable = [
    '',
    'bald',
    '2027-13-01 00:00:00 UTC',
    '2027-00-10 00:00:00 UTC',
    '2027-02-30 10:00:00 UTC',
    '2027-02-29 10:00:00 UTC',
    '2027-10-29 25:00:00 UTC',
    '2027-10-29 10:60:00 UTC',
    '2027-10-29 10:00:60 UTC',
    '2027-10-29 10:00:00 CEST',
    '2027-10-29T10:00:00Z',
    '2027-10-29 10:00:00 +2500',
    '2027-10-29 10:00:00 +0260',
    '2027-10-29 10:00 UTC',
    '29.10.2027 10:00:00 UTC',
    '2027-10-29 10:00:00 UTC extra',
    '0027-10-29 10:00:00 UTC',
  ];
  // zuerst ohne vorhandenen Wert: bleibt leer
  for (const header of unreadable) {
    respond({ commit: { sha: 'h' } }, null, { [EXPIRY_HEADER]: header });
    await client.headSha();
    expect(client.lastTokenExpiry, JSON.stringify(header)).toBeNull();
  }
  // dann mit vorhandenem Wert: bleibt, wie er war
  respond({ commit: { sha: 'h' } }, null, { [EXPIRY_HEADER]: '2027-10-29 10:00:00 UTC' });
  await client.headSha();
  for (const header of unreadable) {
    respond({ commit: { sha: 'h' } }, null, { [EXPIRY_HEADER]: header });
    await client.headSha();
    expect(client.lastTokenExpiry?.toISOString(), JSON.stringify(header)).toBe('2027-10-29T10:00:00.000Z');
  }
  // ohne Kopfzeile ändert sich auch nichts
  respond({ commit: { sha: 'h' } });
  await client.headSha();
  expect(client.lastTokenExpiry?.toISOString()).toBe('2027-10-29T10:00:00.000Z');
});

test('the newest response wins, and error responses carry the expiry too', async () => {
  respond({ commit: { sha: 'h' } }, null, { [EXPIRY_HEADER]: '2027-10-29 10:00:00 UTC' });
  await client.headSha();
  respondStatus(404, '', { [EXPIRY_HEADER]: '2027-11-01 12:00:00 UTC' });
  expect(await client.getFile('05 Daily Notes/2026-11-05.md')).toBeNull();
  expect(client.lastTokenExpiry?.toISOString()).toBe('2027-11-01T12:00:00.000Z');
  respondStatus(409, '', { [EXPIRY_HEADER]: '2027-11-02 12:00:00 UTC' });
  await expect(client.putFile('05 Daily Notes/x.md', 'a', 'old', 'm')).rejects.toBeInstanceOf(ConflictError);
  expect(client.lastTokenExpiry?.toISOString()).toBe('2027-11-02T12:00:00.000Z');
  respondStatus(401, '', { [EXPIRY_HEADER]: '2027-11-03 12:00:00 UTC' });
  await expect(client.headSha()).rejects.toBeInstanceOf(AuthError);
  expect(client.lastTokenExpiry?.toISOString()).toBe('2027-11-03T12:00:00.000Z');
});

// ---------------------------------------------------------------------------------------------
// headSha, changedFiles, checkAccess, listDir
// ---------------------------------------------------------------------------------------------

test('headSha returns the commit sha of main', async () => {
  respond({ name: 'main', commit: { sha: 'h1', commit: { message: 'x' } } });
  expect(await client.headSha()).toBe('h1');
  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(`${API}/branches/main`);
  respond({ name: 'main' });
  await expect(client.headSha()).rejects.toThrow('Unerwartete Antwort');
});

test('changedFiles compares two commits and lists new and old names of renames', async () => {
  respond({
    files: [
      { filename: '05 Daily Notes/2026-10-29.md', status: 'modified', patch: '@@ -1 +1 @@' },
      { filename: '07 Anhänge/Notizbuch/2026/neu.svg', previous_filename: '07 Anhänge/Notizbuch/2026/alt.svg', status: 'renamed' },
      { filename: '04 Ressourcen/Kalender/Termine.md', status: 'modified' },
    ],
  });
  expect(await client.changedFiles('h1', 'h2')).toEqual([
    '05 Daily Notes/2026-10-29.md',
    '07 Anhänge/Notizbuch/2026/neu.svg',
    '07 Anhänge/Notizbuch/2026/alt.svg',
    '04 Ressourcen/Kalender/Termine.md',
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(`${API}/compare/h1...h2`);
});

test('changedFiles needs no request when nothing moved, and copes with an empty answer', async () => {
  expect(await client.changedFiles('same', 'same')).toEqual([]);
  expect(calls).toEqual([]);
  respond({ status: 'identical' });
  expect(await client.changedFiles('h1', 'h2')).toEqual([]);
  respond({ files: [] });
  expect(await client.changedFiles('h1', 'h3')).toEqual([]);
});

test('changedFiles keeps names with blocked word parts away from the caller', async () => {
  respond({
    files: [
      { filename: '05 Daily Notes/2026-10-29.md' },
      { filename: '00 Kontext/Passwörter.md' },
      { filename: 'Recovery Codes.md' },
      { filename: '07 Anhänge/Notizbuch/2026/neu.svg', previous_filename: '07 Anhänge/Notizbuch/2026/Token.svg', status: 'renamed' },
      { filename: 'tresor.KEY' },
    ],
  });
  expect(await client.changedFiles('h1', 'h2')).toEqual(['05 Daily Notes/2026-10-29.md', '07 Anhänge/Notizbuch/2026/neu.svg']);
});

test('changedFiles encodes the commit names in the URL', async () => {
  respond({ files: [] });
  await client.changedFiles('a/b', 'c d?');
  expect(calls[0].url).toBe(`${API}/compare/a%2Fb...c%20d%3F`);
});

test('checkAccess reports whether the token may push', async () => {
  respond({ full_name: REPO, permissions: { admin: false, push: true, pull: true } });
  expect(await client.checkAccess()).toEqual({ canWrite: true });
  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(API);
  respond({ permissions: { admin: false, push: false, pull: true } });
  expect(await client.checkAccess()).toEqual({ canWrite: false });
  respond({ permissions: { pull: true } });
  expect(await client.checkAccess()).toEqual({ canWrite: false });
  respond({ full_name: REPO });
  expect(await client.checkAccess()).toEqual({ canWrite: false });
  respond({ permissions: { push: 'true' } });
  expect(await client.checkAccess()).toEqual({ canWrite: false });
  respond({ permissions: { push: 1 } });
  expect(await client.checkAccess()).toEqual({ canWrite: false });
  respondStatus(401);
  await expect(client.checkAccess()).rejects.toBeInstanceOf(AuthError);
  // Ein privates Repo, auf das der Token nicht zugreifen darf, meldet GitHub als "nicht gefunden"
  respondStatus(404);
  await expect(client.checkAccess()).rejects.toThrow('404');
});

test('listDir lists a folder and returns name, path, sha and type only', async () => {
  respond([
    {
      name: '2026-10-29 Tag.svg',
      path: '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg',
      sha: 'a1',
      size: 1234,
      url: 'https://api.github.com/x',
      download_url: 'https://raw.githubusercontent.com/x',
      type: 'file',
    },
    { name: 'Unterordner', path: '07 Anhänge/Notizbuch/2026/Unterordner', sha: 'd1', type: 'dir' },
  ]);
  expect(await client.listDir('07 Anhänge/Notizbuch/2026')).toEqual([
    { name: '2026-10-29 Tag.svg', path: '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg', sha: 'a1', type: 'file' },
    { name: 'Unterordner', path: '07 Anhänge/Notizbuch/2026/Unterordner', sha: 'd1', type: 'dir' },
  ]);
  expect(calls).toHaveLength(1);
  expect(calls[0].method).toBe('GET');
  expect(calls[0].url).toBe(`${API}/contents/07%20Anh%C3%A4nge/Notizbuch/2026?ref=main`);
});

test('listDir drops entries with blocked word parts, other entry types and broken entries', async () => {
  const dir = '07 Anhänge/Notizbuch/2026';
  const file = (name: string, extra: Record<string, unknown> = {}) => ({ name, path: `${dir}/${name}`, sha: 'x', type: 'file', ...extra });
  respond([
    file('2026-10-29 Tag.svg'),
    file('Recovery Codes.md'),
    file('PASSWORT.txt'),
    file('api.TOKEN'),
    file('tresor.key'),
    file('Monkey.svg'),
    file('ok.md', { path: '07 Anhänge/Notizbuch/Token/ok.md' }), // nur der Pfad ist gesperrt
    file('Recovery.md', { path: `${dir}/harmlos.md` }), // nur der Name ist gesperrt
    { name: 'Link', path: `${dir}/Link`, sha: 'l', type: 'symlink' },
    { name: 'Modul', path: `${dir}/Modul`, sha: 'm', type: 'submodule' },
    { name: 'kaputt' },
    { name: 'ohne Sha', path: `${dir}/ohne Sha`, type: 'file' },
    'kein Objekt',
    null,
  ]);
  const entries = await client.listDir(dir);
  expect(entries.map((e) => e.name)).toEqual(['2026-10-29 Tag.svg', 'Monkey.svg']);
});

test('listDir: 404 is an empty folder, other failures are errors, a file answer is no listing', async () => {
  respondStatus(404);
  expect(await client.listDir('07 Anhänge/Notizbuch/2031')).toEqual([]);
  respondStatus(403);
  await expect(client.listDir('07 Anhänge/Notizbuch/2026')).rejects.toBeInstanceOf(AuthError);
  respondStatus(500);
  await expect(client.listDir('07 Anhänge/Notizbuch/2026')).rejects.toThrow('500');
  respond({ type: 'file', name: 'x.md', path: '05 Daily Notes/x.md', sha: 's', content: '' });
  expect(await client.listDir('05 Daily Notes/x.md')).toEqual([]);
});
