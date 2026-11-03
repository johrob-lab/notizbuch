import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GestureFilter } from '../ink/gestures';
import { INK } from '../ink/types';
import { RING, ringLayout, type Pt } from './ringLayout';
import type { ActionButton, ToolAction } from './toolActions';
import { ERASER_SIZES, WIDTHS } from './toolChoices';
import { Icon } from './Toolbar';

// Der Ring des Rads im Vollbild: zwei Kreise aus Knöpfen um das Rad, darunter ein Schutzfeld über der ganzen Bühne. Was die Knöpfe
// tun, entscheidet die Seite (`onAction`), hier geht es nur darum, wer sie trifft: Stift, Maus, ein Finger, den das Tor gegen
// Handballen annimmt, und jeder Zeiger daneben, der den Ring schließt, ohne dass etwas darunter ihn bekommt.

type Props = {
  /** Die Mitte des Rads, in Punkten der Bühne (von ihrer linken oberen Ecke). */
  anchor: Pt;
  /** Die Größe der Bühne, als der Ring aufging. */
  area: { w: number; h: number };
  actions: { inner: ActionButton[]; outer: ActionButton[] };
  /** Dasselbe Tor gegen Handballen wie das der Schreibfläche und des Rads. */
  filter: GestureFilter;
  onAction(a: ToolAction): void;
  onClose(): void;
};

/** Vier Ecken, die nach innen zeigen: zurück aus dem Vollbild. 24 x 24 wie die Symbole der Werkzeugleiste. */
const EXIT = 'M9 4v4a1 1 0 0 1-1 1H4 M15 4v4a1 1 0 0 0 1 1h4 M20 15h-4a1 1 0 0 0-1 1v4 M4 15h4a1 1 0 0 1 1 1v4';

const capture = (el: Element, id: number) => {
  try {
    el.setPointerCapture(id);
  } catch {
    // ein künstliches Ereignis hat keinen aktiven Zeiger
  }
};

const inside = (e: PointerEvent, el: Element) => {
  const box = el.getBoundingClientRect();
  return e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
};

/** Was ein Knopf zeigt: Symbol, Farbe, Punkt oder ein kurzes Wort. Den ganzen Namen tragen `aria-label` und `title`. */
export function ActionFace({ action }: { action: ToolAction }) {
  switch (action.kind) {
    case 'tool':
      return <Icon name={action.tool === 'eraser' ? 'eraser' : 'pen'} />;
    case 'color':
      return <span class="farbe" style={{ background: INK[action.color] }} />;
    case 'width': {
      const dot = WIDTHS.find((w) => w.id === action.width)?.dot ?? 5;
      return <span class="dot" style={{ width: `${dot}px`, height: `${dot}px` }} />;
    }
    case 'eraserSize': {
      const dot = ERASER_SIZES.find((z) => z.id === action.size)?.dot ?? 11;
      return <span class="rand" style={{ width: `${dot}px`, height: `${dot}px` }} />;
    }
    case 'eraserMode':
      return <span class="wort">{action.mode === 'stueck' ? 'Stück' : 'Strich'}</span>;
    case 'undo':
    case 'redo':
    case 'fit':
      return <Icon name={action.kind} />;
    case 'back':
      return <span class="zeichen">‹</span>;
    case 'forward':
      return <span class="zeichen">›</span>;
    case 'today':
      return <span class="wort">Heute</span>;
    case 'exit':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={EXIT} />
        </svg>
      );
  }
}

/**
 * Der Ring: innen die Wahl zum Werkzeug, außen alles andere, an den Orten aus `ringLayout`. Ein Knopf wirkt beim Abheben (Stift, Maus,
 * ein Finger, den das Tor annimmt); danach schließt der Ring, außer bei Rückgängig und Wiederholen. Das Schutzfeld fängt jeden Zeiger
 * daneben: Stift, Maus oder Finger schließen den Ring (die Knöpfe gehen sofort, das Feld erst, wenn der Zeiger abhebt, damit auch sein
 * Ende nichts darunter trifft), die Hand schließt ihn nicht. Ändert sich die Größe der Bühne, schließt der Ring.
 */
export function ToolRing({ anchor, area, actions, filter, onAction, onClose }: Props) {
  const shield = useRef<HTMLDivElement>(null);
  // Die Ereignisse eines Zeigers kommen auch nach einem neuen Zeichnen an: Sie rufen immer die neuesten Angaben auf.
  const latest = useRef({ filter, onClose });
  latest.current = { filter, onClose };
  /** Welcher Zeiger auf welchem Knopf liegt (sein `key`). */
  const pressed = useRef(new Map<number, string>());
  /** Der Zeiger, der neben den Ring tippte, und wie man das Warten auf sein Abheben beendet. */
  const leaving = useRef<{ id: number; stop(): void } | null>(null);
  const [closing, setClosing] = useState(false);

  // Dreht sich das iPad oder ändert sich die Bühne sonst, passt der Ring nicht mehr zu ihr: Er schließt.
  useLayoutEffect(() => {
    const el = shield.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const box = entries[entries.length - 1]?.contentRect;
      if (box && (Math.abs(box.width - area.w) > 1 || Math.abs(box.height - area.h) > 1)) latest.current.onClose();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [area.w, area.h]);

  // Geht der Ring, während ein Zeiger daneben noch aufliegt (die Bühne ändert ihre Größe, die Seite wechselt), wartet nichts mehr auf ihn.
  useLayoutEffect(() => () => leaving.current?.stop(), []);

  const layout = ringLayout(anchor, { inner: actions.inner.length, outer: actions.outer.length }, area);

  function act(b: ActionButton) {
    onAction(b.action);
    if (!b.keepsOpen) onClose();
  }

  function press(e: PointerEvent, b: ActionButton) {
    if (e.pointerType === 'pen') filter.penDown(e.timeStamp);
    else if (e.pointerType === 'touch' ? !filter.acceptTouch(e, e.timeStamp) : e.button !== 0) return;
    if (b.disabled) return;
    pressed.current.set(e.pointerId, b.key);
    capture(e.currentTarget as Element, e.pointerId);
  }

  function release(e: PointerEvent, b: ActionButton) {
    if (e.pointerType === 'pen') filter.penUp(e.timeStamp);
    const key = pressed.current.get(e.pointerId);
    pressed.current.delete(e.pointerId);
    if (key !== b.key || e.type !== 'pointerup' || b.disabled) return;
    // Kam der Stift, während der Finger auf dem Knopf lag, war der Finger die Hand.
    if (e.pointerType === 'touch' && !filter.acceptTouch(e, e.timeStamp)) return;
    if (inside(e, e.currentTarget as Element)) act(b);
  }

  function shieldDown(e: PointerEvent) {
    if (e.target !== e.currentTarget) return; // ein Knopf
    e.preventDefault();
    if (e.pointerType === 'pen') filter.penDown(e.timeStamp);
    else if (e.pointerType === 'touch' && !filter.acceptTouch(e, e.timeStamp)) return; // die Hand neben dem Ring schließt ihn nicht
    if (leaving.current) return;
    capture(e.currentTarget as Element, e.pointerId);
    // Der Ring schließt, sobald dieser Zeiger abhebt, wo auch immer: Das Schutzfeld bleibt nie liegen.
    const id = e.pointerId;
    function stop() {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    }
    function end(ev: PointerEvent) {
      if (ev.pointerId !== id) return;
      stop();
      if (ev.pointerType === 'pen') latest.current.filter.penUp(ev.timeStamp);
      latest.current.onClose();
    }
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    leaving.current = { id, stop };
    setClosing(true);
  }

  function shieldUp(e: PointerEvent) {
    // Ein Stift, der woanders aufsetzte (ohne Zeigerfang), hebt hier ab: Das Tor hört es trotzdem.
    if (e.target === e.currentTarget && e.pointerType === 'pen') filter.penUp(e.timeStamp);
  }

  const button = (b: ActionButton, at: Pt) => (
    <button
      key={b.key}
      type="button"
      class="ring-knopf"
      aria-label={b.label}
      title={b.label}
      aria-pressed={b.pressed}
      disabled={b.disabled}
      style={{ left: `${at.x - RING.item / 2}px`, top: `${at.y - RING.item / 2}px`, width: `${RING.item}px`, height: `${RING.item}px` }}
      onPointerDown={(e) => press(e, b)}
      onPointerUp={(e) => release(e, b)}
      onPointerCancel={(e) => release(e, b)}
      // Tastatur (und Hilfen wie Sprachsteuerung) lösen einen Klick ohne Zeigerereignisse aus, `detail` ist dann 0.
      onClick={(e) => {
        if (e.detail === 0) act(b);
      }}
    >
      <ActionFace action={b.action} />
    </button>
  );

  return (
    <div
      ref={shield}
      class="ring-schutz"
      role="group"
      aria-label="Werkzeugrad"
      onPointerDown={shieldDown}
      onPointerUp={shieldUp}
      onPointerCancel={shieldUp}
      // Ohne das machte der Browser aus einer Berührung hier einen Klick auf das, was nach dem Schließen darunter liegt.
      onTouchStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onWheel={(e) => e.preventDefault()}
    >
      {!closing && (
        <>
          {actions.inner.map((b, i) => button(b, layout.inner[i]))}
          {actions.outer.map((b, i) => button(b, layout.outer[i]))}
        </>
      )}
    </div>
  );
}
