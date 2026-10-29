// Erkennung von Handballen und Zwei-Finger-Tipp. Reine Logik ohne DOM, die Schreibfläche (`surface.ts`) füttert sie
// mit den Zeigerereignissen. Die Werte stammen aus dem Stift-Test (`docs/reference/stift-test.html`) und den
// Vorgaben für die Schreibfläche.

/** So lange nach dem Abheben des Stifts gilt ein Finger noch als Hand, die beim Schreiben aufliegt. */
const PALM_PAUSE_MS = 250;
/** Eine Auflagefläche, die in einer Richtung größer ist, ist ein Handballen und kein Finger. */
const PALM_SIZE_PX = 120;
/** Der zweite Finger muss höchstens so lange nach dem ersten aufsetzen. */
const TAP_SECOND_FINGER_MS = 150;
/** Beide Finger müssen höchstens so lange nach dem ersten Aufsetzen wieder weg sein. */
const TAP_DURATION_MS = 300;
/** Wer sich so weit oder weiter bewegt, tippt nicht mehr, sondern schiebt. Auch Verschieben und Zoomen beginnen erst dann. */
export const TAP_SLOP_PX = 10;
/** So viel von der Seite bleibt beim Verschieben mindestens auf dem Bildschirm. */
const KEEP_VISIBLE_PX = 60;

/**
 * Entscheidet, welche Berührungen Finger sind. Solange der Stift aufliegt und kurz danach liegt die Hand auf dem
 * Bildschirm, und sehr große Auflageflächen sind Handballen. Beides darf weder verschieben noch zoomen noch rückgängig machen.
 */
export class GestureFilter {
  #penIsDown = false;
  #lastPenUp = -Infinity;

  /** Der Stift setzt auf. (Die Zeit braucht die Methode nicht, sie hat dieselbe Form wie `penUp`.) */
  penDown(_now: number): void {
    this.#penIsDown = true;
  }

  /** Der Stift hebt ab (oder das System bricht ihn ab). `now` in Millisekunden. */
  penUp(now: number): void {
    this.#penIsDown = false;
    this.#lastPenUp = now;
  }

  /** Wahr, wenn die Berührung ein Finger ist. `e` ist das Zeigerereignis (oder etwas mit `width` und `height`). */
  acceptTouch(e: { width?: number; height?: number }, now: number): boolean {
    if (this.#penIsDown || now - this.#lastPenUp < PALM_PAUSE_MS) return false;
    return (e.width ?? 0) <= PALM_SIZE_PX && (e.height ?? 0) <= PALM_SIZE_PX;
  }
}

/** Ein Ereignis eines Fingers. `t` in Millisekunden, Orte in Bildschirmpunkten. */
export type FingerEvent = { id: number; type: 'down' | 'move' | 'up'; x: number; y: number; t: number };

/**
 * Wahr, wenn die Ereignisse (vom ersten Aufsetzen bis zum letzten Abheben, in der Reihenfolge ihres Eintreffens) ein
 * Zwei-Finger-Tipp sind: genau zwei Finger, die zugleich auflagen, der zweite höchstens 150 ms nach dem ersten
 * aufgesetzt, beide höchstens 300 ms nach dem ersten Aufsetzen wieder weg und jeder auf dem Weg (auch beim Abheben)
 * unter 10 px von seinem Aufsetzpunkt entfernt.
 */
export function isTwoFingerTap(ev: FingerEvent[]): boolean {
  const downs = new Map<number, FingerEvent>();
  const ups = new Map<number, FingerEvent>();
  const held = new Set<number>();
  let mostHeld = 0;
  for (const e of ev) {
    if (e.type === 'down') {
      if (downs.has(e.id)) return false;
      downs.set(e.id, e);
      held.add(e.id);
      mostHeld = Math.max(mostHeld, held.size);
      continue;
    }
    const down = downs.get(e.id);
    if (!down || !held.has(e.id)) return false;
    if (Math.hypot(e.x - down.x, e.y - down.y) >= TAP_SLOP_PX) return false;
    if (e.type === 'up') {
      ups.set(e.id, e);
      held.delete(e.id);
    }
  }
  if (downs.size !== 2 || ups.size !== 2 || mostHeld !== 2) return false;
  const [first, second] = [...downs.values()].sort((a, b) => a.t - b.t);
  if (second.t - first.t > TAP_SECOND_FINGER_MS) return false;
  return [...ups.values()].every((up) => up.t - first.t <= TAP_DURATION_MS);
}

// ---------- Verschieben und Zoomen ----------

export type Pt2 = { x: number; y: number };
/** Wie die Seite auf dem Bildschirm liegt: Ein Ort der Seite (px, py) steht bei (px * s + x, py * s + y). */
export type View = { s: number; x: number; y: number };
export type ZoomLimits = { min: number; max: number };

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Schiebt die Seite zurück, wenn weniger als 60 px von ihr auf dem Bildschirm (`size`) übrig wären. */
export function clampView(v: View, size: { w: number; h: number }, page: { w: number; h: number }): View {
  return {
    s: v.s,
    x: clamp(v.x, KEEP_VISIBLE_PX - page.w * v.s, size.w - KEEP_VISIBLE_PX),
    y: clamp(v.y, KEEP_VISIBLE_PX - page.h * v.s, size.h - KEEP_VISIBLE_PX),
  };
}

/** Zoomt um den Bildschirmpunkt `at`: Die Stelle der Seite darunter bleibt dort. Der Maßstab bleibt in den Grenzen. */
export function zoomAround(v: View, at: Pt2, factor: number, limits: ZoomLimits): View {
  const s = clamp(v.s * factor, limits.min, limits.max);
  const px = (at.x - v.x) / v.s;
  const py = (at.y - v.y) / v.s;
  return { s, x: at.x - px * s, y: at.y - py * s };
}

/**
 * Die Ansicht während einer Geste mit Fingern. `ref` ist die Ansicht, `from` sind die Orte der Finger, als die Geste
 * begann (oder zuletzt ein Finger dazukam oder wegging), `to` ihre Orte jetzt, in derselben Reihenfolge. Ein Finger
 * verschiebt die Seite, zwei zoomen sie und verschieben sie (weitere zählen nicht). `started` sagt, ob die Geste schon
 * im Gang ist: Davor bleibt die Ansicht stehen (`null`), bis ein Finger 10 px weit gekommen ist oder sich der Abstand
 * zweier Finger um 10 px geändert hat. So bewegt ein Tipp nichts.
 */
export function gestureView(ref: View, from: Pt2[], to: Pt2[], limits: ZoomLimits, started: boolean): View | null {
  const n = Math.min(from.length, to.length);
  if (n === 0) return null;
  if (n === 1) {
    const dx = to[0].x - from[0].x;
    const dy = to[0].y - from[0].y;
    if (!started && Math.hypot(dx, dy) < TAP_SLOP_PX) return null;
    return { s: ref.s, x: ref.x + dx, y: ref.y + dy };
  }
  const [a0, b0] = from;
  const [a, b] = to;
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1;
  const d1 = Math.hypot(b.x - a.x, b.y - a.y);
  const moved = Math.max(Math.hypot(a.x - a0.x, a.y - a0.y), Math.hypot(b.x - b0.x, b.y - b0.y), Math.abs(d1 - d0));
  if (!started && moved < TAP_SLOP_PX) return null;
  const s = clamp((ref.s * d1) / d0, limits.min, limits.max);
  // Die Stelle der Seite, die anfangs zwischen den Fingern lag, soll jetzt zwischen ihnen liegen.
  const px = ((a0.x + b0.x) / 2 - ref.x) / ref.s;
  const py = ((a0.y + b0.y) / 2 - ref.y) / ref.s;
  return { s, x: (a.x + b.x) / 2 - px * s, y: (a.y + b.y) / 2 - py * s };
}
