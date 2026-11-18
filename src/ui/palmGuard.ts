import type { GestureFilter, TouchMark } from '../ink/gestures';

// Was nach einer Berührung gilt, für alles, was neben der Schreibfläche selbst Zeiger annimmt: die Karten der Tagesseite
// (`cardGestures.ts`) und das Fenster „Frag Claude“ (`AskWindow.tsx`). Ob eine Berührung ein Finger ist oder die Hand, die beim
// Schreiben aufliegt, entscheidet das Tor gegen Handballen (`GestureFilter`). Hier steht, was danach kommt, für beide gleich: Was der
// Browser aus dem Tipp der Hand macht (Maustaste, Klick), trifft nichts (`palmClicks`), und ein Stift meldet dem Tor sein Abheben,
// wo auch immer es ankommt (`watchPens`). Dazu der Schutz des Fensters (`watchHand`) und die Maustaste nach dem Tipp, der den Fokus
// ins Feld des Fensters gesetzt hat (`keepFocusAfterTap`).

/** So lange nach dem Abheben der Hand wird verworfen, was der Browser daraus macht. */
const PALM_CLICK_MS = 1000;
/** So nah am Ort, wo die Hand abhob, liegt, was daraus entstand. Ein Klick der Tastatur hat gar keinen Ort. */
const PALM_CLICK_RADIUS_PX = 40;

/** Was der Browser aus dem Tipp der Hand macht, trifft nichts. */
export type PalmClicks = {
  /** Die Hand hob bei `x`, `y` (Bildschirmpunkte) zur Zeit `t` ab: Bis 1 s danach und bis 40 px entfernt stammt, was kommt, von ihr. */
  arm(x: number, y: number, t: number): void;
  /** Ein anderer Zeiger setzt auf: Was jetzt kommt, stammt von ihm. */
  disarm(): void;
  /** Stammt, was zur Zeit `t` bei `x`, `y` ankommt, von der Hand, die zuletzt abhob? */
  near(x: number, y: number, t: number): boolean;
  /** Für `click` und `mousedown`: Stammt das Ereignis von der Hand, hat es keine Wirkung und erreicht niemanden mehr. */
  swallow(e: MouseEvent): void;
};

export function palmClicks(): PalmClicks {
  /** Wo die Hand abhob und bis wann, was dort ankommt, von ihr stammt. */
  let lifted: { x: number; y: number; until: number } | null = null;
  const there = (x: number, y: number): boolean => lifted !== null && Math.hypot(x - lifted.x, y - lifted.y) <= PALM_CLICK_RADIUS_PX;
  return {
    arm: (x, y, t) => {
      lifted = { x, y, until: t + PALM_CLICK_MS };
    },
    disarm: () => {
      lifted = null;
    },
    near: (x, y, t) => lifted !== null && t <= lifted.until && there(x, y),
    swallow: (e) => {
      if (!lifted) return;
      if (e.timeStamp > lifted.until) {
        lifted = null;
        return;
      }
      if (!there(e.clientX, e.clientY)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
    },
  };
}

/** Stifte, die auf etwas aufsetzten, das selbst Zeiger annimmt: Ihr Tor hört ihr Aufsetzen und ihr Abheben. */
export type PenWatch = {
  /** Der Stift `id` setzt zur Zeit `t` auf. Das Tor `filter` hört es, und später sein Abheben. */
  down(id: number, filter: GestureFilter, t: number): void;
  /** Hört auf. Ein Stift, der noch aufliegt, hebt für sein Tor jetzt ab: Sonst bliebe es für immer zu und jeder Finger abgewiesen. */
  stop(): void;
};

/**
 * Das Abheben eines Stifts kommt nicht immer dort an, wo er aufsetzte: Hebt er über der Leiste oben oder den Reitern ab, hören es Karte
 * und Fenster nicht. Das Fenster des Browsers hört alles, und das Tor wird auf jeden Fall wieder geöffnet.
 */
export function watchPens(): PenWatch {
  const pens = new Map<number, GestureFilter>();
  function onEnd(e: PointerEvent): void {
    const filter = pens.get(e.pointerId);
    if (!filter) return;
    pens.delete(e.pointerId);
    filter.penUp(e.timeStamp);
  }
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  return {
    down(id, filter, t) {
      filter.penDown(t);
      pens.set(id, filter);
    },
    stop() {
      window.removeEventListener('pointerup', onEnd, true);
      window.removeEventListener('pointercancel', onEnd, true);
      for (const filter of pens.values()) filter.penUp(performance.now());
      pens.clear();
    },
  };
}

// ---------- Das Fenster „Frag Claude“ ----------

/** Eine Berührung, die auf dem Fenster aufsetzte: wo sie ist, wie groß, welches Tor sie sah und dessen Stand, und ob es sie abwies. */
type Touching = { x: number; y: number; size: { width: number; height: number }; gate: GestureFilter; mark: TouchMark; palm: boolean };

/** Nimmt das Tor die Berührung jetzt nicht an, oder setzte der Stift auf, seit sie aufliegt? Dann ist sie die Hand. */
const isHand = (t: Touching, now: number): boolean => t.palm || !t.gate.acceptTouch(t.size, now) || t.gate.mark(now).pens !== t.mark.pens;

/**
 * Hält die Hand vom Fenster fern, die beim Schreiben aufliegt. Die Knöpfe fragen das Tor selbst (`useActivation`), hier geht es um
 * alles, was der Browser von sich aus tut, vor allem um das Feld: Er gäbe ihm den Fokus, und das iPad öffnete die Tastatur. Eine
 * Berührung ist die Hand, wenn das Tor sie beim Aufsetzen oder Abheben abweist oder wenn der Stift aufsetzte, während sie auflag.
 * Von ihr geht nichts durch: nicht ihr Anfang und ihr Ende (`touchstart`, `touchend`), und nach dem Abheben auch nicht Maustaste und
 * Klick, die der Browser daraus macht (`palmClicks`, wie bei den Karten). Der Stift auf dem Fenster meldet sich beim Tor wie auf der
 * Seite, und ab, wo auch immer er abhebt (`watchPens`). Strg (oder Cmd) mit Rad zoomt nicht den Browser. `gate` liefert das Tor, das
 * gerade gilt. Gibt die Abmeldung zurück.
 */
export function watchHand(el: HTMLElement, gate: () => GestureFilter): () => void {
  const touching = new Map<number, Touching>();
  const clicks = palmClicks();
  const pens = watchPens();

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'pen') pens.down(e.pointerId, gate(), e.timeStamp);
    if (e.pointerType !== 'touch') {
      clicks.disarm();
      return;
    }
    const now = gate();
    const t: Touching = { x: e.clientX, y: e.clientY, size: { width: e.width, height: e.height }, gate: now, mark: now.mark(e.timeStamp), palm: false };
    t.palm = isHand(t, e.timeStamp);
    if (!t.palm) clicks.disarm(); // ein Finger: Was jetzt kommt, stammt von ihm
    touching.set(e.pointerId, t);
  }

  function onMove(e: PointerEvent): void {
    const t = touching.get(e.pointerId);
    if (!t) return;
    Object.assign(t, { x: e.clientX, y: e.clientY, size: { width: e.width, height: e.height } });
  }

  // Das Abheben hört das ganze Fenster der App: Auch eine Berührung, die neben dem Fenster endet, ist damit vorbei.
  function onEnd(e: PointerEvent): void {
    const t = touching.get(e.pointerId);
    if (!t) return;
    onMove(e);
    touching.delete(e.pointerId);
    if (e.type === 'pointerup' && isHand(t, e.timeStamp)) clicks.arm(e.clientX, e.clientY, e.timeStamp);
  }

  /** Stammt, was an diesem Ort ankommt, von der Hand? Sie hob dort eben ab, oder sie liegt dort noch auf. */
  function fromHand(x: number, y: number, now: number): boolean {
    if (clicks.near(x, y, now)) return true;
    for (const t of touching.values()) if (Math.hypot(x - t.x, y - t.y) <= PALM_CLICK_RADIUS_PX && isHand(t, now)) return true;
    return false;
  }

  function onTouch(e: TouchEvent): void {
    if (e.cancelable && [...e.changedTouches].some((touch) => fromHand(touch.clientX, touch.clientY, e.timeStamp))) e.preventDefault();
  }

  function onWheel(e: WheelEvent): void {
    if (e.ctrlKey || e.metaKey) e.preventDefault();
  }

  el.addEventListener('pointerdown', onDown, true);
  el.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerup', onEnd, true);
  window.addEventListener('pointercancel', onEnd, true);
  el.addEventListener('touchstart', onTouch, { capture: true, passive: false });
  el.addEventListener('touchend', onTouch, { capture: true, passive: false });
  el.addEventListener('mousedown', clicks.swallow, true);
  el.addEventListener('click', clicks.swallow, true);
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', onDown, true);
    el.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    el.removeEventListener('touchstart', onTouch, true);
    el.removeEventListener('touchend', onTouch, true);
    el.removeEventListener('mousedown', clicks.swallow, true);
    el.removeEventListener('click', clicks.swallow, true);
    el.removeEventListener('wheel', onWheel);
    pens.stop(); // ein Stift, der noch auf dem Fenster aufliegt, während es geht, hielte das Tor sonst für immer zu
  };
}

/**
 * Die Knöpfe wirken beim Abheben (`useActivation`), danach macht der Browser aus der Berührung noch Maustaste und Klick auf den Knopf.
 * Hat der Knopf den Fokus ins Feld gesetzt, nähme ihn diese Maustaste gleich wieder weg (am iPad ginge die Tastatur sofort zu). Darum
 * geht die nächste Maustaste ohne ihre Wirkung durch, bis ein neuer Zeiger aufsetzt, höchstens 1 s lang: Eine echte Maus setzt immer
 * zuerst als Zeiger auf. Gibt zurück, wie man das vorzeitig beendet.
 */
export function keepFocusAfterTap(): () => void {
  const stop = () => {
    window.removeEventListener('mousedown', swallow, true);
    window.removeEventListener('pointerdown', stop, true);
    clearTimeout(timer);
  };
  const swallow = (e: MouseEvent) => {
    e.preventDefault();
    stop();
  };
  const timer = setTimeout(stop, PALM_CLICK_MS);
  window.addEventListener('mousedown', swallow, true);
  window.addEventListener('pointerdown', stop, true);
  return stop;
}
