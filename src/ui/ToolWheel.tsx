import { useRef, useState } from 'preact/hooks';
import type { GestureFilter } from '../ink/gestures';
import { QuickSwitch } from './QuickSwitch';
import type { Pt } from './ringLayout';
import type { ActionButton, ToolAction } from './toolActions';
import type { Tool } from './toolChoices';
import type { IconName } from './Toolbar';
import { ToolRing } from './ToolRing';

/** Gibt es kein Werkzeug zu wechseln, zeigt das Rad keines: drei Punkte, und es heißt nach dem, was der Ring dann bietet. */
const NEUTRAL: { icon: IconName; label: string } = { icon: 'menu', label: 'Blättern und Ansicht' };

type Props = {
  tool: Tool;
  partial: boolean;
  pos?: [number, number];
  filter: GestureFilter;
  /**
   * Ohne Schreiben (Firmen-PC, Seite nicht lesbar, Fenster liest nur) gibt es nichts zu wechseln: Auch der Stifttipp öffnet den Ring,
   * und das Rad zeigt drei Punkte und heißt „Blättern und Ansicht“.
   */
  canWrite: boolean;
  actions: { inner: ActionButton[]; outer: ActionButton[] };
  onToggle(): void;
  onMove(pos: [number, number]): void;
  onAction(a: ToolAction): void;
};

/**
 * Das Rad im Vollbild: der Schnellwechsel, der einen Ring aus Knöpfen um sich öffnet. Der Stift tippt und wechselt wie bisher, hält
 * er `HOLD_MS` lang, tippt ein Finger oder klickt die Maus, geht der Ring auf. Er liegt so, wie das Rad gerade auf der Bühne liegt.
 */
export function ToolWheel(p: Props) {
  // `display: contents`: Rad und Ring liegen für die Darstellung direkt auf der Bühne, die Hülle hilft nur, das Rad zu finden.
  const wrap = useRef<HTMLDivElement>(null);
  const [ring, setRing] = useState<{ anchor: Pt; area: { w: number; h: number } } | null>(null);

  const open = () => {
    const button = wrap.current?.querySelector<HTMLElement>('.schnellwechsel');
    const stage = button?.offsetParent;
    if (!button || !stage) return;
    const s = stage.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    setRing({ anchor: { x: b.left + b.width / 2 - s.left, y: b.top + b.height / 2 - s.top }, area: { w: s.width, h: s.height } });
  };

  return (
    <div class="rad" ref={wrap}>
      <QuickSwitch
        tool={p.tool}
        partial={p.partial}
        pos={p.pos}
        filter={p.filter}
        onToggle={p.canWrite ? p.onToggle : open}
        onMove={p.onMove}
        onOpen={open}
        face={p.canWrite ? undefined : NEUTRAL}
      />
      {ring && (
        <ToolRing anchor={ring.anchor} area={ring.area} actions={p.actions} filter={p.filter} onAction={p.onAction} onClose={() => setRing(null)} />
      )}
    </div>
  );
}
