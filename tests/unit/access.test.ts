import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { AccessChangedError, accessProblem, cleanToken, expiryProblem, PendingChangesError, REPOS, saveAccess, tokenProblem, waitingText } from '../../src/lib/access';
import { loadSettings, saveSettings, type Settings } from '../../src/lib/settings';
import { AuthError, errorFor, OfflineError, RateLimitError } from '../../src/sync/github';
import { openStore, type Store } from '../../src/sync/store';

// Alles hier ist erfunden, auch die Token. Es geht keine Anfrage ins Netz: Der Client ist ein Fake.

const TOKEN = 'github_pat_TEST_0123456789';

let store: Store;

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  store = await openStore();
});
afterEach(() => store.close());

// ---------- Der Token ----------

test('the two repositories to choose from', () => {
  expect(REPOS).toEqual(['johrob-lab/2-gehirn', 'johrob-lab/2-gehirn-test']);
});

test('a pasted token loses the spaces and line breaks around it', () => {
  expect(cleanToken(`  ${TOKEN}\n`)).toBe(TOKEN);
  expect(cleanToken(`\t${TOKEN}\u00a0`)).toBe(TOKEN); // auch das geschützte Leerzeichen, das beim Kopieren mitkommt
  expect(tokenProblem(`  ${TOKEN}\n`)).toBeNull();
});

test('a token has visible ASCII characters only', () => {
  expect(tokenProblem(TOKEN)).toBeNull();
  expect(tokenProblem('ghp_AbC123xyz')).toBeNull();
  expect(tokenProblem('!"#$%&\'()*+,-./:;<=>?@[\\]^_`{|}~09azAZ')).toBeNull(); // die Grenzen des erlaubten Bereichs
  const bad = 'Der Token enthält ungültige Zeichen.';
  expect(tokenProblem('github pat TEST')).toBe(bad); // Leerzeichen mittendrin
  expect(tokenProblem('github_pat\nTEST')).toBe(bad); // Zeilenumbruch mittendrin
  expect(tokenProblem('github_pat\tTEST')).toBe(bad);
  expect(tokenProblem('github_pat_TÉST')).toBe(bad); // Umlaut und Akzent
  expect(tokenProblem('github_pat_TEST€')).toBe(bad);
  expect(tokenProblem('github_pat_TEST\u200b')).toBe(bad); // unsichtbares Zeichen von der Zwischenablage
  expect(tokenProblem('github_pat_\u0000TEST')).toBe(bad);
  expect(tokenProblem('github_pat_\u007fTEST')).toBe(bad);
});

test('an empty token is a problem of its own', () => {
  expect(tokenProblem('')).toBe('Bitte den Token eingeben.');
  expect(tokenProblem('   \n')).toBe('Bitte den Token eingeben.');
});

// ---------- Das Ablaufdatum ----------

test('the expiry has to be a real day after today', () => {
  const today = '2026-10-29';
  expect(expiryProblem('2026-10-30', today)).toBeNull();
  expect(expiryProblem('2027-10-29', today)).toBeNull();
  expect(expiryProblem('2028-02-29', today)).toBeNull();
  const past = 'Das Ablaufdatum muss in der Zukunft liegen.';
  expect(expiryProblem('2026-10-29', today)).toBe(past); // heute ist nicht in der Zukunft
  expect(expiryProblem('2026-10-28', today)).toBe(past);
  expect(expiryProblem('2020-01-01', today)).toBe(past);
  const missing = 'Bitte das Ablaufdatum des Tokens eintragen.';
  expect(expiryProblem('', today)).toBe(missing);
  expect(expiryProblem('2027-02-30', today)).toBe(missing); // diesen Tag gibt es nicht
  expect(expiryProblem('morgen', today)).toBe(missing);
  expect(expiryProblem('275760-09-13', today)).toBe(missing); // so ein Jahr kann ein Datumsfeld liefern
});

// ---------- Der Zugang ----------

const clientThat = (check: () => Promise<{ canWrite: boolean }>) => ({ checkAccess: check });

test('a token that may write has no problem', async () => {
  expect(await accessProblem(clientThat(async () => ({ canWrite: true })))).toBeNull();
});

test('a token that may only read is told what to choose', async () => {
  expect(await accessProblem(clientThat(async () => ({ canWrite: false })))).toBe(
    'Der Token darf nicht schreiben. Bitte beim Token „Contents: Read and write“ wählen.',
  );
});

test('a refused token is a problem with the token', async () => {
  const denied = 'Der Zugang klappt nicht. Bitte Token prüfen.';
  expect(await accessProblem(clientThat(() => Promise.reject(new AuthError())))).toBe(denied);
  expect(await accessProblem(clientThat(() => Promise.reject(errorFor(401, new Headers(), ''))))).toBe(denied);
  expect(await accessProblem(clientThat(() => Promise.reject(errorFor(403, new Headers(), ''))))).toBe(denied);
  // Ein Repo, das der Token nicht sehen darf, meldet GitHub als nicht gefunden.
  expect(await accessProblem(clientThat(() => Promise.reject(errorFor(404, new Headers(), ''))))).toBe(denied);
});

test('no connection is told apart from a wrong token', async () => {
  expect(await accessProblem(clientThat(() => Promise.reject(new OfflineError())))).toBe('Keine Verbindung. Bitte später noch einmal.');
});

test('a rate limit asks to try later', async () => {
  expect(await accessProblem(clientThat(() => Promise.reject(new RateLimitError())))).toBe(
    'GitHub nimmt gerade keine weiteren Anfragen an. Bitte später noch einmal.',
  );
});

test('anything else is thrown, never turned into text that could contain the token', async () => {
  const unexpected = new Error(`Bearer ${TOKEN} wurde abgelehnt`);
  await expect(accessProblem(clientThat(() => Promise.reject(unexpected)))).rejects.toBe(unexpected);
  const server = errorFor(500, new Headers(), '');
  await expect(accessProblem(clientThat(() => Promise.reject(server)))).rejects.toBe(server);
});

test('no problem text contains the token', async () => {
  const errors = [new AuthError(), new OfflineError(), new RateLimitError(), errorFor(404, new Headers(), '')];
  for (const error of errors) {
    const text = await accessProblem(clientThat(() => Promise.reject(Object.assign(error, { message: `${error.message} ${TOKEN}` }))));
    expect(text).not.toContain(TOKEN);
  }
  expect(await accessProblem(clientThat(async () => ({ canWrite: false })))).not.toContain(TOKEN);
});

// ---------- GitHub antwortet nicht ----------

test('a check that GitHub never answers ends as no connection after 30 seconds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    const check = accessProblem(clientThat(() => new Promise<never>(() => undefined)));
    let settled = false;
    void check.then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(29_999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(await check).toBe('Keine Verbindung. Bitte später noch einmal.');
  } finally {
    vi.useRealTimers();
  }
});

test('an answer in time leaves no timer behind, and a late answer changes nothing', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  try {
    expect(await accessProblem(clientThat(async () => ({ canWrite: true })))).toBeNull();
    expect(vi.getTimerCount()).toBe(0);

    let answer!: (value: { canWrite: boolean }) => void;
    const slow = accessProblem(clientThat(() => new Promise<{ canWrite: boolean }>((resolve) => (answer = resolve))));
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await slow).toBe('Keine Verbindung. Bitte später noch einmal.');
    answer({ canWrite: true }); // zu spät: Das Ergebnis steht schon fest, und nichts bleibt hängen
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

// ---------- Warten Änderungen? ----------

test('the refusal counts the changes that still wait', () => {
  expect(waitingText(1)).toBe('Erst sichern: Es wartet noch 1 Änderung.');
  expect(waitingText(2)).toBe('Erst sichern: Es warten noch 2 Änderungen.');
  expect(waitingText(17)).toBe('Erst sichern: Es warten noch 17 Änderungen.');
});

// ---------- Speichern ----------

const input = { token: TOKEN, repo: 'johrob-lab/2-gehirn-test', expiry: '2027-10-29' };

const entry = (path: string) => ({ path, text: 'x', kind: 'md' as const, baseSha: null, baseText: null, queuedAt: 1 });
const file = (path: string) => ({ path, text: 'x', sha: 's1', base: 'x', syncedAt: 1 });

/** Ein Gerät, das schon eingerichtet ist und Daten aus dem alten Repo hat. */
async function deviceWithData(o: { waiting?: string[] } = {}): Promise<Settings> {
  const old: Settings = {
    token: 'github_pat_TEST_ALT',
    repo: 'johrob-lab/2-gehirn',
    device: 'Firmen-PC',
    smoothing: 'stark',
    prediction: false,
    quickSwitchPos: [0.4, 0.6],
    tokenExpiry: '2026-12-31',
  };
  await saveSettings(store, old);
  await store.put('files', file('05 Daily Notes/2026-10-29.md'));
  await store.put('files', file('05 Daily Notes/2026-10-28.md'));
  await store.put('meta', 'abc123', 'lastHead');
  for (const path of o.waiting ?? []) await store.put('outbox', entry(path));
  return old;
}

test('the first setup saves the settings with the defaults', async () => {
  const { settings, switched } = await saveAccess(store, input, 'iPad', null);
  expect(settings).toEqual({
    token: TOKEN,
    repo: 'johrob-lab/2-gehirn-test',
    device: 'iPad',
    smoothing: 'mittel',
    prediction: true,
    tokenExpiry: '2027-10-29',
  });
  expect(switched).toBe(false); // es gab nichts, was zu einem anderen Repo gehörte
  expect(await loadSettings(store)).toEqual(settings);
});

test('the first setup keeps the device that was chosen', async () => {
  const { settings } = await saveAccess(store, input, 'Firmen-PC', null);
  expect(settings.device).toBe('Firmen-PC');
  expect((await loadSettings(store))?.device).toBe('Firmen-PC');
});

test('the token is saved in the settings area of IndexedDB and nowhere else', async () => {
  await saveAccess(store, input, 'iPad', null);
  expect(await store.getAll('files')).toEqual([]);
  expect(await store.getAll('outbox')).toEqual([]);
  expect(await store.getAll('meta')).toEqual([]);
  expect(JSON.stringify({ ...localStorage })).not.toContain(TOKEN);
  expect(JSON.stringify({ ...sessionStorage })).not.toContain(TOKEN);
});

test('a new token for the same repository keeps the local data and the other settings', async () => {
  const old = await deviceWithData({ waiting: ['05 Daily Notes/2026-10-30.md'] });
  const { settings, switched } = await saveAccess(store, { token: TOKEN, repo: old.repo, expiry: '2027-11-30' }, 'iPad', old.repo);
  // Nur Token und Ablaufdatum ändern sich, auch wenn noch Änderungen warten. Das Gerät der Einrichtung zählt nicht mehr.
  expect(settings).toEqual({ ...old, token: TOKEN, tokenExpiry: '2027-11-30' });
  expect(switched).toBe(false);
  expect(await loadSettings(store)).toEqual(settings);
  expect((await store.getAll('files')).map((f) => f.path).sort()).toEqual(['05 Daily Notes/2026-10-28.md', '05 Daily Notes/2026-10-29.md']);
  expect((await store.getAll('outbox')).map((e) => e.path)).toEqual(['05 Daily Notes/2026-10-30.md']);
  expect(await store.get('meta', 'lastHead')).toBe('abc123');
});

test('another repository clears the files, the queue and the notes of the old one, and says so', async () => {
  const old = await deviceWithData();
  const { settings, switched } = await saveAccess(store, input, 'iPad', old.repo);
  expect(settings).toEqual({ ...old, token: TOKEN, repo: 'johrob-lab/2-gehirn-test', tokenExpiry: '2027-10-29' });
  expect(switched).toBe(true);
  expect(await loadSettings(store)).toEqual(settings);
  expect(await store.getAll('files')).toEqual([]);
  expect(await store.getAll('outbox')).toEqual([]);
  expect(await store.getAll('meta')).toEqual([]);
});

test('another repository is refused while changes wait, and nothing changes', async () => {
  const old = await deviceWithData({ waiting: ['05 Daily Notes/2026-10-30.md', '05 Daily Notes/2026-10-31.md'] });
  const refused = await saveAccess(store, input, 'iPad', old.repo).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(PendingChangesError);
  expect((refused as PendingChangesError).count).toBe(2);
  expect((refused as PendingChangesError).message).toBe(waitingText(2));
  expect(await loadSettings(store)).toEqual(old);
  expect(await store.getAll('files')).toHaveLength(2);
  expect(await store.getAll('outbox')).toHaveLength(2);
  expect(await store.get('meta', 'lastHead')).toBe('abc123');
});

test('a change that is queued before the switch is seen by the switch', async () => {
  const old = await deviceWithData();
  // Der Eintrag wird zuerst abgeschickt, das Umschalten gleich danach, ohne dazwischen zu warten.
  const queuing = store.put('outbox', entry('05 Daily Notes/2026-10-30.md'));
  const switching = saveAccess(store, input, 'iPad', old.repo);
  await queuing;
  await expect(switching).rejects.toBeInstanceOf(PendingChangesError);
  expect(await loadSettings(store)).toEqual(old);
  expect(await store.getAll('files')).toHaveLength(2);
});

test('the same repository is no switch', async () => {
  const old = await deviceWithData({ waiting: ['05 Daily Notes/2026-10-30.md'] });
  // Dasselbe Repo: nichts wird gelöscht, auch nicht bei wartenden Änderungen.
  await saveAccess(store, { token: TOKEN, repo: old.repo, expiry: '2027-10-29' }, 'iPad', old.repo);
  expect(await store.getAll('outbox')).toHaveLength(1);
  expect(await store.getAll('files')).toHaveLength(2);
});

test('a refused switch does not leave the new token behind', async () => {
  const old = await deviceWithData({ waiting: ['05 Daily Notes/2026-10-30.md'] });
  await expect(saveAccess(store, input, 'iPad', old.repo)).rejects.toBeInstanceOf(PendingChangesError);
  expect(JSON.stringify(await loadSettings(store))).not.toContain(TOKEN);
});

// ---------- Der Zugang hat sich unterdessen geändert ----------

test('the setup is refused when another window has set the device up meanwhile, and nothing is touched', async () => {
  const old = await deviceWithData({ waiting: ['05 Daily Notes/2026-10-30.md'] });
  const refused = await saveAccess(store, input, 'iPad', null).catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(AccessChangedError);
  expect(await loadSettings(store)).toEqual(old); // die Einstellungen des anderen Fensters bleiben
  expect(await store.getAll('files')).toHaveLength(2); // nichts wurde geleert
  expect(await store.getAll('outbox')).toHaveLength(1);
  expect(await store.get('meta', 'lastHead')).toBe('abc123');
  expect(JSON.stringify(await loadSettings(store))).not.toContain(TOKEN);
});

test('a change is refused when the stored repository is not the one the caller works with', async () => {
  // Ein anderes Fenster hat das Repo schon gewechselt; dieses Fenster glaubt noch, das Test-Repo sei in Gebrauch.
  const old = await deviceWithData();
  const refused = await saveAccess(store, { token: TOKEN, repo: 'johrob-lab/2-gehirn-test', expiry: '2027-10-29' }, 'iPad', 'johrob-lab/2-gehirn-test').catch(
    (error: unknown) => error,
  );
  expect(refused).toBeInstanceOf(AccessChangedError);
  expect(await loadSettings(store)).toEqual(old);
  expect(await store.getAll('files')).toHaveLength(2); // der Wechsel zurück hätte die Dateien des anderen Repos geleert
  expect(await store.get('meta', 'lastHead')).toBe('abc123');
});

test('a change on a device without settings is refused', async () => {
  const refused = await saveAccess(store, input, 'iPad', 'johrob-lab/2-gehirn').catch((error: unknown) => error);
  expect(refused).toBeInstanceOf(AccessChangedError);
  expect(await loadSettings(store)).toBeNull();
});

test('the refusal has a German text and no token in it', async () => {
  await deviceWithData();
  const refused = (await saveAccess(store, input, 'iPad', null).catch((error: unknown) => error)) as Error;
  expect(refused.name).toBe('AccessChangedError');
  expect(refused.message).toBe('Der Zugang wurde inzwischen in einem anderen Fenster geändert.');
  expect(refused.message).not.toContain(TOKEN);
});
