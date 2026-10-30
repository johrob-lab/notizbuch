import { afterEach, beforeEach, expect, test } from 'vitest';
import { parsePage } from '../../src/ink/svg';
import { toggleTask } from '../../src/lib/dailyNote';
import type { SyncEngine } from '../../src/sync/engine';
import { fixture, lineOf } from './helpers';
import { A, S, svgPage, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

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

// ---------- Zwei Fenster auf derselben Datenbank ----------

/**
 * Zwei Fenster haben die Seite gelesen (sha s1). Fenster 1 schreibt, Fenster 2 gleicht ab: Der Ausgang ist gemeinsam,
 * also lädt Fenster 2 die Änderung von Fenster 1 hoch. Die Seite von Fenster 2 zeigt davon noch nichts.
 */
async function secondWindowUploadsTheChangeOfTheFirst(edit: (shown: string) => string) {
  fake.files[A] = { text: base, sha: 's1' };
  const second = await h.restart();
  const told: string[][] = [];
  second.onRemoteChange = (paths) => told.push(paths);
  const shown1 = (await e.read(A)) as string;
  const shown2 = (await second.read(A)) as string;
  const change1 = edit(shown1);
  await e.write(A, change1, 'md');
  await second.flush();
  return { second, told, shown2, change1, uploaded: fake.files[A].sha };
}

test('a second window that uploads the change of the first one tells its own page, which still shows the old text', async () => {
  const { told, change1 } = await secondWindowUploadsTheChangeOfTheFirst((shown) => toggleTask(shown, lineOf(shown, 'Liste Planobjekte')));
  expect(fake.files[A].text).toBe(change1);
  expect(told).toEqual([[A]]);
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('the second window then writes on its old text: the upload meets the new version and both changes are kept', async () => {
  const { second, shown2, uploaded } = await secondWindowUploadsTheChangeOfTheFirst((shown) => toggleTask(shown, lineOf(shown, 'Liste Planobjekte')));
  await second.write(A, toggleTask(shown2, lineOf(shown2, 'Reorga abstimmen')), 'md'); // ohne neu zu lesen
  await second.flush();
  expect(puts(A)).toEqual([`put ${A} s1`, `put ${A} s1`, `put ${A} ${uploaded}`]); // Fenster 1 hoch, 409, zusammengeführt
  const text = fake.files[A].text;
  expect(text).toContain('- [x] Liste Planobjekte'); // der Haken von Fenster 1
  expect(text).toContain('- [ ] Reorga abstimmen'); // der Haken von Fenster 2
  expect(h.conflicts).toEqual([]);
});

test('the second window clashing on the same line makes a copy and leaves the uploaded text alone', async () => {
  const { second, shown2, change1 } = await secondWindowUploadsTheChangeOfTheFirst((shown) =>
    shown.replace('Urlaube im Plan nachziehen', 'Urlaube heute nachziehen'),
  );
  const change2 = shown2.replace('Urlaube im Plan nachziehen', 'Urlaube morgen nachziehen');
  await second.write(A, change2, 'md');
  await second.flush();
  expect(fake.files[A].text).toBe(change1);
  expect(fake.files[COPY1].text).toBe(change2);
  expect(h.conflicts).toEqual([{ path: A, copyPath: COPY1 }]);
});

test('after it read the new text the second window writes on top of it without a conflict', async () => {
  const { second, uploaded } = await secondWindowUploadsTheChangeOfTheFirst((shown) => toggleTask(shown, lineOf(shown, 'Liste Planobjekte')));
  const shown = (await second.read(A)) as string; // die Seite liest nach dem Hinweis neu
  await second.write(A, toggleTask(shown, lineOf(shown, 'Reorga abstimmen')), 'md');
  await second.flush();
  expect(puts(A)).toEqual([`put ${A} s1`, `put ${A} ${uploaded}`]);
  expect(h.conflicts).toEqual([]);
});

test('a window whose page never opened the file is not told when it uploads the change of another window', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  const second = await h.restart();
  const told: string[][] = [];
  second.onRemoteChange = (paths) => told.push(paths);
  await e.read(A);
  await e.write(A, 'neu', 'md');
  await second.flush();
  expect(fake.files[A].text).toBe('neu');
  expect(told).toEqual([]);
});

test('a window whose page got the file from GitHub is told as well when it uploads the change of another window', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  const second = await h.restart();
  const told: string[][] = [];
  second.onRemoteChange = (paths) => told.push(paths);
  await second.read(A); // noch keine Kopie in der Datenbank: Der Text kommt von GitHub
  await e.write(A, toggleTask(base, lineOf(base, 'Liste Planobjekte')), 'md');
  await second.flush();
  expect(told).toEqual([[A]]);
});

test('a window that uploads what its own page wrote moves on, and a newer text written meanwhile stays quiet', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const hold = fake.hold('put');
  await e.write(A, 'eins', 'md');
  const flushing = e.flush();
  await hold.reached;
  await e.write(A, 'zwei', 'md'); // die Seite schreibt weiter, während 'eins' unterwegs ist
  hold.release();
  await flushing;
  expect(h.remoteChanges).toEqual([]); // die Seite hält 'zwei', die lokale Kopie auch: nichts zu lesen
  await e.flush();
  expect(fake.files[A].text).toBe('zwei');
  expect(puts(A)).toEqual([`put ${A} s1`, `put ${A} s101`]); // 'zwei' beruht auf dem, was eben hochging
});

test('a restarted app: the page writes without having read, the upload is merged and its next write is merged again', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A); // die Kopie liegt in der Datenbank
  const restarted = await h.restart(); // im Arbeitsspeicher steht nichts: keine Fassung der Seite, kein Text
  const first = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  await restarted.write(A, first, 'md');
  fake.files[A] = { text: theirsGemeldet, sha: 's2' }; // inzwischen hat jemand eine andere Zeile geändert
  await restarted.flush();
  expect(h.remoteChanges).toEqual([[A]]);

  await restarted.write(A, toggleTask(first, lineOf(first, 'Reorga abstimmen')), 'md'); // die Seite liest nicht neu
  await restarted.flush();
  const text = fake.files[A].text;
  expect(text).toContain('- [x] Liste Planobjekte');
  expect(text).toContain('- [ ] Reorga abstimmen');
  expect(text).toContain('todo:AAMkTEST2 gemeldet');
  expect(h.conflicts).toEqual([]);
});

// ---------- Die wartende Änderung wurde unter der Seite neu aufgesetzt ----------

const idsOf = (text: string) =>
  parsePage(text)
    .strokes.map((stroke) => stroke.id)
    .sort();

/**
 * Die Seite hat `before` gelesen (sha s1) und `ours` geschrieben, ein anderes Gerät hat `theirs` hochgeladen (sha s2). Während
 * das Zusammengeführte hochgeht, nimmt die Seite ihre Änderung zurück (sie hält wieder `before`). Die wartende Änderung kommt
 * danach auf das Hochgeladene, und die Seite erfährt es: Dann läuft `onTold`, was die Seite beim Hinweis tut. Danach wird
 * hochgeladen, was noch wartet.
 */
async function takeBackWhileTheMergedTextGoesUp(path: string, kind: 'md' | 'svg', v: { before: string; ours: string; theirs: string }, onTold: () => Promise<void>) {
  fake.files[path] = { text: v.before, sha: 's1' };
  await e.read(path);
  fake.files[path] = { text: v.theirs, sha: 's2' };
  await e.write(path, v.ours, kind);
  const hold = fake.hold('put');
  const flushing = e.flush();
  await hold.reached;
  await e.write(path, v.before, kind);
  const record = e.onRemoteChange;
  let told: Promise<void> | undefined;
  e.onRemoteChange = (paths) => {
    record?.(paths);
    told ??= onTold();
  };
  hold.release();
  await flushing;
  await until(() => told !== undefined, 'Hinweis an die Seite');
  await told;
  await e.flush();
}

/** Strich s2 hier, s9 von einem anderen Gerät, s2 wieder zurückgenommen: Gewartet wird danach auf s1 und s9. */
const STROKES = { before: svgPage('s1'), ours: svgPage('s1', 's2'), theirs: svgPage('s1', 's9') };

test('a stroke the page draws on its old text before it reads the rebased one is added to it, the stroke from elsewhere stays', async () => {
  // ohne neu zu lesen: s9 kennt die Seite noch nicht
  await takeBackWhileTheMergedTextGoesUp(S, 'svg', STROKES, () => e.write(S, svgPage('s1', 's3'), 'svg'));
  expect(idsOf(fake.files[S].text)).toEqual(['s1', 's3', 's9']);
  expect(await h.store.get('files', S)).toMatchObject({ text: fake.files[S].text, sha: fake.files[S].sha });
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.conflicts).toEqual([]);
});

test('a page that read the rebased text first writes on top of it as usual', async () => {
  await takeBackWhileTheMergedTextGoesUp(S, 'svg', STROKES, async () => {
    const shown = (await e.read(S)) as string; // die Seite liest nach dem Hinweis neu
    expect(idsOf(shown)).toEqual(['s1', 's9']);
    await e.write(S, svgPage('s1', 's9', 's3'), 'svg');
  });
  expect(idsOf(fake.files[S].text)).toEqual(['s1', 's3', 's9']);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.conflicts).toEqual([]);
});

test('a page that does not read the rebased text and writes on its old one after that went up still keeps the stroke from elsewhere', async () => {
  await takeBackWhileTheMergedTextGoesUp(S, 'svg', STROKES, async () => undefined); // die Seite liest nicht neu
  expect(idsOf(fake.files[S].text)).toEqual(['s1', 's9']); // das neu Aufgesetzte ist oben, nichts wartet mehr
  await e.write(S, svgPage('s1', 's3'), 'svg'); // weiter auf ihrem alten Text, s9 kennt sie nicht
  await e.flush();
  expect(idsOf(fake.files[S].text)).toEqual(['s1', 's3', 's9']);
  expect(h.conflicts).toEqual([]);
});

test('a change on its old text that clashes with the rebased note is refused: nothing is stored, and the note from elsewhere stays', async () => {
  const ticked = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  // Die Seite ändert auf ihrem alten Text genau die Zeile, die die Routine geändert hat, und zwar anders.
  const clash = base.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 anders%%');
  let refused: unknown = null;
  await takeBackWhileTheMergedTextGoesUp(A, 'md', { before: base, ours: ticked, theirs: theirsGemeldet }, async () => {
    refused = await e.write(A, clash, 'md').then(
      () => null,
      (error: unknown) => error,
    );
  });
  expect(refused).toBeInstanceOf(Error);
  expect(fake.files[A].text).toBe(theirsGemeldet); // ohne Haken, mit der Änderung der Routine, nichts davon überschrieben
  expect(await e.read(A)).toBe(theirsGemeldet); // die Seite liest den neuen Stand und kann ihre Änderung darauf wiederholen
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.conflicts).toEqual([]);
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
