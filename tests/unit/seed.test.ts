import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  assertTestRepo,
  assertUploadPath,
  commitMessage,
  createUploader,
  decideAction,
  DEFAULT_REPO,
  FIXTURES_DIR,
  main,
  planUploads,
  redact,
  SeedError,
} from '../../scripts/seed-test-vault.mjs';
import { hasBlockedWordPart } from '../../src/sync/paths';

// Der Test spricht nie mit GitHub. `main` bekommt ein eigenes `fetch`, das einen kleinen Vault im Speicher spielt.
// Das echte `fetch` ist gesperrt, damit ein Versehen sofort auffällt.

const TOKEN = 'github_pat_TEST';
const API = 'https://api.github.com/repos/johrob-lab/2-gehirn-test/contents/';

type Body = { message?: string; content?: string; sha?: string; branch?: string };
type Call = { method: string; url: string; path: string; headers: Record<string, string>; body?: Body };
/** Darf eine Antwort vorgeben (Response) oder einen Netzfehler (Error). `undefined` heißt: normal antworten. */
type Override = (call: Call) => Response | Error | undefined;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Ein Vault im Speicher mit der Contents-API von GitHub: Lesen (200 oder 404) und Schreiben (201, 200, 409 oder 422). */
function fakeGitHub(existing: Record<string, string> = {}, override?: Override) {
  const files = new Map<string, { sha: string; bytes: Buffer }>();
  const calls: Call[] = [];
  let counter = 0;
  for (const [path, text] of Object.entries(existing)) files.set(path.normalize('NFC'), { sha: `alt${++counter}`, bytes: Buffer.from(text) });

  const fetchFn = async (input: unknown, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const path = url.startsWith(API) ? decodeURIComponent(url.slice(API.length).split('?')[0]) : '';
    const call: Call = {
      method: init.method ?? 'GET',
      url,
      path,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? (JSON.parse(init.body) as Body) : undefined,
    };
    calls.push(call);
    const forced = override?.(call);
    if (forced instanceof Error) throw forced;
    if (forced) return forced;
    const found = files.get(path.normalize('NFC'));
    if (call.method === 'GET') return found ? json(200, { sha: found.sha, path }) : json(404, { message: 'Not Found' });
    if (call.method === 'PUT') {
      const body = call.body ?? {};
      if (found && body.sha === undefined) return json(422, { message: '"sha" wasn\'t supplied.' });
      if (found && body.sha !== found.sha) return json(409, { message: 'does not match' });
      const sha = `neu${++counter}`;
      files.set(path.normalize('NFC'), { sha, bytes: Buffer.from(body.content ?? '', 'base64') });
      return json(found ? 200 : 201, { content: { sha } });
    }
    return json(405, {});
  };
  return { fetchFn, calls, files, puts: () => calls.filter((c) => c.method === 'PUT') };
}

/** Ein Lauf von `main` mit aufgefangener Ausgabe. */
async function run(argv: string[], env: Record<string, string | undefined>, fake = fakeGitHub(), fixturesDir: string = FIXTURES_DIR) {
  const out: string[] = [];
  const err: string[] = [];
  const code = await main({
    argv,
    env,
    fetchFn: fake.fetchFn,
    log: (line: string) => out.push(line),
    errorLog: (line: string) => err.push(line),
    fixturesDir,
  });
  return { code, out, err, text: [...out, ...err].join('\n'), fake };
}

/** Alle Dateien unter `dir` als Vault-Pfade (NFC, mit `/`), sortiert. Unabhängig vom Skript gezählt. */
function filesBelow(dir: string): string[] {
  return readdirSync(dir, { recursive: true })
    .map(String)
    .filter((name) => statSync(join(dir, name)).isFile())
    .map((name) => name.split(/[\\/]/).join('/').normalize('NFC'))
    .sort();
}

const temp: string[] = [];
function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'notizbuch-seed-'));
  temp.push(dir);
  return dir;
}

beforeEach(() => {
  vi.stubGlobal('fetch', () => {
    throw new Error('Im Test gibt es kein Netz.');
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('seed script: which repository', () => {
  test('refuses real vault', async () => {
    expect(() => assertTestRepo('johrob-lab/2-gehirn')).toThrow(SeedError);
    expect(() => assertTestRepo('johrob-lab/2-gehirn')).toThrow(/-test/);

    // Der ganze Lauf bricht ab, bevor irgendetwas gelesen oder hochgeladen wird, auch mit Token.
    const fake = fakeGitHub();
    const result = await run([], { GITHUB_TOKEN: TOKEN, REPO: 'johrob-lab/2-gehirn' }, fake);
    expect(result.code).toBe(1);
    expect(fake.calls).toHaveLength(0);
    expect(result.err.join('\n')).toMatch(/-test/);
    // ... auch beim Probelauf
    const dry = await run(['--dry-run'], { REPO: 'johrob-lab/2-gehirn' }, fake);
    expect(dry.code).toBe(1);
  });

  test('only well-formed repository names ending in -test are accepted', () => {
    for (const repo of [DEFAULT_REPO, 'johrob-lab/2-gehirn-test', 'andere-org/mein.vault_neu-test']) {
      expect(() => assertTestRepo(repo), repo).not.toThrow();
    }
    for (const repo of [
      '',
      'johrob-lab',
      'johrob-lab/2-gehirn',
      'johrob-lab/2-gehirn-Test', // Groß- und Kleinschreibung zählt
      'johrob-lab/2-gehirn-TEST',
      'johrob-lab/2-gehirn-test ', // Leerzeichen am Ende
      ' johrob-lab/2-gehirn-test',
      'johrob-lab/2-gehirn-test\n',
      'johrob-lab/2-gehirn-test/extra',
      'johrob-lab/2-gehirn/x-test',
      'https://github.com/johrob-lab/2-gehirn-test',
      '/2-gehirn-test',
      'johrob-lab/-test-',
      'a/b/c-test',
      'johrob-lab/test', // endet nicht auf -test
      undefined,
      null,
      42,
    ]) {
      expect(() => assertTestRepo(repo as string), JSON.stringify(repo)).toThrow(SeedError);
    }
  });

  test('the default is the test repository', async () => {
    expect(DEFAULT_REPO).toBe('johrob-lab/2-gehirn-test');
    const dry = await run(['--dry-run'], {});
    expect(dry.code).toBe(0);
    expect(dry.out.join('\n')).toContain(DEFAULT_REPO);
    // Ein leeres REPO zählt als nicht gesetzt.
    const empty = await run(['--dry-run'], { REPO: '  ' });
    expect(empty.code).toBe(0);
    expect(empty.out.join('\n')).toContain(DEFAULT_REPO);
  });
});

describe('seed script: which files', () => {
  test('uploads only fixtures', async () => {
    const fake = fakeGitHub();
    const result = await run([], { GITHUB_TOKEN: TOKEN }, fake);
    expect(result.code, result.text).toBe(0);

    // genau die Dateien unter tests/fixtures/vault, keine mehr und keine weniger
    expect(FIXTURES_DIR.split(/[\\/]/).slice(-3)).toEqual(['tests', 'fixtures', 'vault']);
    const onDisk = filesBelow(FIXTURES_DIR);
    expect(onDisk.length).toBeGreaterThan(0);
    expect(onDisk).toContain('05 Daily Notes/2026-10-29.md');
    expect(fake.puts().map((c) => c.path).sort()).toEqual(onDisk);

    // nur Adressen im Test-Repo, nur Contents-API
    expect(fake.calls.every((c) => c.url.startsWith(API))).toBe(true);
    // Inhalte unverändert, Byte für Byte
    for (const put of fake.puts()) {
      expect(Buffer.from(put.body?.content ?? '', 'base64').equals(readFileSync(join(FIXTURES_DIR, put.path))), put.path).toBe(true);
    }
    // Ein Lauf lädt nichts, was nicht in der Planung stand.
    expect(planUploads(FIXTURES_DIR).map((p) => p.path)).toEqual(onDisk);
  });

  test('refuses blocked word parts and ..', () => {
    const blocked = ['Recovery', 'recovery', 'RECOVERY', 'Recovery Codes', 'Passwort', 'PASSWORD', 'passw', 'Token', 'TOKEN', 'api token', 'datei.key', 'DATEI.KEY', '.key', 'a.Key.md'];
    for (const name of blocked) {
      expect(() => assertUploadPath(`05 Daily Notes/${name}.md`), name).toThrow(SeedError);
      expect(() => assertUploadPath(`07 Anhänge/Notizbuch/${name}/Seite.svg`), name).toThrow(SeedError);
      expect(() => assertUploadPath(name), name).toThrow(SeedError);
    }
    for (const path of ['..', '../x.md', '05 Daily Notes/../x.md', '05 Daily Notes/..', 'a..b.md', '05 Daily Notes/..x.md']) {
      expect(() => assertUploadPath(path), path).toThrow(/\.\./);
    }
    // Weitere Formen, die kein sauberer Vault-Pfad sind
    for (const path of ['', '/05 Daily Notes/x.md', '05 Daily Notes//x.md', '05 Daily Notes/', './x.md', '05 Daily Notes\\x.md', '05 Daily Notes/a\nb.md', '05 Daily Notes/a\u0000b.md']) {
      expect(() => assertUploadPath(path), JSON.stringify(path)).toThrow(SeedError);
    }
    // Ähnliche Namen bleiben erlaubt.
    for (const path of [
      '05 Daily Notes/2026-10-29.md',
      '02 Projekte/Beispielprojekt A.md',
      '04 Ressourcen/Kalender/Termine.md',
      '07 Anhänge/Notizbuch/2026/2026-10-29 0800 Sperren & "Muster" <2027> S1.svg',
      '05 Daily Notes/Monkey.md',
      '05 Daily Notes/Tokyo.md',
      '05 Daily Notes/Passage.md',
      '05 Daily Notes/Recover.md',
    ]) {
      expect(() => assertUploadPath(path), path).not.toThrow();
    }
  });

  test('blocks the same word parts as the path guard of the app', () => {
    const names = [
      'Recovery', 'recovery', 'RECOVERY', 'Passwort', 'PASSWORT', 'Password', 'Passwörter', 'Token', 'TOKEN', 'tokens', 'GitHub Token',
      'datei.key', 'DATEI.KEY', '.key', 'speicher.keystore', 'Monkey', 'Keyboard', 'Tokyo', 'Passage', 'Recover', 'Kompass west', '2026-10-29',
    ];
    for (const name of names) {
      const path = `05 Daily Notes/${name}.md`;
      let refused = false;
      try {
        assertUploadPath(path);
      } catch {
        refused = true;
      }
      expect(refused, name).toBe(hasBlockedWordPart(path));
    }
  });

  test('a folder with a blocked name or a link is refused as a whole, before the first upload', async () => {
    for (const name of ['Recovery Codes.md', 'meine passwoerter.txt', 'token.txt', 'id.key']) {
      const dir = tempDir();
      mkdirSync(join(dir, '05 Daily Notes'));
      writeFileSync(join(dir, '05 Daily Notes', '2026-10-29.md'), 'Inhalt');
      writeFileSync(join(dir, '05 Daily Notes', name), 'geheim');
      expect(() => planUploads(dir), name).toThrow(SeedError);
      const fake = fakeGitHub();
      const result = await run([], { GITHUB_TOKEN: TOKEN }, fake, dir);
      expect(result.code, name).toBe(1);
      expect(fake.calls, name).toHaveLength(0); // auch die unbedenkliche Datei bleibt liegen
    }

    const folder = tempDir();
    mkdirSync(join(folder, 'Token'));
    writeFileSync(join(folder, 'Token', 'a.md'), 'x');
    expect(() => planUploads(folder)).toThrow(SeedError);

    const dots = tempDir();
    writeFileSync(join(dots, 'a..b.md'), 'x');
    expect(() => planUploads(dots)).toThrow(/\.\./);

    // Eine Verknüpfung könnte aus dem Ordner hinausführen.
    const linked = tempDir();
    const outside = tempDir();
    writeFileSync(join(outside, 'draussen.md'), 'x');
    symlinkSync(join(outside, 'draussen.md'), join(linked, 'link.md'));
    expect(() => planUploads(linked)).toThrow(/Verknüpfung/);
  });

  test('system files are ignored, a missing or empty folder is an error', () => {
    const dir = tempDir();
    mkdirSync(join(dir, '05 Daily Notes'));
    writeFileSync(join(dir, '05 Daily Notes', '2026-10-29.md'), 'Inhalt');
    writeFileSync(join(dir, '.DS_Store'), 'x');
    writeFileSync(join(dir, '05 Daily Notes', 'Thumbs.db'), 'x');
    expect(planUploads(dir).map((p) => p.path)).toEqual(['05 Daily Notes/2026-10-29.md']);

    expect(() => planUploads(join(dir, 'gibt-es-nicht'))).toThrow(SeedError);
    expect(() => planUploads(tempDir())).toThrow(SeedError); // nichts zum Hochladen
  });

  test('paths are normalized to NFC', async () => {
    const dir = tempDir();
    const nfdFolder = 'Anhänge'; // a plus Trema, so liefern manche Dateisysteme "Anhänge"
    mkdirSync(join(dir, nfdFolder));
    writeFileSync(join(dir, nfdFolder, 'Übung.md'), 'Inhalt');

    const plan = planUploads(dir);
    expect(plan).toHaveLength(1);
    expect(plan[0].path).toBe('Anhänge/Übung.md');
    expect(readFileSync(plan[0].file, 'utf8')).toBe('Inhalt'); // `file` zeigt weiter auf die echte Datei

    const fake = fakeGitHub();
    const result = await run([], { GITHUB_TOKEN: TOKEN }, fake, dir);
    expect(result.code, result.text).toBe(0);
    const [put] = fake.puts();
    expect(put.url).toBe(`${API}Anh%C3%A4nge/%C3%9Cbung.md`);
    expect(put.path.normalize('NFC')).toBe('Anhänge/Übung.md');
    expect(put.body?.message).toBe('Testdaten für das Notizbuch: Anhänge/Übung.md');
  });

  test('the plan is sorted by path, upper case before lower case', () => {
    const dir = tempDir();
    for (const name of ['k.md', 'a.md', 'Z.md', 'z.md', 'c.md', '\u00e4.md', 'B.md', 'm.md', 'x.md', 'f.md']) writeFileSync(join(dir, name), name);
    mkdirSync(join(dir, 'zeta'));
    mkdirSync(join(dir, 'Alpha'));
    writeFileSync(join(dir, 'zeta', 'b.md'), 'x');
    writeFileSync(join(dir, 'Alpha', 'a.md'), 'x');
    const paths = planUploads(dir).map((p) => p.path);
    expect(paths).toHaveLength(12);
    expect(paths).toEqual([...paths].sort());
    expect(paths.indexOf('Alpha/a.md')).toBeLessThan(paths.indexOf('a.md'));
  });

  test('the plan is sorted whatever order the file system lists', async () => {
    // Manche Dateisysteme liefern die Namen schon sortiert. Darum bekommt eine frische Fassung des Skripts ein readdirSync,
    // das jeden Ordner rückwärts liefert.
    vi.resetModules();
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>();
      const backwards = ((...args: Parameters<typeof actual.readdirSync>) => [...(actual.readdirSync as (...a: unknown[]) => unknown[])(...args)].reverse()) as typeof actual.readdirSync;
      return { ...actual, default: actual, readdirSync: backwards };
    });
    try {
      const dir = tempDir();
      for (const name of ['b.md', 'a.md', 'C.md']) writeFileSync(join(dir, name), name);
      mkdirSync(join(dir, 'zeta'));
      writeFileSync(join(dir, 'zeta', 'a.md'), 'x');
      const fresh = await import('../../scripts/seed-test-vault.mjs');
      expect(fresh.planUploads(dir).map((p) => p.path)).toEqual(['C.md', 'a.md', 'b.md', 'zeta/a.md']);
    } finally {
      vi.doUnmock('node:fs');
      vi.resetModules();
    }
  });

  test('two files that become the same path in NFC are refused', () => {
    const dir = tempDir();
    writeFileSync(join(dir, '\u00c4rger.md'), 'a');
    writeFileSync(join(dir, 'A\u0308rger.md'), 'b'); // dasselbe Wort mit Buchstabe plus Trema
    // Manche Dateisysteme (macOS) halten beide für dieselbe Datei. Dann gibt es hier nichts zu prüfen.
    if (readdirSync(dir).length === 2) expect(() => planUploads(dir)).toThrow(/denselben Pfad/);
  });
});

describe('seed script: what happens to each file', () => {
  test('decideAction', () => {
    expect(decideAction(null, false)).toBe('create');
    expect(decideAction(null, true)).toBe('create');
    expect(decideAction('abc123', false)).toBe('skip');
    expect(decideAction('abc123', true)).toBe('update');
  });

  test('existing files are skipped unless --force', async () => {
    const names = filesBelow(FIXTURES_DIR);
    const first = names[0];

    const fake = fakeGitHub({ [first]: 'alter Inhalt' });
    const result = await run([], { GITHUB_TOKEN: TOKEN }, fake);
    expect(result.code, result.text).toBe(0);
    expect(fake.puts().map((c) => c.path).sort()).toEqual(names.slice(1));
    expect(fake.files.get(first)?.bytes.toString()).toBe('alter Inhalt'); // blieb unberührt
    expect(result.out.join('\n')).toContain(first); // und die Ausgabe sagt, dass es übersprungen wurde
    expect(result.out.join('\n')).toMatch(/übersprungen/);

    // Ein zweiter Lauf ohne --force findet alles vor und ändert nichts mehr.
    const before = fake.puts().length;
    const again = await run([], { GITHUB_TOKEN: TOKEN }, fake);
    expect(again.code).toBe(0);
    expect(fake.puts()).toHaveLength(before);

    // Mit --force wird überschrieben, mit der sha der vorhandenen Datei. Neue Dateien bekommen keine.
    const forcedFake = fakeGitHub({ [first]: 'alter Inhalt' });
    const shaBefore = forcedFake.files.get(first)?.sha;
    const forced = await run(['--force'], { GITHUB_TOKEN: TOKEN }, forcedFake);
    expect(forced.code, forced.text).toBe(0);
    expect(forcedFake.puts().map((c) => c.path).sort()).toEqual(names);
    const overwrite = forcedFake.puts().find((c) => c.path === first);
    expect(overwrite?.body?.sha).toBe(shaBefore);
    expect(Buffer.from(overwrite?.body?.content ?? '', 'base64').equals(readFileSync(join(FIXTURES_DIR, first)))).toBe(true);
    expect(forcedFake.puts().filter((c) => c.path !== first).every((c) => c.body?.sha === undefined)).toBe(true);
    expect(forced.out.join('\n')).toMatch(/überschrieben/);
  });

  test('commit message names the file', async () => {
    expect(commitMessage('05 Daily Notes/2026-10-29.md')).toBe('Testdaten für das Notizbuch: 05 Daily Notes/2026-10-29.md');
    expect(commitMessage('Anhänge/x.md')).toBe('Testdaten für das Notizbuch: Anhänge/x.md');

    const fake = fakeGitHub();
    await run([], { GITHUB_TOKEN: TOKEN }, fake);
    expect(fake.puts().length).toBeGreaterThan(0);
    for (const put of fake.puts()) expect(put.body?.message, put.path).toBe(`Testdaten für das Notizbuch: ${put.path}`);
  });

  test('the token goes only into the Authorization header', async () => {
    const fake = fakeGitHub();
    await run([], { GITHUB_TOKEN: `  ${TOKEN}\n` }, fake); // Leerzeichen und Zeilenumbruch vom Einfügen stören nicht
    expect(fake.calls.length).toBeGreaterThan(0);
    for (const call of fake.calls) {
      expect(call.headers.Authorization).toBe(`Bearer ${TOKEN}`);
      expect(call.url).not.toContain(TOKEN);
      expect(JSON.stringify(call.body ?? {})).not.toContain(TOKEN);
    }
  });

  test('the global fetch is used when none is given', async () => {
    const fake = fakeGitHub();
    vi.stubGlobal('fetch', fake.fetchFn);
    const out: string[] = [];
    const code = await main({ argv: [], env: { GITHUB_TOKEN: TOKEN }, log: (line: string) => out.push(line), errorLog: (line: string) => out.push(line) });
    expect(code, out.join('\n')).toBe(0);
    expect(fake.puts().length).toBe(filesBelow(FIXTURES_DIR).length);
  });
});

describe('seed script: the uploader', () => {
  test('encodes every path part, in NFC', async () => {
    const fake = fakeGitHub();
    const uploader = createUploader({ token: TOKEN, repo: DEFAULT_REPO, fetchFn: fake.fetchFn });
    await uploader.find('07 Anha\u0308nge/Notizbuch/2026/2026-10-29 0800 Sperren & "Muster" <2027> S1.svg');
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0].method).toBe('GET');
    expect(fake.calls[0].url).toBe(
      `${API}07%20Anh%C3%A4nge/Notizbuch/2026/2026-10-29%200800%20Sperren%20%26%20%22Muster%22%20%3C2027%3E%20S1.svg`,
    );
  });

  test('find returns the sha, or null when there is no file', async () => {
    const fake = fakeGitHub({ '05 Daily Notes/da.md': 'x' });
    const uploader = createUploader({ token: TOKEN, repo: DEFAULT_REPO, fetchFn: fake.fetchFn });
    expect(await uploader.find('05 Daily Notes/da.md')).toBe(fake.files.get('05 Daily Notes/da.md')?.sha);
    expect(await uploader.find('05 Daily Notes/fehlt.md')).toBeNull();
    // eine Antwort, die keine Datei beschreibt
    const odd = createUploader({ token: TOKEN, repo: DEFAULT_REPO, fetchFn: async () => new Response('[]', { status: 200 }) });
    await expect(odd.find('05 Daily Notes/da.md')).rejects.toThrow(SeedError);
    const garbled = createUploader({ token: TOKEN, repo: DEFAULT_REPO, fetchFn: async () => new Response('<html>', { status: 200 }) });
    await expect(garbled.find('05 Daily Notes/da.md')).rejects.toThrow(/Unerwartete Antwort/);
  });

  test('reports failures without the token, also without the original error', async () => {
    const failures: Override[] = [
      () => json(401, { message: 'Bad credentials' }),
      () => json(403, {}),
      () => json(500, {}),
      () => new TypeError(`fetch failed ${TOKEN}`),
      () => new Error(`Bearer ${TOKEN}`),
    ];
    for (const override of failures) {
      const uploader = createUploader({ token: TOKEN, repo: DEFAULT_REPO, fetchFn: fakeGitHub({}, override).fetchFn });
      const calls = [() => uploader.find('05 Daily Notes/a.md'), () => uploader.put('05 Daily Notes/a.md', new TextEncoder().encode('x'), null, 'Nachricht')];
      for (const call of calls) {
        const error = await call().then(
          () => null,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(SeedError);
        expect((error as SeedError).message).not.toContain(TOKEN);
        expect((error as SeedError).cause).toBeUndefined();
        expect(JSON.stringify(error, Object.getOwnPropertyNames(error))).not.toContain(TOKEN);
      }
    }
  });

  test('a request that never answers ends after 30 seconds', async () => {
    vi.useFakeTimers();
    try {
      const hanging = (_input: unknown, init: RequestInit = {}) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new DOMException('abgebrochen', 'AbortError')));
        });
      const uploader = createUploader({ token: TOKEN, repo: DEFAULT_REPO, fetchFn: hanging });
      const pending = uploader.find('05 Daily Notes/a.md').then(
        () => null,
        (e: unknown) => e,
      );
      await vi.advanceTimersByTimeAsync(29_000);
      let settled = false;
      void pending.then(() => (settled = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(settled).toBe(false); // nach 29 Sekunden wartet es noch
      await vi.advanceTimersByTimeAsync(1_000);
      const error = await pending;
      expect(error).toBeInstanceOf(SeedError);
      expect((error as SeedError).message).toMatch(/Verbindung/);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('seed script: switches, token and errors', () => {
  test('dry run lists files and calls nothing', async () => {
    const fake = fakeGitHub();
    const result = await run(['--dry-run'], {}, fake); // ohne Token, denn es wird nichts gefragt
    expect(result.code, result.text).toBe(0);
    expect(fake.calls).toHaveLength(0);
    for (const path of filesBelow(FIXTURES_DIR)) expect(result.out.join('\n')).toContain(path);
    expect(result.out.join('\n')).toContain(DEFAULT_REPO);
    // Auch mit Token und --force bleibt es beim Auflisten.
    const forced = await run(['--dry-run', '--force'], { GITHUB_TOKEN: TOKEN }, fake);
    expect(forced.code).toBe(0);
    expect(fake.calls).toHaveLength(0);
  });

  test('a real run needs a usable token', async () => {
    const fake = fakeGitHub();
    for (const env of [{}, { GITHUB_TOKEN: '' }, { GITHUB_TOKEN: '   ' }]) {
      const result = await run([], env, fake);
      expect(result.code, JSON.stringify(env)).toBe(1);
      expect(result.err.join('\n')).toContain('GITHUB_TOKEN');
    }
    // Zeichen, die in keinem Token vorkommen, werden gemeldet, ohne den Token zu zeigen.
    for (const token of [`${TOKEN} mit Leerzeichen`, `${TOKEN}ä`, `${TOKEN}\nzweite Zeile`]) {
      const result = await run([], { GITHUB_TOKEN: token }, fake);
      expect(result.code).toBe(1);
      expect(result.err.join('\n')).toMatch(/ungültige Zeichen/);
      expect(result.text).not.toContain(TOKEN);
    }
    expect(fake.calls).toHaveLength(0);
  });

  test('errors from GitHub are explained and stop the run', async () => {
    const cases: [number, RegExp][] = [
      [401, /Token/],
      [403, /Contents: Read and write/],
      [404, /nicht gefunden/],
      [409, /noch einmal/],
      [422, /abgelehnt/],
      [500, /Status 500/],
    ];
    for (const [status, message] of cases) {
      const fake = fakeGitHub({}, (call) => (call.method === 'PUT' ? json(status, { message: 'Text von GitHub' }) : undefined));
      const result = await run([], { GITHUB_TOKEN: TOKEN }, fake);
      expect(result.code, String(status)).toBe(1);
      expect(result.err.join('\n'), String(status)).toMatch(message);
      expect(fake.puts(), String(status)).toHaveLength(1); // nach dem ersten Fehler wird nichts mehr versucht
      expect(result.text, String(status)).not.toContain('Text von GitHub'); // Fremder Text kommt nicht in die Ausgabe
    }

    // schon das Nachsehen scheitert: kein Zugriff, nichts wird geschrieben
    const denied = fakeGitHub({}, (call) => (call.method === 'GET' ? json(401, {}) : undefined));
    const refused = await run([], { GITHUB_TOKEN: TOKEN }, denied);
    expect(refused.code).toBe(1);
    expect(refused.err.join('\n')).toMatch(/Token/);
    expect(denied.puts()).toHaveLength(0);

    // kein Netz
    const offline = fakeGitHub({}, () => new TypeError('fetch failed'));
    const gone = await run([], { GITHUB_TOKEN: TOKEN }, offline);
    expect(gone.code).toBe(1);
    expect(gone.err.join('\n')).toMatch(/Verbindung/);
  });

  test('the token never appears in output or errors', async () => {
    expect(redact(`Fehler mit ${TOKEN} im Text`, [TOKEN])).toBe('Fehler mit *** im Text');
    expect(redact(`${TOKEN}${TOKEN}`, [TOKEN])).toBe('******');
    expect(redact('ohne Geheimnis', [])).toBe('ohne Geheimnis');
    expect(redact('ohne Geheimnis', ['', undefined as unknown as string])).toBe('ohne Geheimnis');

    const env = { GITHUB_TOKEN: TOKEN };
    const scenarios = [
      run([], { ...env, REPO: 'johrob-lab/2-gehirn' }), // echter Vault
      run([], { ...env, REPO: TOKEN }), // der Token ist aus Versehen im Repo-Feld gelandet
      run([], env, fakeGitHub({}, () => json(401, { message: 'Bad credentials' }))),
      run([], env, fakeGitHub({}, () => json(403, {}))),
      run([], env, fakeGitHub({}, () => json(500, {}))),
      run([], env, fakeGitHub({}, () => new TypeError(`fetch failed für ${TOKEN}`))), // ein Netzfehler, der den Token nennt
      run(['--forse'], env), // falscher Schalter
      run([], env, fakeGitHub(), `/gibt/es/nicht/${TOKEN}`), // Ordner fehlt, der Name enthält den Token
    ];
    for (const result of await Promise.all(scenarios)) {
      expect(result.code, result.text).toBe(1);
      expect(result.text).not.toContain(TOKEN);
    }

    // Und im Erfolgsfall steht er auch nicht in der Ausgabe.
    const ok = await run([], env);
    expect(ok.code).toBe(0);
    expect(ok.text).not.toContain(TOKEN);

    // Gelangt er doch in eine Meldung, wird er verdeckt. Hier steht er im Pfad des Ordners.
    const hidden = await run([], env, fakeGitHub(), `/gibt/es/nicht/${TOKEN}`);
    expect(hidden.err.join('\n')).toContain('/gibt/es/nicht/***');
  });

  test('unknown switches are refused, --help explains', async () => {
    const fake = fakeGitHub();
    const wrong: [string[], string][] = [
      [['--forse'], '--forse'],
      [['--dry-run', '--x'], '--x'],
      [['datei.md'], 'datei.md'],
      [['-f'], '-f'],
    ];
    for (const [argv, culprit] of wrong) {
      const result = await run(argv, { GITHUB_TOKEN: TOKEN }, fake);
      expect(result.code, argv.join(' ')).toBe(1);
      expect(result.err.join('\n')).toContain(culprit); // sagt, was nicht verstanden wurde
      expect(result.err.join('\n')).toContain('--help'); // und wo es Hilfe gibt
    }
    expect(fake.calls).toHaveLength(0);

    const help = await run(['--help'], {}, fake);
    expect(help.code).toBe(0);
    const text = help.out.join('\n');
    for (const word of ['GITHUB_TOKEN', 'REPO', '--force', '--dry-run']) expect(text).toContain(word);
    expect(fake.calls).toHaveLength(0);
  });
});
