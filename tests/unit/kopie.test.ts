import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from 'idb';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { Kopie, kopieImSpeicher, setzeKopieImSpeicher, type KopieStand } from '../../src/gehirn/kopie';
import { OfflineError, type CopyClient, type CopyEntry } from '../../src/sync/github';

// Alles hier ist erfunden. Die Datenbank liegt im Speicher (fake-indexeddb), pro Test eine frische.

let kopie: Kopie;

beforeEach(async () => {
  (globalThis as { indexedDB: IDBFactory }).indexedDB = new IDBFactory();
  kopie = await Kopie.open();
});
afterEach(() => kopie.close());

const eintrag = (path: string, sha: string): CopyEntry => ({ path, sha, size: 10 });

/** Ein falscher Client: Baum und Kopf sind einstellbar, die Aufrufe werden gezählt. */
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
  kopie = await Kopie.open();
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
  kopie = await Kopie.open();
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
