import { serialQueue, type Enqueue } from './serialQueue';

// Eine Warteschlange je Notiz. Die Karte „Morgenbriefing“ und das Fenster „Frag Claude“ ändern dieselbe Tagesnotiz: Liefen ihre
// Vorgänge nebeneinander, gingen beide vom selben alten Text aus, und der spätere überschriebe den früheren. Darum laufen alle
// Vorgänge an einer Notiz durch dieselbe Warteschlange. Sie hängt an der Engine und am Pfad: Die App hat eine Engine, und Tests mit
// eigenen Engines warten nie aufeinander. Dazu die Meldung „diese Notiz wurde geschrieben“, damit die Karte neu liest.

const queues = new WeakMap<object, Map<string, Enqueue>>();
const listeners = new WeakMap<object, Set<(path: string) => void>>();

/** Die Warteschlange dieser Notiz bei dieser Engine. Dieselbe Engine und derselbe Pfad geben immer dieselbe zurück. */
export function noteQueue(engine: object, path: string): Enqueue {
  let byPath = queues.get(engine);
  if (!byPath) queues.set(engine, (byPath = new Map()));
  let queue = byPath.get(path);
  if (!queue) byPath.set(path, (queue = serialQueue()));
  return queue;
}

/** Sagt allen, die bei dieser Engine zuhören, dass die Notiz `path` geschrieben wurde. */
export function announceNoteWrite(engine: object, path: string): void {
  for (const listener of [...(listeners.get(engine) ?? [])]) listener(path);
}

/** Hört, wenn bei dieser Engine eine Notiz geschrieben wird. Gibt die Abmeldung zurück. */
export function onNoteWrite(engine: object, listener: (path: string) => void): () => void {
  let set = listeners.get(engine);
  if (!set) listeners.set(engine, (set = new Set()));
  set.add(listener);
  return () => void set.delete(listener);
}
