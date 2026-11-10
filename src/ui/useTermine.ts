import { TERMINE_PATH } from '../lib/filenames';
import { parseTermine, type Termin } from '../lib/termine';
import type { SyncEngine } from '../sync/engine';
import { useVaultList } from './useVaultList';

/** Die Termine aus `Termine.md`, solange die Seite offen ist (siehe `useVaultList`). */
export const useTermine = (engine: SyncEngine): Termin[] => useVaultList(engine, TERMINE_PATH, parseTermine);
