import { GEBURTSTAGE_PATH } from '../lib/filenames';
import { parseGeburtstage, type Geburtstag } from '../lib/geburtstage';
import type { SyncEngine } from '../sync/engine';
import { useVaultList } from './useVaultList';

/** Die Geburtstage und Jahrestage aus `Geburtstage.md`, solange die Seite offen ist (siehe `useVaultList`). */
export const useGeburtstage = (engine: SyncEngine): Geburtstag[] => useVaultList(engine, GEBURTSTAGE_PATH, parseGeburtstage);
