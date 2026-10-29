import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { parsePage } from '../../src/ink/svg';
import { PathNotAllowedError } from '../../src/sync/paths';
import type { SyncEngine } from '../../src/sync/engine';
import { fixture } from './helpers';
import { A, B, S, svgPage, until, type FakeClient, type Harness, setupHarness } from './syncHelpers';

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
  await until(() => fake.finished('get') === 2); // das Auffrischen ist beantwortet, danach bleibt nur noch der Vergleich
  expect(h.remoteChanges).toEqual([]);
});

test('a path with a queued change is not refreshed', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  fake.files[B] = { text: 'b1', sha: 'sb1' };
  await e.read(A);
  await e.read(B);
  await e.write(A, 'lokal', 'md');
  fake.files[A] = { text: 'fremd', sha: 's2' };
  fake.files[B] = { text: 'b2', sha: 'sb2' };

  // B ist der Zeuge: Sein Auffrischen beginnt nach dem von A und braucht dieselben Schritte bis zur Anfrage an GitHub.
  // Ist B durch, hätte A längst gefragt, wenn es das vorhätte.
  expect(await e.read(A)).toBe('lokal');
  expect(await e.read(B)).toBe('b1');
  await until(() => h.remoteChanges.length === 1);
  expect(h.remoteChanges).toEqual([[B]]);
  expect(fake.log.filter((line) => line === `get ${A}`)).toHaveLength(1); // nur das erste Lesen
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal', sha: 's1' });
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
  await until(() => fake.finished('get') === 2); // die Antwort ist da, die Übernahme in die Datenbank läuft an
  await h.store.get('files', A); // und diese Abfrage kommt erst, wenn sie durch ist
  expect(await h.store.get('files', A)).toMatchObject({ text: 'lokal', sha: 's1', base });
  expect(h.remoteChanges).toEqual([]);
});

test('an old answer to a refresh does not replace a newer copy that was adopted meanwhile', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  fake.files[A] = { text: 'Stand zwei', sha: 's2' };
  const hold = fake.hold('get');
  await e.read(A); // das erste Auffrischen holt Stand zwei, seine Antwort bleibt unterwegs
  await hold.reached;
  fake.files[A] = { text: 'Stand drei', sha: 's3' };
  await e.read(A); // das zweite holt Stand drei und übernimmt ihn
  await until(() => h.remoteChanges.length === 1);

  hold.release(); // jetzt kommt die alte Antwort an
  await until(() => fake.finished('get') === 3);
  await h.store.get('files', A); // und diese Abfrage kommt erst, wenn ihre Übernahme (falls sie liefe) durch ist
  expect(await h.store.get('files', A)).toMatchObject({ text: 'Stand drei', sha: 's3', base: 'Stand drei' });
  expect(h.remoteChanges).toEqual([[A]]);
});

test('a refresh on reading keeps the local copy when GitHub says the file is not there, a lost access looks the same', async () => {
  fake.files[A] = { text: base, sha: 's1' };
  await e.read(A);
  delete fake.files[A]; // gelöscht, oder der Zugang ist weg: GitHub antwortet in beiden Fällen mit "nicht gefunden"
  expect(await e.read(A)).toBe(base); // sofort die Kopie
  await until(() => fake.finished('get') === 2);
  await h.store.get('files', A); // diese Abfrage kommt erst, wenn die Übernahme (falls sie liefe) durch ist
  expect(await h.store.get('files', A)).toMatchObject({ text: base, sha: 's1', base });
  expect(h.remoteChanges).toEqual([]);
  expect(await e.read(A)).toBe(base);
});

test('a page removed while its first read is still fetching does not come back as a local copy', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  const hold = fake.hold('get');
  const reading = e.read(S);
  await hold.reached;
  await e.remove(S); // gelöscht, bevor die Antwort ankommt
  hold.release();
  expect(await reading).toBeNull();
  expect(await h.store.get('files', S)).toBeUndefined();
  expect(await e.read(S)).toBeNull(); // bis zum Löschen gilt die Seite als weg
});

// ---------- Löschen ----------

test('remove queues a delete with the last known sha, drops the local copy and flush deletes', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  await e.remove(S);
  expect(await h.store.get('files', S)).toBeUndefined();
  expect(await h.store.get('outbox', S)).toMatchObject({ path: S, kind: 'svg', deleted: true, baseSha: 's1' });
  expect(e.status.value.pending).toBe(1);
  const asked = fake.count('get');
  expect(await e.read(S)).toBeNull(); // bis zum Löschen gilt die Seite als weg
  expect(fake.count('get')).toBe(asked); // und GitHub wird dafür nicht gefragt
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

test('a delete that meets a changed file which is gone by the time it looks is done', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: svgPage('a', 'r'), sha: 's2' }; // ein anderes Gerät hat weitergeschrieben ...
  await e.remove(S);
  fake.before = (line) => {
    if (line === `get ${S}`) delete fake.files[S]; // ... und die Seite dann gelöscht, bevor wir nachsehen
  };
  await e.flush();
  expect(fake.log).toEqual([`get ${S}`, `delete ${S} s1`, `get ${S}`]);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(await h.store.get('files', S)).toBeUndefined();
  expect(h.errors).toEqual([]);
  expect(h.remoteChanges).toEqual([]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a page that is still shown after its delete was cancelled writes on its own version, so the stroke of the other device stays', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: svgPage('a', 'r'), sha: 's2' }; // ein anderes Gerät hat den Strich r dazugemalt
  await e.remove(S);
  await e.flush(); // das Löschen trifft auf den fremden Stand und wird abgebrochen
  expect(h.remoteChanges).toEqual([[S]]);

  await e.write(S, svgPage('a', 'b'), 'svg'); // die Seite hat noch nicht neu gelesen
  await e.flush();
  expect(parsePage(fake.files[S].text).strokes.map((stroke) => stroke.id).sort()).toEqual(['a', 'b', 'r']);
  expect(fake.log.filter((line) => line.startsWith(`put ${S} `))).toEqual([`put ${S} s1`, `put ${S} s2`]); // 409, dann zusammengeführt
  expect(h.conflicts).toEqual([]);
});

test('a page that read the remote version after its delete was cancelled writes on top of it without a conflict', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: svgPage('a', 'r'), sha: 's2' };
  await e.remove(S);
  await e.flush();
  expect(await e.read(S)).toBe(svgPage('a', 'r')); // die Seite liest nach dem Hinweis neu
  await e.write(S, svgPage('a', 'r', 'b'), 'svg');
  await e.flush();
  expect(fake.log.filter((line) => line.startsWith(`put ${S} `))).toEqual([`put ${S} s2`]);
  expect(parsePage(fake.files[S].text).strokes.map((stroke) => stroke.id).sort()).toEqual(['a', 'b', 'r']);
});

test('a page written again while its delete is being cancelled keeps the new ink', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's1' };
  await e.read(S);
  fake.files[S] = { text: svgPage('a', 'r'), sha: 's2' }; // ein anderes Gerät hat weitergeschrieben
  await e.remove(S);
  const pause = fake.pause('get');
  const flushing = e.flush();
  await pause.reached; // das Löschen traf auf den fremden Stand, der Abgleich holt ihn gerade
  const again = svgPage('a', 'b');
  await e.write(S, again, 'svg'); // die Seite wird in diesem Moment wieder beschrieben
  pause.release();
  await flushing;
  expect(await h.store.get('outbox', S)).toMatchObject({ text: again, baseSha: 's1' });
  expect((await h.store.get('outbox', S))?.deleted).toBeFalsy();
  expect(await h.store.get('files', S)).toMatchObject({ text: again });
  expect(h.remoteChanges).toEqual([]);

  await e.flush(); // die neue Tinte geht mit der fremden zusammen hoch
  expect(parsePage(fake.files[S].text).strokes.map((stroke) => stroke.id).sort()).toEqual(['a', 'b', 'r']);
  expect(fake.count('delete')).toBe(1); // nur der eine Versuch, der am fremden Stand scheiterte
});

test('removing a page whose upload failed leaves nothing to delete, the upload is no longer under way', async () => {
  fake.offline = true;
  await e.write(S, svgPage('a'), 'svg');
  await e.flush(); // scheitert: Die Seite steht noch in der Warteschlange
  await e.remove(S);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(e.status.value.pending).toBe(0);
  fake.offline = false;
  await e.flush();
  expect(fake.log).toEqual([`put ${S} null`]); // nur der Versuch von eben, danach geht nichts mehr an GitHub
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

test('removing a file that was never read does not delete what this device never saw', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's7' };
  await e.remove(S);
  expect(await h.store.get('outbox', S)).toMatchObject({ deleted: true, baseSha: null });
  await e.flush();
  expect(fake.log).toEqual([`get ${S}`]); // angesehen, aber nicht gelöscht
  expect(fake.files[S]).toEqual({ text: svgPage('a'), sha: 's7' });
  expect(await h.store.get('files', S)).toMatchObject({ text: svgPage('a'), sha: 's7', base: svgPage('a') });
  expect(h.remoteChanges).toEqual([[S]]); // die Seite bekommt zu sehen, was sie löschen wollte
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('removing a file again while its delete is queued changes nothing', async () => {
  fake.files[S] = { text: svgPage('a'), sha: 's7' };
  await e.remove(S); // nie gelesen: Die Fassung auf GitHub ist unbekannt, das Löschen merkt sich nur die letzte lokale
  const queued = await h.store.get('outbox', S);
  await e.remove(S);
  expect(await h.store.get('outbox', S)).toEqual(queued);
  expect(e.status.value.pending).toBe(1);
  await e.flush();
  expect(fake.log).toEqual([`get ${S}`]); // ein Abgleich, ein Blick auf GitHub, nichts gelöscht (siehe oben)
});

test('removing a file that never existed on GitHub is done once GitHub confirms it is not there', async () => {
  await e.remove(S);
  await e.flush();
  expect(fake.log).toEqual([`get ${S}`]);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.errors).toEqual([]);
});

test('a page created without ever seeing the file is not deleted when someone else created it meanwhile', async () => {
  const theirs = svgPage('r');
  fake.files[S] = { text: theirs, sha: 's9' }; // ein anderes Gerät hat die Seite angelegt
  const pause = fake.pause('put');
  await e.write(S, svgPage('o'), 'svg'); // blind: Dieses Gerät hat die Datei nie gelesen
  const flushing = e.flush();
  await pause.reached;
  await e.remove(S); // während der erste Upload unterwegs ist
  pause.release();
  await flushing; // der Upload trifft auf die Datei des anderen Geräts
  expect(await h.store.get('outbox', S)).toMatchObject({ deleted: true, baseSha: null, text: svgPage('o') });

  await e.flush(); // und das Löschen darf diese Datei nicht mitnehmen
  expect(fake.files[S]).toEqual({ text: theirs, sha: 's9' });
  expect(fake.count('delete')).toBe(0);
  expect(await h.store.get('files', S)).toMatchObject({ text: theirs, sha: 's9', base: theirs });
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.remoteChanges).toEqual([[S]]);
  expect(e.status.value).toEqual({ state: 'gesichert', pending: 0 });
});

test('a page whose upload arrived but was never answered is still deleted, because the text on GitHub is ours', async () => {
  const hold = fake.hold('put');
  await e.write(S, svgPage('a'), 'svg');
  e.stop();
  const flushing = e.flush();
  await hold.reached; // GitHub hat die Seite angelegt, die Antwort fehlt
  const shaOnGitHub = fake.files[S].sha;
  await e.remove(S);
  e.stop(); // die Wartezeit des Löschens soll nicht dazwischenfunken
  await vi.advanceTimersByTimeAsync(30_000);
  await flushing;
  expect(e.status.value).toEqual({ state: 'wartet', pending: 1 });

  hold.release();
  await e.flush();
  expect(fake.files[S]).toBeUndefined();
  expect(fake.log).toContain(`delete ${S} ${shaOnGitHub}`);
  expect(await h.store.getAll('outbox')).toEqual([]);
  expect(h.remoteChanges).toEqual([]);
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
