import { mergePages } from '../ink/svg';
import { conflictPath } from '../lib/filenames';
import { mergeText } from '../lib/merge';

// Die reinen Teile der Konfliktbehandlung: Sie kennen weder Speicher noch GitHub und lassen sich einzeln prüfen.

/**
 * Führt unsere Fassung mit der fremden zusammen. `baseText` ist der gemeinsame Ausgangspunkt, nötig, um zu sehen, wer was
 * geändert hat: bei Text, welche Zeilen, bei einer Seite, welche Kopfdaten und welche Striche (ein radierter Strich kommt
 * nicht zurück). Ohne ihn werden bei einer Seite die Striche vereint, und bei den Kopfdaten gilt, was `theirs` angibt
 * (siehe `mergePages`). Das Ergebnis ist der zusammengeführte Text,
 * oder `null`, wenn sich beide Fassungen nicht sicher vereinen lassen: Text, der an derselben Stelle verschieden
 * geändert wurde, oder eine Seite, die nicht lesbar ist.
 */
export function mergeByKind(kind: 'md' | 'svg', baseText: string | null, ours: string, theirs: string): string | null {
  if (ours === theirs) return theirs;
  if (kind === 'md') {
    const result = mergeText(baseText ?? '', ours, theirs);
    return result.ok ? result.text : null;
  }
  try {
    return mergePages(ours, theirs, baseText ?? undefined);
  } catch {
    return null; // eine der beiden Seiten ist nicht lesbar
  }
}

const COPY_MARKER = ' (Konflikt)';

/** Name der n-ten Konfliktkopie: `(Konflikt)` für n = 1, dann `(Konflikt 2)`, `(Konflikt 3)` und so weiter. */
export function copyPathFor(path: string, n: number): string {
  const first = conflictPath(path);
  if (n === 1) return first;
  const at = first.lastIndexOf(COPY_MARKER);
  return `${first.slice(0, at)} (Konflikt ${n})${first.slice(at + COPY_MARKER.length)}`;
}
