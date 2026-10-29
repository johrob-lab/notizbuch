import type { SMOOTHING } from '../ink/types';
import type { Store } from '../sync/store';
import type { Day } from './dates';

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
};

const KEY = 'settings';

/** Die gespeicherten Einstellungen, oder `null`, wenn dieses Gerät noch nicht eingerichtet ist. */
export async function loadSettings(store: Store): Promise<Settings | null> {
  return (await store.get('settings', KEY)) ?? null;
}

export async function saveSettings(store: Store, s: Settings): Promise<void> {
  await store.put('settings', s, KEY);
}
