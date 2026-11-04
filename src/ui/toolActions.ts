import { PEN_CHOICES, PEN_NAMES, type PenKind } from '../ink/pens';
import type { InkColor, WidthName } from '../ink/types';
import type { EraserMode, EraserSize, InkPrefs } from '../lib/settings';
import { COLORS, ERASER_MODES, ERASER_SIZES, WIDTHS, mm, type Tool } from './toolChoices';

// Welche Knöpfe Rad und Lasche zeigen, als reine Daten: Innen die Wahl zum Werkzeug, außen alles andere.

export type ToolAction =
  | { kind: 'tool'; tool: Tool } | { kind: 'pen'; pen: PenKind } | { kind: 'color'; color: InkColor } | { kind: 'width'; width: WidthName }
  | { kind: 'eraserSize'; size: EraserSize } | { kind: 'eraserMode'; mode: EraserMode }
  | { kind: 'undo' } | { kind: 'redo' } | { kind: 'back' } | { kind: 'today' } | { kind: 'forward' } | { kind: 'fit' } | { kind: 'exit' };

export type ActionGroup = 'werkzeug' | 'farbe' | 'breite' | 'radiergroesse' | 'radierart' | 'verlauf' | 'blaettern' | 'ansicht';

export type ActionButton = {
  /** Eindeutig im ganzen Satz, `kind:wert`. */
  key: string;
  action: ToolAction;
  group: ActionGroup;
  label: string;
  pressed?: boolean;
  disabled?: boolean;
  /** Nach dem Tippen bleibt der Ring offen (Rückgängig und Wiederholen lassen sich mehrmals hintereinander tippen). */
  keepsOpen?: boolean;
};

type Options = {
  ink: InkPrefs;
  /** Nur mit dem Stift auf einer lesbaren Seite gibt es die Werkzeuge. */
  canWrite: boolean;
  canUndo: boolean;
  canRedo: boolean;
  canBack: boolean;
  canForward: boolean;
  /** Beschriftung von ‹ und › der Ansicht (`STEP_LABELS`). */
  stepLabels: [string, string];
};

export function toolActions(o: Options): { inner: ActionButton[]; outer: ActionButton[] } {
  const { ink } = o;
  const inner: ActionButton[] = [];
  const outer: ActionButton[] = [];

  if (o.canWrite) {
    if (ink.tool === 'eraser') {
      for (const z of ERASER_SIZES) {
        inner.push({ key: `eraserSize:${z.id}`, action: { kind: 'eraserSize', size: z.id }, group: 'radiergroesse', label: z.name, pressed: ink.eraserSize === z.id });
      }
      for (const m of ERASER_MODES) {
        inner.push({ key: `eraserMode:${m.id}`, action: { kind: 'eraserMode', mode: m.id }, group: 'radierart', label: m.name, pressed: ink.eraserMode === m.id });
      }
    } else {
      for (const c of COLORS) {
        inner.push({ key: `color:${c.id}`, action: { kind: 'color', color: c.id }, group: 'farbe', label: c.label, pressed: ink.color === c.id });
      }
      for (const w of WIDTHS) {
        inner.push({ key: `width:${w.id}`, action: { kind: 'width', width: w.id }, group: 'breite', label: `${w.name} (${mm(w.id)})`, pressed: ink.width === w.id });
      }
    }
    // Die Stifte in der Reihenfolge von `PEN_CHOICES`, dann der Radierer.
    for (const pen of PEN_CHOICES) {
      outer.push({ key: `pen:${pen}`, action: { kind: 'pen', pen }, group: 'werkzeug', label: PEN_NAMES[pen], pressed: ink.tool === 'pen' && ink.pen === pen });
    }
    outer.push(
      { key: 'tool:eraser', action: { kind: 'tool', tool: 'eraser' }, group: 'werkzeug', label: 'Radierer', pressed: ink.tool === 'eraser' },
      { key: 'undo', action: { kind: 'undo' }, group: 'verlauf', label: 'Rückgängig', disabled: !o.canUndo, keepsOpen: true },
      { key: 'redo', action: { kind: 'redo' }, group: 'verlauf', label: 'Wiederholen', disabled: !o.canRedo, keepsOpen: true },
    );
  }

  outer.push(
    { key: 'back', action: { kind: 'back' }, group: 'blaettern', label: o.stepLabels[0], disabled: !o.canBack },
    { key: 'today', action: { kind: 'today' }, group: 'blaettern', label: 'Heute' },
    { key: 'forward', action: { kind: 'forward' }, group: 'blaettern', label: o.stepLabels[1], disabled: !o.canForward },
    { key: 'fit', action: { kind: 'fit' }, group: 'ansicht', label: 'Ganze Seite' },
    { key: 'exit', action: { kind: 'exit' }, group: 'ansicht', label: 'Vollbild aus' },
  );
  return { inner, outer };
}
