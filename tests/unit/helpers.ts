import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Läuft nur in Tests (Node). Der erfundene Mini-Vault liegt in tests/fixtures/vault/.
// Nicht `new URL('…', import.meta.url)` schreiben: Vite macht daraus eine Asset-URL ohne file-Schema.
const VAULT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'vault');

/** Liest eine Datei aus dem erfundenen Mini-Vault, zum Beispiel `05 Daily Notes/2026-10-29.md`. */
export function fixture(path: string): string {
  return readFileSync(join(VAULT_DIR, path), 'utf8');
}

/** Index der ersten Zeile, die `text` enthält, oder -1. */
export function lineOf(md: string, text: string): number {
  return md.split('\n').findIndex((line) => line.includes(text));
}
