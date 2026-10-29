import { afterEach, beforeEach, expect, test } from 'vitest';
import { PathNotAllowedError } from '../../src/sync/paths';
import type { SyncEngine } from '../../src/sync/engine';
import { fixture } from './helpers';
import { A, B, S, quiet, svgPage, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

const base = fixture('05 Daily Notes/2026-10-29.md');

let h: Harness;
let fake: FakeClient;
let e: SyncEngine;

beforeEach(async () => {
  h = await setupHarness();
  ({ fake, e } = h);
});
afterEach(() => h.dispose());

// ---------- Lesen ----------

test('without a local copy it fetches, keeps the copy and returns the text', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  expect(await e.read(A)).toBe(base);
  expect(await h.store.get('files', A)).toMatchObject({ path: A, text: base, sha: 's1', base });
  expect(typeof (await h.store.get('files', A))?.syncedAt).toBe('number');
});

test('a file that does not exist reads as null and is not kept', async () => {
  expect(await e.read(A)).toBeNull();
  expect(await h.store.get('files', A)).toBeUndefined();
});

test('a write that lands while the first read is still fetching is not overwritten', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  const hold = fake.hold('get');
  const reading = e.read(A);
  await hold.reached;
  await e.write(A, 'lokal', 'md');
  hold.release();
  expect(await reading).toBe('lokal');
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal', sha: null, base: null });
  expect(await h.store.get('outbox', A)).toMatchObject({ text: 'lokal', baseSha: null });
});

test('offline without a local copy reads as null, and the next read fetches', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  fake.offline = true;
  expect(await e.read(A)).toBeNull();
  expect(await h.store.get('files', A)).toBeUndefined();
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 }); // nichts wartet auf das Netz
  fake.offline = false;
  expect(await e.read(A)).toBe(base);
});

test('a refused access reads as null and shows zugang', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  fake.auth = false;
  expect(await e.read(A)).toBeNull();
  expect(e.status.value.state).toBe('zugang');
});

test('a file that cannot be decoded throws and is never kept as empty', async () => {
  fake.broken.add(A);
  await expect(e.read(A)).rejects.toBeInstanceOf(TypeError);
  expect(await h.store.get('files', A)).toBeUndefined();
  expect(await h.store.getAll('outbox')).toEqual([]);
  await expect(e.read(A)).rejects.toBeInstanceOf(TypeError); // und es bleibt dabei
});

test('a path that is not allowed throws', async () => {
  fake.forbidden.add(A);
  await expect(e.read(A)).rejects.toBeInstanceOf(PathNotAllowedError);
});

test('with a local copy it answers at once and refreshes in the background', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  fake.files[A] = { text: 'neuer Stand', sha: 's2' };
  expect(await e.read(A)).toBe(base); // sofort die Kopie
  await until(() => h.remoteChanges.length === 1);
  expect(h.remoteChanges).toEqual([[A]]);
  expect(await h.store.get('files', A)).toMatchObject({ text: 'neuer Stand', sha: 's2', base: 'neuer Stand' });
  expect(await e.read(A)).toBe('neuer Stand');
});

test('the refresh keeps quiet when nothing changed', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  await e.read(A);
  await until(() => fake.count('get') === 2);
  await quiet();
  expect(h.remoteChanges).toEqual([]);
});

test('a path with a queued change is not refreshed', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  await e.write(A, 'lokal', 'md');
  fake.files[A] = { text: 'fremd', sha: 's2' };
  expect(await e.read(A)).toBe('lokal');
  await quiet();
  expect(fake.count('get')).toBe(1); // nur das erste Lesen
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal', sha: 's1' });
  expect(h.remoteChanges).toEqual([]);
});

test('a change made while the refresh is under way wins over the refreshed text', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  fake.files[A] = { text: 'fremd', sha: 's2' };
  const hold = fake.hold('get');
  await e.read(A);
  await hold.reached;
  await e.write(A, 'lokal', 'md');
  hold.release();
  await quiet();
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal', sha: 's1', base });
  expect(h.remoteChanges).toEqual([]);
});

// ---------- Löschen ----------

test('remove queues a delete with the last known sha, drops the local copy and flush deletes', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  await e.remove(S);
  expect(await h.store.get('files', S)).toBeUndefined();
  expect(await h.store.get('outbox', S)).toMatchObject({ path: S, kind: 'svg', deleted: true, baseSha: 's1' });
  expect(e.status.value.pending).toBe(1);
  expect(await e.read(S)).toBeNull(); // bis zum Löschen gilt die Seite als weg
  expect(await h.store.get('files', S)).toBeUndefined();

  await e.flush();
  expect(fake.files[S]).toBeUndefined();
  expect(fake.log).toContain(`delete ${S} s1`);
  expect(fake.messages).toEqual(['Notizbuch: 2026-10-29 Tag.svg (iPad)']);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a 404 on delete counts as done', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  delete fake.files[S]; // wurde inzwischen anderswo gelöscht
  await e.remove(S);
  await e.flush();
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.errors).toEqual([]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a delete that meets a changed file is cancelled and the remote version stays', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  const theirs = svgPage('a', 'r');
  fake.files[S] = { text: theirs, sha: 's2' }; // ein anderes Gerät hat weitergeschrieben
  await e.remove(S);
  await e.flush();
  expect(fake.files[S]).toEqual({ text: theirs, sha: 's2' });
  expect(await h.store.get('files', S)).toMatchObject({ text: theirs, sha: 's2', base: theirs });
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.remoteChanges).toEqual([[S]]);
  expect(await e.read(S)).toBe(theirs);
});

test('removing a page that never went up leaves nothing queued', async () => {
  await e.write(S, svgPage('a'), 'svg');
  await e.remove(S);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(await h.store.get('files', S)).toBeUndefined();
  expect(e.status.value.pending).toBe(0);
  await e.flush();
  expect(fake.log).toEqual([]);
});

test('removing while the first upload is under way still removes the page', async () => {
  const hold = fake.hold('put');
  await e.write(S, svgPage('a'), 'svg');
  const flushing = e.flush();
  await hold.reached;
  await e.remove(S);
  hold.release();
  await flushing;
  expect(fake.files[S]).toBeDefined(); // der Upload war schon unterwegs
  await e.flush();
  expect(fake.files[S]).toBeUndefined();
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(await h.store.get('files', S)).toBeUndefined();
});

test('writing while the delete is under way uploads the new text as a new file', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  await e.remove(S);
  const hold = fake.hold('delete');
  const flushing = e.flush();
  await hold.reached; // die Datei ist auf GitHub schon weg, die Antwort ist unterwegs
  const again = svgPage('b');
  await e.write(S, again, 'svg');
  hold.release();
  await flushing;
  expect(await h.store.get('outbox', S)).toMatchObject({ text: again, baseSha: null, baseText: null });
  expect(await h.store.get('files', S)).toMatchObject({ text: again, sha: null, base: null });
  await e.flush();
  expect(fake.files[S].text).toBe(again);
  expect(fake.log).toContain(`put ${S} null`);
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('writing after remove brings the page back', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  await e.remove(S);
  const again = svgPage('a', 'b');
  await e.write(S, again, 'svg');
  expect(await h.store.get('outbox', S)).toMatchObject({ text: again, baseSha: 's1' });
  expect((await h.store.get('outbox', S))?.deleted).toBeFalsy();
  await e.flush();
  expect(fake.files[S].text).toBe(again);
  expect(fake.count('delete')).toBe(0);
});

test('removing a file that was never read looks up its sha when flushing', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's7' };
  await e.remove(S);
  expect(await h.store.get('outbox', S)).toMatchObject({ deleted: true, baseSha: null });
  await e.flush();
  expect(fake.log).toEqual([`get ${S}`, `delete ${S} s7`]);
  expect(fake.files[S]).toBeUndefined();
  expect(await h.store.getAll('outbox')).toEqual([]);
});

test('deletes and uploads never run at the same time', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  await e.write(A, 'x', 'md');
  await e.write(B, 'y', 'md');
  await e.remove(S);
  await e.flush();
  expect(fake.maxActive).toBe(1);
  expect(fake.files[S]).toBeUndefined();
  expect(fake.files[A].text).toBe('x');
  expect(fake.files[B].text).toBe('y');
});
