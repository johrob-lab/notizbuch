import { boundsOf, emptyBox, growBox, lineWidth, type Box } from './bounds';
import { chainSpan, neighborOffset, settledSide, sideAt, SIDES, type Present, type Side } from './chain';
import { cutStroke, ERASER_PX, ERASER_STEP_PX, hitIndexes, pointsAlong, takeOut, takeOutIds } from './erase';
import { clampView, GestureFilter, gestureView, isFingerTap, isTwoFingerTap, SIDE_MARGIN_PX, zoomAround, type FingerEvent, type Pt2, type View, type ZoomLimits } from './gestures';
import { GRAIN, GRAIN_MIN_PX, grainMask } from './grain';
import { History, restore, type Removed } from './history';
import { fixedSegments, tailStart } from './live';
import { InkMeter } from './meter';
import { outlineOf, traceCurve } from './outline';
import {
  BLEISTIFT_OPACITY,
  DEFAULT_FUELLER,
  DEFAULT_PEN_ANGLE,
  MIN_DIST_PX,
  isShape,
  nibShape,
  penAngle,
  type FuellerSettings,
  type PenKind,
} from './pens';
import { extrapolate } from './predict';
import { isScribble, scribbleTargets } from './scribble';
import { newStrokeId, StrokeBuilder } from './stroke';
import { storedForm } from './svg';
import type { EraserMode, EraserSize } from '../lib/settings';
import { INK, MM, PAGE_H, PAGE_W, PAPER, WIDTH_MM, type FieldBox, type InkColor, type Page, type Pt, type Stroke, type StrokeColor, type WidthName } from './types';

// Die Schreibfläche: drei Canvas-Ebenen übereinander (Grund mit Papier und fertigen Strichen, Live mit dem Strich, der
// gerade entsteht, Vorhersage mit dem Stück voraus). Die Zeigerlogik stammt aus dem Stift-Test
// (`docs/reference/stift-test.html`, mit dem Apple Pencil geprüft). Neu gegenüber dem Stift-Test: Geschrieben und
// radiert wird nur mit dem Stift. Finger und Maus bewegen die Seite, ein Zwei-Finger-Tipp macht rückgängig.

export type SurfaceOptions = {
  /** Nichts schreiben, radieren oder rückgängig machen, nur ansehen. Verschieben und Zoomen gehen weiter. */
  readOnly: boolean;
  /** Stärke der Glättung (σ, siehe `SMOOTHING`). Die Füllfeder glättet stattdessen mit ihrer Strich-Stabilisierung. */
  sigma: number;
  prediction: boolean;
  /**
   * Das Tor, das entscheidet, welche Berührungen Finger sind (Handballen, Stift liegt auf). Wer außerhalb der Fläche
   * Berührungen annimmt, wo beim Schreiben die Hand ruht (der Schnellwechsel), teilt es mit der Fläche. Ohne Angabe hat
   * die Fläche ein eigenes.
   */
  filter?: GestureFilter;
  /** Die Seite hat sich geändert (Strich fertig, radiert, rückgängig, wiederholt). Wird sofort, nicht verzögert, gerufen. */
  onChange: (p: Page) => void;
  /**
   * Ein Finger oder die Maus hat die Seite angetippt, an dieser Stelle der Seite (Seiteneinheiten). Der Stift tippt nie,
   * er schreibt, und ein Handballen zählt nicht. Das gilt auch, wenn die Seite nur zum Ansehen offen ist.
   */
  onTap?: (at: { x: number; y: number }) => void;
  /**
   * Die Ansicht hat sich geändert (verschoben, gezoomt, andere Größe): Ein Ort der Seite liegt auf dem Bildschirm bei
   * `x + Seitenort * s` (Punkte, von der oberen linken Ecke der Fläche aus). Wer etwas über die Seite legt, das mit ihr
   * wandern soll (die Karten der Tagesseite), folgt ihr so. Wird beim ersten Zeichnen gerufen und danach nur bei Änderung.
   */
  onView?: (view: View) => void;
  /**
   * Rechtecke der Seite (x, y, Breite, Höhe in Seiteneinheiten), in denen der Stift nicht schreibt, zum Beispiel unter einer
   * Karte. Ein Strich, der hineinläuft, endet am Rand, und einer, der darin beginnt, beginnt erst beim Verlassen. Radieren geht überall.
   */
  noInk?: readonly (readonly [x: number, y: number, w: number, h: number])[];
  /**
   * Weiterscrollen: Die Nachbarseite `side` (siehe `setNeighbors`) soll die offene Seite werden. Das kommt, wenn sie die Mitte
   * des Bildschirms bedeckt (`settledSide`), sobald ein Zug mit Fingern oder der Maus zu Ende ist oder das Mausrad
   * `WHEEL_SETTLE_MS` lang stillsteht. Es kommt auch, wenn der Stift auf ihr oder im Spalt davor aufsetzt oder ein Finger oder
   * die Maus dort tippt (`sideAt`): Dann schreibt der Stift nichts, und der Tipp gilt nicht der Seite (`onTap`). `view` ist die
   * Ansicht in diesem Moment, gerechnet in Einheiten dieser Seite. Ohne Nachbarn kommt es nie.
   */
  onNeighbor?: (side: Side, view: View) => void;
  /**
   * Die Ansicht beim ersten Messen der Fläche statt der ganzen Seitenbreite oben, zum Beispiel dort, wo die Seite eben noch als
   * Nachbarin stand. Sie wird wie jede Ansicht in ihre Grenzen geklemmt.
   */
  initialView?: View;
};

/** Eine Nachbarseite für die Vorschau: ihre Striche und ihr Hintergrund als fertiges SVG (wie bei `setPage`). */
export type NeighborPage = { strokes: Stroke[]; background: string };

/** Eine Nachbarseite, wie die Fläche sie zeigt. `image` ist ihr Hintergrund `svg` als Bild, sobald eines geladen ist. */
type Neighbor = { strokes: Stroke[]; svg: string; image: HTMLImageElement | null };

/**
 * Ein Strich, der entsteht, mit Stift und Farbe des Strichs. `drawn` sagt, was schon fest auf der Live-Ebene steht: bei Linien das erste Segment, das
 * noch fehlt (siehe `live.ts`), bei Formen die Zahl der Punkte, deren Viereck vom vorigen Punkt und deren Kreis dort stehen.
 * `tailArea` ist der Bereich des Endstücks auf der Vorhersage-Ebene.
 */
type Drawing = {
  id: number;
  builder: StrokeBuilder;
  pen: PenKind;
  color: StrokeColor;
  box: Box;
  drawn: number;
  tailArea: Box | null;
  hist: { x: number; y: number; t: number }[];
};
/**
 * Ein Radiervorgang. Ganze Striche: `removed` sind die herausgenommenen. Nur das Stück: `before` ist die Liste vom Beginn
 * (für Rückgängig), `cuts` ordnet jedem zerschnittenen Original seine Reststücke zu, `origin` jedem Stück sein Original.
 */
type Erasing = {
  id: number;
  mode: EraserMode;
  removed: Removed[];
  before: Stroke[];
  cuts: Map<string, Stroke[]>;
  origin: Map<string, string>;
  last: Pt2;
};
type Gesture = { revert: View; ref: View; from: Pt2[]; moved: boolean; snapView: View | null };

/** Ab so vielen Punkten auf der Seite zoomt eine Geste nur das Bild und zeichnet erst am Ende neu. */
const HEAVY_POINTS = 8000;
/** Zoom als Vielfaches der normalen Größe (`fit`, die Seite füllt die Breite): kleiner als normal wird die Seite nie. */
const MIN_ZOOM = 1;
const MAX_ZOOM = 10;
/**
 * So lange (ms) muss das Mausrad stillstehen, bis die Ansicht zur Ruhe kommt wie nach dem Loslassen eines Zugs: Bedeckt dann ein
 * Nachbar die Mitte, wird er die offene Seite (`onNeighbor`). Jedes Rad-Ereignis, auch Zoomen mit Strg, beginnt die Zeit neu.
 */
export const WHEEL_SETTLE_MS = 250;
/** Die Spitze beim Schweben ist auf dem Bildschirm mindestens so lang (Punkte), sonst wäre sie in normaler Größe kaum zu sehen. */
const TIP_MIN_PX = 8;
/** So lange (ms) bleibt die Spitze nach der letzten Schwebe-Meldung stehen. */
const TIP_HOLD_MS = 300;

/**
 * Richtung, in die der Stift beim letzten Strichpunkt mit Neigung zeigte (Bogenmaß). So steht die Spitze beim Schweben, denn
 * dabei meldet Safari keine Neigung. Sie gehört keiner einzelnen Fläche: Jede Seite baut ihre eigene, und nach dem Blättern
 * steht die Spitze wie beim letzten Strich, nicht wieder wie bei einem Rechtshänder.
 */
let lastPenDir = DEFAULT_PEN_ANGLE;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** Alle Zeigerereignisse zwischen zwei Bildern, soweit der Browser sie liefert, sonst nur das eine. */
function samples(e: PointerEvent): PointerEvent[] {
  try {
    const list = e.getCoalescedEvents();
    if (list.length) return list;
  } catch {
    // ältere Browser kennen die Funktion nicht
  }
  return [e];
}

function context(canvas: HTMLCanvasElement, settings?: CanvasRenderingContext2DSettings): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d', settings);
  if (!ctx) throw new Error('Dieser Browser kann keine Schreibfläche zeichnen.');
  return ctx;
}

/** Ein Hintergrund (fertiges SVG für eine ganze Seite) als Quelle für ein Bild. */
function backgroundSrc(svg: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">${svg}</svg>`,
  )}`;
}

/**
 * Hintergründe, die schon als Bild geladen sind, nach ihrem SVG-Text, der zuletzt gebrauchte zuletzt. Eine neue Fläche zeigt so
 * sofort, was die vorige eben noch zeigte: Beim Weiterscrollen wird die Vorschau des Nachbarn zum Hintergrund der neuen Seite
 * und die bisherige Seite zu ihrem Nachbarn. Müsste das Bild erst laden, stünde die Seite einen Augenblick ohne Linien und
 * Schrift da. Wenige genügen: die Seite und ihre zwei Nachbarn, dazu die der Fläche davor.
 */
const loadedBackgrounds = new Map<string, HTMLImageElement>();
const KEEP_BACKGROUNDS = 6;

/** Das schon geladene Bild zu einem Hintergrund, sonst `null`. */
function loadedBackground(svg: string): HTMLImageElement | null {
  const img = loadedBackgrounds.get(svg);
  if (img) keepBackground(svg, img);
  return img ?? null;
}

/** Merkt sich ein geladenes Bild als zuletzt gebraucht. Das am längsten nicht gebrauchte geht, wenn es zu viele sind. */
function keepBackground(svg: string, img: HTMLImageElement): void {
  loadedBackgrounds.delete(svg);
  loadedBackgrounds.set(svg, img);
  for (const oldest of loadedBackgrounds.keys()) {
    if (loadedBackgrounds.size <= KEEP_BACKGROUNDS) break;
    loadedBackgrounds.delete(oldest);
  }
}

/** Was von einem neuen Strich auf der Live-Ebene steht, bevor etwas gezeichnet ist (siehe `Drawing.drawn`). */
const nothingDrawn = (pen: PenKind): number => (isShape(pen) ? 0 : 1);

let grainCanvas: HTMLCanvasElement | null = null;

/** Die Kachel der Körnung in Graphitgrau, je Feld ein Bildpunkt, ganz deckend oder ganz durchsichtig. Einmal gebaut, für alle Flächen. */
function grainTile(): HTMLCanvasElement {
  if (!grainCanvas) {
    const { tile, cover, seed } = GRAIN;
    const mask = grainMask(tile, cover, seed);
    const c = document.createElement('canvas');
    c.width = tile;
    c.height = tile;
    const ctx = context(c);
    ctx.fillStyle = INK.grau;
    for (let i = 0; i < mask.length; i++) if (mask[i]) ctx.fillRect(i % tile, Math.floor(i / tile), 1, 1);
    grainCanvas = c;
  }
  return grainCanvas;
}

// Formen (Füllfeder und Bleistift), während sie entstehen: je Punkt ein Kreis mit seiner halben Breite (nie dünner als ein
// Bildpunkt) und vom vorigen Punkt her ein Viereck. Alle Teile laufen im selben Sinn herum wie `arc(…, false)`: In einem Pfad
// mit einem `fill` (Regel nonzero) füllt sich ihre Vereinigung ohne Löcher, und keine Stelle wird darin doppelt gemalt.

/** Hängt das Viereck von `a` nach `b` an den Pfad, die Ecken je Punkt um seinen Radius senkrecht zum Stück. */
function addQuad(ctx: CanvasRenderingContext2D, a: Pt2, ra: number, b: Pt2, rb: number): void {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(len > 0)) return; // zwei gleiche Punkte: Ihre Kreise decken das Stück
  const nx = (a.y - b.y) / len;
  const ny = (b.x - a.x) / len;
  ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
  ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
  ctx.lineTo(b.x - nx * rb, b.y - ny * rb);
  ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
  ctx.closePath();
}

/** Hängt den Kreis um `c` als eigenes Teilstück an den Pfad. */
function addCircle(ctx: CanvasRenderingContext2D, c: Pt2, r: number): void {
  ctx.moveTo(c.x + r, c.y);
  ctx.arc(c.x, c.y, r, 0, Math.PI * 2, false);
  ctx.closePath();
}

/**
 * Hängt die Punkte `from` bis `to - 1` einer Form an den Pfad: je Punkt das Viereck vom vorigen Punkt her (Punkt 0 hat
 * keins) und den Kreis um ihn, jeder Punkt mindestens `minW` breit (ein Bildpunkt). Gibt zurück, wie viele Punkte dafür
 * gebraucht wurden.
 */
function addShape(ctx: CanvasRenderingContext2D, p: readonly Pt[], from: number, to: number, minW: number): number {
  const r = (i: number) => Math.max(p[i].w, minW) / 2;
  for (let i = from; i < to; i++) {
    if (i > 0) addQuad(ctx, p[i - 1], r(i - 1), p[i], r(i));
    addCircle(ctx, p[i], r(i));
  }
  return to > from ? to - Math.max(0, from - 1) : 0;
}

export class InkSurface {
  private readonly el: HTMLElement;
  private readonly opts: SurfaceOptions;
  private readonly base: HTMLCanvasElement;
  private readonly live: HTMLCanvasElement;
  private readonly pred: HTMLCanvasElement;
  /** Bild der Grundebene für Gesten auf vollen Seiten. Hat nur während einer solchen Geste eine Größe. */
  private readonly snap = document.createElement('canvas');
  private readonly bctx: CanvasRenderingContext2D;
  private readonly lctx: CanvasRenderingContext2D;
  private readonly pctx: CanvasRenderingContext2D;
  /** Das Kornmuster des Bleistifts je Ebene, beim ersten Gebrauch gebaut. `null`: Der Browser hat keins geliefert. */
  private readonly grains = new Map<CanvasRenderingContext2D, CanvasPattern | null>();
  private readonly observer: ResizeObserver;
  private readonly cleanups: (() => void)[] = [];

  // Seite
  private head: Pick<Page, 'kind' | 'key' | 'meta'> = { kind: 'tag', key: '', meta: {} };
  private strokes: Stroke[] = [];
  private background: HTMLImageElement | null = null;
  private backgroundSvg = '';
  /** Die Nachbarseiten über und unter der Seite, nur zum Ansehen (siehe `setNeighbors`). */
  private neighbors: Record<Side, Neighbor | null> = { above: null, below: null };

  // Werkzeug
  private readOnly: boolean;
  private tool: 'pen' | 'eraser' = 'pen';
  private pen: PenKind = 'kugel';
  private color: InkColor = 'schwarz';
  private widthMm = WIDTH_MM.mittel;
  private eraserPx = ERASER_PX.mittel;
  private eraserMode: EraserMode = 'strich';
  private scribble = true;
  /** Die Regler der Füllfeder für die nächsten Striche. */
  private fueller: FuellerSettings = DEFAULT_FUELLER;
  private flashTimer = 0;
  private flashEl: HTMLElement | null = null;
  /** Die Spitze der Füllfeder, solange der Stift über der Seite schwebt. */
  private tipEl: HTMLElement | null = null;
  private tipTimer = 0;

  // Ansicht: `view` rechnet Seiteneinheiten in Bildschirmpunkte um (x * s + x), `fit` ist der Maßstab für die Seitenbreite.
  private dpr = 1;
  private vw = 0;
  private vh = 0;
  private fit = 1;
  private rect = { left: 0, top: 0 };
  private view: View = { s: 1, x: 0, y: 0 };
  private hasView = false;
  private reportedView: View | null = null;

  // Verlauf
  private readonly history = new History();

  // Eingabe
  private readonly filter: GestureFilter;
  private drawing: Drawing | null = null;
  private erasing: Erasing | null = null;
  private readonly touches = new Map<number, Pt2>();
  /** Die Ereignisse der Finger seit dem ersten Aufsetzen, für den Zwei-Finger-Tipp. */
  private fingerLog: FingerEvent[] = [];
  /** Dasselbe für Finger und Maus, für den Tipp mit einem Zeiger. */
  private tapLog: FingerEvent[] = [];
  /** Der Stift, von dem das Tor gegen Handballen weiß, dass er aufliegt (`pointerId`), bis er abhebt. */
  private penKnown: number | null = null;
  /** Hört nicht mehr auf das Ende eines Stifts, den die Fläche erst unterwegs bemerkt hat (siehe `noticePen`). */
  private stopPenEnd: (() => void) | null = null;
  private gesture: Gesture | null = null;
  private liveArea: Box | null = null;
  private predArea: Box | null = null;
  private predTimer = 0;
  /** Läuft ab, wenn das Mausrad `WHEEL_SETTLE_MS` lang stillsteht (siehe `onWheel`). */
  private wheelTimer = 0;
  /** Messung der Schreibverzögerung, siehe `meter.ts`. */
  readonly meter = new InkMeter();
  private liveEvents = 0;
  private livePtsMax = 0;
  private meterRaf = 0;
  private raf = 0;
  private destroyed = false;

  constructor(el: HTMLElement, o: SurfaceOptions) {
    this.el = el;
    this.opts = o;
    this.filter = o.filter ?? new GestureFilter();
    this.readOnly = o.readOnly;
    if (getComputedStyle(el).position === 'static') el.style.position = 'relative';
    Object.assign(el.style, { overflow: 'hidden', touchAction: 'none', userSelect: 'none', cursor: 'grab' });
    this.base = this.layer('grund', false);
    this.live = this.layer('live', true);
    this.pred = this.layer('vorhersage', false);
    this.live.setAttribute('aria-label', 'Schreibfläche');
    this.bctx = context(this.base);
    this.lctx = context(this.live, { desynchronized: true });
    this.pctx = context(this.pred);
    el.append(this.base, this.live, this.pred);

    // Alle Zeiger hören auf `el`: Der Stift (und der Finger) bleibt mit Zeigerfang bei der Fläche, auch außerhalb ihres Rands.
    this.listen(el, 'pointerdown', this.onDown, { passive: false });
    this.listen(el, 'pointermove', this.onMove, { passive: false });
    this.listen(el, 'pointerup', this.onUp);
    this.listen(el, 'pointercancel', this.onUp);
    this.listen(el, 'pointerleave', this.onLeave);
    this.listen(el, 'wheel', this.onWheel, { passive: false });
    // Ohne diese Sperren zoomt oder scrollt Safari die ganze Seite, statt dass die Fläche die Geste bekommt.
    const prevent = (e: Event) => e.preventDefault();
    for (const type of ['touchstart', 'touchmove', 'contextmenu']) this.listen(el, type, prevent, { passive: false });
    for (const type of ['gesturestart', 'gesturechange', 'gestureend']) this.listen(document, type, prevent, { passive: false });

    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(el);
    this.resize();
  }

  // ---------- Öffentliche Schnittstelle ----------

  get canUndo(): boolean {
    return !this.readOnly && this.history.canUndo;
  }

  get canRedo(): boolean {
    return !this.readOnly && this.history.canRedo;
  }

  /**
   * Zeigt eine Seite. Der Verlauf für Rückgängig beginnt neu, die Ansicht bleibt wie sie ist (die Fläche passt sich beim
   * ersten Mal selbst an die Seitenbreite an). `background` ist fertiges SVG für Papier, Linien und Feldnamen
   * (dasselbe wie für `serializePage`). Die Felder zeichnet die Fläche nicht selbst, sie stecken im Hintergrund.
   */
  setPage(p: Page, _fields: FieldBox[], background: string): void {
    // Was gerade entsteht, bleibt: Ein Strich kommt am Ende zur neuen Seite dazu. Radiert der Stift gerade, bleiben die
    // Striche weg, die er schon erfasst hat, und er radiert weiter (auch aus der neuen Seite).
    const er = this.erasing;
    const erased = er ? new Set(er.removed.map((r) => r.stroke.id)) : null;
    this.head = { kind: p.kind, key: p.key, meta: { ...p.meta } };
    this.strokes = p.strokes.slice();
    this.history.clear();
    if (er && erased) er.removed = takeOutIds(this.strokes, erased);
    if (er?.mode === 'stueck') {
      // Was schon zerschnitten ist, bleibt zerschnitten: Jedes Original weicht seinen Stücken.
      er.before = this.strokes.slice();
      for (const [orig, pieces] of er.cuts) {
        const i = this.strokes.findIndex((x) => x.id === orig);
        if (i >= 0) this.strokes.splice(i, 1, ...pieces);
      }
    }
    if (!this.drawing && !this.erasing) this.clearLive(true);
    this.setBackground(background);
    this.render();
  }

  /**
   * Ändert die Kopfdaten der Seite und mit ihnen den Hintergrund (bei Besprechungen zeigt er die Kopfdaten), ohne die Striche,
   * den Verlauf für Rückgängig und die Ansicht anzutasten. Ein Strich im Gang bleibt. Gemeldet wird nichts: Wer die
   * Kopfdaten ändert, sorgt selbst dafür, dass die Seite gespeichert wird, und liest sie dazu mit `getPage`.
   */
  setHead(meta: Record<string, string>, background: string): void {
    this.head = { ...this.head, meta: { ...meta } };
    this.setBackground(background, true);
  }

  /**
   * Zeigt einen anderen Hintergrund (fertiges SVG wie bei `setPage`), zum Beispiel mit neuen Terminen, ohne die Striche, den
   * Verlauf für Rückgängig und die Ansicht anzutasten. Ein Strich im Gang bleibt, und bis das neue Bild geladen ist, bleibt das
   * alte stehen. Gemeldet wird nichts: Die Seite selbst ist dieselbe.
   */
  showBackground(svg: string): void {
    this.setBackground(svg, true);
  }

  /** Der Hintergrund, den die Fläche zeigt, als SVG-Text: der zuletzt gesetzte, auch solange sein Bild noch lädt. */
  get shownBackground(): string {
    return this.backgroundSvg;
  }

  /**
   * Zeigt die Nachbarseiten über (`above`) und unter (`below`) der Seite, je `PAGE_GAP` von ihr entfernt (siehe `chain.ts`),
   * nur zum Ansehen: Papier, Hintergrund und Striche. Ersetzt beide, `null` nimmt einen weg. Die Ansicht lässt sich dann bis in
   * die Nachbarn schieben, und wer nach einem Zug loslässt, während einer die Mitte bedeckt, meldet ihn mit `onNeighbor`. Jeder
   * Nachbar hat ein eigenes Bild für den Hintergrund. Gleicher Text lädt nicht neu, und bis ein neues Bild geladen ist, bleibt
   * das bisherige stehen.
   */
  setNeighbors(n: { above: NeighborPage | null; below: NeighborPage | null }): void {
    if (this.destroyed) return;
    for (const side of SIDES) this.neighbors[side] = this.neighborFrom(side, n[side]);
    this.clampView();
    this.render();
  }

  /** Wie viele Striche die Vorschau der Nachbarn zeigt, `null` für einen, den es nicht gibt. */
  get neighborStrokes(): { above: number | null; below: number | null } {
    return { above: this.neighbors.above?.strokes.length ?? null, below: this.neighbors.below?.strokes.length ?? null };
  }

  /**
   * Der Hintergrund, den die Vorschau des Nachbarn `side` zeigt, als SVG-Text: der zuletzt gesetzte, auch solange sein Bild noch
   * lädt. `null` ohne diesen Nachbarn.
   */
  neighborBackground(side: Side): string | null {
    return this.neighbors[side]?.svg ?? null;
  }

  /** Die Seite, wie sie jetzt ist: eine Momentaufnahme, spätere Änderungen verändern sie nicht. */
  getPage(): Page {
    return { ...this.head, meta: { ...this.head.meta }, strokes: this.strokes.slice() };
  }

  /** Stift oder Radierer. Ein anderes Werkzeug blendet die Spitze beim Schweben aus. */
  setTool(t: 'pen' | 'eraser'): void {
    if (t !== this.tool) this.hideTip();
    this.tool = t;
  }

  /** Der Stift für die nächsten Striche. Ein Strich, der gerade entsteht, bleibt bei seinem. Ein anderer Stift blendet die Spitze aus. */
  setPen(pen: PenKind): void {
    if (pen !== this.pen) this.hideTip();
    this.pen = pen;
  }

  /** Die Regler der Füllfeder für die nächsten Striche. Ein Strich, der gerade entsteht, bleibt bei seinen. */
  setFueller(s: FuellerSettings): void {
    this.fueller = s;
  }

  setColor(c: InkColor): void {
    this.color = c;
  }

  setWidth(w: WidthName): void {
    this.widthMm = WIDTH_MM[w];
  }

  /** Kritzeln über Geschriebenem löscht es (an) oder bleibt ein Strich (aus). */
  setScribble(on: boolean): void {
    this.scribble = on;
  }

  /** Größe und Art des Radierers. Ein Radiervorgang, der gerade läuft, behält seine Art. */
  setEraser(size: EraserSize, mode: EraserMode): void {
    this.eraserPx = ERASER_PX[size];
    this.eraserMode = mode;
  }

  /**
   * Sperrt die Fläche oder gibt sie frei. Beim Sperren endet, was gerade entsteht, ohne zur Seite zu gehören: Ein Strich
   * verschwindet, radierte Striche stehen wieder da. Die Seite wird nicht mehr gespeichert, also soll auch nichts auf
   * dem Bildschirm stehen, was nie gespeichert wird. Die Spitze beim Schweben geht sofort: Hier schreibt der Stift nicht mehr.
   */
  setReadOnly(on: boolean): void {
    this.readOnly = on;
    if (!on) return;
    this.cancelInput();
    this.hideTip();
  }

  undo(): void {
    if (!this.readOnly && this.history.undo(this.strokes)) this.edited();
  }

  redo(): void {
    if (!this.readOnly && this.history.redo(this.strokes)) this.edited();
  }

  /**
   * Der Stift hebt ab, ohne dass er es getan hat, weil die Seite verlassen wird: Ein Strich oder Radieren im Gang
   * wird fertig und gemeldet wie sonst beim Abheben.
   */
  finishInput(): void {
    if (this.drawing) this.finishDraw(true);
    if (this.erasing) this.finishErase();
  }

  /** Die ganze Seitenbreite auf den Bildschirm. */
  zoomToFit(): void {
    this.view = { s: this.fit, x: (this.vw - PAGE_W * this.fit) / 2, y: 16 };
    this.clampView();
    this.render();
  }

  /** Liegt gerade ein Finger auf der Fläche? Dann gehört jeder weitere zur selben Geste. */
  get fingersDown(): boolean {
    return this.touches.size > 0;
  }

  /**
   * Übernimmt einen Finger, der auf etwas aufgesetzt hat, das über der Fläche liegt (eine Karte): Von jetzt an bewegt er die Seite
   * wie ein Finger auf der Fläche, zwei Finger zoomen sie (auch wenn nur einer auf der Karte liegt), und ein Zwei-Finger-Tipp
   * macht rückgängig. `from` ist, wo und wann der Finger aufgesetzt hat: Die Fläche rechnet so, als wäre er von dort an bei ihr
   * gewesen, die Seite folgt ihm also von seinem Aufsetzpunkt aus. Die Fläche fängt den Zeiger ein: Seine weiteren Ereignisse
   * kommen bei ihr an und nicht mehr bei der Karte. Gibt `false` zurück, wenn sie ihn nicht annimmt (kein Finger, ein Handballen,
   * der Stift liegt auf).
   */
  adopt(e: PointerEvent, from: { clientX: number; clientY: number; timeStamp: number }): boolean {
    if (this.destroyed || e.pointerType !== 'touch') return false;
    if (this.touches.has(e.pointerId)) return true;
    if (!this.filter.acceptTouch(e, e.timeStamp)) return false;
    this.refreshRect();
    if (!this.touches.size) this.forgetTaps();
    this.capture(e);
    const start = this.local(from);
    this.touches.set(e.pointerId, start);
    this.logFinger(e, 'down', { at: start, t: from.timeStamp });
    this.rebaseGesture();
    const here = this.local(e);
    if (here.x !== start.x || here.y !== start.y) {
      this.touches.set(e.pointerId, here);
      this.logFinger(e, 'move');
      this.moveGesture();
    }
    return true;
  }

  /** Ort der Seite (Seiteneinheiten) in Bildschirmkoordinaten (`clientX`, `clientY`). */
  toClient(x: number, y: number): Pt2 {
    this.refreshRect();
    return { x: this.rect.left + this.view.x + x * this.view.s, y: this.rect.top + this.view.y + y * this.view.s };
  }

  destroy(): void {
    this.destroyed = true;
    for (const stop of this.cleanups) stop();
    this.observer.disconnect();
    cancelAnimationFrame(this.raf);
    this.stopMeter();
    clearTimeout(this.predTimer);
    clearTimeout(this.wheelTimer);
    this.forgetPenEnd();
    clearTimeout(this.flashTimer);
    this.flashEl?.remove();
    this.hideTip();
    this.neighbors = { above: null, below: null }; // ihre Bilder gehen mit (die zuletzt gebrauchten hält `loadedBackgrounds`)
    for (const c of [this.base, this.live, this.pred, this.snap]) {
      c.remove();
      // Safari gibt den Speicher einer Zeichenfläche erst frei, wenn sie nichts mehr zu halten hat, und deckelt alle zusammen.
      c.width = 0;
      c.height = 0;
    }
  }

  // ---------- Aufbau ----------

  private layer(name: string, receivesInput: boolean): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.dataset.layer = name;
    Object.assign(c.style, { position: 'absolute', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none' });
    if (!receivesInput) {
      c.style.pointerEvents = 'none';
      c.setAttribute('aria-hidden', 'true');
    }
    return c;
  }

  private listen(target: EventTarget, type: string, fn: (e: never) => void, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn as EventListener, options);
    this.cleanups.push(() => target.removeEventListener(type, fn as EventListener, options));
  }

  private resize(): void {
    const r = this.el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return; // noch nicht (oder nicht mehr) sichtbar: Die nächste Größenänderung holt es nach
    const had = this.hasView;
    const oldFit = this.fit;
    const cx = (this.vw / 2 - this.view.x) / this.view.s;
    const cy = (this.vh / 2 - this.view.y) / this.view.s;
    this.dpr = clamp(window.devicePixelRatio || 1, 1, 3);
    this.vw = r.width;
    this.vh = r.height;
    for (const c of [this.base, this.live, this.pred]) {
      c.width = Math.round(this.vw * this.dpr);
      c.height = Math.round(this.vh * this.dpr);
    }
    this.refreshRect();
    this.fit = Math.max(0.2, Math.min((this.vw - 2 * SIDE_MARGIN_PX) / PAGE_W, 1.6));
    if (!had) {
      this.hasView = true;
      const start = this.opts.initialView;
      const { min, max } = this.zoomLimits();
      this.view = start ? { ...start, s: clamp(start.s, min, max) } : { s: this.fit, x: (this.vw - PAGE_W * this.fit) / 2, y: 16 };
    } else {
      // Die Mitte des Bildschirms bleibt bei derselben Stelle der Seite, der Zoom behält sein Verhältnis zur Seitenbreite.
      this.view.s = (this.view.s / oldFit) * this.fit;
      this.view.x = this.vw / 2 - cx * this.view.s;
      this.view.y = this.vh / 2 - cy * this.view.s;
    }
    this.clampView();
    this.render();
  }

  private refreshRect(): void {
    const r = this.el.getBoundingClientRect();
    this.rect = { left: r.left, top: r.top };
  }

  /** Sagt `onView` die Ansicht, wenn sie sich seit der letzten Meldung geändert hat. */
  private reportView(): void {
    const { s, x, y } = this.view;
    const last = this.reportedView;
    if (last && last.s === s && last.x === x && last.y === y) return;
    this.reportedView = { s, x, y };
    this.opts.onView?.({ s, x, y });
  }

  private changed(): void {
    this.opts.onChange(this.getPage());
  }

  /** Die Striche haben sich durch Rückgängig oder Wiederholen geändert. */
  private edited(): void {
    this.render();
    this.changed();
  }

  /** Verwirft, was gerade entsteht (siehe `setReadOnly`). */
  private cancelInput(): void {
    if (this.drawing) this.finishDraw(false);
    const er = this.erasing;
    if (!er) return;
    this.erasing = null;
    if (er.mode === 'stueck') this.strokes.splice(0, this.strokes.length, ...er.before);
    else restore(this.strokes, er.removed);
    this.clearLive(true);
    this.render();
  }

  // ---------- Koordinaten ----------

  private local(e: { clientX: number; clientY: number }): Pt2 {
    return { x: e.clientX - this.rect.left, y: e.clientY - this.rect.top };
  }

  private toPage(x: number, y: number): Pt2 {
    return { x: (x - this.view.x) / this.view.s, y: (y - this.view.y) / this.view.s };
  }

  private setView(ctx: CanvasRenderingContext2D): void {
    const { dpr, view } = this;
    ctx.setTransform(dpr * view.s, 0, 0, dpr * view.s, dpr * view.x, dpr * view.y);
  }

  // ---------- Zeichnen ----------

  /** Ein Bildpunkt in Seiteneinheiten: Dünner wird kein Strich gezeichnet, sonst verschwindet er. */
  private pixel(): number {
    return 1 / (this.view.s * this.dpr);
  }

  /** Linienbreite eines Strichs auf dem Bildschirm. */
  private lineW(s: Stroke): number {
    return lineWidth(s, this.pixel());
  }

  /** Ein fertiger Strich: Kugelschreiber und Fineliner als Linie in einer Breite, Füllfeder und Bleistift als Form. */
  private drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    if (isShape(s.tool)) {
      this.drawShape(ctx, s);
      return;
    }
    ctx.strokeStyle = INK[s.color];
    ctx.fillStyle = INK[s.color];
    this.drawLine(ctx, s.pts, this.lineW(s));
  }

  /**
   * Ein einziger glatter Pfad in der Breite `w`, derselbe wie in der SVG-Datei (`pathD`): zu jedem Punkt eine Kurve bis zur
   * Mitte zum nächsten, zuletzt eine Linie zum Endpunkt. Ein einzelner Punkt ist ein Kreis. Die Farbe setzt, wer ruft.
   */
  private drawLine(ctx: CanvasRenderingContext2D, p: readonly Pt[], w: number): void {
    const n = p.length;
    if (!n) return;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (n === 1) {
      ctx.arc(p[0].x, p[0].y, w / 2, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    ctx.moveTo(p[0].x, p[0].y);
    for (let i = 1; i < n - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    ctx.lineTo(p[n - 1].x, p[n - 1].y);
    ctx.lineWidth = w;
    ctx.stroke();
  }

  /**
   * Füllfeder und Bleistift: alle Vielecke des Umrisses (`outlineOf`) als runde Kurven wie in der Datei (`traceCurve`) in einem
   * Pfad mit einem `fill` (Regel nonzero), so hat die Form kein Loch. Keine Stelle ist dünner als ein Bildpunkt, sonst verschwände
   * sie (die Datei behält die echten Breiten). Der Bleistift malt mit seiner Deckkraft in einem Zug, darum wird er dort, wo er sich
   * selbst überlappt, nicht dunkler. Mit Körnung nur, wo er auf dem Bildschirm mindestens `GRAIN_MIN_PX` Bildpunkte breit ist.
   */
  private drawShape(ctx: CanvasRenderingContext2D, s: Stroke): void {
    if (!s.pts.length) return;
    const pencil = s.tool === 'bleistift';
    ctx.save();
    if (pencil) ctx.globalAlpha = BLEISTIFT_OPACITY;
    this.shapePaint(ctx, s.color, { grainy: pencil && boundsOf(s).maxW * this.view.s * this.dpr >= GRAIN_MIN_PX });
    ctx.beginPath();
    for (const poly of outlineOf(s, this.pixel())) traceCurve(ctx, poly);
    ctx.fill('nonzero');
    ctx.restore();
  }

  /**
   * Womit eine Form gemalt wird: in der Farbe des Strichs, mit `grainy` (nur fertige Bleistiftstriche) im Kornmuster, voll
   * deckend (die Deckkraft des Bleistifts setzt, wer zeichnet). Das Muster wird nicht geglättet: So deckt jeder Bildpunkt ganz
   * oder gar nicht, auch vergrößert, und wo sich Stücke auf einer Ebene überlappen, wird es nicht dunkler.
   */
  private shapePaint(ctx: CanvasRenderingContext2D, color: StrokeColor, { grainy }: { grainy: boolean }): void {
    const grain = grainy ? this.grain(ctx) : null;
    ctx.fillStyle = grain ?? INK[color];
    ctx.strokeStyle = grain ?? INK[color];
    ctx.imageSmoothingEnabled = !grain;
  }

  /**
   * Das Kornmuster einer Ebene: die Kachel wiederholt, ein Feld `GRAIN.cell` Seiteneinheiten groß. Jede Ebene zeichnet in
   * Seitenkoordinaten, darum liegt die Körnung fest auf der Seite und ist auf allen Ebenen dieselbe.
   */
  private grain(ctx: CanvasRenderingContext2D): CanvasPattern | null {
    if (!this.grains.has(ctx)) {
      const pattern = ctx.createPattern(grainTile(), 'repeat');
      pattern?.setTransform(new DOMMatrix().scale(GRAIN.cell, GRAIN.cell));
      this.grains.set(ctx, pattern);
    }
    return this.grains.get(ctx) ?? null;
  }

  /**
   * Hintergrund als SVG-Bild, damit er bei jedem Zoom scharf bleibt. Gleicher Text: nichts neu laden. Ein Bild, das schon
   * geladen ist (siehe `loadedBackgrounds`), gilt sofort. Mit `keepOld` bleibt das bisherige Bild stehen, bis das neue geladen
   * ist: Bei jeder Eingabe im Kopf einer Besprechung ändert sich der Hintergrund, und eine Zeichnung zwischendurch zeigte kurz
   * leeres Papier.
   */
  private setBackground(svg: string, keepOld = false): void {
    if (svg === this.backgroundSvg) return;
    this.backgroundSvg = svg;
    const ready = svg ? loadedBackground(svg) : null;
    if (ready) {
      this.background = ready;
      this.scheduleRender();
      return;
    }
    if (!keepOld) this.background = null;
    if (!svg) return;
    const img = new Image();
    img.onload = () => {
      img.onload = null; // das Bild bleibt vielleicht in `loadedBackgrounds`: Es soll die Fläche dann nicht festhalten
      keepBackground(svg, img);
      if (this.destroyed || svg !== this.backgroundSvg) return;
      this.background = img;
      this.scheduleRender();
    };
    img.src = backgroundSrc(svg);
  }

  /**
   * Der Nachbar `side`, wie die Fläche ihn zeigen soll: mit den Strichen von `next` und dessen Hintergrund. Ein neuer
   * Hintergrund lädt als Bild, bis dahin bleibt das bisherige (wie `showBackground`).
   */
  private neighborFrom(side: Side, next: NeighborPage | null): Neighbor | null {
    if (!next) return null;
    const before = this.neighbors[side];
    const svg = next.background;
    const changed = svg !== '' && svg !== before?.svg;
    // Ein Bild, das schon geladen ist (siehe `loadedBackgrounds`), gilt sofort.
    const ready = changed ? loadedBackground(svg) : null;
    if (changed && !ready) this.loadNeighborImage(side, svg);
    return { strokes: next.strokes.slice(), svg, image: ready ?? (svg ? (before?.image ?? null) : null) };
  }

  /** Lädt den Hintergrund eines Nachbarn als Bild. Es gilt nur, wenn der Nachbar dann noch genau diesen Hintergrund hat. */
  private loadNeighborImage(side: Side, svg: string): void {
    const img = new Image();
    img.onload = () => {
      img.onload = null; // wie bei `setBackground`: Das Bild im Speicher hält die Fläche nicht fest
      keepBackground(svg, img);
      const n = this.neighbors[side];
      if (this.destroyed || !n || n.svg !== svg) return;
      n.image = img;
      this.scheduleRender();
    };
    img.src = backgroundSrc(svg);
  }

  /** Papier mit Schatten und darauf den Hintergrund `image` (fehlt er noch, nur das Papier), dort, wohin `ctx` gerade zeichnet. */
  private drawPaper(ctx: CanvasRenderingContext2D, image: HTMLImageElement | null): void {
    const px = 1 / this.view.s; // ein Bildschirmpunkt in Seiteneinheiten
    ctx.fillStyle = 'rgba(22, 32, 48, 0.10)';
    ctx.fillRect(2 * px, 3 * px, PAGE_W, PAGE_H);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    if (image) ctx.drawImage(image, 0, 0, PAGE_W, PAGE_H);
  }

  /** Die Striche, die im Bild liegen (`seen`: links, oben, rechts, unten in Seiteneinheiten), die anderen spart es sich. */
  private drawStrokes(ctx: CanvasRenderingContext2D, strokes: readonly Stroke[], seen: Box): void {
    const [x0, y0, x1, y1] = seen;
    for (const s of strokes) {
      const { box, maxW } = boundsOf(s);
      const m = Math.max(maxW, this.lineW(s));
      if (box[2] + m < x0 || box[0] - m > x1 || box[3] + m < y0 || box[1] - m > y1) continue;
      this.drawStroke(ctx, s);
    }
  }

  /**
   * Ein Nachbar an seinem Platz über oder unter der Seite, wie die Seite selbst: Papier mit Schatten, Hintergrund und die Striche
   * im Bild (`seen` in Einheiten der Seite). Liegt er ganz außerhalb des Bilds, zeichnet es nichts.
   */
  private drawNeighbor(ctx: CanvasRenderingContext2D, side: Side, seen: Box): void {
    const n = this.neighbors[side];
    if (!n) return;
    const dy = neighborOffset(side);
    const shadow = 3 / this.view.s; // so weit reicht der Schatten unter das Papier
    if (dy + PAGE_H + shadow < seen[1] || dy > seen[3]) return;
    ctx.save();
    ctx.translate(0, dy);
    this.drawPaper(ctx, n.image);
    this.drawStrokes(ctx, n.strokes, [seen[0], seen[1] - dy, seen[2], seen[3] - dy]);
    ctx.restore();
  }

  private scheduleRender(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** Die Grundebene ganz neu: Papier und alle Striche, die im Bild liegen, und ebenso die Nachbarn, soweit sie zu sehen sind. */
  private render(): void {
    if (this.destroyed || !this.hasView) return;
    this.reportView();
    const { bctx, base, view, dpr } = this;
    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, base.width, base.height);
    const sv = this.gesture?.snapView;
    if (sv) {
      // Volle Seite mitten in einer Geste: nur das Bild verschieben und skalieren, scharf wird es am Ende.
      const k = view.s / sv.s;
      bctx.setTransform(k, 0, 0, k, (view.x - sv.x * k) * dpr, (view.y - sv.y * k) * dpr);
      bctx.drawImage(this.snap, 0, 0);
    } else {
      this.setView(bctx);
      const x0 = -view.x / view.s;
      const y0 = -view.y / view.s;
      const seen: Box = [x0, y0, x0 + this.vw / view.s, y0 + this.vh / view.s];
      // Erst die Nachbarn, dann die Seite darüber: Ein Strich der Seite, der über ihren Rand hinausreicht, bleibt zu sehen.
      for (const side of SIDES) this.drawNeighbor(bctx, side, seen);
      this.drawPaper(bctx, this.background);
      this.drawStrokes(bctx, this.strokes, seen);
    }
    if (this.drawing) {
      this.clearPred();
      this.redrawLive();
    }
  }

  // ---------- Strich, der gerade entsteht ----------

  /** Rahmen in Bildschirmpunkten, den ein Rahmen der Seite mit Rand `pad` (Seiteneinheiten) belegt. */
  private screenBox(b: Box, pad: number): Box {
    const { s, x, y } = this.view;
    return [(b[0] - pad) * s + x, (b[1] - pad) * s + y, (b[2] + pad) * s + x, (b[3] + pad) * s + y];
  }

  /** Löscht die Ebene, ganz oder nur dort, wo zuletzt gezeichnet wurde (das spart Zeit und damit Verzögerung). */
  private clearLive(all: boolean): void {
    const { lctx, dpr } = this;
    lctx.setTransform(1, 0, 0, 1, 0, 0);
    if (all) lctx.clearRect(0, 0, this.live.width, this.live.height);
    else if (this.liveArea) {
      const [x0, y0, x1, y1] = this.liveArea;
      lctx.clearRect(Math.floor(x0 * dpr) - 2, Math.floor(y0 * dpr) - 2, Math.ceil((x1 - x0) * dpr) + 4, Math.ceil((y1 - y0) * dpr) + 4);
    }
    this.liveArea = null;
  }

  /** Breite des entstehenden Strichs auf dem Bildschirm. */
  private liveW(d: Drawing): number {
    return Math.max(d.builder.meanW() || this.widthMm * MM, this.pixel());
  }

  /** Zeichnet Punkte `from` bis zum Ende von Segment `to - 1` (oder bis zum letzten Punkt, wenn `toEnd`) als einen Pfad. */
  private tracePath(ctx: CanvasRenderingContext2D, p: readonly Pt[], first: number, to: number, toEnd: boolean): number {
    const n = p.length;
    // Stücke stoßen stumpf aneinander: Runde Kappen an jeder Naht legten die Kanten doppelt übereinander, die Linie sähe
    // live dicker aus als nach dem Abheben. Rund bleiben nur Anfang und Ende des ganzen Strichs.
    ctx.lineCap = 'butt';
    if (first <= 1) this.roundCap(ctx, p[0]);
    if (toEnd) this.roundCap(ctx, p[n - 1]);
    const start = first <= 1 ? p[0] : { x: (p[first - 1].x + p[first].x) / 2, y: (p[first - 1].y + p[first].y) / 2 };
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    const last = toEnd ? n - 1 : to;
    for (let i = Math.max(1, first); i < last && i < n - 1; i++) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
    if (toEnd) ctx.lineTo(p[n - 1].x, p[n - 1].y);
    ctx.stroke();
    return last - Math.max(0, first - 1) + 1;
  }

  /** Kreis in Linienbreite: die runde Kappe an einem Ende des Strichs. */
  private roundCap(ctx: CanvasRenderingContext2D, at: Pt): void {
    ctx.beginPath();
    ctx.arc(at.x, at.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  private inkStyle(ctx: CanvasRenderingContext2D, w: number): void {
    ctx.strokeStyle = INK[this.drawingColor()];
    ctx.fillStyle = ctx.strokeStyle;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = w;
  }

  private drawingColor(): StrokeColor {
    return this.drawing?.color ?? this.color;
  }

  /**
   * Zeichnet den entstehenden Strich weiter: Was fest geworden ist, kommt einmal auf die Live-Ebene, das Endstück (höchstens
   * K + 3 Punkte, bei der Füllfeder ab der ersten Richtung die Punkte in 2,5 σ vor dem Ende) wird auf der Vorhersage-Ebene neu
   * gezeichnet. So kostet jede Bewegung gleich viel, egal wie lang der Strich ist.
   */
  private liveUpdate(): number {
    const d = this.drawing;
    if (!d) return 0;
    if (isShape(d.pen)) return this.liveShape(d);
    const b = d.builder;
    const p = b.points();
    const n = p.length;
    if (!n) return 0;
    const settled = b.settled();
    const w = this.liveW(d);
    let drawnPts = 0;
    const seg = fixedSegments(n, settled, d.drawn);
    if (seg.to > seg.from) {
      this.setView(this.lctx);
      this.inkStyle(this.lctx, w);
      drawnPts += this.tracePath(this.lctx, p, seg.from, seg.to, false);
      d.drawn = seg.to;
    }
    drawnPts += this.paintTail(d);
    return drawnPts;
  }

  /**
   * `liveUpdate` für Formen, Punkt für Punkt: Solange `d.drawn` kleiner ist als die Zahl der festen Punkte, kommen das
   * Viereck von Punkt `d.drawn - 1` her und der Kreis um Punkt `d.drawn` auf die Live-Ebene (der Kreis um Punkt 0 mit dem
   * ersten festen Punkt). Alles, was ein Aufruf dorthin zeichnet, ist ein Pfad mit einem `fill`.
   */
  private liveShape(d: Drawing): number {
    const p = d.builder.points();
    const settled = d.builder.settled();
    let count = 0;
    if (d.drawn < settled) {
      const ctx = this.lctx;
      this.setView(ctx);
      this.shapePaint(ctx, d.color, { grainy: false });
      ctx.beginPath();
      count = addShape(ctx, p, d.drawn, settled, this.pixel());
      ctx.fill('nonzero');
      d.drawn = settled;
    }
    return count + this.paintTail(d);
  }

  /** Das Endstück auf der Vorhersage-Ebene: alten Bereich löschen, neu zeichnen. Gibt die Zahl der Punkte zurück. */
  private paintTail(d: Drawing): number {
    if (isShape(d.pen)) return this.paintShapeTail(d);
    const p = d.builder.points();
    const n = p.length;
    this.clearArea(this.pctx, d.tailArea);
    d.tailArea = null;
    if (!n) return 0;
    const w = this.liveW(d);
    const first = Math.min(d.drawn, tailStart(n, d.builder.settled()) + 1);
    this.setView(this.pctx);
    this.inkStyle(this.pctx, w);
    let count: number;
    if (n === 1) {
      this.pctx.beginPath();
      this.pctx.arc(p[0].x, p[0].y, w / 2, 0, Math.PI * 2);
      this.pctx.fill();
      count = 1;
    } else count = this.tracePath(this.pctx, p, first, n - 1, true);
    const box = emptyBox();
    for (let i = Math.max(0, first - 1); i < n; i++) growBox(box, p[i]);
    d.tailArea = this.screenBox(box, w + 3 / this.view.s);
    return count;
  }

  /**
   * Das Endstück einer Form: Vierecke und Kreise ab Punkt `d.drawn - 1` bis zum Ende, ohne den Kreis um Punkt `d.drawn - 1`
   * (den hat die Live-Ebene), in einem Pfad mit einem `fill`.
   */
  private paintShapeTail(d: Drawing): number {
    const p = d.builder.points();
    const n = p.length;
    this.clearArea(this.pctx, d.tailArea);
    d.tailArea = null;
    if (n <= d.drawn) return 0;
    const ctx = this.pctx;
    const px = this.pixel();
    this.setView(ctx);
    this.shapePaint(ctx, d.color, { grainy: false });
    ctx.beginPath();
    const count = addShape(ctx, p, d.drawn, n, px);
    ctx.fill('nonzero');
    const box = emptyBox();
    let r = px / 2;
    for (let i = Math.max(0, d.drawn - 1); i < n; i++) {
      growBox(box, p[i]);
      r = Math.max(r, p[i].w / 2);
    }
    d.tailArea = this.screenBox(box, r + 3 / this.view.s);
    return count;
  }

  /** Löscht einen Bereich (Bildschirmpunkte) einer Ebene. */
  private clearArea(ctx: CanvasRenderingContext2D, a: Box | null): void {
    if (!a) return;
    const { dpr } = this;
    const [x0, y0, x1, y1] = a;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(Math.floor(x0 * dpr) - 2, Math.floor(y0 * dpr) - 2, Math.ceil((x1 - x0) * dpr) + 4, Math.ceil((y1 - y0) * dpr) + 4);
  }

  /** Den entstehenden Strich ganz neu zeichnen (nach Zoom oder Verschieben). */
  private redrawLive(): void {
    this.clearLive(true);
    const d = this.drawing;
    if (d) {
      this.clearPredLayer();
      d.drawn = nothingDrawn(d.pen);
      d.tailArea = null;
    }
    this.liveUpdate();
  }

  /** Die ganze Vorhersage-Ebene leeren (Endstück und Vorhersage). */
  private clearPredLayer(): void {
    clearTimeout(this.predTimer);
    this.pctx.setTransform(1, 0, 0, 1, 0, 0);
    this.pctx.clearRect(0, 0, this.pred.width, this.pred.height);
    this.predArea = null;
  }

  private clearPred(): void {
    clearTimeout(this.predTimer);
    if (!this.predArea) return;
    const [x0, y0, x1, y1] = this.predArea;
    const { pctx, dpr } = this;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(Math.floor(x0 * dpr) - 2, Math.floor(y0 * dpr) - 2, Math.ceil((x1 - x0) * dpr) + 4, Math.ceil((y1 - y0) * dpr) + 4);
    this.predArea = null;
    // Vorhersage und Endstück teilen sich die Ebene: was die Vorhersage überdeckt hat, wieder zeichnen.
    if (this.drawing) this.paintTail(this.drawing);
  }

  /** Zeichnet die Linie ein Stück vor den Stift, damit sie nicht hinterherhinkt. */
  private predict(e: PointerEvent): void {
    this.clearPred();
    const d = this.drawing;
    if (!this.opts.prediction || !d || !d.builder.points().length) return;
    let target: Pt2 | null = null;
    try {
      const list = e.getPredictedEvents(); // Safari liefert eigene Vorhersagen, wenn es sie kann
      if (list.length) target = this.local(list[list.length - 1]);
    } catch {
      // keine Vorhersage vom Browser
    }
    target ??= extrapolate(d.hist); // sonst aus der Geschwindigkeit der letzten Punkte vorausrechnen
    if (!target) return;
    const pts = d.builder.points();
    const last = pts[pts.length - 1];
    const t = this.toPage(target.x, target.y);
    const { pctx } = this;
    this.setView(pctx);
    let pad: number;
    if (isShape(d.pen)) {
      // Eine Form: Viereck vom letzten Punkt zum vorhergesagten in der Breite des letzten Punkts, ein Kreis am Ende.
      const r = Math.max(last.w, this.pixel()) / 2;
      this.shapePaint(pctx, d.color, { grainy: false });
      pctx.beginPath();
      addQuad(pctx, last, r, t, r);
      addCircle(pctx, t, r);
      pctx.fill('nonzero');
      pad = r + 2 / this.view.s;
    } else {
      const w = this.liveW(d);
      pctx.strokeStyle = INK[d.color];
      pctx.lineCap = 'round';
      pctx.lineWidth = w;
      pctx.beginPath();
      pctx.moveTo(last.x, last.y);
      pctx.lineTo(t.x, t.y);
      pctx.stroke();
      pad = w + 2 / this.view.s;
    }
    this.predArea = this.screenBox([Math.min(last.x, t.x), Math.min(last.y, t.y), Math.max(last.x, t.x), Math.max(last.y, t.y)], pad);
    this.predTimer = window.setTimeout(() => this.clearPred(), 40); // der Stift steht still: Vorhersage wieder weg
  }

  private beginDraw(e: PointerEvent): void {
    const pos = this.local(e);
    if (this.tool === 'eraser') {
      this.erasing = { id: e.pointerId, mode: this.eraserMode, removed: [], before: this.strokes.slice(), cuts: new Map(), origin: new Map(), last: pos };
      this.eraseAt(pos);
      this.eraserCursor(pos);
      return;
    }
    const pen = this.pen;
    const builder = this.newBuilder(pen);
    const color = builder.stroke().color;
    this.drawing = { id: e.pointerId, builder, pen, color, box: emptyBox(), drawn: nothingDrawn(pen), tailArea: null, hist: [] };
    this.addSample(e);
    this.liveUpdate();
    this.startMeter();
  }

  private newBuilder(pen: PenKind): StrokeBuilder {
    return new StrokeBuilder({
      pen,
      color: this.color,
      widthMm: this.widthMm,
      // Die Glättung aus den Einstellungen. Die Füllfeder glättet stattdessen mit ihrer Strich-Stabilisierung (aus `fueller` und `pxUnit`).
      sigma: this.opts.sigma,
      t: Date.now(),
      minDist: MIN_DIST_PX / this.view.s, // auf dem Bildschirm immer gleich weit, egal wie weit hineingezoomt ist
      // Nur die Füllfeder liest diese beiden: ihre Regler und wie viele Seiteneinheiten ein Bildschirmpunkt gerade ist.
      fueller: this.fueller,
      pxUnit: 1 / this.view.s,
    });
  }

  /** Liegt der Ort der Seite in einem Rechteck, in dem der Stift nicht schreibt? */
  private inNoInk(p: Pt2): boolean {
    return (this.opts.noInk ?? []).some(([x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h);
  }

  private addSample(ev: PointerEvent): void {
    const d = this.drawing!;
    // Die Spitze beim Schweben steht wie die Feder beim letzten Strich, auch auf der nächsten Seite.
    lastPenDir = penAngle(ev.tiltX ?? 0, ev.tiltY ?? 0) ?? lastPenDir;
    const pos = this.local(ev);
    const pt = this.toPage(pos.x, pos.y);
    if (this.inNoInk(pt)) {
      this.cutStroke();
      return;
    }
    d.hist.push({ x: pos.x, y: pos.y, t: ev.timeStamp });
    if (d.hist.length > 12) d.hist.shift();
    // Jedes Ereignis mit seiner eigenen Zeit, auch die zusammengefassten: Daraus misst die Füllfeder das Tempo.
    if (d.builder.add(pt.x, pt.y, ev.pressure, ev.tiltX ?? 0, ev.tiltY ?? 0, ev.timeStamp)) growBox(d.box, pt);
  }

  /**
   * Der Stift kommt in ein Rechteck ohne Tinte: Der Strich bis hierher ist fertig, und der nächste beginnt, wo der Stift das
   * Rechteck verlässt. Ohne den Schnitt zöge die Linie quer durch das Rechteck von dem Punkt davor zu dem Punkt danach.
   */
  private cutStroke(): void {
    const d = this.drawing;
    if (!d || !d.builder.points().length) return;
    this.commitStroke(d);
    d.builder = this.newBuilder(d.pen);
    d.box = emptyBox();
    d.drawn = nothingDrawn(d.pen);
    d.tailArea = null;
    d.hist = [];
    this.clearLive(true);
    this.clearPredLayer();
  }

  /**
   * Der Strich wird Teil der Seite, und die Seite meldet die Änderung sofort. Ein Gekritzel über Geschriebenem löscht es
   * stattdessen. Gespeichert wird der fertige Strich, bei der Füllfeder mit beiden spitzen Enden. `tUp` ist die Zeit des
   * Abhebens, falls bekannt: Bis dahin klingt bei der Füllfeder das Tempo ab. Der Strich kommt gleich in der Genauigkeit der
   * Datei auf die Seite (`storedForm`): Was nach dem Abheben zu sehen ist, ist genau das, was nach dem Neuladen zu sehen ist.
   */
  private commitStroke(d: Drawing, tUp?: number): void {
    const s = storedForm(d.builder.finish(tUp));
    if (!s.pts.length) return;
    if (this.scribble && this.eraseByScribble(s)) return;
    this.strokes.push(s);
    this.setView(this.bctx);
    this.drawStroke(this.bctx, s);
    this.history.push({ type: 'add', stroke: s });
    this.changed();
  }

  /**
   * Ist `s` ein Gekritzel über Strichen, verschwinden sie, und das Gekritzel kommt nicht auf die Seite. Rückgängig holt sie
   * in einem Schritt zurück. Wahr, wenn gelöscht wurde. Ein Gekritzel über leerem Papier bleibt ein Strich.
   */
  private eraseByScribble(s: Stroke): boolean {
    if (!isScribble(s.pts, Date.now() - s.t)) return false;
    const targets = scribbleTargets(s, this.strokes);
    if (!targets.length) return false;
    const before = this.strokes.slice();
    takeOutIds(this.strokes, new Set(targets));
    this.history.push({ type: 'swap', before, after: this.strokes.slice() });
    this.render();
    this.flash(boundsOf(s).box);
    this.changed();
    return true;
  }

  /**
   * Ein heller Kreis für 300 ms dort, wo das Gekritzel gelöscht hat: So sieht man, dass es kein Strich war. Er ist ein eigenes
   * Element über der Fläche, nicht auf einer Zeichenebene: So löscht sein Verschwinden nichts, was inzwischen dort gezeichnet wurde.
   */
  private flash(b: Box): void {
    clearTimeout(this.flashTimer);
    this.flashEl?.remove();
    const [x0, y0, x1, y1] = this.screenBox(b, 4 / this.view.s);
    const d = Math.max(x1 - x0, y1 - y0);
    const el = document.createElement('div');
    el.className = 'kritzel-hinweis';
    el.setAttribute('aria-hidden', 'true');
    Object.assign(el.style, {
      position: 'absolute',
      left: `${(x0 + x1 - d) / 2}px`,
      top: `${(y0 + y1 - d) / 2}px`,
      width: `${d}px`,
      height: `${d}px`,
      borderRadius: '50%',
      background: 'rgba(44, 90, 138, 0.15)',
      pointerEvents: 'none',
    });
    this.el.append(el);
    this.flashEl = el;
    this.flashTimer = window.setTimeout(() => {
      el.remove();
      if (this.flashEl === el) this.flashEl = null;
    }, 300);
  }

  /** Der Stift hebt ab (zur Zeit `tUp`, falls bekannt), oder der Strich wird abgebrochen (`commit` falsch). */
  private finishDraw(commit: boolean, tUp?: number): void {
    const d = this.drawing;
    this.drawing = null;
    this.stopMeter();
    this.clearLive(true);
    this.clearPredLayer();
    if (d && commit) this.commitStroke(d, tUp);
  }

  /** Zählt Bilder, solange der Stift schreibt. */
  private startMeter(): void {
    cancelAnimationFrame(this.meterRaf);
    this.meter.pause();
    const tick = (now: number) => {
      this.meter.frame(now);
      this.meterRaf = requestAnimationFrame(tick);
    };
    this.meterRaf = requestAnimationFrame(tick);
  }

  private stopMeter(): void {
    cancelAnimationFrame(this.meterRaf);
    this.meterRaf = 0;
  }

  /** Für Tests: Stiftbewegungen und die meisten Punkte, die eine Bewegung gezeichnet hat. */
  liveStats(): { events: number; ptsMax: number } {
    return { events: this.liveEvents, ptsMax: this.livePtsMax };
  }

  // ---------- Radierer (ganze Striche) ----------

  /** Radiert an einem Ort (Bildschirmpunkte) im Umkreis des Radierers: ganze Striche oder nur das Stück unter dem Kreis. */
  private eraseAt(at: Pt2): void {
    const er = this.erasing;
    if (!er) return;
    const p = this.toPage(at.x, at.y);
    const r = this.eraserPx / this.view.s;
    const hits = hitIndexes(this.strokes, p, r, this.pixel());
    if (!hits.length) return;
    if (er.mode === 'strich') er.removed.push(...takeOut(this.strokes, hits));
    else {
      // Die höchsten zuerst: So bleiben die Stellen der übrigen gültig, auch wenn ein Strich in mehrere Stücke zerfällt.
      const minW = this.pixel();
      for (const i of hits) {
        const s = this.strokes[i];
        // Mindestens einen Bildpunkt breit gezeichnet, also trifft der Kreis ihn auch so breit (wie beim ganzen Strich).
        const cut = cutStroke(s, p, r + Math.max(0, minW - s.w) / 2, () => newStrokeId(s.t));
        if (!cut) continue;
        // Wie ein fertiger Strich gleich in der Genauigkeit der Datei: Die neuen Punkte am Schnitt sähen sonst nach dem Neuladen anders aus.
        const pieces = cut.map(storedForm);
        const orig = er.origin.get(s.id) ?? s.id;
        for (const piece of pieces) er.origin.set(piece.id, orig);
        const kept = (er.cuts.get(orig) ?? [s]).flatMap((x) => (x.id === s.id ? pieces : [x]));
        er.cuts.set(orig, kept);
        this.strokes.splice(i, 1, ...pieces);
      }
    }
    this.scheduleRender();
  }

  /** Radiert entlang einer Strecke in kleinen Schritten, damit kein Strich zwischen zwei Messpunkten durchrutscht. */
  private erasePath(from: Pt2, to: Pt2): void {
    for (const at of pointsAlong(from, to, Math.min(ERASER_STEP_PX, this.eraserPx / 2))) this.eraseAt(at);
  }

  private eraserCursor(p: Pt2): void {
    this.clearLive(false);
    const ctx = this.lctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(p.x, p.y, this.eraserPx, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(44, 90, 138, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(44, 90, 138, 0.9)';
    ctx.stroke();
    const m = this.eraserPx + 2;
    this.liveArea = [p.x - m, p.y - m, p.x + m, p.y + m];
  }

  private finishErase(): void {
    const er = this.erasing;
    this.erasing = null;
    this.clearLive(true);
    if (!er) return;
    if (er.mode === 'stueck') {
      if (!er.cuts.size) return;
      this.history.push({ type: 'swap', before: er.before, after: this.strokes.slice() });
    } else {
      if (!er.removed.length) return;
      this.history.push({ type: 'erase', removed: er.removed });
    }
    this.changed();
  }

  // ---------- Ansicht und Gesten ----------

  private zoomLimits(): ZoomLimits {
    return { min: this.fit * MIN_ZOOM, max: this.fit * MAX_ZOOM };
  }

  /** Hält die Ansicht in ihren Grenzen. Mit Nachbarn reicht sie bis in sie hinein (siehe `chainSpan`). */
  private clampView(): void {
    this.view = clampView(this.view, { w: this.vw, h: this.vh }, { w: PAGE_W, h: PAGE_H }, chainSpan(this.present()));
  }

  /** Welche Nachbarn da sind. */
  private present(): Present {
    return { above: this.neighbors.above !== null, below: this.neighbors.below !== null };
  }

  /** Der Nachbar an einem Ort der Fläche (Bildschirmpunkte), auch im Spalt vor ihm (`sideAt`). Auf der Seite selbst `null`. */
  private neighborAt(at: Pt2): Side | null {
    return sideAt(this.toPage(at.x, at.y).y, this.present());
  }

  /** Macht den Nachbarn `side` zur offenen Seite (siehe `onNeighbor`), mit der Ansicht, wie sie jetzt ist. */
  private openNeighbor(side: Side): void {
    this.opts.onNeighbor?.(side, { ...this.view });
  }

  /** Eine Geste beginnt oder die Zahl der Finger ändert sich: Ab jetzt zählt, was die Finger von hier aus tun. */
  private rebaseGesture(): void {
    const g = (this.gesture ??= { revert: { ...this.view }, ref: this.view, from: [], moved: false, snapView: null });
    g.ref = { ...this.view };
    g.from = [...this.touches.values()].map((p) => ({ ...p }));
  }

  private moveGesture(): void {
    const g = this.gesture;
    const next = g && gestureView(g.ref, g.from, [...this.touches.values()], this.zoomLimits(), g.moved);
    if (!g || !next) return;
    this.startMoving(g);
    this.view = next;
    this.clampView();
    this.scheduleRender();
  }

  /**
   * Auf einer vollen Seite würde jedes Bild alle Striche neu zeichnen: Dann zeigt die Geste nur ein Bild der Grundebene. Die
   * Striche der Nachbarn zählen mit, auch sie zeichnet jedes Bild neu.
   */
  private startMoving(g: Gesture): void {
    if (g.moved) return;
    g.moved = true;
    let points = 0;
    for (const list of [this.strokes, ...SIDES.map((side) => this.neighbors[side]?.strokes ?? [])]) {
      for (const s of list) points += s.pts.length;
    }
    if (points <= HEAVY_POINTS) return;
    this.snap.width = this.base.width;
    this.snap.height = this.base.height;
    context(this.snap).drawImage(this.base, 0, 0);
    g.snapView = { ...this.view };
  }

  /**
   * Alle Finger sind weg. Mit `revert` gilt die Ansicht von vor der Geste: Der Stift kam, das war die Hand. Sonst wird nach einem
   * Zug die Nachbarseite gemeldet, die jetzt die Mitte des Bildschirms bedeckt (`onNeighbor`). Gibt zurück, ob das geschah.
   */
  private endGesture(revert: boolean): boolean {
    const g = this.gesture;
    if (!g) return false;
    this.gesture = null;
    if (revert && g.moved) this.view = g.revert;
    this.snap.width = 0;
    this.snap.height = 0;
    if (!g.moved) return false;
    this.render();
    const side = revert ? null : settledSide(this.view, { w: this.vw, h: this.vh }, this.present());
    if (!side || !this.opts.onNeighbor) return false;
    this.openNeighbor(side);
    return true;
  }

  // ---------- Spitze beim Schweben ----------

  /**
   * Der Stift schwebt über der Seite, ohne sie zu berühren. Mit der Füllfeder auf einer Seite, die man beschreiben kann, zeigt
   * die Spitze, wo er aufsetzen würde: die Form der Feder bei mittlerem Druck (`nibShape`), gedreht wie beim letzten Strich.
   * Über einem Nachbarn und dem Spalt davor schreibt er nicht (er öffnet ihn), dort steht keine Spitze.
   */
  private hover(e: PointerEvent): void {
    if (this.readOnly || this.tool !== 'pen' || this.pen !== 'fueller' || this.drawing) {
      this.hideTip();
      return;
    }
    // Ob er über einem Nachbarn schwebt, sagt die Lage der Fläche, wie sie zuletzt gemessen war: Auch dafür wird nicht bei jeder
    // Meldung neu gemessen.
    if (this.neighborAt(this.local(e))) {
      this.hideTip();
      return;
    }
    // Wo die Fläche liegt, wird nur gemessen, wenn noch keine Spitze steht (erstes Schweben, nach dem Verlassen, nach einer
    // Pause), sonst wie immer bei Größe, Rad und Aufsetzen. Jedes Messen erzwingt ein Layout, und der Stift meldet sich oft.
    if (!this.tipEl) this.refreshRect();
    this.showTip(this.local(e));
  }

  /**
   * Stellt die Spitze mit ihrer Mitte auf `at` (Bildschirmpunkte in der Fläche): ein eigenes Element über den Ebenen, so löscht
   * ihr Wandern nichts, was dort gezeichnet ist. Ohne neue Schwebe-Meldung geht sie nach `TIP_HOLD_MS`.
   */
  private showTip(at: Pt2): void {
    const shape = nibShape(this.fueller, this.widthMm * MM, lastPenDir);
    // Bildschirmpunkte je Seiteneinheit: wie die Seite, aber so viele, dass die Spitze mindestens `TIP_MIN_PX` lang ist.
    const k = Math.max(this.view.s, TIP_MIN_PX / shape.long);
    const long = shape.long * k;
    const short = shape.short * k;
    if (!this.tipEl) {
      const el = document.createElement('div');
      el.className = 'spitze';
      el.setAttribute('aria-hidden', 'true');
      this.el.append(el);
      this.tipEl = el;
    }
    Object.assign(this.tipEl.style, {
      left: `${at.x - long / 2}px`,
      top: `${at.y - short / 2}px`,
      width: `${long}px`,
      height: `${short}px`,
      transform: `rotate(${shape.angle}rad)`,
      background: INK[this.color],
    });
    clearTimeout(this.tipTimer);
    this.tipTimer = window.setTimeout(() => this.hideTip(), TIP_HOLD_MS);
  }

  private hideTip(): void {
    clearTimeout(this.tipTimer);
    this.tipEl?.remove();
    this.tipEl = null;
  }

  // ---------- Eingabe ----------

  private capture(e: PointerEvent): void {
    try {
      this.el.setPointerCapture(e.pointerId);
    } catch {
      // ein künstliches Ereignis hat keinen aktiven Zeiger
    }
  }

  /** Hält ein Ereignis eines Fingers fest. `where` gilt statt des Ortes und der Zeit des Ereignisses (ein Finger, der früher aufsetzte, siehe `adopt`). */
  private logFinger(e: PointerEvent, type: FingerEvent['type'], where?: { at: Pt2; t: number }): void {
    const p = where?.at ?? this.local(e);
    const event: FingerEvent = { id: e.pointerId, type, x: p.x, y: p.y, t: where?.t ?? e.timeStamp };
    this.tapLog.push(event);
    // Rückgängig machen nur Finger: Die Maus hat nur einen Zeiger und kann keinen Zwei-Finger-Tipp machen.
    if (e.pointerType === 'touch') this.fingerLog.push(event);
  }

  private forgetTaps(): void {
    this.fingerLog = [];
    this.tapLog = [];
  }

  private onDown = (e: PointerEvent): void => {
    this.hideTip(); // der Stift setzt auf: Die Linie übernimmt
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.refreshRect();
    if (e.pointerType === 'pen') {
      this.filter.penDown(e.timeStamp);
      this.penKnown = e.pointerId;
      this.endGesture(true); // die Hand lag schon auf dem Bildschirm: was die Finger eben verschoben haben, war sie
      this.touches.clear();
      this.forgetTaps();
      if (this.drawing) this.finishDraw(true);
      if (this.erasing) this.finishErase();
      // Auf einer Nachbarseite oder im Spalt davor schreibt und radiert der Stift nicht, gleich welches Werkzeug gilt: Sein
      // Aufsetzen macht sie zur offenen Seite. Erst der nächste Kontakt schreibt, dann auf ihr.
      const side = this.neighborAt(this.local(e));
      if (side) {
        this.openNeighbor(side);
        return;
      }
      if (this.readOnly) return;
      this.capture(e);
      this.beginDraw(e);
      return;
    }
    if (e.pointerType === 'touch' && !this.filter.acceptTouch(e, e.timeStamp)) return;
    // Finger und Maus schreiben nie, sie verschieben und zoomen die Seite.
    if (e.pointerType !== 'touch') this.capture(e);
    if (!this.touches.size) this.forgetTaps();
    this.touches.set(e.pointerId, this.local(e));
    this.logFinger(e, 'down');
    this.rebaseGesture();
  };

  private onMove = (e: PointerEvent): void => {
    const { drawing: d, erasing: er } = this;
    if (d && e.pointerId === d.id) {
      e.preventDefault();
      const t0 = performance.now();
      for (const ev of samples(e)) this.addSample(ev);
      const pts = this.liveUpdate();
      this.predict(e);
      this.liveEvents++;
      this.livePtsMax = Math.max(this.livePtsMax, pts);
      this.meter.points(pts);
      this.meter.event(performance.now() - t0, t0);
    } else if (er && e.pointerId === er.id) {
      e.preventDefault();
      for (const ev of samples(e)) {
        const p = this.local(ev);
        this.erasePath(er.last, p);
        er.last = p;
      }
      this.eraserCursor(er.last);
    } else if (this.touches.has(e.pointerId)) {
      e.preventDefault();
      this.touches.set(e.pointerId, this.local(e));
      this.logFinger(e, 'move');
      this.moveGesture();
    } else if (e.pointerType === 'pen') {
      if (e.buttons === 0) this.hover(e);
      else if (this.penKnown !== e.pointerId) this.noticePen(e);
    }
  };

  /**
   * Ein Stift liegt auf, aber sein Aufsetzen kam bei der Seite davor an, die dann zu dieser wechselte (er setzte auf ihrem Nachbarn
   * auf). Das Tor gegen Handballen erfährt es einmal: Sonst nähme es die Hand, die noch aufliegt, als Finger. Sein Ende hört das
   * Fenster, denn er kann auch über der Leiste oder einer Karte abheben, wo es nie bei der Fläche ankäme (wie bei den Karten): So
   * geht das Tor auf jeden Fall wieder auf.
   */
  private noticePen(e: PointerEvent): void {
    const id = e.pointerId;
    this.penKnown = id;
    this.filter.penDown(e.timeStamp);
    this.forgetPenEnd();
    const end = (ev: PointerEvent): void => {
      if (ev.pointerId !== id) return;
      this.forgetPenEnd();
      if (this.penKnown === id) this.penKnown = null;
      this.filter.penUp(ev.timeStamp);
    };
    window.addEventListener('pointerup', end, true);
    window.addEventListener('pointercancel', end, true);
    this.stopPenEnd = () => {
      window.removeEventListener('pointerup', end, true);
      window.removeEventListener('pointercancel', end, true);
    };
  }

  private forgetPenEnd(): void {
    this.stopPenEnd?.();
    this.stopPenEnd = null;
  }

  private onUp = (e: PointerEvent): void => {
    const { drawing: d, erasing: er } = this;
    // Mit der Zeit des Abhebens: Ruhte der Stift davor, ohne noch Punkte zu schicken, endet die Füllfeder trotzdem langsam.
    if (d && e.pointerId === d.id) this.finishDraw(true, e.timeStamp);
    else if (er && e.pointerId === er.id) this.finishErase();
    if (e.pointerType === 'pen') {
      this.filter.penUp(e.timeStamp);
      this.penKnown = null;
    }
    if (!this.touches.delete(e.pointerId)) return;
    if (e.type === 'pointercancel') this.forgetTaps(); // eine abgebrochene Berührung ist kein Tipp
    else this.logFinger(e, 'up');
    if (this.touches.size) {
      this.rebaseGesture();
      return;
    }
    if (this.endGesture(false)) {
      this.forgetTaps(); // die Nachbarseite wird die offene: Hier zählt der Zug weder als Tipp noch als Rückgängig
      return;
    }
    // Zwei Finger machen auf der offenen Seite rückgängig, auch wenn sie auf einem Nachbarn tippen.
    if (isTwoFingerTap(this.fingerLog)) this.undo();
    else if (isFingerTap(this.tapLog)) this.tapAt(this.tapLog[0]);
    this.forgetTaps();
  };

  /**
   * Ein Finger oder die Maus hat an diesem Ort der Fläche getippt: Auf einem Nachbarn (oder im Spalt davor) wird er die offene
   * Seite, sonst gilt der Tipp der Seite (`onTap`).
   */
  private tapAt(at: Pt2): void {
    const side = this.neighborAt(at);
    if (side) this.openNeighbor(side);
    else this.opts.onTap?.(this.toPage(at.x, at.y));
  }

  /** Der Stift verlässt die Fläche: Die Spitze beim Schweben geht mit. */
  private onLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'pen') this.hideTip();
  };

  /**
   * Mausrad: blättern, mit Strg (oder Cmd, so meldet das Trackpad Zwei-Finger-Zoomen) zoomen. Beides kann die Mitte in einen
   * Nachbarn bringen: Steht das Rad danach `WHEEL_SETTLE_MS` lang still, gilt das wie das Loslassen eines Zugs (`wheelSettled`).
   */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.refreshRect();
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.vh : 1;
    if (e.ctrlKey || e.metaKey) {
      this.view = zoomAround(this.view, this.local(e), Math.exp(-e.deltaY * unit * 0.0025), this.zoomLimits());
    } else {
      this.view = { ...this.view, x: this.view.x - e.deltaX * unit, y: this.view.y - e.deltaY * unit };
    }
    this.clampView();
    this.scheduleRender();
    this.awaitWheelRest();
  };

  /** Beginnt die Zeit bis zur Ruhe des Rads neu. */
  private awaitWheelRest(): void {
    clearTimeout(this.wheelTimer);
    this.wheelTimer = window.setTimeout(this.wheelSettled, WHEEL_SETTLE_MS);
  }

  /**
   * Das Rad steht still: Bedeckt ein Nachbar die Mitte, wird er die offene Seite. Liegt noch ein Finger, die Maus oder der Stift
   * auf, wartet das, bis alles losgelassen ist: Ein Zug, der gerade läuft, soll nicht mitten drin auf einer anderen Seite landen.
   */
  private wheelSettled = (): void => {
    this.wheelTimer = 0;
    if (this.destroyed) return;
    if (this.touches.size > 0 || this.drawing || this.erasing) {
      this.awaitWheelRest();
      return;
    }
    const side = settledSide(this.view, { w: this.vw, h: this.vh }, this.present());
    if (side) this.openNeighbor(side);
  };
}
