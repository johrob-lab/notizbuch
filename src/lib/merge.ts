import { diff3Merge, diffIndices } from 'node-diff3';

/** Der zusammengeführte Text, oder `ok: false`, wenn sich die beiden Fassungen nicht sicher vereinen lassen. */
export type MergeResult = { ok: true; text: string } | { ok: false };

/**
 * Längste Fassung (Zeilen im Sinne von `text.split('\n')`), die noch verglichen wird. Der Vergleich in
 * node-diff3 wird bei vielen gleichen Zeilen (Leerzeilen) überlinear langsam und hält dann die Seite an.
 * Größere Notizen gelten als Konflikt, der Abgleich legt dann eine Konfliktkopie an.
 */
const MAX_LINES = 3000;

/** `side` weicht von `base` nur durch Ersetzen ab: Jede Abweichung tauscht k Zeilen gegen k andere. */
function onlyReplaces(base: string[], side: string[]): boolean {
  return diffIndices(base, side).every((hunk) => hunk.buffer1[1] === hunk.buffer2[1]);
}

/**
 * Löst einen Bereich auf, den node-diff3 als Konflikt meldet. Das tut es schon, wenn die beiden Seiten nur
 * Nachbarzeilen ändern (Haken in der App, Markierung der Routine in der nächsten Zeile). Stelle für Stelle
 * lässt sich das nur entscheiden, wenn beide Seiten im Bereich reine Ersetzungen sind. Gleich viele Zeilen
 * reichen nicht: Fügt eine Seite eine Zeile ein und löscht dafür eine andere, rutschen ihre Zeilen auf andere
 * Stellen, und der Vergleich Stelle für Stelle würde eine Löschung der anderen Seite zurücknehmen. Bei reinen
 * Ersetzungen gewinnt die Seite, die eine Zeile geändert hat, haben beide sie gleich geändert, gilt sie
 * einmal. Ändern beide dieselbe Zeile verschieden, oder ist eine Seite keine reine Ersetzung, gibt es
 * `null`: Das muss ein Mensch entscheiden.
 */
function resolveLines(ours: string[], base: string[], theirs: string[]): string[] | null {
  // Ungleich viele Zeilen sind nie nur Ersetzungen. Die Prüfung erspart die beiden Vergleiche darunter.
  if (ours.length !== base.length || theirs.length !== base.length) return null;
  if (!onlyReplaces(base, ours) || !onlyReplaces(base, theirs)) return null;
  const lines: string[] = [];
  for (let i = 0; i < base.length; i++) {
    if (ours[i] === base[i]) lines.push(theirs[i]);
    else if (theirs[i] === base[i] || ours[i] === theirs[i]) lines.push(ours[i]);
    else return null;
  }
  return lines;
}

/**
 * Führt zwei Fassungen einer Notiz zusammen, die beide aus `base` entstanden sind: `ours` ist die Fassung der
 * App, `theirs` der neue Stand aus dem Vault. Verglichen wird zeilenweise, getrennt an `\n`. Ein `\r` bleibt am
 * Zeilenende stehen, Notizen mit Windows-Zeilenenden behalten es also.
 *
 * Änderungen an verschiedenen Stellen gelten beide, gleiche Änderungen einmal. Ersetzen beide Seiten Zeilen,
 * die direkt aneinander grenzen, gilt für jede Zeile die Änderung der Seite, die sie geändert hat. Alles andere,
 * was sich überschneidet oder berührt, scheitert mit `{ ok: false }`, statt eine Seite still zu verwerfen: dieselbe
 * Zeile verschieden geändert, eine Zeile gelöscht und geändert, an derselben Stelle verschieden eingefügt, eine
 * Einfügung oder Löschung direkt neben der Änderung der anderen Seite.
 *
 * Ohne Vergleich geht es nur, wenn eine Seite nichts geändert hat oder beide gleich sind. Hat sonst eine der
 * drei Fassungen mehr als `MAX_LINES` Zeilen, scheitert es ebenfalls.
 */
export function mergeText(base: string, ours: string, theirs: string): MergeResult {
  if (ours === base) return { ok: true, text: theirs };
  if (theirs === base || ours === theirs) return { ok: true, text: ours };

  const oursLines = ours.split('\n');
  const baseLines = base.split('\n');
  const theirsLines = theirs.split('\n');
  if (Math.max(oursLines.length, baseLines.length, theirsLines.length) > MAX_LINES) return { ok: false };

  // Zeilen-Arrays, nicht Texte: Einen String trennt node-diff3 an Leerraum. `excludeFalseConflicts` ist die
  // Voreinstellung und steht hier, weil das Ergebnis davon abhängt: Gleiche Änderungen beider Seiten an
  // derselben Stelle übernimmt node-diff3 einmal, sie sind kein Konflikt.
  const regions = diff3Merge(oursLines, baseLines, theirsLines, { excludeFalseConflicts: true });
  const merged: string[] = [];
  for (const { ok, conflict } of regions) {
    const lines = ok ?? (conflict ? resolveLines(conflict.a, conflict.o, conflict.b) : null);
    if (!lines) return { ok: false };
    merged.push(...lines);
  }
  return { ok: true, text: merged.join('\n') };
}
