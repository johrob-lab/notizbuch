import type { InkColor, SMOOTHING, WidthName } from '../ink/types';
import type { Store } from '../sync/store';
import type { Day } from './dates';

/** Größe des Radierers, siehe `ERASER_PX`. */
export type EraserSize = 'klein' | 'mittel' | 'gross';
/** Der Radierer nimmt ganze Striche weg (`strich`) oder nur das Stück, über das er fährt (`stueck`). */
export type EraserMode = 'strich' | 'stueck';

/** Die Wahl in der Werkzeugleiste. Sie gilt für alle Seiten und bleibt über einen Neustart erhalten. */
export type InkPrefs = {
  tool: 'pen' | 'eraser';
  color: InkColor;
  width: WidthName;
  eraserSize: EraserSize;
  eraserMode: EraserMode;
  /** Kritzeln über Geschriebenem löscht es. */
  scribble: boolean;
};

export const DEFAULT_INK: InkPrefs = { tool: 'pen', color: 'schwarz', width: 'mittel', eraserSize: 'mittel', eraserMode: 'strich', scribble: true };

/** Einstellungen dieses Geräts. Sie liegen nur in der IndexedDB des Geräts, der Token nirgends sonst. */
export type Settings = {
  token: string;
  repo: string;
  device: 'iPad' | 'Firmen-PC';
  smoothing: keyof typeof SMOOTHING;
  prediction: boolean;
  /** Ort des Schnellwechsel-Knopfs als Anteil (0 bis 1) der freien Fläche, von links und von oben. Ohne Angabe unten rechts. */
  quickSwitchPos?: [number, number];
  /** Ablaufdatum des Tokens. Der Browser kann es nicht aus der Antwort von GitHub lesen, darum fragt die Einrichtung danach. */
  tokenExpiry?: Day;
  /** Zeigt über der Seite, wie lange die App je Stiftbewegung braucht (Vergleich mit dem Stift-Test). Ohne Angabe aus. */
  messung?: boolean;
  /** Werkzeugwahl, siehe `InkPrefs`. Ohne Angabe `DEFAULT_INK`. */
  ink?: InkPrefs;
};

/** Unter diesem Schlüssel liegen die Einstellungen im Bereich `settings` der IndexedDB. */
export const SETTINGS_KEY = 'settings';

/** Die gespeicherten Einstellungen, oder `null`, wenn dieses Gerät noch nicht eingerichtet ist. */
export async function loadSettings(store: Store): Promise<Settings | null> {
  return (await store.get('settings', SETTINGS_KEY)) ?? null;
}

export async function saveSettings(store: Store, s: Settings): Promise<void> {
  await store.put('settings', s, SETTINGS_KEY);
}

/**
 * Ändert die gespeicherten Einstellungen in einem Zug. `change` bekommt den Stand aus dem Speicher (nicht den der Oberfläche)
 * und liefert den neuen: So geht keine Änderung verloren, die zwischendurch woanders gespeichert wurde (zum Beispiel der
 * Ort des Schnellwechsels, während die Glättung gewählt wird), auch bei mehreren Änderungen kurz hintereinander. `null`,
 * wenn dieses Gerät nicht eingerichtet ist: Dann wird nichts geschrieben. `change` darf nichts außerhalb verändern, es kann
 * zweimal laufen, wenn der Browser die Verbindung zur Datenbank währenddessen beendet.
 */
export async function updateSettings(store: Store, change: (now: Settings) => Settings): Promise<Settings | null> {
  return store.transact(['settings'], async (tx) => {
    const now = await tx.objectStore('settings').get(SETTINGS_KEY);
    if (!now) return null;
    const next = change(now);
    await tx.objectStore('settings').put(next, SETTINGS_KEY);
    return next;
  });
}
