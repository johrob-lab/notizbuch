import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { TAP_SLOP_PX, type GestureFilter } from '../ink/gestures';
import { Icon } from './Toolbar';
import type { Tool } from './toolChoices';

/** Durchmesser des Knopfs und Abstand zum Rand der Bühne, in Bildschirmpunkten. */
const SIZE = 56;
const INSET = 16;
/** So lange liegt der Stift auf dem Knopf, bis sich statt eines Wechsels die Werkzeuge öffnen (nur mit `onOpen`). */
export const HOLD_MS = 400;

type Props = {
  /** Das Werkzeug, das gerade gilt. Der Knopf zeigt sein Symbol. */
  tool: Tool;
  /** Radiert der Radierer nur das Stück? Dann hat der Knopf einen gestrichelten Rand. */
  partial?: boolean;
  /** Ort des Knopfs als Anteil (0 bis 1) der Fläche, in der er liegen darf, von links und von oben. Ohne Angabe unten rechts. */
  pos?: [number, number];
  /**
   * Dasselbe Tor gegen Handballen wie das der Schreibfläche. Der Knopf liegt dort, wo beim Schreiben die Hand ruht:
   * Er nimmt keine Berührung an, solange der Stift aufliegt, und meldet dem Tor den Stift, der auf ihm aufsetzt.
   */
  filter: GestureFilter;
  onToggle(): void;
  onMove(pos: [number, number]): void;
  /**
   * Öffnet die Werkzeuge rund um den Knopf (das Rad im Vollbild). Dann öffnet sie der Stift, der `HOLD_MS` auf dem Knopf liegt
   * (beim Abheben wechselt er nichts), ein Fingertipp, ein Mausklick und die Tastatur. Ohne diese Angabe tun Fingertipp und Maus
   * nichts, und die Tastatur wechselt.
   */
  onOpen?(): void;
};

type Drag = {
  id: number;
  /** `tap`: der Stift. `move`: ein Finger, er verschiebt den Knopf. `click`: die Maus, nur mit `onOpen`. */
  kind: 'move' | 'tap' | 'click';
  grabX: number;
  grabY: number;
  area: DOMRect | undefined;
  /** Der Knopf und der Ort des Zeigers beim Aufsetzen. */
  box: DOMRect;
  x: number;
  y: number;
  /** Der Zeiger ist einmal `TAP_SLOP_PX` oder weiter gekommen: Er tippt nicht, er zieht. */
  far: boolean;
  /** Der Stift hat die Werkzeuge geöffnet oder den Knopf verlassen: Beim Abheben wechselt er nichts. */
  spent: boolean;
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const inside = (e: PointerEvent, box: DOMRect) => e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;

/**
 * Runder Knopf, der zwischen Kugelschreiber und Radierer wechselt. Ein Tipp mit dem Stift wechselt, mit dem Finger
 * lässt er sich verschieben (ein Tipp mit dem Finger tut nichts, damit die Hand beim Schreiben ihn nicht auslöst).
 * Die Maus bleibt außen vor: Sie schreibt nicht, also wechselt sie auch kein Werkzeug. Mit `onOpen` (das Rad im Vollbild)
 * öffnen der gehaltene Stift, ein Fingertipp, ein Mausklick und die Tastatur die Werkzeuge; Fingertipps gehen durch dasselbe Tor.
 */
export function QuickSwitch({ tool, partial, pos, filter, onToggle, onMove, onOpen }: Props) {
  const drag = useRef<Drag | null>(null);
  const moving = useRef<[number, number] | null>(null);
  const hold = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  // Das Halten endet erst nach dem Zeichnen: Es öffnet mit dem neuesten `onOpen`.
  const open = useRef(onOpen);
  open.current = onOpen;
  const [live, setLive] = useState<[number, number] | null>(null);
  const [fx, fy] = live ?? pos ?? [1, 1];
  const free = SIZE + 2 * INSET;

  // Geht der Knopf, solange der Stift hält (Seitenwechsel), öffnet nichts mehr. Gleich beim Einhängen, nicht erst nach dem Zeichnen.
  useLayoutEffect(() => () => clearTimeout(hold.current), []);

  function stopHold() {
    clearTimeout(hold.current);
    hold.current = undefined;
  }

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
    } else if (e.pointerType === 'mouse' && onOpen && e.button === 0) {
      kind = 'click';
    } else {
      return;
    }
    const button = e.currentTarget as HTMLElement;
    const box = button.getBoundingClientRect();
    stopHold();
    drag.current = {
      id: e.pointerId,
      kind,
      grabX: e.clientX - box.left,
      grabY: e.clientY - box.top,
      area: button.offsetParent?.getBoundingClientRect(),
      box,
      x: e.clientX,
      y: e.clientY,
      far: false,
      spent: false,
    };
    try {
      button.setPointerCapture(e.pointerId);
    } catch {
      // ein künstliches Ereignis hat keinen aktiven Zeiger
    }
    if (kind === 'tap' && onOpen) {
      const id = e.pointerId;
      hold.current = setTimeout(() => {
        hold.current = undefined;
        const d = drag.current;
        if (!d || d.id !== id || d.kind !== 'tap' || d.spent) return;
        d.spent = true;
        open.current?.();
      }, HOLD_MS);
    }
  }

  function move(e: PointerEvent) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= TAP_SLOP_PX) d.far = true;
    if (d.kind === 'tap') {
      // Der Stift hält, solange er auf dem Knopf bleibt, ein wenig Zittern eingeschlossen. Verlässt er ihn, ist das Halten vorbei.
      if (onOpen && !d.spent && !inside(e, d.box)) {
        d.spent = true;
        stopHold();
      }
      return;
    }
    if (d.kind !== 'move' || !d.area) return;
    // Setzt der Stift auf, während der Finger den Knopf zieht, war der Finger die Hand.
    if (!filter.acceptTouch(e, e.timeStamp)) return dropDrag();
    // Mit `onOpen` kann ein Finger, der noch nicht weit gekommen ist, ein Tipp sein: Bis dahin bleibt der Knopf, wo er ist.
    if (onOpen && !d.far) return;
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
    // Ein abgebrochener Zeiger (das System nimmt ihn weg) wechselt nichts, öffnet nichts und verschiebt nichts.
    const lifted = e.type === 'pointerup';
    if (d.kind === 'tap') {
      stopHold();
      drag.current = null;
      if (lifted && !d.spent) onToggle();
      return;
    }
    if (d.kind === 'click') {
      drag.current = null;
      if (lifted && !d.far) onOpen?.();
      return;
    }
    if (onOpen && !d.far) {
      // Ein Fingertipp öffnet die Werkzeuge, wenn das Tor ihn auch beim Abheben für einen Finger hält: Kam inzwischen der Stift, war er die Hand.
      dropDrag();
      if (lifted && filter.acceptTouch(e, e.timeStamp)) onOpen();
      return;
    }
    const done = moving.current;
    // Ein abgebrochener Zug zählt nicht: Der Knopf bleibt, wo er war.
    if (done && lifted) onMove(done);
    dropDrag();
  }

  return (
    <button
      type="button"
      class="schnellwechsel"
      data-testid="quick-switch"
      data-tool={tool}
      data-modus={tool === 'eraser' && partial ? 'stueck' : undefined}
      aria-label="Werkzeug wechseln"
      title={
        onOpen
          ? 'Mit dem Stift antippen: Kugelschreiber oder Radierer. Stift halten oder mit dem Finger antippen: alle Werkzeuge. Mit dem Finger verschieben.'
          : 'Mit dem Stift antippen: Kugelschreiber oder Radierer. Mit dem Finger verschieben.'
      }
      style={{
        left: `calc(${INSET}px + ${fx} * (100% - ${free}px))`,
        top: `calc(${INSET}px + ${fy} * (100% - ${free}px))`,
      }}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      // Tastatur (und Hilfen wie Sprachsteuerung) lösen einen Klick ohne Zeigerereignisse aus, `detail` ist dann 0. Mit `onOpen`
      // öffnet er wie ein Mausklick die Werkzeuge: Dort gibt es auch Kugelschreiber und Radierer und den Weg aus dem Vollbild.
      onClick={(e) => {
        if (e.detail === 0) (onOpen ?? onToggle)();
      }}
    >
      <Icon name={tool === 'eraser' ? 'eraser' : 'pen'} />
    </button>
  );
}
