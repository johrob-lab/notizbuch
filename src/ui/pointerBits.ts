import { useRef } from 'preact/hooks';
import type { GestureFilter, TouchMark } from '../ink/gestures';

// Was Ring, Lasche und Rad gemeinsam brauchen: den Zeiger an einem Knopf festhalten, prüfen, ob er noch auf dem Knopf liegt,
// und die Regel, wer einen Knopf auslöst.

/** Hält den Zeiger am Element fest. Ein künstliches Ereignis hat keinen aktiven Zeiger, dann bleibt es beim Versuch. */
export function capturePointer(el: Element, id: number): void {
  try {
    el.setPointerCapture(id);
  } catch {
    // ein künstliches Ereignis hat keinen aktiven Zeiger
  }
}

type Box = { left: number; right: number; top: number; bottom: number };

/** Liegt der Zeiger noch auf dem Element (oder in dem Rechteck, das es beim Aufsetzen hatte)? */
export function inside(e: PointerEvent, target: Element | Box): boolean {
  const box = 'getBoundingClientRect' in target ? target.getBoundingClientRect() : target;
  return e.clientX >= box.left && e.clientX <= box.right && e.clientY >= box.top && e.clientY <= box.bottom;
}

export type Pressable = { key: string; disabled?: boolean };

/**
 * Wer einen Knopf auslöst, in Ring und Lasche gleich: Stift und Maus beim Abheben, ein Finger nur, wenn das Tor gegen Handballen ihn
 * beim Aufsetzen und beim Abheben annimmt, die Tastatur mit einem Klick ohne Zeigerereignisse (`detail` ist dann 0). Der Stift meldet
 * dem Tor sein Aufsetzen und Abheben. Gibt für jeden Knopf die Ereignisse zurück, die man ihm gibt.
 */
export function useActivation<B extends Pressable>(filter: GestureFilter, act: (b: B) => void) {
  /** Welcher Zeiger auf welchem Knopf liegt (sein `key`). */
  const pressed = useRef(new Map<number, { key: string; mark: TouchMark }>());

  function press(e: PointerEvent, b: B) {
    if (e.pointerType === 'pen') filter.penDown(e.timeStamp);
    else if (e.pointerType === 'touch' ? !filter.acceptTouch(e, e.timeStamp) : e.button !== 0) return;
    if (b.disabled) return;
    pressed.current.set(e.pointerId, { key: b.key, mark: filter.mark(e.timeStamp) });
    capturePointer(e.currentTarget as Element, e.pointerId);
  }

  function release(e: PointerEvent, b: B) {
    if (e.pointerType === 'pen') filter.penUp(e.timeStamp);
    const down = pressed.current.get(e.pointerId);
    pressed.current.delete(e.pointerId);
    if (down?.key !== b.key || e.type !== 'pointerup' || b.disabled) return;
    // Kam der Stift, während der Finger auf dem Knopf lag, war der Finger die Hand.
    // Ein Finger, der schon lag, als der Stift aufsetzte, oder der nur hält, war die Hand und tippt nichts.
    if (e.pointerType === 'touch' && (!filter.acceptTouch(e, e.timeStamp) || !filter.stillTap(down.mark, e.timeStamp))) return;
    if (inside(e, e.currentTarget as Element)) act(b);
  }

  return (b: B) => ({
    onPointerDown: (e: PointerEvent) => press(e, b),
    onPointerUp: (e: PointerEvent) => release(e, b),
    onPointerCancel: (e: PointerEvent) => release(e, b),
    onClick: (e: MouseEvent) => {
      if (e.detail === 0) act(b);
    },
  });
}
