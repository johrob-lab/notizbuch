import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { utf8ToBase64 } from '../../src/sync/base64';
import { AuthError, ConflictError, errorFor, GitHubClient, OfflineError, RateLimitError, statusOf } from '../../src/sync/github';
import { PathNotAllowedError } from '../../src/sync/paths';

// Alles hier ist erfunden: Token, Repo und Dateien. Es geht keine Anfrage ins Netz, fetch ist ein Fake.
const TOKEN = 'test-zugang-0123456789';
const REPO = 'johrob-lab/2-gehirn-test';
const API = `https://api.github.com/repos/${REPO}`;
const EXPIRY_HEADER = 'github-authentication-token-expiration';
const ACCEPT_DEFAULT = 'application/vnd.github+json';
const ACCEPT_OBJECT = 'application/vnd.github.object+json';

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
    '00 Beispiel/Notiz.md',
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

test('getFile and putFile hand a byte order mark at the start of a file through unchanged', async () => {
  const text = '\uFEFF## Ergänzungen\n- [ ] Aufgabe\n';
  const content = Buffer.from(text, 'utf8').toString('base64');
  expect(content.startsWith('77u/')).toBe(true); // die Bytes EF BB BF am Anfang
  respond({ type: 'file', encoding: 'base64', size: 40, sha: 's1', content });
  const file = await client.getFile('05 Daily Notes/2026-10-29.md');
  expect(file).toEqual({ text, sha: 's1' });
  // Wer den gelesenen Text wieder schreibt, schickt dieselben Bytes
  respond({ content: { sha: 's2' } });
  await client.putFile('05 Daily Notes/2026-10-29.md', file?.text ?? '', file?.sha ?? null, 'm');
  expect((calls[1].body as { content: string }).content).toBe(content);
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

// So antwortet GitHub auf eine Datei über 1 MB, solange der Standard-Accept gilt: 403 statt 200 mit leerem Inhalt.
const TOO_LARGE_BODY = JSON.stringify({
  message:
    'This API returns blobs up to 1 MB in size. The requested blob is too large to fetch via the API, but you can use the Git Data API to request blobs up to 100 MB in size.',
  errors: [{ resource: 'Blob', field: 'data', code: 'too_large' }],
  documentation_url: 'https://docs.github.com/rest/repos/contents#get-repository-content',
  status: '403',
});
const RATE_HEADERS = { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990' };

test('getFile: a file over 1 MB answers 403 first, then comes in the object format and via the blob', async () => {
  const path = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respond(
    { type: 'file', encoding: 'none', size: 2_000_000, name: '2026-10-29 Tag.svg', path, content: '', sha: 'big1' },
    { content: utf8ToBase64('<svg>groß €</svg>'), encoding: 'base64' },
  );
  expect(await client.getFile(path)).toEqual({ text: '<svg>groß €</svg>', sha: 'big1' });

  const contents = '/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main';
  expect(calls.map((c) => [c.method, c.url.replace(API, ''), c.headers.Accept])).toEqual([
    ['GET', contents, ACCEPT_DEFAULT],
    ['GET', contents, ACCEPT_OBJECT],
    ['GET', '/git/blobs/big1', ACCEPT_DEFAULT],
  ]);
  // Die Wiederholung trägt dieselben Kopfzeilen und denselben Cache-Modus, nur Accept ist ein anderes.
  expect(calls[1].headers).toEqual({ ...calls[0].headers, Accept: ACCEPT_OBJECT });
  expect(calls[1].cache).toBe('no-store');
});

test('getFile: whatever the retry answers follows the usual route', async () => {
  const path = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg';
  // Inhalt kommt mit: direkt dekodieren, kein Blob
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respond({ type: 'file', encoding: 'base64', size: 6, sha: 's1', content: utf8ToBase64('direkt') });
  expect(await client.getFile(path)).toEqual({ text: 'direkt', sha: 's1' });
  expect(calls).toHaveLength(2);
  // Die Datei ist inzwischen weg: 404 heißt weiter "gibt es nicht"
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respondStatus(404);
  expect(await client.getFile(path)).toBeNull();
  // Eine Antwort, die keine Datei beschreibt, ist keine Datei
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respond([{ name: 'x.svg', path: `${path}/x.svg`, sha: 's', type: 'file' }]);
  await expect(client.getFile(path)).rejects.toThrow('Unerwartete Antwort');
});

test('getFile: a 403 that stays a 403 is an AuthError, and the retry is made only once', async () => {
  const body = JSON.stringify({ message: 'Resource not accessible by personal access token' });
  respondStatus(403, body, RATE_HEADERS);
  respondStatus(403, body, RATE_HEADERS);
  await expect(client.getFile('05 Daily Notes/x.md')).rejects.toBeInstanceOf(AuthError);
  expect(calls.map((c) => c.headers.Accept)).toEqual([ACCEPT_DEFAULT, ACCEPT_OBJECT]);
  expect(calls).toHaveLength(2);
});

test('getFile: only a plain 403 is retried, not a rate limit and not any other failure', async () => {
  const path = '05 Daily Notes/x.md';
  const limited = '{"message":"You have exceeded a secondary rate limit."}';
  respondStatus(403, limited, { 'x-ratelimit-remaining': '0' });
  await expect(client.getFile(path)).rejects.toBeInstanceOf(RateLimitError);
  respondStatus(403, limited, { 'retry-after': '60' });
  await expect(client.getFile(path)).rejects.toBeInstanceOf(RateLimitError);
  respondStatus(429);
  await expect(client.getFile(path)).rejects.toBeInstanceOf(RateLimitError);
  respondStatus(401, '', RATE_HEADERS);
  await expect(client.getFile(path)).rejects.toBeInstanceOf(AuthError);
  respondStatus(500);
  await expect(client.getFile(path)).rejects.toThrow('500');
  respondStatus(404);
  expect(await client.getFile(path)).toBeNull();
  expect(calls).toHaveLength(6); // jeweils genau eine Anfrage

  // Das Limit kann auch erst die Wiederholung treffen
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respondStatus(403, limited, { 'retry-after': '60' });
  await expect(client.getFile(path)).rejects.toBeInstanceOf(RateLimitError);
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respondStatus(403, limited, { 'x-ratelimit-remaining': '0' });
  await expect(client.getFile(path)).rejects.toBeInstanceOf(RateLimitError);
});

test('getFile: the retry goes to the same guarded NFC path, and a refused path sends nothing at all', async () => {
  // a plus Trema statt ä als einem Zeichen, so wie manche Eingaben es liefern
  const nfd = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag.svg'.normalize('NFD');
  expect(nfd).not.toBe(nfd.normalize('NFC'));
  respondStatus(403, TOO_LARGE_BODY, RATE_HEADERS);
  respond({ type: 'file', encoding: 'none', size: 2_000_000, content: '', sha: 'big2' }, { content: utf8ToBase64('x'), encoding: 'base64' });
  expect(await client.getFile(nfd)).toEqual({ text: 'x', sha: 'big2' });
  const url = `${API}/contents/07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%20Tag.svg?ref=main`;
  expect(calls.map((c) => c.url)).toEqual([url, url, `${API}/git/blobs/big2`]);

  // Ein gesperrter Pfad kommt gar nicht erst zu einer ersten Anfrage, also auch nicht zu einer Wiederholung
  calls.length = 0;
  for (const refused of ['00 Beispiel/Notiz.md', '05 Daily Notes/../00 Beispiel/Notiz.md', '05 Daily Notes/Token.md', '04 Ressourcen/Kalender']) {
    await expect(client.getFile(refused), refused).rejects.toBeInstanceOf(PathNotAllowedError);
  }
  expect(calls).toEqual([]);
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
    // Sekundäres Ratenlimit: GitHub nennt mit retry-after, wann es weitergeht
    [403, { 'retry-after': '60' }, RateLimitError],
    [403, { 'x-ratelimit-remaining': '12', 'retry-after': '60' }, RateLimitError],
    [429, { 'retry-after': '60' }, RateLimitError],
    [401, { 'retry-after': '60' }, AuthError],
    [409, { 'retry-after': '60' }, ConflictError],
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
  // retry-after bei einem Serverfehler ist kein Ratenlimit
  respondStatus(503, '', { 'retry-after': '30' });
  const busy = await errorOf(client.headSha());
  expect(Object.getPrototypeOf(busy)).toBe(Error.prototype);
  expect(busy?.message).toContain('503');
});

test('errors that come from an answer carry its status, so callers need not parse the message', async () => {
  for (const status of [400, 404, 422, 500, 503]) {
    respondStatus(status, '{"message":"x"}');
    expect(statusOf(await errorOf(client.headSha())), String(status)).toBe(status);
  }
  respondStatus(409);
  const conflict = await errorOf(client.headSha());
  expect(conflict).toBeInstanceOf(ConflictError);
  expect(statusOf(conflict)).toBe(409);
  // Auch ein 422 über die sha ist ein Konflikt und behält seinen Status
  respondStatus(422, JSON.stringify({ message: 'Invalid request.\n\n"sha" wasn\'t supplied.' }));
  const shaless = await errorOf(client.headSha());
  expect(shaless).toBeInstanceOf(ConflictError);
  expect(statusOf(shaless)).toBe(422);
  // Der Fehler bleibt ein einfacher Error mit dem Text, der den Status nennt
  respondStatus(500);
  const plain = await errorOf(client.headSha());
  expect(Object.getPrototypeOf(plain)).toBe(Error.prototype);
  expect(plain?.message).toBe('GitHub antwortete mit Status 500.');
});

test('statusOf is undefined for everything that has no status', () => {
  expect(statusOf(new OfflineError())).toBeUndefined();
  expect(statusOf(new AuthError())).toBeUndefined();
  expect(statusOf(new RateLimitError())).toBeUndefined();
  expect(statusOf(new Error('x'))).toBeUndefined();
  expect(statusOf(Object.assign(new Error('x'), { status: '404' }))).toBeUndefined();
  expect(statusOf(null)).toBeUndefined();
  expect(statusOf(undefined)).toBeUndefined();
  expect(statusOf('404')).toBeUndefined();
});

test('errorFor gives tests the very error the client throws for an answer', () => {
  expect(statusOf(errorFor(404, new Headers(), ''))).toBe(404);
  expect(errorFor(409, new Headers(), '')).toBeInstanceOf(ConflictError);
  expect(errorFor(401, new Headers(), '')).toBeInstanceOf(AuthError);
  expect(errorFor(429, new Headers(), '')).toBeInstanceOf(RateLimitError);
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

test('OfflineError keeps the original error as cause, and the cause never lands in the message', async () => {
  failNetwork();
  const lost = await errorOf(client.headSha());
  expect(lost).toBeInstanceOf(OfflineError);
  expect(lost?.cause).toBeInstanceOf(TypeError);
  expect((lost?.cause as Error).message).toBe('Failed to fetch');
  expect(lost?.message).toBe('Keine Verbindung zu GitHub.');

  // Auch wenn die Verbindung erst beim Lesen der Antwort abbricht
  replies.push({ kind: 'bodyFails' });
  const cut = await errorOf(client.headSha());
  expect(cut).toBeInstanceOf(OfflineError);
  expect((cut?.cause as Error).message).toBe('network error');
  expect(cut?.message).toBe('Keine Verbindung zu GitHub.');

  // Der Konstruktor nimmt die Ursache getrennt vom Text. Ohne Ursache gibt es keine.
  const own = new OfflineError('eigener Text', { cause: 'Ursache' });
  expect(own.message).toBe('eigener Text');
  expect(own.cause).toBe('Ursache');
  expect('cause' in new OfflineError()).toBe(false);
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
    [403, { 'retry-after': '60' }],
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
      { filename: '00 Beispiel/Passwörter Muster.md' },
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

// ---------------------------------------------------------------------------------------------
// listDir bei großen Ordnern: Die Contents-API liefert höchstens 1000 Einträge, danach schneidet sie ab
// ---------------------------------------------------------------------------------------------

const BIG_DIR = '07 Anhänge/Notizbuch/2026';
const BIG_DIR_URL = '/contents/07%20Anh%C3%A4nge/Notizbuch/2026?ref=main';
const PARENT_URL = '/contents/07%20Anh%C3%A4nge/Notizbuch?ref=main';

function dayName(i: number) {
  return `2026-${String(i).padStart(4, '0')} Tag.svg`;
}

/** Eine Ordnerliste der Contents-API mit `count` Dateien. */
function contentsListing(count: number) {
  return Array.from({ length: count }, (_, i) => ({ name: dayName(i), path: `${BIG_DIR}/${dayName(i)}`, sha: `c${i}`, type: 'file' }));
}

/** Die Liste des Elternordners. Darin steht die sha des großen Ordners. */
const PARENT_LISTING = [
  { name: '2025', path: '07 Anhänge/Notizbuch/2025', sha: 'tree2025', type: 'dir' },
  { name: '2026', path: BIG_DIR, sha: 'tree2026', type: 'dir' },
  { name: 'Deckblatt.svg', path: '07 Anhänge/Notizbuch/Deckblatt.svg', sha: 'dk1', type: 'file' },
];

test('listDir: at 1000 entries the list may be cut off, so the full list comes from the Git Trees API', async () => {
  const tree: unknown[] = Array.from({ length: 1250 }, (_, i) => ({
    path: dayName(i),
    mode: '100644',
    type: 'blob',
    sha: `b${i}`,
    size: 100,
    url: `https://api.github.com/repos/${REPO}/git/blobs/b${i}`,
  }));
  tree.push(
    { path: 'Unterordner', mode: '040000', type: 'tree', sha: 'sub1', url: 'https://api.github.com/x' },
    { path: 'Modul', mode: '160000', type: 'commit', sha: 'mod1' }, // Submodul
    { path: 'Monkey.svg', mode: '100644', type: 'blob', sha: 'm1' },
    { path: 'Recovery Codes.md', mode: '100644', type: 'blob', sha: 'x1' },
    { path: 'Notfall.KEY', mode: '100644', type: 'blob', sha: 'x2' },
    { path: 'PASSWORT', mode: '040000', type: 'tree', sha: 'x3' },
    { path: 'api.Token', mode: '100644', type: 'blob', sha: 'x4' },
    { path: 'ohne Sha', mode: '100644', type: 'blob' },
    { mode: '100644', type: 'blob', sha: 'ohne Pfad' },
    { path: 'unbekannt', type: 'link', sha: 'x5' },
    'kein Objekt',
    null,
  );
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respond({ sha: 'tree2026', url: 'https://api.github.com/x', tree, truncated: false });

  const entries = await client.listDir(BIG_DIR);

  // mehr als die 1000 der Contents-API, gleiche Form wie dort, ganze Pfade, gesperrte und unbrauchbare Einträge weg
  expect(entries).toHaveLength(1250 + 2);
  expect(entries[0]).toEqual({ name: dayName(0), path: `${BIG_DIR}/${dayName(0)}`, sha: 'b0', type: 'file' });
  expect(entries[1249]).toEqual({ name: dayName(1249), path: `${BIG_DIR}/${dayName(1249)}`, sha: 'b1249', type: 'file' });
  expect(entries[1250]).toEqual({ name: 'Unterordner', path: `${BIG_DIR}/Unterordner`, sha: 'sub1', type: 'dir' });
  expect(entries[1251]).toEqual({ name: 'Monkey.svg', path: `${BIG_DIR}/Monkey.svg`, sha: 'm1', type: 'file' });
  expect(entries.every((e) => Object.keys(e).sort().join() === 'name,path,sha,type')).toBe(true);

  // Reihenfolge der Anfragen: Ordner, dann Elternordner (für die sha), dann Tree. Alle wie üblich gesendet, der Tree ohne Rekursion.
  expect(calls.map((c) => [c.method, c.url.replace(API, '')])).toEqual([
    ['GET', BIG_DIR_URL],
    ['GET', PARENT_URL],
    ['GET', '/git/trees/tree2026'],
  ]);
  for (const call of calls) {
    expect(call.headers.Accept, call.url).toBe(ACCEPT_DEFAULT);
    expect(call.headers.Authorization, call.url).toBe(`Bearer ${TOKEN}`);
    expect(call.cache, call.url).toBe('no-store');
    expect(call.url, call.url).not.toContain(TOKEN);
  }
});

test('listDir: up to 999 entries are the whole folder, only 1000 or more start the second route', async () => {
  respond(contentsListing(999));
  const entries = await client.listDir(BIG_DIR);
  expect(entries).toHaveLength(999);
  expect(calls).toHaveLength(1);

  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respond({ tree: [{ path: 'a.svg', type: 'blob', sha: 'b1' }], truncated: false });
  expect(await client.listDir(BIG_DIR)).toHaveLength(1);
  expect(calls).toHaveLength(4);
});

test('listDir: the limit counts the entries GitHub sent, not the ones left after filtering', async () => {
  // 1000 Einträge, davon zwei gesperrte: GitHub hat an der Grenze abgeschnitten, auch wenn danach nur 998 übrig sind.
  const sent = [
    ...contentsListing(998),
    { name: 'Recovery Codes.md', path: `${BIG_DIR}/Recovery Codes.md`, sha: 'r1', type: 'file' },
    { name: 'Notfall.KEY', path: `${BIG_DIR}/Notfall.KEY`, sha: 'r2', type: 'file' },
  ];
  expect(sent).toHaveLength(1000);
  respond(sent);
  respond(PARENT_LISTING);
  respond({ tree: [{ path: 'a.svg', type: 'blob', sha: 'b1' }], truncated: false });
  expect((await client.listDir(BIG_DIR)).map((e) => e.name)).toEqual(['a.svg']);
  expect(calls).toHaveLength(3);
});

test('listDir: a truncated tree answer is returned as far as it goes, an empty one is an empty folder', async () => {
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respond({ sha: 'tree2026', truncated: true, tree: [{ path: 'a.svg', type: 'blob', sha: 'b1' }, { path: 'b.svg', type: 'blob', sha: 'b2' }] });
  expect((await client.listDir(BIG_DIR)).map((e) => e.name)).toEqual(['a.svg', 'b.svg']);

  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respond({ sha: 'tree2026', truncated: false, tree: [] });
  expect(await client.listDir(BIG_DIR)).toEqual([]);
});

test('listDir: the Git Trees route works from the NFC path and encodes the sha', async () => {
  const nfd = BIG_DIR.normalize('NFD');
  expect(nfd).not.toBe(BIG_DIR);
  respond(contentsListing(1000));
  respond([{ name: '2026', path: BIG_DIR, sha: 'a/b?c', type: 'dir' }]);
  respond({ tree: [{ path: 'x.svg', type: 'blob', sha: 'b1' }], truncated: false });
  expect(await client.listDir(nfd)).toEqual([{ name: 'x.svg', path: `${BIG_DIR}/x.svg`, sha: 'b1', type: 'file' }]);
  expect(calls.map((c) => c.url.replace(API, ''))).toEqual([BIG_DIR_URL, PARENT_URL, '/git/trees/a%2Fb%3Fc']);
});

test('listDir: when the parent folder is big too, its sha comes from the Git Trees API in turn', async () => {
  const sub = `${BIG_DIR}/Unterordner`;
  respond(Array.from({ length: 1000 }, (_, i) => ({ name: dayName(i), path: `${sub}/${dayName(i)}`, sha: `u${i}`, type: 'file' })));
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respond({ tree: [{ path: 'Unterordner', type: 'tree', sha: 'treeSub' }], truncated: false });
  respond({ tree: [{ path: 'Seite.svg', type: 'blob', sha: 'bs' }], truncated: false });
  expect(await client.listDir(sub)).toEqual([{ name: 'Seite.svg', path: `${sub}/Seite.svg`, sha: 'bs', type: 'file' }]);
  expect(calls.map((c) => c.url.replace(API, ''))).toEqual([
    '/contents/07%20Anh%C3%A4nge/Notizbuch/2026/Unterordner?ref=main',
    BIG_DIR_URL,
    PARENT_URL,
    '/git/trees/tree2026',
    '/git/trees/treeSub',
  ]);
});

test('listDir: a big folder whose parent the guard does not release is an error, not a silently cut-off list', async () => {
  // Diese vier Ordner haben keinen freigegebenen Elternordner (Hauptordner des Vaults, 07 Anhänge, 04 Ressourcen).
  for (const folder of ['05 Daily Notes', '02 Projekte', '07 Anhänge/Notizbuch', '04 Ressourcen/Kalender']) {
    calls.length = 0;
    respond(contentsListing(1000));
    const error = await errorOf(client.listDir(folder));
    expect(error, folder).not.toBeNull();
    expect(error, folder).not.toBeInstanceOf(PathNotAllowedError);
    expect(error?.message, folder).toContain('1000');
    expect(calls, folder).toHaveLength(1); // nur die Liste des Ordners selbst, nie die des Elternordners
  }
});

test('listDir: the Git Trees route refuses answers it cannot trust and reports missing pieces', async () => {
  // Der Elternordner kennt den Ordner nicht (zwischendurch gelöscht)
  respond(contentsListing(1000));
  respond([{ name: '2025', path: '07 Anhänge/Notizbuch/2025', sha: 'tree2025', type: 'dir' }]);
  await expect(client.listDir(BIG_DIR)).rejects.toThrow('Unerwartete Antwort');
  // Gleicher Name, aber eine Datei: deren sha ist keine Tree-sha
  respond(contentsListing(1000));
  respond([{ name: '2026', path: BIG_DIR, sha: 'file1', type: 'file' }]);
  await expect(client.listDir(BIG_DIR)).rejects.toThrow('Unerwartete Antwort');
  // Der Elternordner ist weg (404 ergibt eine leere Liste)
  respond(contentsListing(1000));
  respondStatus(404);
  await expect(client.listDir(BIG_DIR)).rejects.toThrow('Unerwartete Antwort');
  // Die Antwort der Trees API hat keine Einträge
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respond({ sha: 'tree2026', truncated: false });
  await expect(client.listDir(BIG_DIR)).rejects.toThrow('Unerwartete Antwort');
  // Der Tree fehlt: ein Fehler mit dem Status, keine leere Liste
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respondStatus(404);
  const gone = await errorOf(client.listDir(BIG_DIR));
  expect(gone).not.toBeNull();
  expect(gone?.message).toContain('404');
});

test('listDir: the extra requests of the Git Trees route map errors like every other request', async () => {
  respond(contentsListing(1000));
  respondStatus(401);
  await expect(client.listDir(BIG_DIR)).rejects.toBeInstanceOf(AuthError);
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  failNetwork();
  await expect(client.listDir(BIG_DIR)).rejects.toBeInstanceOf(OfflineError);
  respond(contentsListing(1000));
  respond(PARENT_LISTING);
  respondStatus(403, '', { 'x-ratelimit-remaining': '0' });
  await expect(client.listDir(BIG_DIR)).rejects.toBeInstanceOf(RateLimitError);
});
