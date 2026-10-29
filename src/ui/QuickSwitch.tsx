import { useRef, useState } from 'preact/hooks';
import type { GestureFilter } from '../ink/gestures';
import { Icon, type Tool } from './Toolbar';

/** Durchmesser des Knopfs und Abstand zum Rand der Bühne, in Bildschirmpunkten. */
const SIZE = 56;
const INSET = 16;

type Props = {
  /** Das Werkzeug, das gerade gilt. Der Knopf zeigt sein Symbol. */
  tool: Tool;
  /** Ort des Knopfs als Anteil (0 bis 1) der Fläche, in der er liegen darf, von links und von oben. Ohne Angabe unten rechts. */
  pos?: [number, number];
  /**
   * Dasselbe Tor gegen Handballen wie das der Schreibfläche. Der Knopf liegt dort, wo beim Schreiben die Hand ruht:
   * Er nimmt keine Berührung an, solange der Stift aufliegt, und meldet dem Tor den Stift, der auf ihm aufsetzt.
   */
  filter: GestureFilter;
  onToggle(): void;
  onMove(pos: [number, number]): void;
};

type Drag = { id: number; kind: 'move' | 'tap'; grabX: number; grabY: number; area: DOMRect | undefined };

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/**
 * Runder Knopf, der zwischen Kugelschreiber und Radierer wechselt. Ein Tipp mit dem Stift wechselt, mit dem Finger
 * lässt er sich verschieben (ein Tipp mit dem Finger tut nichts, damit die Hand beim Schreiben ihn nicht auslöst).
 * Die Maus bleibt außen vor: Sie schreibt nicht, also wechselt sie auch kein Werkzeug.
 */
export function QuickSwitch({ tool, pos, filter, onToggle, onMove }: Props) {
  const drag = useRef<Drag | null>(null);
  const moving = useRef<[number, number] | null>(null);
  const [live, setLive] = useState<[number, number] | null>(null);
  const [fx, fy] = live ?? pos ?? [1, 1];
  const free = SIZE + 2 * INSET;

  /** Der Zug ist vorbei, ohne dass der Knopf an einen neuen Ort kommt: Er geht dahin zurück, wo er war. */
  function dropDrag() {
    drag.current = null;
    moving.current = null;
    setLive(null);
  }

  function down(e: PointerEvent) {
    let kind: Drag['kind'];
    if (e.pointerType === 'pen') {
      filter.penDown(e.timeStamp); // die Hand liegt jetzt auf dem Bildschirm, auch neben dem Knopf
      kind = 'tap';
    } else if (e.pointerType === 'touch' && filter.acceptTouch(e, e.timeStamp)) {
      kind = 'move';
    } else {
      return;
    }
    const button = e.currentTarget as HTMLElement;
    const box = button.getBoundingClientRect();
    drag.current = {
      id: e.pointerId,
      kind,
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      area: button.offsetParent?.getBoundingClientRect(),
    };
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // ein künstliches Ereignis hat keinen aktiven Zeiger
    }
  }

  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || d.kind !== 'move' || !d.area) return;
    // Setzt der Stift auf, während der Finger den Knopf zieht, war der Finger die Hand.
    if (!filter.acceptTouch(e, e.timeStamp)) return dropDrag();
    const next: [number, number] = [
      clamp01((e.clientX - d.grabX - d.area.left - INSET) / (d.area.width - free)),
      clamp01((e.clientY - d.grabY - d.area.top - INSET) / (d.area.height - free)),
    ];
    moving.current = next;
    setLive(next);
  }

  function up(e: PointerEvent) {
    if (e.pointerType === 'pen') filter.penUp(e.timeStamp);
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (d.kind === 'tap') {
      drag.current = null;
      if (e.type === 'pointerup') onToggle();
      return;
    }
    const done = moving.current;
    // Ein abgebrochener Zug (das System nimmt die Berührung weg) zählt nicht: Der Knopf bleibt, wo er war.
    if (done && e.type === 'pointerup') onMove(done);
    dropDrag();
  }

  return (
    <button
      type="button"
      class="schnellwechsel"
      data-testid="quick-switch"
      data-tool={tool}
      aria-label="Werkzeug wechseln"
      title="Mit dem Stift antippen: Kugelschreiber oder Radierer. Mit dem Finger verschieben."
      style={{
        left: `calc(${INSET}px + ${fx} * (100% - ${free}px))`,
        top: `calc(${INSET}px + ${fy} * (100% - ${free}px))`,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      // Tastatur (und Hilfen wie Sprachsteuerung) lösen einen Klick ohne Zeigerereignisse aus, `detail` ist dann 0.
      onClick={(e) => {
        if (e.detail === 0) onToggle();
      }}
    >
      <Icon name={tool === 'eraser' ? 'eraser' : 'pen'} />
    </button>
  );
}
