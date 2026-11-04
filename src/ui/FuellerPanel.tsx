import { signal } from '@preact/signals';
import { useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { GestureFilter } from '../ink/gestures';
import { outlineD } from '../ink/outline';
import { FLAT_NIB, PRESSURE_SPAN, STABIL_SIGMA, type FuellerSettings } from '../ink/pens';
import { StrokeBuilder, fmtNum } from '../ink/stroke';
import { INK, MM, WIDTH_MM } from '../ink/types';
import { inkPrefs, setInkPrefs } from './inkPrefs';
import { capturePointer, untilLifted } from './pointerBits';

// Das Regler-Fenster der Füllfeder. Ein zweiter Tipp auf die schon gewählte Füllfeder öffnet es (`inkTools`): aus der
// Werkzeugleiste unter ihrem Knopf, aus Rad und Lasche in der Mitte der Bühne. Oben eine Vorschau mit dem Modell der Füllfeder,
// darunter die vier Regler. Ein Schutzfeld über der ganzen Bühne fängt jeden Zeiger neben dem Fenster und schließt es wie das
// Schutzfeld des Rings: Nichts darunter bekommt den Zeiger, er schreibt also nichts. Finger gehen auf dem Schutzfeld wie auf den
// Reglern durch dasselbe Tor gegen Handballen wie auf der Seite.

/** Das Rechteck eines Knopfs der Werkzeugleiste in Bildschirmkoordinaten. */
export type ButtonRect = { left: number; top: number; bottom: number; width: number };
/** Wo das Fenster steht: unter dem Knopf der Werkzeugleiste oder in der Mitte der Bühne (aus Rad und Lasche). */
export type PanelAt = { at: 'leiste'; rect: ButtonRect } | { at: 'mitte' };

/**
 * Das offene Fenster, `null`, wenn keines offen ist. Es schließt bei einem Tipp daneben, wenn ein anderes Werkzeug oder ein anderer
 * Stift gilt und wenn die App in den Hintergrund geht (hier), bei einem weiteren Tipp auf die Füllfeder (`inkTools`), mit seiner
 * Seite und wenn das Vollbild wechselt (`PageView`).
 */
export const fuellerPanel = signal<PanelAt | null>(null);

function close(): void {
  fuellerPanel.value = null;
}

// ---------- Vorschau ----------

/** Die Vorschau-Linie: eine liegende S-Kurve (eine ganze Welle), so breit und so hoch in Seiteneinheiten. */
const CURVE = { w: 60, h: 20 };
/** Abstand der Punkte, von links nach rechts gemessen (Seiteneinheiten). */
const STEP = 0.5;
/** Druck an beiden Enden der Kurve und in ihrer Mitte. */
const CURVE_PRESSURE = { ends: 0.2, middle: 0.8 };

/**
 * Die Vorschau: eine S-Kurve, geschrieben mit dem Modell der Füllfeder (`StrokeBuilder` mit den Reglern und der Glättung der
 * Strich-Stabilisierung, ohne Neigung, also in der Stiftrichtung `DEFAULT_PEN_ANGLE`). Der Druck steigt zur Mitte hin und fällt
 * wieder. Zurück kommen der Umriss des fertigen Strichs (`finish()`, beide Enden) als Pfad und eine `viewBox`, in die er bei jeder
 * Einstellung dieser Breite passt: Beim Schieben eines Reglers bleibt die Kurve stehen, nur der Strich ändert sich.
 */
export function previewD(o: FuellerSettings, widthMm: number): { d: string; viewBox: string } {
  // Der Mindestabstand ist der Punktabstand, so fällt kein Punkt weg. Seiteneinheiten je Bildschirmpunkt leitet der Builder daraus ab.
  const builder = new StrokeBuilder({ pen: 'fueller', color: 'schwarz', widthMm, sigma: STABIL_SIGMA * o.stabil, t: 0, minDist: STEP, fueller: o });
  const n = Math.round(CURVE.w / STEP);
  for (let i = 0; i <= n; i++) {
    const f = i / n;
    const y = (CURVE.h / 2) * (1 - Math.sin(2 * Math.PI * f));
    builder.add(f * CURVE.w, y, CURVE_PRESSURE.ends + (CURVE_PRESSURE.middle - CURVE_PRESSURE.ends) * Math.sin(Math.PI * f));
  }
  // So weit reicht der Strich höchstens über die Kurve hinaus: die halbe Breite an der breitesten Stelle, die es geben kann (ganz
  // flache Feder längs zur Strichrichtung, voller Druck bei voller Druckempfindlichkeit). Auf eine Stelle aufgerundet wie im Pfad.
  const reach = Math.ceil(((widthMm * MM * FLAT_NIB.along * (1 + PRESSURE_SPAN)) / 2) * 10) / 10;
  const viewBox = [-reach, -reach, CURVE.w + 2 * reach, CURVE.h + 2 * reach].map(fmtNum).join(' ');
  return { d: outlineD(builder.finish().pts), viewBox };
}

// ---------- Regler ----------

type Key = keyof FuellerSettings;

/** Die vier Regler, wie GoodNotes sie nennt und ordnet. */
const SLIDERS: readonly { key: Key; name: string }[] = [
  { key: 'schaerfe', name: 'Schärfe der Spitze' },
  { key: 'druck', name: 'Druckempfindlichkeit' },
  { key: 'rundung', name: 'Rundung der Spitze' },
  { key: 'stabil', name: 'Strich-Stabilisierung' },
];

/** Durchmesser des Knopfs auf dem Regler (Bildschirmpunkte), wie in app.css: Seine Mitte wandert so viel weniger weit, als der Regler breit ist. */
const THUMB_PX = 28;
/** Abstand des Fensters zu den Rändern der Bühne und zum Knopf der Werkzeugleiste (Bildschirmpunkte). */
const EDGE_PX = 8;

/** Ein Regler in ganzen Prozent (0 bis 100), wie er auf dem Regler steht. Gespeichert ist der Anteil (0 bis 1). */
const percentOf = (share: number): number => Math.round(share * 100);

/** Was neben dem Regler steht: der Wert in Prozent, bei der Schärfe an den Enden „Rund“ und „Scharf“. */
function valueText(key: Key, percent: number): string {
  if (key === 'schaerfe' && percent === 0) return 'Rund';
  if (key === 'schaerfe' && percent === 100) return 'Scharf';
  return `${percent} %`;
}

/** Stellt einen Regler: eine neue Einstellung statt einer geänderten. Gespeichert wird sie wie die übrige Werkzeugwahl. */
function setPercent(key: Key, percent: number): void {
  const now = inkPrefs.value.fueller;
  if (percentOf(now[key]) === percent) return;
  setInkPrefs({ fueller: { ...now, [key]: percent / 100 } });
}

/** Der Wert, bei dem die Mitte des Knopfs auf `x` (Bildschirmkoordinate) stünde: ganze Prozent, auf 0 bis 100 begrenzt. */
function percentAt(el: Element, x: number): number {
  const r = el.getBoundingClientRect();
  const travel = r.width - THUMB_PX;
  return travel > 0 ? Math.round(Math.min(1, Math.max(0, (x - r.left - THUMB_PX / 2) / travel)) * 100) : 0;
}

/** Wo die Mitte des Knopfs bei `percent` steht (Bildschirmkoordinate). */
function thumbAt(el: Element, percent: number): number {
  const r = el.getBoundingClientRect();
  return r.left + THUMB_PX / 2 + ((r.width - THUMB_PX) * percent) / 100;
}

/** Ein Zeiger, der einen Regler schiebt. */
type Slide = {
  key: Key;
  /** Der Anteil beim Aufsetzen: Er gilt wieder, wenn der Zeiger abbricht oder der Finger die Hand war. */
  start: number;
  /** So weit neben der Mitte des Knopfs setzte der Zeiger auf, wenn er den Knopf traf: Der Knopf springt dann nicht. */
  grab: number;
  /** Ein Finger: Er kann die Hand gewesen sein. */
  finger: boolean;
};

/**
 * Das Fenster, solange es offen und die Füllfeder gewählt ist. `PageView` zeigt es nur, wo geschrieben werden kann. Ein anderes
 * Werkzeug oder ein anderer Stift schließt es, gleich wo er gewählt wurde.
 */
export function FuellerPanel({ filter }: { filter: GestureFilter }) {
  const at = fuellerPanel.value;
  const { tool, pen } = inkPrefs.value;
  const chosen = tool === 'pen' && pen === 'fueller';
  useLayoutEffect(() => {
    if (!chosen) close();
  }, [chosen]);
  return at && chosen ? <Panel at={at} filter={filter} /> : null;
}

/**
 * Schutzfeld und Fenster. Ein Regler folgt dem Stift, der Maus und einem Finger, den das Tor gegen Handballen annimmt. Setzt der
 * Stift auf, war ein Finger, der gerade einen Regler schiebt, die Hand: Der Regler geht zurück, wo er beim Aufsetzen des Fingers
 * stand. Ebenso, wenn das Tor den Finger später nicht mehr annimmt, und bei einem abgebrochenen Zeiger. Tastatur und Hilfen der
 * Bedienung stellen die Regler wie gewohnt (`input`).
 */
function Panel({ at, filter }: { at: PanelAt; filter: GestureFilter }) {
  const { color, width, fueller } = inkPrefs.value;
  const preview = useMemo(() => previewD(fueller, WIDTH_MM[width]), [fueller, width]);
  const shield = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  // Das Abheben eines Zeigers kommt auch nach einem neuen Zeichnen an: Es fragt immer das neueste Tor.
  const gate = useRef(filter);
  gate.current = filter;
  /** Der Stift oder die Maus, die neben dem Fenster aufsetzten und es schließen, und wie man das Warten auf ihr Abheben beendet. */
  const leaving = useRef<{ id: number; stop(): void } | null>(null);
  /** Finger auf dem Schutzfeld, die das Fenster beim Abheben schließen, wenn sie dann noch tippen: wie man das Warten beendet. */
  const fingers = useRef(new Map<number, () => void>());
  /** Die Zeiger, die gerade einen Regler schieben. */
  const slides = useRef(new Map<number, Slide>());
  const [closing, setClosing] = useState(false);

  // Unter dem Knopf der Werkzeugleiste, so mittig unter ihm, wie die Bühne es zulässt. In die Mitte stellt es app.css.
  useLayoutEffect(() => {
    const el = box.current;
    const area = shield.current?.getBoundingClientRect();
    if (!el || !area || at.at !== 'leiste') return;
    const w = el.offsetWidth;
    const left = Math.max(EDGE_PX, Math.min(area.width - w - EDGE_PX, at.rect.left + at.rect.width / 2 - area.left - w / 2));
    const top = Math.max(EDGE_PX, at.rect.bottom + EDGE_PX - area.top);
    Object.assign(el.style, { left: `${left}px`, top: `${top}px`, maxHeight: `calc(100% - ${top + EDGE_PX}px)` });
  }, [at]);

  // Geht die App in den Hintergrund, schließt das Fenster. Danach kommt oft das Abheben eines Zeigers nicht mehr an.
  useLayoutEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') close();
    };
    document.addEventListener('visibilitychange', hidden);
    return () => document.removeEventListener('visibilitychange', hidden);
  }, []);

  // Geht das Fenster, während ein Zeiger noch aufliegt, wartet nichts mehr auf ihn. Was ein Regler bis dahin bekam, bleibt.
  useLayoutEffect(
    () => () => {
      leaving.current?.stop();
      for (const stop of fingers.current.values()) stop();
      fingers.current.clear();
      slides.current.clear();
    },
    [],
  );

  /** Der Zeiger schiebt nicht mehr: Sein Regler steht wieder, wo er beim Aufsetzen stand. */
  function undo(id: number, s: Slide): void {
    slides.current.delete(id);
    setPercent(s.key, percentOf(s.start));
  }

  /** Der Stift setzt im Fenster oder daneben auf. Finger, die gerade einen Regler schieben, lagen schon da: Sie waren die Hand. */
  function penLands(e: PointerEvent): void {
    filter.penDown(e.timeStamp);
    for (const [id, s] of slides.current) if (s.finger) undo(id, s);
  }

  function shieldDown(e: PointerEvent) {
    if (e.target !== e.currentTarget) return; // im Fenster
    e.preventDefault();
    if (e.pointerType === 'pen') penLands(e);
    else if (e.pointerType === 'touch' && !filter.acceptTouch(e, e.timeStamp)) return; // die Hand neben dem Fenster schließt es nicht
    const id = e.pointerId;
    if (leaving.current) {
      // Es schließt schon. Kommt das Abheben des Zeigers, der es schließt, nie an (iOS beim Wechsel der App), bliebe das Schutzfeld
      // ohne Fenster liegen: Ein anderer Zeiger schließt es darum sofort.
      if (id !== leaving.current.id) close();
      return;
    }
    capturePointer(e.currentTarget as Element, id);
    if (e.pointerType === 'touch') {
      // Ein Finger kann die Hand sein, die neben dem Fenster landet, bevor der Stift einen Regler erreicht: Das Fenster bleibt. Beim
      // Abheben schließt er es, wenn er ein Tipp war. Kam inzwischen der Stift oder lag er länger, bleibt es offen.
      const mark = filter.mark(e.timeStamp);
      fingers.current.get(id)?.(); // ein früherer Finger mit derselben Kennung, dessen Abheben nie ankam
      fingers.current.set(
        id,
        untilLifted(id, (ev) => {
          fingers.current.delete(id);
          if (ev.type === 'pointerup' && gate.current.acceptTouch(ev, ev.timeStamp) && gate.current.stillTap(mark, ev.timeStamp)) close();
        }),
      );
      return;
    }
    // Stift und Maus: Das Fenster geht sofort, das Schutzfeld erst, wenn der Zeiger abhebt (wo auch immer), damit auch sein Ende
    // nichts darunter trifft.
    const stop = untilLifted(id, (ev) => {
      if (ev.pointerType === 'pen') gate.current.penUp(ev.timeStamp);
      close();
    });
    leaving.current = { id, stop };
    setClosing(true);
  }

  function shieldUp(e: PointerEvent) {
    // Ein Stift, der woanders aufsetzte (ohne Zeigerfang), hebt hier ab: Das Tor hört es trotzdem.
    if (e.target === e.currentTarget && e.pointerType === 'pen') filter.penUp(e.timeStamp);
  }

  // Der Stift im Fenster meldet sich beim Tor, vor dem Regler, den er trifft: So gehen Finger, die die Hand waren, zuerst zurück.
  function boxDown(e: PointerEvent) {
    if (e.pointerType !== 'pen') return;
    penLands(e);
    capturePointer(e.currentTarget as Element, e.pointerId); // sein Abheben kommt hier an, auch neben dem Fenster
  }

  function boxUp(e: PointerEvent) {
    if (e.pointerType === 'pen') filter.penUp(e.timeStamp);
  }

  function slideDown(e: PointerEvent, key: Key) {
    if (e.pointerType === 'touch' ? !filter.acceptTouch(e, e.timeStamp) : e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget as Element;
    const start = inkPrefs.value.fueller[key];
    const thumb = thumbAt(el, percentOf(start));
    const grab = Math.abs(e.clientX - thumb) <= THUMB_PX / 2 ? e.clientX - thumb : 0;
    slides.current.set(e.pointerId, { key, start, grab, finger: e.pointerType === 'touch' });
    capturePointer(el, e.pointerId);
    setPercent(key, percentAt(el, e.clientX - grab));
  }

  function slideMove(e: PointerEvent) {
    const s = slides.current.get(e.pointerId);
    if (!s) return;
    // Nimmt das Tor den Finger nicht mehr an (der Stift liegt auf, die Auflage ist zu groß geworden), war er die Hand.
    if (s.finger && !filter.acceptTouch(e, e.timeStamp)) return undo(e.pointerId, s);
    setPercent(s.key, percentAt(e.currentTarget as Element, e.clientX - s.grab));
  }

  function slideUp(e: PointerEvent) {
    const s = slides.current.get(e.pointerId);
    if (!s) return;
    // Ein abgebrochener Zeiger schiebt nichts, ebenso ein Finger, den das Tor beim Abheben nicht mehr annimmt.
    if (e.type === 'pointercancel' || (s.finger && !filter.acceptTouch(e, e.timeStamp))) undo(e.pointerId, s);
    else slides.current.delete(e.pointerId);
  }

  return (
    <div
      ref={shield}
      class="fueller-schutz"
      onPointerDown={shieldDown}
      onPointerUp={shieldUp}
      onPointerCancel={shieldUp}
      // Ohne das machte der Browser aus einer Berührung hier einen Klick auf das, was nach dem Schließen darunter liegt.
      onTouchStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      // Unter dem Schutzfeld blättert und zoomt die Seite nicht. Ist das Fenster höher als die Bühne, blättert es selbst.
      onWheel={(e) => {
        if (e.target === e.currentTarget || e.ctrlKey || e.metaKey) e.preventDefault();
      }}
    >
      {!closing && (
        <div
          ref={box}
          class="fueller-fenster"
          data-at={at.at}
          role="dialog"
          aria-label="Füllfeder"
          onPointerDownCapture={boxDown}
          onPointerUp={boxUp}
          onPointerCancel={boxUp}
        >
          <h2 class="fueller-titel">Füllfeder</h2>
          <svg class="fueller-vorschau" viewBox={preview.viewBox} aria-hidden="true">
            <path d={preview.d} fill={INK[color]} />
          </svg>
          {SLIDERS.map(({ key, name }) => {
            const percent = percentOf(fueller[key]);
            const text = valueText(key, percent);
            return (
              <div key={key} class="fueller-regler" data-regler={key}>
                <span class="fueller-name" aria-hidden="true">
                  {name}
                </span>
                <span class="fueller-wert" aria-hidden="true">
                  {text}
                </span>
                <div class="fueller-feld" onPointerDown={(e) => slideDown(e, key)} onPointerMove={slideMove} onPointerUp={slideUp} onPointerCancel={slideUp}>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={percent}
                    aria-label={name}
                    aria-valuetext={text}
                    style={{ '--anteil': String(percent / 100) }}
                    onInput={(e) => setPercent(key, Number(e.currentTarget.value))}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
