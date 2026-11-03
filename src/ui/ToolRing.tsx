import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { GestureFilter } from '../ink/gestures';
import { INK } from '../ink/types';
import { RING, ringLayout, type Pt } from './ringLayout';
import type { ActionButton, ToolAction } from './toolActions';
import { ERASER_SIZES, WIDTHS } from './toolChoices';
import { capturePointer, useActivation } from './pointerBits';
import { Icon, PEN_ICON } from './Toolbar';

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

/** Was ein Knopf zeigt: Symbol, Farbe, Punkt oder ein kurzes Wort. Den ganzen Namen tragen `aria-label` und `title`. */
export function ActionFace({ action }: { action: ToolAction }) {
  switch (action.kind) {
    case 'tool':
      return <Icon name={action.tool === 'eraser' ? 'eraser' : 'pen'} />;
    case 'pen':
      return <Icon name={PEN_ICON[action.pen]} />;
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

/** Wartet auf das Abheben (oder den Abbruch) des Zeigers `id`, wo auch immer es ankommt. Gibt zurück, wie man das Warten beendet. */
function untilLifted(id: number, then: (ev: PointerEvent) => void): () => void {
  function stop() {
    window.removeEventListener('pointerup', end, true);
    window.removeEventListener('pointercancel', end, true);
  }
  function end(ev: PointerEvent) {
    if (ev.pointerId !== id) return;
    stop();
    then(ev);
  }
  window.addEventListener('pointerup', end, true);
  window.addEventListener('pointercancel', end, true);
  return stop;
}

/**
 * Der Ring: innen die Wahl zum Werkzeug, außen alles andere, an den Orten aus `ringLayout`. Ein Knopf wirkt beim Abheben (Stift, Maus,
 * ein Finger, den das Tor annimmt); danach schließt der Ring, außer bei Rückgängig und Wiederholen. Das Schutzfeld fängt jeden Zeiger
 * daneben, nichts darunter bekommt ihn. Stift und Maus schließen den Ring sofort (die Knöpfe gehen gleich, das Feld erst, wenn der
 * Zeiger abhebt, damit auch sein Ende nichts darunter trifft). Ein Finger schließt ihn erst beim Abheben und nur, wenn das Tor ihn dann
 * noch annimmt und er noch tippt (`acceptTouch` und `stillTap`): Die Hand, die neben dem Ring landet, bevor der Stift einen Knopf
 * erreicht, schließt ihn nicht. Ändert sich die Größe der Bühne, geht die Seite in den Hintergrund oder verliert das Fenster den Fokus,
 * schließt der Ring. Er gilt für ein Öffnen: Nach `onClose` baut ihn der Elternteil ab (`ToolWheel`), zurückgesetzt wird nichts.
 */
export function ToolRing({ anchor, area, actions, filter, onAction, onClose }: Props) {
  const shield = useRef<HTMLDivElement>(null);
  // Die Ereignisse eines Zeigers kommen auch nach einem neuen Zeichnen an: Sie rufen immer die neuesten Angaben auf.
  const latest = useRef({ filter, onClose });
  latest.current = { filter, onClose };
  /** Der Stift oder die Maus, die neben den Ring tippten und ihn schließen, und wie man das Warten auf ihr Abheben beendet. */
  const leaving = useRef<{ id: number; stop(): void } | null>(null);
  /** Finger auf dem Schutzfeld, die den Ring beim Abheben schließen, wenn sie dann noch tippen: wie man das Warten beendet. */
  const fingers = useRef(new Map<number, () => void>());
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

  // Geht die Seite in den Hintergrund (Wechsel der App) oder verliert das Fenster den Fokus, schließt der Ring. Danach kommt oft das
  // Abheben eines Zeigers nicht mehr an, auf das er sonst wartete.
  useLayoutEffect(() => {
    const close = () => latest.current.onClose();
    const hidden = () => {
      if (document.visibilityState === 'hidden') close();
    };
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('blur', close);
    return () => {
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('blur', close);
    };
  }, []);

  // Geht der Ring, während ein Zeiger daneben noch aufliegt (die Bühne ändert ihre Größe, die Seite wechselt, der Stift wählt einen
  // Knopf, während die Hand daneben liegt), wartet nichts mehr auf ihn.
  useLayoutEffect(
    () => () => {
      leaving.current?.stop();
      for (const stop of fingers.current.values()) stop();
      fingers.current.clear();
    },
    [],
  );

  // „Heute“ liegt genau unter der Mitte: Dann liest man unten ‹ Heute › von links nach rechts, mit Schreiben wie ohne.
  const today = actions.outer.findIndex((b) => b.action.kind === 'today');
  const layout = ringLayout(anchor, { inner: actions.inner.length, outer: actions.outer.length }, area, today >= 0 ? today : undefined);

  const activation = useActivation(filter, (b: ActionButton) => {
    onAction(b.action);
    if (!b.keepsOpen) onClose();
  });

  function shieldDown(e: PointerEvent) {
    if (e.target !== e.currentTarget) return; // ein Knopf
    e.preventDefault();
    if (e.pointerType === 'pen') filter.penDown(e.timeStamp);
    else if (e.pointerType === 'touch' && !filter.acceptTouch(e, e.timeStamp)) return; // die Hand neben dem Ring schließt ihn nicht
    const id = e.pointerId;
    if (leaving.current) {
      // Der Ring schließt schon. Kommt das Abheben des Zeigers, der ihn schließt, nie an (iOS beim Wechsel der App), bliebe das
      // Schutzfeld ohne Knöpfe liegen: Ein anderer Zeiger schließt ihn darum sofort.
      if (id !== leaving.current.id) latest.current.onClose();
      return;
    }
    capturePointer(e.currentTarget as Element, id);
    if (e.pointerType === 'touch') {
      // Ein Finger kann auch die Hand sein, die neben dem Ring landet, bevor der Stift einen Knopf erreicht: Die Knöpfe bleiben. Beim
      // Abheben schließt er den Ring, wenn er ein Tipp war. Kam inzwischen der Stift oder lag er länger, bleibt der Ring offen.
      const mark = filter.mark(e.timeStamp);
      fingers.current.get(id)?.(); // ein früherer Finger mit derselben Kennung, dessen Abheben nie ankam
      fingers.current.set(
        id,
        untilLifted(id, (ev) => {
          fingers.current.delete(id);
          const gate = latest.current.filter;
          if (ev.type === 'pointerup' && gate.acceptTouch(ev, ev.timeStamp) && gate.stillTap(mark, ev.timeStamp)) latest.current.onClose();
        }),
      );
      return;
    }
    // Stift und Maus schließen den Ring, sobald sie abheben, wo auch immer: Das Schutzfeld bleibt nie liegen.
    const stop = untilLifted(id, (ev) => {
      if (ev.pointerType === 'pen') latest.current.filter.penUp(ev.timeStamp);
      latest.current.onClose();
    });
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
      {...activation(b)}
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
