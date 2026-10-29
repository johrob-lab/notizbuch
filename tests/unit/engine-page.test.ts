import { afterEach, beforeEach, expect, test } from 'vitest';
import { toggleTask } from '../../src/lib/dailyNote';
import type { SyncEngine } from '../../src/sync/engine';
import { fixture, lineOf } from './helpers';
import { A, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

// Die Seite schreibt immer einen Text, der aus dem entstand, den sie zuletzt gelesen oder hochgeladen hat. Die
// lokale Kopie kann inzwischen weiter sein (fremde Änderung, Konflikt). Dann muss der Upload das merken und
// zusammenführen, statt die fremde Änderung mit dem Stand der Kopie still zu überschreiben.

const base = fixture('05 Daily Notes/2026-10-29.md');
const COPY1 = '05 Daily Notes/2026-10-29 (Konflikt).md';
const COPY2 = '05 Daily Notes/2026-10-29 (Konflikt 2).md';

let h: Harness;
let fake: FakeClient;
let e: SyncEngine;

beforeEach(async () => {
  h = await setupHarness();
  ({ fake, e } = h);
});
afterEach(() => h.dispose());

const puts = (path: string) => fake.log.filter((line) => line.startsWith(`put ${path} `));
const theirsGemeldet = base.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 gemeldet%%');

/** Die Seite hat `base` gelesen (sha s1), auf GitHub steht danach etwas Fremdes (sha s2), das die Kopie noch nicht hat. */
async function pageReadsThenSomeoneElseWrites(edit: string) {
  fake.files[A] = { text: base, sha: 's1' };
  const shown = (await e.read(A)) as string;
  const theirs = edit;
  fake.files[A] = { text: theirs, sha: 's2' };
  return { shown, theirs };
}

test('a write the page makes right after a same-line conflict is saved as a copy, the remote text stays', async () => {
  const ours = base.replace('Urlaube im Plan nachziehen', 'Urlaube heute nachziehen');
  const { theirs } = await pageReadsThenSomeoneElseWrites(base.replace('Urlaube im Plan nachziehen', 'Urlaube morgen nachziehen'));
  await e.write(A, ours, 'md');

  // Beim Hinweis auf die fremde Änderung sichert die Seite noch eine Eingabe, die auf ihrem alten Text beruht.
  const stale = ours + '\nnoch ein Gedanke\n';
  const record = e.onRemoteChange;
  let saved = false;
  e.onRemoteChange = (paths) => {
    record?.(paths);
    if (saved) return;
    saved = true;
    void e.write(A, stale, 'md');
  };
  await e.flush();
  await until(async () => (await h.store.get('outbox', A))?.text === stale);
  await e.flush();

  expect(fake.files[A]).toEqual({ text: theirs, sha: 's2' }); // der fremde Stand ist unangetastet
  expect(fake.files[COPY1].text).toBe(ours);
  expect(fake.files[COPY2].text).toBe(stale);
  expect(h.conflicts).toEqual([
    { path: A, copyPath: COPY1 },
    { path: A, copyPath: COPY2 },
  ]);
  expect(await h.store.get('files', A)).toMatchObject({ text: theirs, sha: 's2', base: theirs });
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('an edit that derives from the text the page read is merged after a poll refreshed the copy', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  fake.head = 'h1';
  const shown = (await e.read(A)) as string;
  await e.pollRemote();

  fake.files[A] = { text: theirsGemeldet, sha: 's2' };
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote(); // die Kopie hat jetzt s2, die Seite zeigt noch den alten Text
  expect(h.remoteChanges).toEqual([[A]]);
  expect(await h.store.get('files', A)).toMatchObject({ sha: 's2' });

  await e.write(A, toggleTask(shown, lineOf(shown, 'Liste Planobjekte')), 'md');
  await e.flush();
  expect(fake.files[A].text).toContain('- [x] Liste Planobjekte');
  expect(fake.files[A].text).toContain('todo:AAMkTEST2 gemeldet');
  expect(puts(A)).toEqual([`put ${A} s1`, `put ${A} s2`]); // erst mit der Fassung der Seite (409), dann zusammengeführt
  expect(h.conflicts).toEqual([]);
});

test('a page that read the new text after the poll writes on top of it without a conflict', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  fake.head = 'h1';
  await e.read(A);
  await e.pollRemote();

  fake.files[A] = { text: theirsGemeldet, sha: 's2' };
  fake.changes = [A];
  fake.head = 'h2';
  await e.pollRemote();
  const shown = (await e.read(A)) as string; // die Seite liest nach dem Hinweis neu
  expect(shown).toBe(theirsGemeldet);

  await e.write(A, toggleTask(shown, lineOf(shown, 'Liste Planobjekte')), 'md');
  await e.flush();
  expect(puts(A)).toEqual([`put ${A} s2`]);
  expect(fake.files[A].text).toContain('- [x] Liste Planobjekte');
  expect(fake.files[A].text).toContain('todo:AAMkTEST2 gemeldet');
});

test('after an upload the next write builds on the uploaded version', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  await e.write(A, 'eins', 'md');
  await e.flush();
  const sha1 = fake.files[A].sha;
  await e.write(A, 'zwei', 'md');
  await e.flush();
  expect(puts(A)).toEqual([`put ${A} s1`, `put ${A} ${sha1}`]);
  expect(fake.files[A].text).toBe('zwei');
  expect(fake.count('get')).toBe(1); // nur das erste Lesen, kein Umweg über einen Konflikt
});

test('after a merged upload the next write from the same page is merged again, nothing is lost', async () => {
  const { shown } = await pageReadsThenSomeoneElseWrites(theirsGemeldet);
  const first = toggleTask(shown, lineOf(shown, 'Liste Planobjekte'));
  await e.write(A, first, 'md');
  await e.flush(); // zusammengeführt hochgeladen, die Seite erfährt davon
  expect(h.remoteChanges).toEqual([[A]]);

  // Die Seite liest nicht neu, ihre nächste Eingabe beruht auf `first`.
  const second = toggleTask(first, lineOf(first, 'Reorga abstimmen'));
  await e.write(A, second, 'md');
  await e.flush();
  const text = fake.files[A].text;
  expect(text).toContain('- [x] Liste Planobjekte');
  expect(text).toContain('- [ ] Reorga abstimmen'); // die zweite Eingabe hakt den erledigten Punkt ab
  expect(text).toContain('todo:AAMkTEST2 gemeldet');
  expect(h.conflicts).toEqual([]);
});

test('a restarted app writes on top of the stored copy', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const restarted = await h.restart(); // der Speicher im Arbeitsspeicher ist leer, die Kopie liegt in der Datenbank
  await restarted.write(A, 'neu', 'md');
  await restarted.flush();
  expect(puts(A)).toEqual([`put ${A} s1`]);
  expect(fake.files[A].text).toBe('neu');
});

test('a page that never saw the file and clashed with it writes again on its own version, not on the remote one', async () => {
  const theirs = 'von Obsidian angelegt';
  fake.files[A] = { text: theirs, sha: 's9' };
  await e.write(A, 'erste Fassung', 'md'); // blind: Die Seite hat die Datei nie gelesen
  await e.flush();
  expect(fake.files[COPY1].text).toBe('erste Fassung');
  expect(await h.store.get('files', A)).toMatchObject({ text: theirs, sha: 's9' }); // die Kopie hat jetzt den fremden Stand

  // Die Seite weiß davon nichts und schreibt auf ihrem Text weiter: Das darf den fremden Stand nicht überschreiben.
  await e.write(A, 'zweite Fassung', 'md');
  await e.flush();
  expect(fake.files[A]).toEqual({ text: theirs, sha: 's9' });
  expect(fake.files[COPY2].text).toBe('zweite Fassung');
  expect(puts(A)).toEqual([`put ${A} null`, `put ${A} null`]);
});

test('a page that was deleted and is written again does not carry the old version', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  await e.remove(A);
  await e.flush();
  expect(fake.files[A]).toBeUndefined();
  await e.write(A, 'wieder da', 'md');
  await e.flush();
  expect(puts(A)).toEqual([`put ${A} null`]);
  expect(fake.files[A].text).toBe('wieder da');
});
