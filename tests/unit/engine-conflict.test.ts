import { afterEach, beforeEach, expect, test } from 'vitest';
import { toggleTask } from '../../src/lib/dailyNote';
import { parsePage } from '../../src/ink/svg';
import { ConflictError, OfflineError } from '../../src/sync/github';
import type { SyncEngine } from '../../src/sync/engine';
import { fixture, lineOf } from './helpers';
import { A, B, S, svgPage, type FakeClient, type Harness, setupHarness } from './syncHelpers';

const base = fixture('05 Daily Notes/2026-10-29.md');
const COPY1 = '05 Daily Notes/2026-10-29 (Konflikt).md';
const COPY2 = '05 Daily Notes/2026-10-29 (Konflikt 2).md';
const COPY3 = '05 Daily Notes/2026-10-29 (Konflikt 3).md';
const SVG_COPY = '07 Anhänge/Notizbuch/2026/2026-10-29 Tag (Konflikt).svg';

let h: Harness;
let fake: FakeClient;
let e: SyncEngine;

beforeEach(async () => {
  h = await setupHarness();
  ({ fake, e } = h);
});
afterEach(() => h.dispose());

/** Text, den die App kennt (Stand sha s1), und der Stand auf GitHub (sha s2), beide ändern dieselbe Zeile. */
async function sameLineClash() {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = base.replace('Urlaube im Plan nachziehen', 'Urlaube heute nachziehen');
  const theirs = base.replace('Urlaube im Plan nachziehen', 'Urlaube morgen nachziehen');
  fake.files[A] = { text: theirs, sha: 's2' };
  return { ours, theirs };
}

// ---------- Markdown ----------

test('the app tells the page about the merge, and the local copy is the merged text', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  fake.files[A] = { text: base.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 gemeldet%%'), sha: 's2' };
  await e.write(A, ours, 'md');
  await e.flush();
  expect(h.remoteChanges).toEqual([[A]]);
  expect(await e.read(A)).toBe(fake.files[A].text);
  expect(await h.store.get('files', A)).toMatchObject({ sha: fake.files[A].sha, base: fake.files[A].text });
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.conflicts).toEqual([]);
});

test('same line conflict keeps the remote text locally and queues no second upload of the original', async () => {
  const { ours, theirs } = await sameLineClash();
  await e.write(A, ours, 'md');
  await e.flush();
  expect(await e.read(A)).toBe(theirs);
  expect(await h.store.get('files', A)).toMatchObject({ text: theirs, sha: 's2', base: theirs });
  expect(fake.log.filter((line) => line.startsWith(`put ${A} `))).toEqual([`put ${A} s1`]);
  expect(h.remoteChanges).toEqual([[A]]);
  expect(h.conflicts).toEqual([{ path: A, copyPath: COPY1 }]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('further conflict copies are numbered and never overwrite an older one', async () => {
  fake.files[COPY1] = { text: 'ältere Kopie', sha: 'c1' };
  const first = await sameLineClash();
  await e.write(A, first.ours, 'md');
  await e.flush();
  expect(fake.files[COPY1].text).toBe('ältere Kopie');
  expect(fake.files[COPY2].text).toBe(first.ours);

  const ours2 = first.theirs.replace('Urlaube morgen', 'Urlaube gestern');
  fake.files[A] = { text: first.theirs.replace('Urlaube morgen', 'Urlaube übermorgen'), sha: 's3' };
  await e.write(A, ours2, 'md');
  await e.flush();
  expect(fake.files[COPY2].text).toBe(first.ours);
  expect(fake.files[COPY3].text).toBe(ours2);
  expect(h.conflicts.map((c) => c.copyPath)).toEqual([COPY2, COPY3]);
});

test('a copy that is still queued here counts as taken', async () => {
  const first = await sameLineClash();
  fake.putErrors.set(COPY1, new Error('kaputt')); // die erste Kopie bleibt in der Warteschlange
  await e.write(A, first.ours, 'md');
  await e.flush();
  expect((await h.store.getAll('outbox')).map((entry) => entry.path)).toEqual([COPY1]);

  const ours2 = first.theirs.replace('Urlaube morgen', 'Urlaube gestern');
  fake.files[A] = { text: first.theirs.replace('Urlaube morgen', 'Urlaube übermorgen'), sha: 's3' };
  await e.write(A, ours2, 'md');
  await e.flush();
  expect(h.conflicts.map((c) => c.copyPath)).toEqual([COPY1, COPY2]);
  expect(fake.files[COPY2].text).toBe(ours2);
  expect(fake.files[COPY1]).toBeUndefined();
});

test('the copy is stored locally before it is uploaded, so going offline right then loses nothing', async () => {
  const { ours, theirs } = await sameLineClash();
  fake.putErrors.set(COPY1, new OfflineError());
  await e.write(A, ours, 'md');
  await e.flush();
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  expect(await h.store.get('outbox', COPY1)).toMatchObject({ text: ours, baseSha: null, baseText: null, kind: 'md' });
  expect(await e.read(COPY1)).toBe(ours);
  expect(await e.read(A)).toBe(theirs);
  expect(h.conflicts).toEqual([{ path: A, copyPath: COPY1 }]);

  fake.putErrors.clear();
  await e.flush();
  expect(fake.files[COPY1].text).toBe(ours);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a merge that equals the remote text uploads nothing', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  fake.files[A] = { text: ours, sha: 's2' }; // dieselbe Änderung steht schon auf GitHub
  await e.write(A, ours, 'md');
  await e.flush();
  expect(fake.log.filter((line) => line.startsWith(`put ${A} `))).toEqual([`put ${A} s1`]);
  expect(await h.store.get('files', A)).toMatchObject({ text: ours, sha: 's2', base: ours });
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.conflicts).toEqual([]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('when GitHub already has our change and more, nothing is uploaded and the page is told', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  const theirs = ours.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 gemeldet%%'); // unsere Änderung plus eine fremde
  fake.files[A] = { text: theirs, sha: 's2' };
  await e.write(A, ours, 'md');
  await e.flush();
  expect(fake.log.filter((line) => line.startsWith(`put ${A} `))).toEqual([`put ${A} s1`]);
  expect(await e.read(A)).toBe(theirs);
  expect(await h.store.get('files', A)).toMatchObject({ text: theirs, sha: 's2', base: theirs });
  expect(h.remoteChanges).toEqual([[A]]);
  expect(h.conflicts).toEqual([]);
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('a spurious 409 while the file did not change is retried', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  fake.putErrorOnce.set(A, new ConflictError());
  await e.write(A, ours, 'md');
  await e.flush();
  expect(fake.files[A].text).toBe(ours);
  expect(h.conflicts).toEqual([]);
  expect(fake.log.filter((line) => line.startsWith(`put ${A} `))).toEqual([`put ${A} s1`, `put ${A} s1`]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a new file that appeared on GitHub meanwhile is not overwritten', async () => {
  fake.files[B] = { text: 'von Obsidian', sha: 's9' };
  await e.write(B, 'von der App', 'md');
  await e.flush();
  expect(fake.files[B].text).toBe('von Obsidian');
  expect(fake.files['05 Daily Notes/2026-10-30 (Konflikt).md'].text).toBe('von der App');
  expect(h.conflicts).toHaveLength(1);
});

test('a file that is gone from GitHub is uploaded again as a new file', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  delete fake.files[A];
  const ours = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  await e.write(A, ours, 'md');
  await e.flush();
  expect(fake.files[A].text).toBe(ours);
  expect(fake.log).toContain(`put ${A} null`);
  expect(h.conflicts).toEqual([]);
});

test('going offline in the middle of a conflict loses nothing', async () => {
  const { ours } = await sameLineClash();
  await e.write(A, ours, 'md');
  fake.before = (line) => {
    if (line.startsWith('get ')) fake.offline = true; // das Netz fällt aus, sobald der fremde Stand geholt wird
  };
  await e.flush();
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });
  expect(await h.store.get('outbox', A)).toMatchObject({ text: ours, baseSha: 's1', baseText: base });
  expect(h.conflicts).toEqual([]);

  fake.before = undefined;
  fake.offline = false;
  await e.flush();
  expect(fake.files[COPY1].text).toBe(ours);
  expect(h.conflicts).toEqual([{ path: A, copyPath: COPY1 }]);
});

test('a write during the conflict is merged on the next upload and nothing is lost', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  const first = toggleTask(base, lineOf(base, 'Liste Planobjekte'));
  fake.files[A] = { text: base.replace('todo:AAMkTEST2%%', 'todo:AAMkTEST2 gemeldet%%'), sha: 's2' };
  await e.write(A, first, 'md');

  const hold = fake.hold('get'); // der fremde Stand ist geholt, die Zusammenführung läuft noch
  const flushing = e.flush();
  await hold.reached;
  const second = toggleTask(first, lineOf(first, 'Reorga abstimmen'));
  await e.write(A, second, 'md');
  hold.release();
  await flushing;
  await e.flush();

  const text = fake.files[A].text;
  expect(text).toContain('- [x] Liste Planobjekte');
  expect(text).toContain('todo:AAMkTEST2 gemeldet');
  expect(text).toContain('- [ ] Reorga abstimmen');
  expect(h.conflicts).toEqual([]);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(await e.read(A)).toBe(text);
});

test('a write during a conflict copy is saved in the copy', async () => {
  const { ours, theirs } = await sameLineClash();
  await e.write(A, ours, 'md');
  const hold = fake.hold('get');
  const flushing = e.flush();
  await hold.reached;
  const newer = ours + '\nnoch ein Gedanke\n';
  await e.write(A, newer, 'md');
  hold.release();
  await flushing;
  expect(fake.files[COPY1].text).toBe(newer);
  expect(await e.read(A)).toBe(theirs);
  expect(await h.store.getAll('outbox')).toEqual([]);
});

// ---------- Handschrift (SVG) ----------

test('svg: strokes of both sides are merged', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: svgPage('a', 'r'), sha: 's2' }; // ein anderes Gerät hat Strich r ergänzt
  await e.write(S, svgPage('a', 'o'), 'svg');
  await e.flush();
  const ids = parsePage(fake.files[S].text).strokes.map((s) => s.id);
  expect(ids.sort()).toEqual(['a', 'o', 'r']);
  expect(await e.read(S)).toBe(fake.files[S].text);
  expect(h.remoteChanges).toEqual([[S]]);
  expect(h.conflicts).toEqual([]);
});

test('svg: a page that is already identical on GitHub is not rewritten', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  // Ein anderes Werkzeug hat dieselbe Seite mit einem Kommentar gespeichert. Neu geschrieben ginge der Kommentar verloren.
  const same = svgPage('a', 'b') + '<!-- von einem anderen Werkzeug -->\n';
  fake.files[S] = { text: same, sha: 's2' };
  await e.write(S, same, 'svg');
  await e.flush();
  expect(fake.log.filter((line) => line.startsWith(`put ${S} `))).toEqual([`put ${S} s1`]);
  expect(fake.files[S]).toEqual({ text: same, sha: 's2' });
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('svg: an unreadable remote page keeps the remote text and saves ours as a copy', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: 'kein SVG', sha: 's2' };
  const ours = svgPage('a', 'o');
  await e.write(S, ours, 'svg');
  await e.flush();
  expect(fake.files[S].text).toBe('kein SVG');
  expect(fake.files[SVG_COPY].text).toBe(ours);
  expect(h.conflicts).toEqual([{ path: S, copyPath: SVG_COPY }]);
});

test('svg: ink written while a merge is under way comes along on the next upload', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: svgPage('a', 'r'), sha: 's2' };
  await e.write(S, svgPage('a', 'o'), 'svg');
  const hold = fake.hold('get');
  const flushing = e.flush();
  await hold.reached;
  await e.write(S, svgPage('a', 'o', 'p'), 'svg');
  hold.release();
  await flushing;
  await e.flush();
  expect(parsePage(fake.files[S].text).strokes.map((s) => s.id).sort()).toEqual(['a', 'o', 'p', 'r']);
  expect(await h.store.getAll('outbox')).toEqual([]);
});
