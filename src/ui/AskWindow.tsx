import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { GestureFilter, type TouchMark } from '../ink/gestures';
import type { KiModel } from '../lib/settings';
import type { SyncEngine } from '../sync/engine';
import type { AskPage } from './ask';
import { PALM_CLICK_MS, PALM_CLICK_RADIUS_PX } from './cardGestures';
import { useActivation, type Pressable } from './pointerBits';

// Das Fenster „Frag Claude“: eine Frage tippen oder diktieren, die offene Seite mitschicken, die Antwort lesen. Es gehört der App,
// nicht der Seite: Darum bleibt es offen, wenn man blättert, und nennt immer die Seite, die gerade offen ist (`page`). In den
// Einstellungen und in der Liste der Besprechungen ist es versteckt (`away`) und behält, was im Feld steht. Es liegt außerhalb der
// Bühne: Die Schreibfläche sieht nie, was auf ihm geschieht. Ein Stiftstrich darauf wird also nie Tinte, Finger und Rad bewegen
// die Seite nicht. Vor der Hand, die beim Schreiben aufliegt, schützt es dasselbe Tor wie die Seite (`watchHand`).

/** Was die App mit dem Fenster tun kann. */
export type AskControl = {
  /**
   * Öffnet das Fenster und setzt den Fokus ins Feld, beides sofort im selben Aufruf: Das iPad öffnet die Tastatur nur, solange der
   * Tipp auf den Knopf noch läuft.
   */
  open(): void;
};

type Props = {
  engine: SyncEngine;
  kiKey: string;
  model: KiModel;
  /** Die offene Seite, sobald sie gelesen ist und sich angemeldet hat. Sonst `null`. */
  page: AskPage | null;
  /** Einstellungen oder Liste der Besprechungen: Das Fenster ist versteckt und behält alles. */
  away: boolean;
  /** Hier legt das Fenster ab, wie die App es öffnet. */
  control: { current: AskControl | null };
};

/** Ein Knopf des Fensters und was er tut. */
type Knopf = Pressable & { run(): void };

/** Eine Berührung, die auf dem Fenster aufsetzte: wo sie ist, wie groß, welches Tor sie sah und dessen Stand, und ob es sie abwies. */
type Touching = { x: number; y: number; size: { width: number; height: number }; gate: GestureFilter; mark: TouchMark; palm: boolean };

/** Nimmt das Tor die Berührung jetzt nicht an, oder setzte der Stift auf, seit sie aufliegt? Dann ist sie die Hand. */
const isHand = (t: Touching, now: number): boolean => t.palm || !t.gate.acceptTouch(t.size, now) || t.gate.mark(now).pens !== t.mark.pens;

/**
 * Hält die Hand vom Fenster fern, die beim Schreiben aufliegt. Die Knöpfe fragen das Tor selbst (`useActivation`), hier geht es um
 * alles, was der Browser von sich aus tut, vor allem um das Feld: Er gäbe ihm den Fokus, und das iPad öffnete die Tastatur. Eine
 * Berührung ist die Hand, wenn das Tor sie beim Aufsetzen oder Abheben abweist oder wenn der Stift aufsetzte, während sie auflag.
 * Von ihr geht nichts durch: nicht ihr Anfang und ihr Ende (`touchstart`, `touchend`), und bis 1 s nach dem Abheben, bis 40 px
 * entfernt, auch nicht Maus und Klick, die der Browser daraus macht (wie bei den Karten, siehe `cardGestures.ts`). Der Stift auf dem
 * Fenster meldet sich beim Tor wie auf der Seite, und ab, wo auch immer er abhebt. Strg (oder Cmd) mit Rad zoomt nicht den Browser.
 * `gate` liefert das Tor, das gerade gilt. Gibt die Abmeldung zurück.
 */
function watchHand(el: HTMLElement, gate: () => GestureFilter): () => void {
  const touching = new Map<number, Touching>();
  /** Stifte, die auf dem Fenster aufsetzten, mit dem Tor, das davon weiß. */
  const pens = new Map<number, GestureFilter>();
  /** Nach dem Abheben der Hand: wo sie abhob und bis wann, was dort ankommt, von ihr stammt. */
  let lifted: { x: number; y: number; until: number } | null = null;

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'pen') {
      const now = gate();
      now.penDown(e.timeStamp);
      pens.set(e.pointerId, now);
    }
    if (e.pointerType !== 'touch') {
      lifted = null;
      return;
    }
    const now = gate();
    const t: Touching = { x: e.clientX, y: e.clientY, size: { width: e.width, height: e.height }, gate: now, mark: now.mark(e.timeStamp), palm: false };
    t.palm = isHand(t, e.timeStamp);
    if (!t.palm) lifted = null; // ein Finger: Was jetzt kommt, stammt von ihm
    touching.set(e.pointerId, t);
  }

  function onMove(e: PointerEvent): void {
    const t = touching.get(e.pointerId);
    if (!t) return;
    Object.assign(t, { x: e.clientX, y: e.clientY, size: { width: e.width, height: e.height } });
  }

  // Das Abheben hört das ganze Fenster der App: Auch wer neben dem Fenster abhebt, meldet sich ab.
  function onEnd(e: PointerEvent): void {
    const pen = pens.get(e.pointerId);
    if (pen) {
      pens.delete(e.pointerId);
      pen.penUp(e.timeStamp);
    }
    const t = touching.get(e.pointerId);
    if (!t) return;
    onMove(e);
    touching.delete(e.pointerId);
    if (e.type === 'pointerup' && isHand(t, e.timeStamp)) lifted = { x: t.x, y: t.y, until: e.timeStamp + PALM_CLICK_MS };
  }

  /** Stammt, was an diesem Ort ankommt, von der Hand? Sie liegt dort noch auf, oder sie hob dort eben ab. */
  function fromHand(x: number, y: number, now: number): boolean {
    const near = (p: { x: number; y: number }) => Math.hypot(x - p.x, y - p.y) <= PALM_CLICK_RADIUS_PX;
    if (lifted && now <= lifted.until && near(lifted)) return true;
    for (const t of touching.values()) if (near(t) && isHand(t, now)) return true;
    return false;
  }

  function onTouch(e: TouchEvent): void {
    if (e.cancelable && [...e.changedTouches].some((touch) => fromHand(touch.clientX, touch.clientY, e.timeStamp))) e.preventDefault();
  }

  // Aus dem Ende der Hand macht der Browser Maus und Klick: Sie treffen nichts, das Feld bekommt keinen Fokus.
  function onMouse(e: MouseEvent): void {
    if (!lifted) return;
    if (e.timeStamp > lifted.until) {
      lifted = null;
      return;
    }
    if (Math.hypot(e.clientX - lifted.x, e.clientY - lifted.y) > PALM_CLICK_RADIUS_PX) return;
    e.preventDefault();
    e.stopImmediatePropagation();
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
  el.addEventListener('mousedown', onMouse, true);
  el.addEventListener('click', onMouse, true);
  el.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    el.removeEventListener('pointerdown', onDown, true);
    el.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerup', onEnd, true);
    window.removeEventListener('pointercancel', onEnd, true);
    el.removeEventListener('touchstart', onTouch, true);
    el.removeEventListener('touchend', onTouch, true);
    el.removeEventListener('mousedown', onMouse, true);
    el.removeEventListener('click', onMouse, true);
    el.removeEventListener('wheel', onWheel);
    // Ein Stift, der noch auf dem Fenster aufliegt, während es geht, hielte das Tor sonst für immer zu.
    for (const pen of pens.values()) pen.penUp(performance.now());
    pens.clear();
  };
}

/**
 * Die Knöpfe wirken beim Abheben (`useActivation`), danach macht der Browser aus der Berührung noch Maustaste und Klick auf den Knopf.
 * Hat der Knopf den Fokus ins Feld gesetzt, nähme ihn diese Maustaste gleich wieder weg (am iPad ginge die Tastatur sofort zu). Darum
 * geht die nächste Maustaste ohne ihre Wirkung durch, bis ein neuer Zeiger aufsetzt, höchstens 1 s lang: Eine echte Maus setzt immer
 * zuerst als Zeiger auf. Gibt zurück, wie man das vorzeitig beendet.
 */
function keepFocusAfterTap(): () => void {
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

/**
 * Das Fenster: oben „Frag Claude“ und „Schließen“, darunter das Feld für die Frage, der Schalter „Seite mitschicken“ mit dem Namen der
 * offenen Seite, „Fragen“ und „Neue Frage“, die Zeile für Fehler und der Verlauf. Alle Knöpfe und der Schalter laufen über
 * `useActivation` mit dem Tor der offenen Seite, ohne Seite mit einem eigenen.
 */
export function AskWindow({ page, away, control }: Props) {
  const root = useRef<HTMLElement>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState('');
  const [withPage, setWithPage] = useState(true);
  // Ohne offene Seite gibt es auch keinen Stift auf ihr: Dann gilt ein eigenes Tor, das nur hört, was auf dem Fenster geschieht.
  const [ownGate] = useState(() => new GestureFilter());
  const gate = page?.filter ?? ownGate;
  // Was auf dem Fenster geschieht, fragt immer das Tor, das gerade gilt.
  const gateNow = useRef(gate);
  gateNow.current = gate;

  useLayoutEffect(() => {
    const el = root.current;
    if (!el) return;
    return watchHand(el, () => gateNow.current);
  }, []);

  // Den Fokus ins Feld, und er bleibt dort, auch wenn der Browser nach dem Tipp noch die Maustaste auf dem Knopf meldet.
  const keeping = useRef<(() => void) | null>(null);
  const focusField = () => {
    field.current?.focus();
    keeping.current?.();
    keeping.current = keepFocusAfterTap();
  };
  useLayoutEffect(() => () => keeping.current?.(), []);

  // Direkt am Element sichtbar, nicht erst nach dem nächsten Zeichnen: Ein verstecktes Feld nähme den Fokus nicht.
  useLayoutEffect(() => {
    const mine: AskControl = {
      open: () => {
        const el = root.current;
        if (el) el.hidden = false;
        focusField();
        setOpen(true);
      },
    };
    control.current = mine;
    return () => {
      if (control.current === mine) control.current = null;
    };
  }, [control]);

  /** Schließen leert alles: Das nächste Öffnen beginnt von vorn, mit der Seite. */
  const close = () => {
    field.current?.blur();
    setOpen(false);
    setQuestion('');
    setWithPage(true);
  };

  const press = useActivation(gate, (b: Knopf) => b.run());
  const empty = question.trim() === '';
  const pageName = page?.label ?? 'keine Seite offen';

  return (
    <section ref={root} class="frag-fenster" role="dialog" aria-labelledby="frag-titel" hidden={!open || away}>
      <div class="frag-kopf">
        <h2 id="frag-titel">Frag Claude</h2>
        <button type="button" class="knopf" {...press({ key: 'schliessen', run: close })}>
          Schließen
        </button>
      </div>
      <label for="frag-feld">Was willst du wissen?</label>
      <textarea id="frag-feld" ref={field} rows={3} value={question} onInput={(e) => setQuestion(e.currentTarget.value)} />
      <div class="frag-knoepfe">
        <button
          type="button"
          role="switch"
          class="frag-seite"
          aria-checked={withPage}
          aria-label={`Seite mitschicken: ${pageName}`}
          disabled={!page}
          {...press({ key: 'seite', disabled: !page, run: () => setWithPage((on) => !on) })}
        >
          <span class="frag-spur" />
          <span class="frag-schaltertext">
            Seite mitschicken
            <small>{pageName}</small>
          </span>
        </button>
        {/* Das Fragen selbst kommt im nächsten Schritt dazu: Bis dahin ist der Knopf da und tut nichts. */}
        <button type="button" class="knopf primaer" disabled={empty} {...press({ key: 'fragen', disabled: empty, run: () => undefined })}>
          Fragen
        </button>
        <button type="button" class="knopf" {...press({ key: 'neu', run: focusField })}>
          Neue Frage
        </button>
      </div>
      <p class="frag-fehler" role="alert" />
      <ol class="frag-verlauf" />
    </section>
  );
}
