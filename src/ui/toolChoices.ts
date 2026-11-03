import { WIDTH_MM, type InkColor, type WidthName } from '../ink/types';
import type { EraserMode, EraserSize } from '../lib/settings';

// Die Auswahllisten der Werkzeuge: Die Werkzeugleiste, das Rad und die Lasche zeigen dieselben Farben, Breiten und Größen.

export type Tool = 'pen' | 'eraser';

export const COLORS: { id: InkColor; label: string }[] = [
  { id: 'schwarz', label: 'Schwarz' },
  { id: 'blau', label: 'Blau' },
  { id: 'rot', label: 'Rot (offen)' },
  { id: 'gruen', label: 'Grün (erledigt)' },
];

export const WIDTHS: { id: WidthName; name: string; dot: number }[] = [
  { id: 'fein', name: 'Fein', dot: 3 },
  { id: 'mittel', name: 'Mittel', dot: 5 },
  { id: 'breit', name: 'Breit', dot: 8 },
];

export const ERASER_SIZES: { id: EraserSize; name: string; dot: number }[] = [
  { id: 'klein', name: 'Radierer klein', dot: 6 },
  { id: 'mittel', name: 'Radierer mittel', dot: 11 },
  { id: 'gross', name: 'Radierer groß', dot: 17 },
];

export const ERASER_MODES: { id: EraserMode; name: string }[] = [
  { id: 'strich', name: 'Ganzer Strich' },
  { id: 'stueck', name: 'Nur Stück' },
];

export const mm = (w: WidthName) => `${String(WIDTH_MM[w]).replace('.', ',')} mm`;
