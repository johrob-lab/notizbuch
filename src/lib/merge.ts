import { diff3Merge } from 'node-diff3';

/** Der zusammengeführte Text, oder `ok: false`, wenn sich die beiden Fassungen nicht sicher vereinen lassen. */
export type MergeResult = { ok: true; text: string } | { ok: false };

/**
 * Löst einen Bereich auf, den node-diff3 als Konflikt meldet. Das tut es schon, wenn die beiden Seiten nur
 * Nachbarzeilen ändern (Haken in der App, Markierung der Routine in der nächsten Zeile). Haben `ours`, `base`
 * und `theirs` im Bereich gleich viele Zeilen, hat jede Seite Zeilen nur ersetzt, und es wird Zeile für Zeile
 * entschieden: Die Seite, die eine Zeile geändert hat, gewinnt, haben beide sie gleich geändert, gilt sie
 * einmal. Ändern beide dieselbe Zeile verschieden oder ändert eine Seite die Zeilenzahl (einfügen oder
 * löschen direkt an der Änderung der anderen), gibt es `null`: Das muss ein Mensch entscheiden.
 */
function resolveLines(ours: string[], base: string[], theirs: string[]): string[] | null {
  if (ours.length !== base.length || theirs.length !== base.length) return null;
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
 */
export function mergeText(base: string, ours: string, theirs: string): MergeResult {
  if (ours === base) return { ok: true, text: theirs };
  if (theirs === base || ours === theirs) return { ok: true, text: ours };

  // Zeilen-Arrays, nicht Texte: Einen String trennt node-diff3 an Leerraum. `excludeFalseConflicts` ist die
  // Voreinstellung und steht hier, weil das Ergebnis davon abhängt: Gleiche Änderungen beider Seiten an
  // derselben Stelle übernimmt node-diff3 einmal, sie sind kein Konflikt.
  const regions = diff3Merge(ours.split('\n'), base.split('\n'), theirs.split('\n'), { excludeFalseConflicts: true });
  const merged: string[] = [];
  for (const { ok, conflict } of regions) {
    const lines = ok ?? (conflict ? resolveLines(conflict.a, conflict.o, conflict.b) : null);
    if (!lines) return { ok: false };
    merged.push(...lines);
  }
  return { ok: true, text: merged.join('\n') };
}
