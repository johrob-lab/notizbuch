import { TAP_SLOP_PX, type GestureFilter } from '../ink/gestures';
import { palmClicks, watchPens } from './palmGuard';

// Die Karten der Tagesseite liegen über der Schreibfläche und fangen jede Berührung ab, die auf ihnen beginnt: Die Fläche darunter
// sieht sie nie. Damit die Seite trotzdem mit Fingern und Rad zu bedienen ist, wo immer sie beginnen, entscheidet dieses Modul,
// was von den Karten an die Seite geht. Es ist die Verbindung zwischen Karten und Fläche, `PageView` hängt sie nur ein.
//
// Finger: Ein Finger auf einer Karte gehört der Karte, solange er tippt. Zieht er seitwärts, zieht er senkrecht, wo die Karte
// nichts zu blättern hat, oder kommt ein zweiter Finger dazu (auf die Karte oder aufs Papier), gehört er der Seite: Sie
// verschiebt und zoomt, ein Zwei-Finger-Tipp macht rückgängig. Nur senkrechtes Ziehen in einer Liste, die in diese Richtung noch
// blättern kann, bleibt bei der Karte. Die Übergabe geht über `PageHand.adopt`: Die Fläche übernimmt den echten Zeiger (mit
// Zeigerfang) und bekommt seine Ereignisse von da an selbst, es werden keine Ereignisse nachgebaut.
//
// Handballen: Die Karten nehmen Stift und Finger an, die Fläche darunter schützt sich mit einem Tor (`GestureFilter`), solange
// der Stift aufliegt, kurz danach und bei großen Auflageflächen. Dasselbe Tor gilt hier für das, was ein Finger auf einer Karte
// auslöst: Ein Handballen neben dem Stift hakt nichts ab und öffnet nichts. Das gilt auch für einen Finger, der schon auf der
// Karte lag, als der Stift aufsetzte: Er war die Hand, sein Tipp zählt nicht, wann immer er abhebt. Der Stift auf einer Karte
// meldet sich beim Tor wie auf der Fläche, und er meldet sich auch ab, wenn er woanders abhebt (über der Leiste oben): Sonst
// bliebe das Tor zu und jeder Finger abgewiesen, bis der nächste Strich es öffnet. Diese Regeln für den Klick aus dem Tipp eines
// Handballens und für das Abheben des Stifts stehen in `palmGuard.ts`: Das Fenster „Frag Claude“ hält es genauso.
//
// Rad: Strg (oder Cmd) mit Rad zoomt, sonst wandert die Seite. Ohne das zoomte der Browser die ganze Oberfläche. Nur wo die
// Karte selbst noch in diese Richtung scrollen kann, scrollt sie.
//
// Die große Karte (das Morgenbriefing in der Großansicht, `.karte.gross`) deckt die Seite ganz ab. Ein Finger oder ein Rad, das auf
// ihr beginnt, geht nie an die Seite: Sie würde sich unsichtbar bewegen. Was die Karte selbst blättern kann, blättert sie weiter.
// Für Stift und Handballen gilt dort dasselbe wie auf jeder Karte.

/** Wo und wann ein Finger aufgesetzt hat. */
export type Origin = { clientX: number; clientY: number; timeStamp: number };

/** Was die Karten von der Schreibfläche brauchen (`InkSurface` hat es). */
export type PageHand = {
  /** Liegt gerade ein Finger auf der Fläche? Dann gehört jeder weitere zur selben Geste. */
  readonly fingersDown: boolean;
  /** Übergibt der Seite einen Finger, der auf einer Karte aufgesetzt hat. `false`, wenn die Fläche ihn nicht annimmt. */
  adopt(e: PointerEvent, from: Origin): boolean;
};

export type CardLayer = {
  /** Die Bühne, in der Schreibfläche und Karten liegen. */
  stage: HTMLElement;
  /** Das Element der Schreibfläche: Dort sitzt das Papier, und dorthin gehen die Räder der Karten. */
  host: HTMLElement;
  /** Der Rahmen um die Karten. */
  frame: HTMLElement;
  /** Die Schreibfläche, sobald es sie gibt. */
  surface(): PageHand | null;
  /** Dasselbe Tor gegen Handballen wie das der Schreibfläche. */
  filter: GestureFilter;
};

/**
 * `offen`: Der Finger tippt noch, die Karte hat ihn. `seite`: Die Seite hat ihn. `karte`: Die Karte blättert mit ihm.
 * `ignoriert`: Er ist weder Finger der Seite noch der Karte (Handballen, die Fläche hat ihn nicht angenommen, der Stift kam).
 */
type Owner = 'offen' | 'seite' | 'karte' | 'ignoriert';
/** `big`: Der Finger hat auf der großen Karte aufgesetzt. */
type Track = { origin: Origin; last: PointerEvent; target: EventTarget | null; owner: Owner; big: boolean };

/** Liegt das Ziel in der großen Karte? */
const onBigCard = (target: EventTarget | null): boolean => target instanceof Element && target.closest('.karte.gross') !== null;

/** Kann etwas zwischen `from` und `stop` (der Rahmen der Karten) in dieser Richtung noch scrollen? Dann gehört das Rad ihm. */
export function scrollsFurther(from: EventTarget | null, stop: Element, deltaY: number): boolean {
  if (deltaY === 0) return false;
  for (let el = from instanceof Element ? from : null; el && el !== stop; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      if (deltaY > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
  }
  return false;
}

/** Hängt die Karten an die Seite. Gibt die Abmeldung zurück. */
export function watchCards(o: CardLayer): () => void {
  const { stage, host, frame, filter } = o;
  const tracks = new Map<number, Track>();
  /** Berührungen auf Karten, die das Tor als Handballen abgewiesen hat. */
  const palms = new Set<number>();
  /** Stifte, die auf einer Karte aufsetzten: Das Tor hört ihr Abheben, wo auch immer es ankommt. */
  const pens = watchPens();
  /** Aus dem Tipp eines Handballens macht der Browser einen Klick. Er trifft nichts, der Handballen soll nichts auslösen. */
  const clicks = palmClicks();

  const onCard = (target: EventTarget | null): boolean => target instanceof Node && frame.contains(target);
  const onPaper = (target: EventTarget | null): boolean => target instanceof Node && host.contains(target);

  function handOver(track: Track): void {
    // Ein Finger der großen Karte bleibt bei ihr, was immer er tut.
    if (track.big) {
      track.owner = 'karte';
      return;
    }
    track.owner = o.surface()?.adopt(track.last, track.origin) ? 'seite' : 'ignoriert';
  }

  /** Jeder Finger auf einer Karte, der noch tippt, geht an die Seite, in der Reihenfolge, in der die Finger aufgesetzt haben. */
  function handOverAll(): void {
    for (const track of tracks.values()) if (track.owner === 'offen') handOver(track);
  }

  function onDown(e: PointerEvent): void {
    if (e.pointerType === 'pen') {
      // Die Hand liegt auf: Was schon vorher auf dem Bildschirm lag, war sie. Die Fläche macht dasselbe mit ihren Fingern. Hebt
      // so ein Finger ab, ist sein Tipp der eines Handballens: Der Klick, den der Browser daraus macht, wird verworfen.
      for (const [id, track] of tracks) {
        if (track.owner !== 'offen') continue;
        track.owner = 'ignoriert';
        palms.add(id);
      }
      if (onCard(e.target)) pens.down(e.pointerId, filter, e.timeStamp);
      clicks.disarm();
      return;
    }
    if (e.pointerType !== 'touch') {
      clicks.disarm();
      return;
    }
    const card = onCard(e.target);
    if (!card && !onPaper(e.target)) return;
    if (!filter.acceptTouch(e, e.timeStamp)) {
      if (card) palms.add(e.pointerId);
      return;
    }
    clicks.disarm();
    if (!card) {
      // Ein Finger auf dem Papier, während einer auf einer Karte liegt: beide gehören der Seite. Die Fläche nimmt den neuen selbst an.
      handOverAll();
      return;
    }
    const here: Track = {
      origin: { clientX: e.clientX, clientY: e.clientY, timeStamp: e.timeStamp },
      last: e,
      target: e.target,
      owner: 'offen',
      big: onBigCard(e.target),
    };
    tracks.set(e.pointerId, here);
    const others = [...tracks.values()].some((track) => track !== here && (track.owner === 'offen' || track.owner === 'seite'));
    if (others || o.surface()?.fingersDown) handOverAll();
  }

  function onMove(e: PointerEvent): void {
    const track = tracks.get(e.pointerId);
    if (!track) return;
    track.last = e;
    if (track.owner !== 'offen') return;
    const dx = e.clientX - track.origin.clientX;
    const dy = e.clientY - track.origin.clientY;
    if (Math.hypot(dx, dy) < TAP_SLOP_PX) return;
    // Der Finger geht nach oben, wenn die Liste nach unten blättert: Das Rad hat das umgekehrte Vorzeichen.
    if (Math.abs(dy) > Math.abs(dx) && scrollsFurther(track.target, frame, -dy)) track.owner = 'karte';
    else handOver(track);
  }

  function onEnd(e: PointerEvent): void {
    tracks.delete(e.pointerId);
    if (palms.delete(e.pointerId) && e.type === 'pointerup') clicks.arm(e.clientX, e.clientY, e.timeStamp);
  }

  // Solange die Seite einen Finger hat, scrollt der Browser nichts: Sonst nähme er die Geste weg (`pointercancel`).
  function onTouchMove(e: Event): void {
    if (e.cancelable && [...tracks.values()].some((track) => track.owner === 'seite')) e.preventDefault();
  }

  function onWheel(e: WheelEvent): void {
    if (onBigCard(e.target)) {
      // Die große Karte scrollt selbst, was sie scrollen kann. Strg mit Rad zoomt nichts, auch nicht den Browser.
      if (e.ctrlKey || e.metaKey) e.preventDefault();
      return;
    }
    if (!(e.ctrlKey || e.metaKey) && scrollsFurther(e.target, frame, e.deltaY)) return;
    e.preventDefault();
    host.dispatchEvent(
      new WheelEvent('wheel', {
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        metaKey: e.metaKey,
        bubbles: true,
        cancelable: true,
      }),
    );
  }

  stage.addEventListener('pointerdown', onDown, true);
  stage.addEventListener('pointermove', onMove, true);
  stage.addEventListener('pointerup', onEnd, true);
  stage.addEventListener('pointercancel', onEnd, true);
  frame.addEventListener('click', clicks.swallow, true);
  frame.addEventListener('touchmove', onTouchMove, { capture: true, passive: false });
  frame.addEventListener('wheel', onWheel, { passive: false });
  return () => {
    stage.removeEventListener('pointerdown', onDown, true);
    stage.removeEventListener('pointermove', onMove, true);
    stage.removeEventListener('pointerup', onEnd, true);
    stage.removeEventListener('pointercancel', onEnd, true);
    frame.removeEventListener('click', clicks.swallow, true);
    frame.removeEventListener('touchmove', onTouchMove, true);
    frame.removeEventListener('wheel', onWheel);
    // Ein Stift, der noch auf einer Karte aufliegt, während die Karten gehen, hielte das Tor sonst für immer zu.
    pens.stop();
  };
}
