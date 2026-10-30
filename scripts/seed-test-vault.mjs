// @ts-check
// Lädt den erfundenen Mini-Vault aus tests/fixtures/vault/ in ein Test-Repo auf GitHub.
//
// Aufruf:  node scripts/seed-test-vault.mjs [--dry-run] [--force]      (Hilfe mit --help)
//
// Der Token kommt aus der Umgebungsvariable GITHUB_TOKEN, nie aus einem Schalter. Wie man ihn setzt, ohne dass er im Verlauf
// der Eingabeaufforderung landet, steht in der README im Abschnitt "Testkopie". Das Ziel kommt aus REPO (Standard: DEFAULT_REPO).
//
// Diese Regeln lockert das Skript nie:
// - Es schreibt nur in ein Repo, dessen Name auf "-test" endet. Das echte Vault ist damit ausgeschlossen.
// - Es lädt nur Dateien unter tests/fixtures/vault/ hoch. Der Pfad im Repo ist der Pfad unter diesem Ordner (NFC).
// - Pfade mit gesperrten Wortteilen (recovery, passw, token, .key, Groß- und Kleinschreibung egal) oder mit ".." werden
//   abgelehnt, und zwar bevor eine einzige Datei hochgeladen wird.
// - Der Token steht nur im Authorization-Header. Er kommt in keine Ausgabe und in keine Fehlermeldung.
//
// Das Skript nutzt bewusst nicht den GitHubClient der App. Dessen Pfadsperre erlaubt das Schreiben nur in "05 Daily Notes"
// und "07 Anhänge/Notizbuch", der Mini-Vault enthält aber auch "02 Projekte" und "04 Ressourcen/Kalender". Darum hat es einen
// eigenen kleinen Uploader für die Contents-API. Er braucht nur Node 22 (eingebaute Module und fetch), keine Pakete.
//
// Die Entscheidungen stehen in reinen Funktionen (assertTestRepo, planUploads, decideAction ...), die ohne Netz getestet
// werden (tests/unit/seed.test.ts). Das Netz kommt nur in createUploader vor. `main` läuft nur, wenn das Skript direkt
// gestartet wird.

import { readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Das Test-Repo, wenn `REPO` nicht gesetzt ist. */
export const DEFAULT_REPO = 'johrob-lab/2-gehirn-test';

/** Der Ordner mit den erfundenen Testdaten. Alles Hochgeladene kommt von hier. */
export const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures', 'vault');

// Diese Wortteile dürfen in keinem Pfad vorkommen (Zugangsdaten, Schlüssel). Dieselbe Liste wie die Pfadsperre der App in
// src/sync/paths.ts. Das .mjs-Skript kann dieses TypeScript nicht laden, darum steht sie hier noch einmal.
// tests/unit/seed.test.ts prüft, dass beide dasselbe sperren.
const BLOCKED_WORD_PARTS = ['recovery', 'passw', 'token', '.key'];

// Dateien, die Betriebssysteme von selbst anlegen. Sie gehören nicht in den Vault und werden nicht hochgeladen.
const SYSTEM_FILES = new Set(['.DS_Store', 'Thumbs.db']);

// Besitzer/Name, der Name endet auf -test. Erlaubt sind die Zeichen, die GitHub in Namen zulässt.
const TEST_REPO = /^[A-Za-z0-9-]+\/[A-Za-z0-9._-]+-test$/;

// Wie die Pfadsperre der App: Steuerzeichen und einzelne Surrogate gibt es in keinem Vault-Pfad.
const CONTROL_OR_BROKEN = /[\p{Cc}\p{Cs}]/u;

const API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
/** So lange darf eine Anfrage dauern. Danach gilt sie als fehlende Verbindung. */
const REQUEST_TIMEOUT_MS = 30_000;
const MASK = '***';

const USAGE = [
  'Lädt die erfundenen Testdaten aus tests/fixtures/vault/ in ein Test-Repo auf GitHub.',
  '',
  'Aufruf:',
  '  node scripts/seed-test-vault.mjs [--dry-run] [--force]',
  '',
  'Umgebung:',
  '  GITHUB_TOKEN  Token mit "Contents: Read and write", nur für das Test-Repo. Nötig, außer bei --dry-run.',
  `  REPO          Das Test-Repo (Besitzer/Name). Standard: ${DEFAULT_REPO}. Der Name muss auf "-test" enden.`,
  '',
  'Schalter:',
  '  --dry-run     Nur auflisten, was hochgeladen würde. GitHub wird nicht angefragt.',
  '  --force       Vorhandene Dateien überschreiben. Ohne den Schalter werden sie übersprungen.',
  '  --help        Diese Hilfe.',
].join('\n');

/** Ein Fehler, dessen Text für die Person gedacht ist, die das Skript startet. Er nennt nie den Token. */
export class SeedError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'SeedError';
  }
}

// ---------- Entscheidungen ohne Netz ----------

/**
 * Wirft `SeedError`, wenn `repo` kein Test-Repo ist: die Form `besitzer/name`, und der Name endet auf `-test`.
 * @param {unknown} repo
 */
export function assertTestRepo(repo) {
  if (typeof repo !== 'string' || !TEST_REPO.test(repo)) {
    throw new SeedError(
      `Abbruch: REPO ${JSON.stringify(String(repo))} ist kein Test-Repo. Der Name muss die Form besitzer/name-test haben und auf "-test" enden. Das echte Vault wird nie beschrieben.`,
    );
  }
}

/** @param {string} path */
function hasBlockedWordPart(path) {
  const lower = path.normalize('NFC').toLowerCase();
  return BLOCKED_WORD_PARTS.some((part) => lower.includes(part));
}

/**
 * @param {unknown} path
 * @param {string} why
 */
function refusal(path, why) {
  return new SeedError(`Pfad nicht erlaubt (${why}): ${JSON.stringify(path)}`);
}

/**
 * Wirft `SeedError`, wenn der Pfad im Repo nicht hochgeladen werden darf: leer, mit `..`, mit Rückwärtsschrägstrich oder
 * Steuerzeichen, mit leerem Teil oder Teil `.` (auch `/` am Anfang oder Ende) oder mit einem gesperrten Wortteil.
 * Geprüft wird die NFC-Form.
 * @param {unknown} path
 */
export function assertUploadPath(path) {
  if (typeof path !== 'string' || path === '') throw refusal(path, 'leer');
  const nfc = path.normalize('NFC');
  if (nfc.includes('..')) throw refusal(path, 'enthält ..');
  if (nfc.includes('\\') || CONTROL_OR_BROKEN.test(nfc)) throw refusal(path, 'ungültige Zeichen');
  if (nfc.split('/').some((part) => part === '' || part === '.')) throw refusal(path, 'leerer Pfadteil');
  if (hasBlockedWordPart(nfc)) throw refusal(path, 'gesperrter Wortteil');
}

/**
 * Alle Dateien unter `fixturesDir`, bereit zum Hochladen: `path` ist der Pfad im Repo (NFC, mit `/`), `file` die Datei auf
 * der Platte. Sortiert nach `path`. Jeder Name wird geprüft, bevor eine Datei gelesen wird, und ein einziger unzulässiger
 * Name stoppt die ganze Planung. Verknüpfungen und andere Nicht-Dateien werden abgelehnt (sie könnten aus dem Ordner
 * hinausführen), `.DS_Store` und `Thumbs.db` bleiben unbeachtet.
 * @param {string} fixturesDir
 * @returns {{ path: string, file: string }[]}
 */
export function planUploads(fixturesDir) {
  /** @type {{ path: string, file: string }[]} */
  const plan = [];
  const root = resolve(fixturesDir);

  /**
   * @param {string} dir
   * @param {string[]} parents
   */
  const walk = (dir, parents) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      throw new SeedError(`Der Ordner mit den Testdaten fehlt oder lässt sich nicht lesen: ${dir}`);
    }
    for (const entry of entries) {
      if (SYSTEM_FILES.has(entry.name)) continue;
      const parts = [...parents, entry.name.normalize('NFC')];
      const path = parts.join('/');
      assertUploadPath(path);
      const onDisk = join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new SeedError(`Verknüpfungen werden nicht hochgeladen: ${JSON.stringify(path)}`);
      if (entry.isDirectory()) walk(onDisk, parts);
      else if (entry.isFile()) plan.push({ path, file: onDisk });
      else throw new SeedError(`Keine gewöhnliche Datei: ${JSON.stringify(path)}`);
    }
  };
  walk(root, []);

  if (plan.length === 0) throw new SeedError(`Im Ordner ${root} gibt es nichts zum Hochladen.`);
  plan.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  for (let i = 1; i < plan.length; i++) {
    if (plan[i].path === plan[i - 1].path) throw new SeedError(`Zwei Dateien haben denselben Pfad: ${JSON.stringify(plan[i].path)}`);
  }
  return plan;
}

/**
 * Was mit einer Datei geschieht: anlegen, wenn es sie im Repo nicht gibt. Gibt es sie, bleibt sie, außer mit `--force`.
 * @param {string | null} existingSha die sha der Datei im Repo, `null` wenn es sie nicht gibt
 * @param {boolean} force
 * @returns {'create' | 'update' | 'skip'}
 */
export function decideAction(existingSha, force) {
  if (existingSha === null) return 'create';
  return force ? 'update' : 'skip';
}

/** @param {string} path */
export function commitMessage(path) {
  return `Testdaten für das Notizbuch: ${path.normalize('NFC')}`;
}

/**
 * @param {string[]} argv
 * @returns {{ force: boolean, dryRun: boolean, help: boolean }}
 */
export function parseArgs(argv) {
  const options = { force: false, dryRun: false, help: false };
  for (const arg of argv) {
    if (arg === '--force') options.force = true;
    else if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new SeedError(`Unbekannter Schalter: ${arg}. Hilfe gibt es mit --help.`);
  }
  return options;
}

/**
 * Ersetzt jedes Vorkommen der Geheimnisse durch `***`. Leere Geheimnisse bleiben unbeachtet.
 * @param {string} text
 * @param {(string | undefined)[]} secrets
 */
export function redact(text, secrets) {
  let result = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret !== '') result = result.split(secret).join(MASK);
  }
  return result;
}

/**
 * Der Token aus der Umgebung. Ohne Leerzeichen und Zeilenumbrüche drumherum (vom Einfügen), nur Buchstaben, Ziffern und
 * Unterstriche. Die Meldungen nennen den Token nie: Ein Header-Fehler von fetch könnte ihn sonst zeigen.
 * @param {Record<string, string | undefined>} env
 */
function readToken(env) {
  const token = (env.GITHUB_TOKEN ?? '').trim();
  if (token === '') {
    throw new SeedError(
      'GITHUB_TOKEN fehlt. Bitte einen Token mit "Contents: Read and write" nur für das Test-Repo setzen. Mit --dry-run geht es auch ohne.',
    );
  }
  if (!/^[A-Za-z0-9_]+$/.test(token)) {
    throw new SeedError('GITHUB_TOKEN enthält ungültige Zeichen. Ein Token besteht nur aus Buchstaben, Ziffern und Unterstrichen.');
  }
  return token;
}

// ---------- Das Netz ----------

/**
 * Der Text zu einem Fehlerstatus von GitHub. Was GitHub dazu schreibt, kommt nicht in die Ausgabe.
 * @param {number} status
 */
function httpError(status) {
  if (status === 401) return new SeedError('GitHub lehnt den Token ab (Status 401). Bitte den Token prüfen.');
  if (status === 403) {
    return new SeedError(
      'GitHub verweigert den Zugriff (Status 403). Der Token braucht für dieses Repo die Berechtigung "Contents: Read and write". Möglich ist auch, dass GitHub gerade keine weiteren Anfragen annimmt.',
    );
  }
  if (status === 404) return new SeedError('Das Repo wurde nicht gefunden, oder der Token darf es nicht sehen (Status 404).');
  if (status === 409 || status === 422) {
    return new SeedError(`GitHub hat die Datei abgelehnt (Status ${status}). Bitte noch einmal starten, dann wird der aktuelle Stand geprüft.`);
  }
  return new SeedError(`GitHub antwortete mit Status ${status}.`);
}

/**
 * Der kleine Uploader für die Contents-API. Er nimmt den Token nur für den Authorization-Header und gibt ihn nirgends
 * weiter. Fehler von `fetch` werden zu einer Meldung ohne den ursprünglichen Text. Ein Repo, das kein Test-Repo ist, lehnt
 * er selbst ab (wie `assertTestRepo`), und keine Anfrage folgt einer Weiterleitung: Sie könnte woandershin führen als in
 * das Test-Repo.
 * @param {{ token: string, repo: string, fetchFn: typeof fetch }} o
 */
export function createUploader({ token, repo, fetchFn }) {
  assertTestRepo(repo);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': API_VERSION,
    'User-Agent': 'notizbuch-seed',
  };

  /** Jeder Pfadteil einzeln kodiert, die Schrägstriche bleiben. */
  const address = (/** @type {string} */ path) => `${API}/repos/${repo}/contents/${path.normalize('NFC').split('/').map(encodeURIComponent).join('/')}`;

  /**
   * @param {'GET' | 'PUT'} method
   * @param {string} url
   * @param {unknown} [body]
   * @returns {Promise<{ status: number, text: string }>}
   */
  async function send(method, url, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetchFn(url, {
        method,
        headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'error',
        signal: controller.signal,
      });
      // Die Antwort ganz lesen, damit die Verbindung frei wird.
      return { status: response.status, text: await response.text() };
    } catch {
      // Der ursprüngliche Fehler bleibt außen vor: Er könnte Teile der Anfrage enthalten.
      throw new SeedError('Keine Verbindung zu GitHub.');
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    /**
     * Die sha der Datei im Repo, oder `null`, wenn es sie nicht gibt (auch in einem leeren Repo).
     * @param {string} path
     * @returns {Promise<string | null>}
     */
    async find(path) {
      const { status, text } = await send('GET', address(path));
      if (status === 404) return null;
      if (status !== 200) throw httpError(status);
      /** @type {unknown} */
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        // bleibt null: unten gemeldet
      }
      // Ein Ordner kommt als Liste zurück und hat keine sha: Auch das ist keine Antwort, mit der sich etwas anfangen lässt.
      const sha = typeof data === 'object' && data !== null ? /** @type {{ sha?: unknown }} */ (data).sha : undefined;
      if (typeof sha !== 'string') throw new SeedError('Unerwartete Antwort von GitHub.');
      return sha;
    },

    /**
     * Legt die Datei an (`sha` ist `null`) oder überschreibt die Fassung mit dieser `sha`. Ohne Angabe eines Zweigs: Es gilt der
     * Standardzweig des Repos, auch in einem leeren Repo, in dem es noch keinen Zweig gibt.
     * @param {string} path
     * @param {Uint8Array} bytes
     * @param {string | null} sha
     * @param {string} message
     */
    async put(path, bytes, sha, message) {
      /** @type {{ message: string, content: string, sha?: string }} */
      const body = { message, content: Buffer.from(bytes).toString('base64') };
      if (sha !== null) body.sha = sha;
      const { status } = await send('PUT', address(path), body);
      if (status !== 200 && status !== 201) throw httpError(status);
    },
  };
}

/**
 * Was ein Lauf bisher geschafft hat, als Text.
 * @param {{ created: number, updated: number, skipped: number }} counts
 */
function summary(counts) {
  return `${counts.created} hochgeladen, ${counts.updated} überschrieben, ${counts.skipped} übersprungen`;
}

/**
 * Geht die Planung der Reihe nach durch. Ein Fehler beendet den Lauf sofort. Die Meldung nennt dann die Datei, sagt, wie weit
 * der Lauf kam, und dass er sich wiederholen lässt: Was schon oben ist, wird beim nächsten Mal übersprungen.
 * @param {{ plan: { path: string, file: string }[], uploader: ReturnType<typeof createUploader>, force: boolean, log: (line: string) => void }} o
 */
export async function seed({ plan, uploader, force, log }) {
  const counts = { created: 0, updated: 0, skipped: 0 };
  for (const { path, file } of plan) {
    try {
      const existing = await uploader.find(path);
      const action = decideAction(existing, force);
      if (action === 'skip') {
        counts.skipped += 1;
        log(`übersprungen (gibt es schon): ${path}`);
        continue;
      }
      await uploader.put(path, readFileSync(file), existing, commitMessage(path));
      if (action === 'update') {
        counts.updated += 1;
        log(`überschrieben: ${path}`);
      } else {
        counts.created += 1;
        log(`hochgeladen: ${path}`);
      }
    } catch (error) {
      const reason = error instanceof SeedError ? error.message : `Unerwarteter Fehler: ${error instanceof Error ? error.message : String(error)}`;
      throw new SeedError(
        [`Abbruch bei ${path}: ${reason}`, `Bis dahin: ${summary(counts)}.`, 'Schon Hochgeladenes bleibt, ein neuer Lauf überspringt es und macht weiter.'].join('\n'),
      );
    }
  }
  return counts;
}

// ---------- Der Lauf ----------

/**
 * @typedef {Object} MainOptions
 * @property {string[]} [argv] die Schalter, ohne `node` und Skriptname
 * @property {Record<string, string | undefined>} [env] die Umgebung mit GITHUB_TOKEN und REPO
 * @property {typeof fetch} [fetchFn] Standard ist das fetch von Node
 * @property {(line: string) => void} [log] Standard ist die Standardausgabe
 * @property {(line: string) => void} [errorLog] Standard ist die Fehlerausgabe
 * @property {string} [fixturesDir] Standard ist tests/fixtures/vault
 */

/**
 * Der ganze Lauf. Gibt den Exit-Code zurück: 0 wenn alles gut ging, 1 bei jedem Fehler. Jede Zeile der Ausgabe geht durch
 * `redact`, der Token kann also auch dann nicht erscheinen, wenn er irgendwo in einen Text geraten ist.
 * @param {MainOptions} [options]
 * @returns {Promise<number>}
 */
export async function main(options = {}) {
  const {
    argv = process.argv.slice(2),
    env = process.env,
    fetchFn = (/** @type {Parameters<typeof fetch>[0]} */ input, /** @type {Parameters<typeof fetch>[1]} */ init) => globalThis.fetch(input, init),
    log = (/** @type {string} */ line) => console.log(line),
    errorLog = (/** @type {string} */ line) => console.error(line),
    fixturesDir = FIXTURES_DIR,
  } = options;
  const secrets = [env.GITHUB_TOKEN, env.GITHUB_TOKEN?.trim()];
  const say = (/** @type {string} */ line) => log(redact(line, secrets));
  const complain = (/** @type {string} */ line) => errorLog(redact(line, secrets));

  try {
    const args = parseArgs(argv);
    if (args.help) {
      say(USAGE);
      return 0;
    }
    const repo = (env.REPO ?? '').trim() || DEFAULT_REPO;
    assertTestRepo(repo);
    const plan = planUploads(fixturesDir);
    say(`Test-Repo: ${repo}`);

    if (args.dryRun) {
      say(`Probelauf, es wird nichts hochgeladen. Diese Dateien würden hochgeladen (${plan.length}):`);
      for (const { path } of plan) say(`  ${path}`);
      say(args.force ? 'Vorhandene Dateien würden überschrieben.' : 'Vorhandene Dateien würden übersprungen. Mit --force würden sie überschrieben.');
      return 0;
    }

    const uploader = createUploader({ token: readToken(env), repo, fetchFn });
    if (args.force) say('Mit --force: Vorhandene Dateien werden überschrieben.');
    const counts = await seed({ plan, uploader, force: args.force, log: say });
    say(`Fertig: ${summary(counts)}.`);
    return 0;
  } catch (error) {
    complain(error instanceof SeedError ? error.message : `Unerwarteter Fehler: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

/** Läuft das Skript direkt (`node scripts/seed-test-vault.mjs`) und wurde es nicht nur importiert? */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isMain()) process.exitCode = await main();
