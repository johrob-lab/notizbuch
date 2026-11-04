import { signal } from '@preact/signals';
import { PEN_CHOICES, type FuellerSettings } from '../ink/pens';
import { PALETTE, WIDTH_MM } from '../ink/types';
import { DEFAULT_INK, updateSettings, type InkPrefs, type Settings } from '../lib/settings';
import type { Store } from '../sync/store';

// Die Werkzeugwahl gehört nicht zu einer Seite, sondern zum Gerät: Wer radiert und zur nächsten Seite blättert, radiert
// dort weiter. Sie lebt darum hier als Signal, nicht im Zustand von `PageView` (der mit jeder Seite neu beginnt), und wird
// in den Einstellungen gespeichert.

/** So lange nach der letzten Wahl wird gespeichert. */
export const SAVE_DELAY_MS = 500;

export const inkPrefs = signal<InkPrefs>(DEFAULT_INK);

let savedTo: Store | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let pending: Store | null = null;
let listening = false;

const oneOf = <T>(value: unknown, allowed: readonly T[], fallback: T): T => (allowed.includes(value as T) ? (value as T) : fallback);

/** Ein Regler der Füllfeder: eine endliche Zahl, auf 0 bis 1 begrenzt und auf zwei Nachkommastellen gerundet, sonst `fallback`. */
const share = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.round(Math.min(1, Math.max(0, value)) * 100) / 100 : fallback;

/** Die gespeicherten Regler der Füllfeder, jeder fehlende oder kaputte Wert aus `DEFAULT_INK.fueller`. */
function fuellerOf(raw: unknown): FuellerSettings {
  const r: Partial<Record<keyof FuellerSettings, unknown>> = typeof raw === 'object' && raw !== null ? raw : {};
  const start = DEFAULT_INK.fueller;
  return {
    schaerfe: share(r.schaerfe, start.schaerfe),
    druck: share(r.druck, start.druck),
    rundung: share(r.rundung, start.rundung),
    stabil: share(r.stabil, start.stabil),
  };
}

/** Die gespeicherte Wahl, jedes fehlende oder unbekannte Feld aus `DEFAULT_INK`. */
function sanitize(raw: Partial<InkPrefs> | undefined): InkPrefs {
  const r = raw ?? {};
  return {
    tool: oneOf(r.tool, ['pen', 'eraser'] as const, DEFAULT_INK.tool),
    pen: oneOf(r.pen, PEN_CHOICES, DEFAULT_INK.pen),
    color: oneOf(r.color, PALETTE, DEFAULT_INK.color),
    width: oneOf(r.width, Object.keys(WIDTH_MM) as InkPrefs['width'][], DEFAULT_INK.width),
    eraserSize: oneOf(r.eraserSize, ['klein', 'mittel', 'gross'] as const, DEFAULT_INK.eraserSize),
    eraserMode: oneOf(r.eraserMode, ['strich', 'stueck'] as const, DEFAULT_INK.eraserMode),
    scribble: typeof r.scribble === 'boolean' ? r.scribble : DEFAULT_INK.scribble,
    fueller: fuellerOf(r.fueller),
  };
}

/** Speichert, was noch aussteht, sofort (beim Verlassen der App). */
export function flushInkPrefs(): Promise<void> {
  clearTimeout(timer);
  timer = undefined;
  const store = pending;
  pending = null;
  if (!store) return Promise.resolve();
  const ink = inkPrefs.value;
  return updateSettings(store, (now) => ({ ...now, ink })).then(
    () => undefined,
    () => undefined, // die Wahl gilt trotzdem auf dem Bildschirm, gespeichert wird beim nächsten Mal
  );
}

/** Übernimmt die gespeicherte Wahl beim Start. Mit `store` speichert `setInkPrefs` später dorthin. */
export function initInkPrefs(s: Settings | null, store?: Store): void {
  inkPrefs.value = sanitize(s?.ink);
  if (store) savedTo = store;
  if (!listening && typeof document !== 'undefined') {
    listening = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') void flushInkPrefs();
    });
  }
}

/** Ändert die Wahl: sofort auf dem Bildschirm, gespeichert 500 ms nach der letzten Änderung. */
export function setInkPrefs(change: Partial<InkPrefs>, store: Store | null = savedTo): void {
  inkPrefs.value = { ...inkPrefs.value, ...change };
  if (!store) return;
  pending = store;
  clearTimeout(timer);
  timer = setTimeout(() => void flushInkPrefs(), SAVE_DELAY_MS);
}
