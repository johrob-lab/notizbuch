import { expect, test, vi } from 'vitest';
import { announceNoteWrite, noteQueue, onNoteWrite } from '../../src/ui/noteQueue';

// Eine Warteschlange je Notiz und Engine, und die Meldung „diese Notiz wurde geschrieben“.

function held() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => (release = resolve));
  return { promise, release };
}

/** Startet eine Aufgabe, die anhält, bis der Test sie freigibt, und merkt sich, ob sie begonnen hat. */
function task(queue: ReturnType<typeof noteQueue>) {
  const hold = held();
  const state = { started: false };
  const done = queue(async () => {
    state.started = true;
    await hold.promise;
  });
  return { state, hold, done };
}

test('one note, one queue per engine', async () => {
  const e1 = {};
  const e2 = {};
  const a = task(noteQueue(e1, 'a.md'));
  const b = task(noteQueue(e1, 'a.md'));
  const otherEngine = task(noteQueue(e2, 'a.md'));
  const otherPath = task(noteQueue(e1, 'b.md'));
  await Promise.resolve();
  await Promise.resolve();
  expect(a.state.started).toBe(true);
  expect(b.state.started).toBe(false);
  expect(otherEngine.state.started).toBe(true);
  expect(otherPath.state.started).toBe(true);
  a.hold.release();
  await a.done;
  await vi.waitFor(() => expect(b.state.started).toBe(true));
  b.hold.release();
  otherEngine.hold.release();
  otherPath.hold.release();
  await Promise.all([b.done, otherEngine.done, otherPath.done]);
});

test('only the same engine hears a write', () => {
  const e1 = {};
  const e2 = {};
  const listener = vi.fn();
  const stop = onNoteWrite(e1, listener);
  announceNoteWrite(e1, 'a.md');
  expect(listener).toHaveBeenCalledWith('a.md');
  announceNoteWrite(e2, 'b.md');
  expect(listener).toHaveBeenCalledTimes(1);
  stop();
  announceNoteWrite(e1, 'c.md');
  expect(listener).toHaveBeenCalledTimes(1);
});
