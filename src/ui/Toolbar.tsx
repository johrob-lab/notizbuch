import type { ComponentChildren } from 'preact';
import { INK, WIDTH_MM, type InkColor, type WidthName } from '../ink/types';

export type Tool = 'pen' | 'eraser';

type Props = {
  tool: Tool;
  color: InkColor;
  width: WidthName;
  canUndo: boolean;
  canRedo: boolean;
  onTool(tool: Tool): void;
  onColor(color: InkColor): void;
  onWidth(width: WidthName): void;
  onUndo(): void;
  onRedo(): void;
  /**
   * Die ganze Seitenbreite auf den Bildschirm: der Weg zurück, wenn man sich hineingezoomt oder die Seite weggeschoben hat.
   * Wo es keine Werkzeugleiste gibt (Firmen-PC, Seite nicht lesbar oder nicht geladen), hat `PageView` einen eigenen Knopf dafür.
   */
  onFit(): void;
};

const COLORS: { id: InkColor; label: string }[] = [
  { id: 'schwarz', label: 'Schwarz' },
  { id: 'blau', label: 'Blau' },
  { id: 'rot', label: 'Rot (offen)' },
  { id: 'gruen', label: 'Grün (erledigt)' },
];

const WIDTHS: { id: WidthName; name: string; dot: number }[] = [
  { id: 'fein', name: 'Fein', dot: 3 },
  { id: 'mittel', name: 'Mittel', dot: 5 },
  { id: 'breit', name: 'Breit', dot: 8 },
];

const mm = (w: WidthName) => `${String(WIDTH_MM[w]).replace('.', ',')} mm`;

/** Symbole als Pfade, 24 x 24. */
export const ICONS = {
  pen: 'M4 20l1-4L16.5 4.5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19z M14 7l3 3',
  eraser: 'M14.6 4.6a2 2 0 0 1 2.8 0l2 2a2 2 0 0 1 0 2.8L11 17.8H7l-2.4-2.4a2 2 0 0 1 0-2.8z M9.5 9.7l5 5 M11 17.8h8.5',
  undo: 'M9 14L4 9l5-5 M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5 M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  // vier Ecken, die nach außen zeigen: die Seite im ganzen Bild
  fit: 'M4 9V5a1 1 0 0 1 1-1h4 M15 4h4a1 1 0 0 1 1 1v4 M20 15v4a1 1 0 0 1-1 1h-4 M9 20H5a1 1 0 0 1-1-1v-4',
};

export function Icon({ name }: { name: keyof typeof ICONS }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

function Group({ label, children }: { label: string; children: ComponentChildren }) {
  return (
    <div class="grp" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** Werkzeugleiste: Kugelschreiber und Radierer, vier Farben, drei Breiten, Rückgängig und Wiederholen, ganze Seite. */
export function Toolbar(p: Props) {
  return (
    <div class="werkzeuge" role="toolbar" aria-label="Werkzeuge">
      <Group label="Werkzeug">
        <button class="tb" type="button" aria-pressed={p.tool === 'pen'} aria-label="Kugelschreiber" title="Kugelschreiber" onClick={() => p.onTool('pen')}>
          <Icon name="pen" />
        </button>
        <button class="tb" type="button" aria-pressed={p.tool === 'eraser'} aria-label="Radierer" title="Radierer" onClick={() => p.onTool('eraser')}>
          <Icon name="eraser" />
        </button>
      </Group>
      <div class="sep" aria-hidden="true" />
      <Group label="Farbe">
        {COLORS.map((c) => (
          <button
            key={c.id}
            class="tb swatch"
            type="button"
            aria-pressed={p.color === c.id}
            aria-label={c.label}
            title={c.label}
            onClick={() => p.onColor(c.id)}
          >
            <span style={{ background: INK[c.id] }} />
          </button>
        ))}
      </Group>
      <div class="sep" aria-hidden="true" />
      <Group label="Breite">
        {WIDTHS.map((w) => (
          <button
            key={w.id}
            class="tb"
            type="button"
            aria-pressed={p.width === w.id}
            aria-label={`${w.name} (${mm(w.id)})`}
            title={`${w.name} (${mm(w.id)})`}
            onClick={() => p.onWidth(w.id)}
          >
            <span class="dot" style={{ width: `${w.dot}px`, height: `${w.dot}px` }} />
          </button>
        ))}
      </Group>
      <div class="sep" aria-hidden="true" />
      <Group label="Verlauf">
        <button class="tb" type="button" aria-label="Rückgängig" title="Rückgängig" disabled={!p.canUndo} onClick={p.onUndo}>
          <Icon name="undo" />
        </button>
        <button class="tb" type="button" aria-label="Wiederholen" title="Wiederholen" disabled={!p.canRedo} onClick={p.onRedo}>
          <Icon name="redo" />
        </button>
      </Group>
      <div class="sep" aria-hidden="true" />
      <Group label="Ansicht">
        <button class="tb" type="button" aria-label="Ganze Seite" title="Ganze Seite" onClick={p.onFit}>
          <Icon name="fit" />
        </button>
      </Group>
    </div>
  );
}
