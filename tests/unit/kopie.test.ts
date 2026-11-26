import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Kopie, kopieImSpeicher, setzeKopieImSpeicher, type KopieStand } from '../../src/gehirn/kopie';
import { base64ToUtf8 } from '../../src/sync/base64';
import { CALL_TIMEOUT_MS, OfflineError, type CopyClient, type CopyEntry } from '../../src/sync/github';

// Alles hier ist erfunden, auch die Repos. Die Datenbank liegt im Speicher (fake-indexeddb), pro Test eine frische.

const REPO = 'beispiel/vault';

let kopie: Kopie;

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  kopie = await Kopie.open(REPO);
});
afterEach(() => {
  vi.useRealTimers();
  kopie.close();
});

const eintrag = (path: string, sha: string): CopyEntry => ({ path, sha, size: 10 });

/**
 * Ein falscher Client: Baum und Kopf sind einstellbar, die Aufrufe werden gezählt. Ein Blob mit einer sha aus `kaputt` ist kein UTF-8:
 * `copyText` wirft dann, was das Dekodieren des echten Clients wirft.
 */
function fakeClient(opts: { head?: string; entries?: CopyEntry[]; truncated?: boolean } = {}) {
  const state = {
    head: opts.head ?? 'h1',
    entries: opts.entries ?? [],
    truncated: opts.truncated ?? false,
    headCalls: 0,
    treeCalls: 0,
    textCalls: [] as string[],
    running: 0,
    maxRunning: 0,
    failAt: 0, // beim wievielten copyText ein OfflineError kommt (0 = nie)
    delay: 0,
    kaputt: [] as string[],
  };
  const client: CopyClient = {
    async headSha() {
      state.headCalls++;
      return state.head;
    },
    async vaultTree() {
      state.treeCalls++;
      return { entries: state.entries, truncated: state.truncated };
    },
    async copyText(entry) {
      const nummer = state.textCalls.push(entry.path);
      state.running++;
      state.maxRunning = Math.max(state.maxRunning, state.running);
      try {
        await new Promise((r) => setTimeout(r, state.delay));
        if (state.failAt && nummer >= state.failAt) throw new OfflineError('kein Netz');
        if (state.kaputt.includes(entry.sha)) return base64ToUtf8('/w=='); // das Byte 0xFF, wie aus Excel unter Windows
        return `Text von ${entry.path} (${entry.sha})`;
      } finally {
        state.running--;
      }
    },
  };
  return { client, state };
}

const drei = () => [eintrag('a.md', 's1'), eintrag('b.md', 's2'), eintrag('c.md', 's3')];

async function pathsInDb(): Promise<string[]> {
  const db = await openDB('notizbuch-gehirn', 1);
  const keys = (await db.getAllKeys('dateien')) as string[];
  db.close();
  return keys.sort();
}

test('erstes Laden holt jede Datei einmal', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  const stande: KopieStand[] = [];
  const ergebnis = await kopie.auffrischen(client, (s) => stande.push(s));
  expect(state.textCalls.sort()).toEqual(['a.md', 'b.md', 'c.md']);
  expect(kopie.dateien().map((d) => d.path)).toEqual(['a.md', 'b.md', 'c.md']);
  expect(kopie.stand()).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
  expect(ergebnis).toEqual(kopie.stand());
  expect(stande.some((s) => s.geladen < s.gesamt)).toBe(true);
  expect(stande.at(-1)).toMatchObject({ geladen: 3, gesamt: 3 });
  expect(kopie.text('b.md')).toBe('Text von b.md (s2)');
  expect(kopie.text('gibt es nicht.md')).toBeNull();
});

test('gleicher Kopf, keine weitere Anfrage', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  await kopie.auffrischen(client);
  await kopie.auffrischen(client);
  expect(state.headCalls).toBe(2);
  expect(state.treeCalls).toBe(1);
  expect(state.textCalls).toHaveLength(3);
});

test('nur Geänderte und Neue', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  await kopie.auffrischen(client);
  state.textCalls.length = 0;
  state.head = 'h2';
  state.entries = [eintrag('a.md', 's1'), eintrag('b.md', 'neu'), eintrag('d.md', 's4')]; // c weg
  await kopie.auffrischen(client);
  expect(state.textCalls.sort()).toEqual(['b.md', 'd.md']);
  expect(kopie.dateien().map((d) => d.path)).toEqual(['a.md', 'b.md', 'd.md']);
  expect(kopie.text('c.md')).toBeNull();
  expect(await pathsInDb()).toEqual(['a.md', 'b.md', 'd.md']);
  expect(kopie.stand()).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
});

test('übersteht einen Neustart', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  await kopie.auffrischen(client);
  kopie.close();
  kopie = await Kopie.open(REPO);
  expect(kopie.dateien().map((d) => d.path)).toEqual(['a.md', 'b.md', 'c.md']);
  expect(kopie.stand()).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
  expect(state.headCalls).toBe(1);
});

test('ohne Netz mitten im Laden', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  state.failAt = 2;
  const stand = await kopie.auffrischen(client);
  expect(stand.ohneNetz).toBe(true);
  expect(stand.vollstaendig).toBe(false);
  expect(stand.geladen).toBe(1);
  expect(stand.gesamt).toBe(3);
  expect(kopie.dateien()).toHaveLength(1);
  // Neustart ohne Netz: die Kopie ist nicht vollständig, der Kopf wurde nicht gesetzt.
  kopie.close();
  kopie = await Kopie.open(REPO);
  expect(kopie.stand()).toMatchObject({ geladen: 1, gesamt: 3, vollstaendig: false });
  // Später mit Netz: nur die fehlenden.
  state.failAt = 0;
  state.textCalls.length = 0;
  const danach = await kopie.auffrischen(client);
  expect(state.textCalls).toHaveLength(2);
  expect(danach).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
});

test('kein Netz schon beim Kopf', async () => {
  const { client } = fakeClient({ entries: drei() });
  client.headSha = async () => {
    throw new OfflineError('kein Netz');
  };
  const stand = await kopie.auffrischen(client);
  expect(stand).toEqual({ geladen: 0, gesamt: 0, vollstaendig: false, ohneNetz: true });
});

test('andere Fehler lassen die Kopie, wie sie ist, und werfen nicht', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  await kopie.auffrischen(client);
  state.head = 'h2';
  state.entries = [eintrag('a.md', 'neu')];
  client.vaultTree = async () => {
    throw new Error('kaputt');
  };
  const stand = await kopie.auffrischen(client);
  expect(stand.ohneNetz).toBe(false);
  expect(stand.vollstaendig).toBe(false);
  expect(kopie.dateien()).toHaveLength(3);
});

test('höchstens 4 zugleich', async () => {
  const entries = Array.from({ length: 10 }, (_, i) => eintrag(`n${i}.md`, `s${i}`));
  const { client, state } = fakeClient({ entries });
  state.delay = 5;
  await kopie.auffrischen(client);
  expect(state.textCalls).toHaveLength(10);
  expect(state.maxRunning).toBeLessThanOrEqual(4);
  expect(state.maxRunning).toBeGreaterThan(1);
});

test('zwei Aufrufe, ein Lauf', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  const eins = kopie.auffrischen(client);
  const zwei = kopie.auffrischen(client);
  expect(zwei).toBe(eins);
  await Promise.all([eins, zwei]);
  expect(state.headCalls).toBe(1);
  expect(state.textCalls).toHaveLength(3);
});

test('nur erlaubte Pfade landen in der Kopie', async () => {
  const { client, state } = fakeClient({
    entries: [eintrag('01 Inbox/Passwort.md', 'x'), eintrag('.obsidian/a.md', 'y'), eintrag('CLAUDE.md', 'z'), eintrag('ok.md', 's')],
  });
  const stand = await kopie.auffrischen(client);
  expect(state.textCalls).toEqual(['ok.md']);
  expect(kopie.dateien().map((d) => d.path)).toEqual(['ok.md']);
  expect(await pathsInDb()).toEqual(['ok.md']);
  expect(stand).toEqual({ geladen: 1, gesamt: 1, vollstaendig: true, ohneNetz: false });
});

test('ein gekürzter Baum löscht nichts und setzt den Kopf nicht', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  await kopie.auffrischen(client);
  state.head = 'h2';
  state.truncated = true;
  state.entries = [eintrag('a.md', 's1')];
  const stand = await kopie.auffrischen(client);
  expect(kopie.dateien()).toHaveLength(3);
  expect(stand.vollstaendig).toBe(false);
});

test('die Kopie dieser Sitzung', () => {
  expect(kopieImSpeicher()).toBeNull();
  setzeKopieImSpeicher(kopie);
  expect(kopieImSpeicher()).toBe(kopie);
  setzeKopieImSpeicher(null);
  expect(kopieImSpeicher()).toBeNull();
});

/** Öffnet die Kopie und gibt die Verbindung dazu, damit ein Test sie von außen schließen kann (wie Safari). */
async function kopieMitVerbindung(): Promise<{ k: Kopie; verbindung: () => IDBDatabase }> {
  let db: IDBDatabase | undefined;
  const echt = indexedDB.open.bind(indexedDB);
  const spy = vi.spyOn(indexedDB, 'open').mockImplementation((...args: Parameters<IDBFactory['open']>) => {
    const req = echt(...args);
    req.addEventListener('success', () => (db = req.result));
    return req;
  });
  const k = await Kopie.open(REPO, 'notizbuch-gehirn-probe');
  spy.mockRestore();
  return { k, verbindung: () => db! };
}

test('beendet Safari die Verbindung, öffnet die Kopie neu und kommt ans Ziel', async () => {
  const { k, verbindung } = await kopieMitVerbindung();
  verbindung().close();
  const { client } = fakeClient({ entries: drei() });
  const stand = await k.auffrischen(client);
  expect(stand).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
  k.close();
});

test('nach close() wird nicht neu geöffnet', async () => {
  const { k } = await kopieMitVerbindung();
  const { client } = fakeClient({ entries: drei() });
  const lauf = k.auffrischen(client);
  k.close();
  const stand = await lauf;
  expect(stand.vollstaendig).toBe(false);
  expect(stand.ohneNetz).toBe(false);
  const db = await openDB('notizbuch-gehirn-probe', 1);
  expect(await db.get('meta', 'head')).toBeUndefined();
  db.close();
});

test('eine Anfrage ohne Antwort endet nach der Zeitgrenze als ohne Netz, das nächste Auffrischen läuft neu', async () => {
  const { client } = fakeClient({ entries: drei() });
  // Nur die Uhr der Zeitgrenze ist falsch: Die Datenbank im Speicher arbeitet mit setImmediate weiter.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  // Nacheinander hängt der Kopf, der Baum und das Holen der Blobs: eine Verbindung, die nie antwortet (das iPad kam aus dem Hintergrund).
  for (const haengt of ['headSha', 'vaultTree', 'copyText'] as const) {
    let gefragt!: () => void;
    const angefragt = new Promise<void>((resolve) => (gefragt = resolve));
    const haengend: CopyClient = { ...client };
    haengend[haengt] = () => {
      gefragt();
      return new Promise<never>(() => undefined);
    };
    const lauf = kopie.auffrischen(haengend);
    let fertig = false;
    void lauf.then(() => (fertig = true));
    await angefragt;
    await vi.advanceTimersByTimeAsync(CALL_TIMEOUT_MS - 1);
    expect(fertig).toBe(false);
    expect(kopie.auffrischen(client)).toBe(lauf); // solange er läuft, bekommt jeder Aufruf denselben Lauf
    await vi.advanceTimersByTimeAsync(1);
    expect(await lauf).toMatchObject({ vollstaendig: false, ohneNetz: true });
  }
  // Mit Antwort beginnt ein neuer Lauf und kommt ans Ziel: Der hängende von vorhin blockiert nichts mehr.
  vi.useRealTimers();
  expect(await kopie.auffrischen(client)).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
});

test('ein anderes Repo leert die Kopie, bevor etwas gelesen oder gesucht wird', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  await kopie.auffrischen(client);
  expect(kopie.stand()).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
  kopie.close();
  kopie = await Kopie.open('beispiel/anderes-vault');
  expect(kopie.dateien()).toEqual([]);
  expect(kopie.text('a.md')).toBeNull();
  expect(kopie.stand()).toEqual({ geladen: 0, gesamt: 0, vollstaendig: false, ohneNetz: false });
  expect(await pathsInDb()).toEqual([]);
  expect(state.headCalls).toBe(1); // geleert wird ohne Anfrage
  // Das neue Repo lädt wie beim ersten Mal: jede Datei, auch bei gleicher sha.
  state.textCalls.length = 0;
  expect(await kopie.auffrischen(client)).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });
  expect(state.textCalls.sort()).toEqual(['a.md', 'b.md', 'c.md']);
  // Dasselbe Repo noch einmal: Nichts wird geleert.
  kopie.close();
  kopie = await Kopie.open('beispiel/anderes-vault');
  expect(kopie.stand()).toEqual({ geladen: 3, gesamt: 3, vollstaendig: true, ohneNetz: false });

  // Eine Kopie ohne Angabe des Repos gilt ebenso als fremd.
  const alt = await openDB('notizbuch-gehirn-alt', 1, {
    upgrade(u) {
      u.createObjectStore('dateien', { keyPath: 'path' });
      u.createObjectStore('meta');
    },
  });
  await alt.put('dateien', { path: 'a.md', sha: 's1', text: 'aus einem unbekannten Repo' });
  await alt.put('meta', 'h1', 'head');
  alt.close();
  const ohne = await Kopie.open(REPO, 'notizbuch-gehirn-alt');
  expect(ohne.dateien()).toEqual([]);
  expect(ohne.stand()).toEqual({ geladen: 0, gesamt: 0, vollstaendig: false, ohneNetz: false });
  ohne.close();
});

test('eine Datei, die kein UTF-8 ist, bleibt draußen, und die Kopie wird trotzdem vollständig', async () => {
  const { client, state } = fakeClient({ entries: drei() });
  state.kaputt = ['s2'];
  const stande: KopieStand[] = [];
  const voll = { geladen: 2, gesamt: 2, vollstaendig: true, ohneNetz: false };
  expect(await kopie.auffrischen(client, (s) => stande.push(s))).toEqual(voll);
  expect(stande.at(-1)).toEqual(voll);
  expect(state.textCalls.sort()).toEqual(['a.md', 'b.md', 'c.md']);
  expect(kopie.dateien().map((d) => d.path)).toEqual(['a.md', 'c.md']);
  expect(kopie.text('b.md')).toBeNull();
  expect(await pathsInDb()).toEqual(['a.md', 'c.md']);

  // Derselbe Kopf: keine Anfrage nach Baum oder Blob, auch nicht für die unlesbare Datei.
  state.textCalls.length = 0;
  expect(await kopie.auffrischen(client)).toEqual(voll);
  expect(state.treeCalls).toBe(1);
  expect(state.textCalls).toEqual([]);

  // Nach einem Neustart mit neuem Kopf: nur die geänderte Datei, die unlesbare (gleiche sha) nicht noch einmal.
  kopie.close();
  kopie = await Kopie.open(REPO);
  expect(kopie.stand()).toEqual(voll);
  state.head = 'h2';
  state.entries = [eintrag('a.md', 's1'), eintrag('b.md', 's2'), eintrag('c.md', 's3neu')];
  expect(await kopie.auffrischen(client)).toEqual(voll);
  expect(state.textCalls).toEqual(['c.md']);

  // Mit neuer sha wird sie wieder geholt und kommt dazu. Wird eine lesbare Datei unlesbar, fliegt ihre alte Fassung hinaus.
  state.textCalls.length = 0;
  state.head = 'h3';
  state.kaputt = ['s1neu'];
  state.entries = [eintrag('a.md', 's1neu'), eintrag('b.md', 's2neu'), eintrag('c.md', 's3neu')];
  expect(await kopie.auffrischen(client)).toEqual(voll);
  expect(state.textCalls.sort()).toEqual(['a.md', 'b.md']);
  expect(kopie.dateien().map((d) => d.path)).toEqual(['b.md', 'c.md']);
  expect(kopie.text('a.md')).toBeNull();
  expect(await pathsInDb()).toEqual(['b.md', 'c.md']);
  // Gemerkt bleibt nur, was der Baum noch nennt.
  const db = await openDB('notizbuch-gehirn', 1);
  expect(await db.get('meta', 'unlesbar')).toEqual(['s1neu']);
  db.close();
});
