// Eine Warteschlange, die Aufgaben nacheinander ausführt, in der Reihenfolge, in der sie kommen. Die Karte „Morgenbriefing“
// liest und schreibt dieselbe Datei: Zwei Vorgänge zugleich (ein Tipp auf einen Haken, während die Notiz neu gelesen wird)
// würden vom selben alten Text ausgehen, und der spätere überschriebe den früheren. Nacheinander geht jeder vom Ergebnis
// des vorigen aus.

export type Enqueue = <T>(task: () => Promise<T>) => Promise<T>;

/**
 * Eine neue Warteschlange. `run(task)` startet `task`, sobald alles davor zu Ende ist (gleich ob es gelang), und gibt dessen
 * Ergebnis zurück. Scheitert eine Aufgabe, scheitert nur ihr eigenes Ergebnis, die nächste läuft trotzdem. Zwei
 * Warteschlangen warten nie aufeinander.
 */
export function serialQueue(): Enqueue {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };
}
