import type { Stroke } from './types';

// Der Verlauf für Rückgängig und Wiederholen. Er rechnet nur mit der Liste der Striche einer Seite und kennt weder
// Zeichenfläche noch Ereignisse.

/** Ein Strich, der radiert wurde, und die Stelle, an der er in der Liste stand (nachdem seine Vorgänger schon draußen waren). */
export type Removed = { stroke: Stroke; index: number };
/** Was ein Schritt getan hat: einen Strich dazugetan oder Striche radiert (in der Reihenfolge, in der sie herauskamen). */
export type Action = { type: 'add'; stroke: Stroke } | { type: 'erase'; removed: Removed[] };

/** So viele Schritte lassen sich zurücknehmen. */
export const MAX_HISTORY = 300;

/**
 * Stellt radierte Striche wieder an ihre Plätze. Rückwärts, wie sie herauskamen: Jede Stelle galt für die Liste, wie sie
 * nach dem Vorgänger aussah.
 */
export function restore(strokes: Stroke[], removed: readonly Removed[]): void {
  for (let k = removed.length - 1; k >= 0; k--) strokes.splice(removed[k].index, 0, removed[k].stroke);
}

export class History {
  readonly #undo: Action[] = [];
  readonly #redo: Action[] = [];
  readonly #max: number;

  constructor(max = MAX_HISTORY) {
    this.#max = max;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  clear(): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
  }

  /** Ein neuer Schritt ist geschehen. Was sich wiederholen ließ, gilt nicht mehr, und der älteste Schritt fällt heraus, wenn es zu viele sind. */
  push(a: Action): void {
    this.#undo.push(a);
    if (this.#undo.length > this.#max) this.#undo.shift();
    this.#redo.length = 0;
  }

  /** Macht den letzten Schritt an `strokes` rückgängig (an Ort und Stelle). Wahr, wenn es einen gab. */
  undo(strokes: Stroke[]): boolean {
    const a = this.#undo.pop();
    if (!a) return false;
    if (a.type === 'add') {
      const i = strokes.lastIndexOf(a.stroke);
      if (i >= 0) strokes.splice(i, 1);
    } else {
      restore(strokes, a.removed);
    }
    this.#redo.push(a);
    return true;
  }

  /** Macht den zuletzt zurückgenommenen Schritt noch einmal. Wahr, wenn es einen gab. */
  redo(strokes: Stroke[]): boolean {
    const a = this.#redo.pop();
    if (!a) return false;
    if (a.type === 'add') strokes.push(a.stroke);
    else for (const r of a.removed) strokes.splice(r.index, 1);
    this.#undo.push(a);
    return true;
  }
}

