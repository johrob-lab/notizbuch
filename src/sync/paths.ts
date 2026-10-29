/** Wofür ein Pfad gebraucht wird: lesen, schreiben (auch löschen) oder die Dateiliste eines Ordners holen. */
export type Mode = 'read' | 'write' | 'list';

export class PathNotAllowedError extends Error {
  constructor(path: string) {
    super(`Zugriff auf den Pfad nicht erlaubt: ${String(path)}`);
    this.name = 'PathNotAllowedError';
  }
}

// Die Pfadsperre ist die Sicherheitsgrenze der App: Was hier nicht ausdrücklich erlaubt ist, wird nie angefragt.
// Ordner stehen als Liste ihrer Pfadteile. Ein Pfad liegt in einem Ordner, wenn seine ersten Teile genau diese sind.
const WRITABLE_FOLDERS: readonly (readonly string[])[] = [['05 Daily Notes'], ['07 Anhänge', 'Notizbuch']];
const READ_ONLY_FOLDERS: readonly (readonly string[])[] = [['04 Ressourcen', 'Kalender']];
const READABLE_FOLDERS = [...WRITABLE_FOLDERS, ...READ_ONLY_FOLDERS];
// Von diesem Ordner gibt es nur die Dateiliste des Ordners selbst, nie den Inhalt einer Datei oder eines Unterordners.
const LIST_ONLY_FOLDERS: readonly (readonly string[])[] = [['02 Projekte']];

// Diese Wortteile dürfen in keinem Pfad vorkommen, egal ob groß oder klein geschrieben (Zugangsdaten, Schlüssel).
const BLOCKED_WORD_PARTS = ['recovery', 'passw', 'token', '.key'];

// Steuerzeichen (U+0000 bis U+001F und U+007F bis U+009F) und einzelne Surrogate. Letztere kann encodeURIComponent nicht kodieren.
const CONTROL_OR_BROKEN = /[\p{Cc}\p{Cs}]/u;

/** Der Pfad in der Schreibweise des Vaults: Umlaute als ein Zeichen (NFC), nicht als Buchstabe plus Trema. */
export function normalizePath(path: string): string {
  return path.normalize('NFC');
}

/** Wahr, wenn der Pfad einen gesperrten Wortteil enthält (Groß- und Kleinschreibung egal). */
export function hasBlockedWordPart(path: string): boolean {
  const lower = normalizePath(path).toLowerCase();
  return BLOCKED_WORD_PARTS.some((part) => lower.includes(part));
}

/** Wahr, wenn `segments` mit den Teilen von `folder` beginnt. Mit `strict` muss danach noch mindestens ein Teil folgen. */
function startsWithFolder(segments: string[], folder: readonly string[], strict: boolean): boolean {
  if (segments.length < folder.length + (strict ? 1 : 0)) return false;
  return folder.every((part, i) => segments[i] === part);
}

function isAllowed(path: unknown, mode: unknown): boolean {
  if (typeof path !== 'string') return false;
  const normalized = normalizePath(path);
  if (CONTROL_OR_BROKEN.test(normalized) || normalized.includes('\\')) return false;
  const segments = normalized.split('/');
  // Leere Teile fangen auch den leeren Pfad, einen Schrägstrich am Anfang oder Ende und `//` ab.
  if (segments.some((part) => part === '' || part === '.' || part === '..')) return false;
  if (hasBlockedWordPart(normalized)) return false;

  switch (mode) {
    case 'write':
      return WRITABLE_FOLDERS.some((folder) => startsWithFolder(segments, folder, true));
    case 'read':
      return READABLE_FOLDERS.some((folder) => startsWithFolder(segments, folder, true));
    case 'list':
      return (
        READABLE_FOLDERS.some((folder) => startsWithFolder(segments, folder, false)) ||
        LIST_ONLY_FOLDERS.some((folder) => segments.length === folder.length && startsWithFolder(segments, folder, false))
      );
    default:
      return false;
  }
}

/**
 * Wirft `PathNotAllowedError`, wenn der Pfad für diesen Zweck nicht erlaubt ist.
 * - `write` (auch zum Löschen): Dateien in `05 Daily Notes/` und `07 Anhänge/Notizbuch/` (auch in Unterordnern).
 * - `read`: dasselbe, dazu Dateien in `04 Ressourcen/Kalender/`.
 * - `list`: `02 Projekte` selbst und jeder Ordner, den `read` erlaubt.
 * Abgelehnt werden außerdem leere Pfade, `/` am Anfang, `\`, leere Teile (`//`), die Teile `.` und `..`, Steuerzeichen
 * und jeder Pfad mit einem gesperrten Wortteil. Geprüft wird die NFC-Form des Pfads, `normalizePath` liefert sie.
 */
export function assertAllowedPath(path: string, mode: Mode): void {
  if (!isAllowed(path, mode)) throw new PathNotAllowedError(path);
}
