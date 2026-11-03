import type { GestureFilter } from '../ink/gestures';
import type { InkColor, WidthName } from '../ink/types';
import { todayVienna } from '../lib/dates';
import type { EraserMode, EraserSize } from '../lib/settings';
import { inkPrefs, setInkPrefs } from './inkPrefs';
import type { PageProps } from './PageView';
import { routeHash } from './router';
import { toolActions, type ActionButton, type ToolAction } from './toolActions';
import type { Tool } from './toolChoices';

// Die Verdrahtung der Werkzeuge: was Werkzeugleiste, Rad, Lasche und Schnellwechsel gemeinsam tun. Reine Funktion ohne Hooks;
// `PageView` ruft sie bei jedem Rendern auf. Den Effekt, der die Wahl an die Schreibfläche gibt, behält `PageView`.

export type InkToolsOptions = {
  surface: { current: { undo(): void; redo(): void; zoomToFit(): void } | null };
  canWrite: boolean;
  full: boolean;
  canUndo: boolean;
  canRedo: boolean;
  nav?: PageProps['nav'];
  onVollbildAus?: () => void;
  quickSwitchPos?: [number, number];
  onQuickSwitchMove?: (pos: [number, number]) => void;
  filter: GestureFilter;
};

export type Choose = { tool(t: Tool): void; color(c: InkColor): void; width(w: WidthName): void; eraserSize(s: EraserSize): void; eraserMode(m: EraserMode): void };

/** Rad, Lasche und der einfache Schnellwechsel haben dieselben Angaben. */
export type QuickProps = { tool: Tool; partial: boolean; pos?: [number, number]; filter: GestureFilter; onToggle(): void; onMove(pos: [number, number]): void };

export type InkTools = { choose: Choose; runAction(a: ToolAction): void; actions: { inner: ActionButton[]; outer: ActionButton[] } | null; quick: QuickProps };

export function inkTools(o: InkToolsOptions): InkTools {
  const { tool, eraserMode } = inkPrefs.value;

  const chooseTool = (t: Tool) => setInkPrefs({ tool: t });
  // Wer Farbe oder Breite wählt, will schreiben: Der Kugelschreiber ist dann wieder das Werkzeug. Ebenso Größe oder Art: der Radierer.
  const chooseColor = (c: InkColor) => setInkPrefs({ color: c, tool: 'pen' });
  const chooseWidth = (w: WidthName) => {
    setInkPrefs({ width: w, tool: 'pen' });
  };
  const chooseEraserSize = (size: EraserSize) => setInkPrefs({ eraserSize: size, tool: 'eraser' });
  const chooseEraserMode = (mode: EraserMode) => setInkPrefs({ eraserMode: mode, tool: 'eraser' });

  /** Ein Knopf des Rads: dieselben Wege wie Werkzeugleiste, Leiste oben und Ersatzknopf. */
  const runAction = (a: ToolAction): void => {
    switch (a.kind) {
      case 'tool':
        return chooseTool(a.tool);
      case 'color':
        return chooseColor(a.color);
      case 'width':
        return chooseWidth(a.width);
      case 'eraserSize':
        return chooseEraserSize(a.size);
      case 'eraserMode':
        return chooseEraserMode(a.mode);
      case 'undo':
        return o.surface.current?.undo();
      case 'redo':
        return o.surface.current?.redo();
      case 'back':
      case 'forward': {
        const to = o.nav?.[a.kind];
        if (to) window.location.hash = routeHash(to);
        return;
      }
      case 'today':
        // Wer die App über Nacht offen lässt, soll im neuen Tag landen: Der Tag wird beim Tippen berechnet.
        window.location.hash = routeHash({ view: 'tag', key: todayVienna() });
        return;
      case 'fit':
        return o.surface.current?.zoomToFit();
      case 'exit':
        return o.onVollbildAus?.();
    }
  };

  // Rad und Lasche zeigen dieselben Knöpfe.
  const actions = o.full
    ? toolActions({
        ink: inkPrefs.value,
        canWrite: o.canWrite,
        canUndo: o.canUndo,
        canRedo: o.canRedo,
        canBack: o.nav?.canBack ?? false,
        canForward: o.nav?.canForward ?? false,
        stepLabels: o.nav?.labels ?? ['Zurück', 'Weiter'],
      })
    : null;

  const quick: QuickProps = {
    tool,
    partial: eraserMode === 'stueck',
    pos: o.quickSwitchPos,
    filter: o.filter,
    onToggle: () => chooseTool(tool === 'pen' ? 'eraser' : 'pen'),
    onMove: o.onQuickSwitchMove ?? (() => {}),
  };

  return { choose: { tool: chooseTool, color: chooseColor, width: chooseWidth, eraserSize: chooseEraserSize, eraserMode: chooseEraserMode }, runAction, actions, quick };
}
