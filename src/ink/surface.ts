import { boundsOf, emptyBox, growBox, lineWidth, type Box } from './bounds';
import { hitIndexes, pointsAlong, takeOut, takeOutIds } from './erase';
import { clampView, GestureFilter, gestureView, isFingerTap, isTwoFingerTap, zoomAround, type FingerEvent, type Pt2, type View, type ZoomLimits } from './gestures';
import { History, restore, type Removed } from './history';
import { extrapolate } from './predict';
import { StrokeBuilder } from './stroke';
import { INK, PAGE_H, PAGE_W, PAPER, WIDTH_MM, type FieldBox, type InkColor, type Page, type Stroke, type WidthName } from './types';

// Die Schreibfläche: drei Canvas-Ebenen übereinander (Grund mit Papier und fertigen Strichen, Live mit dem Strich, der
// gerade entsteht, Vorhersage mit dem Stück voraus). Die Zeigerlogik stammt aus dem Stift-Test
// (`docs/reference/stift-test.html`, mit dem Apple Pencil geprüft). Neu gegenüber dem Stift-Test: Geschrieben und
// radiert wird nur mit dem Stift. Finger und Maus bewegen die Seite, ein Zwei-Finger-Tipp macht rückgängig.

export type SurfaceOptions = {
  /** Nichts schreiben, radieren oder rückgängig machen, nur ansehen. Verschieben und Zoomen gehen weiter. */
  readOnly: boolean;
  /** Stärke der Glättung (σ, siehe `SMOOTHING`). */
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
};

type Drawing = { id: number; builder: StrokeBuilder; box: Box; current: Stroke; hist: { x: number; y: number; t: number }[] };
type Erasing = { id: number; removed: Removed[]; last: Pt2 };
type Gesture = { revert: View; ref: View; from: Pt2[]; moved: boolean; snapView: View | null };

const ERASER_RADIUS_PX = 10;
/** Ab so vielen Punkten auf der Seite zoomt eine Geste nur das Bild und zeichnet erst am Ende neu. */
const HEAVY_POINTS = 8000;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 10;

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
  private readonly observer: ResizeObserver;
  private readonly cleanups: (() => void)[] = [];

  // Seite
  private head: Pick<Page, 'kind' | 'key' | 'meta'> = { kind: 'tag', key: '', meta: {} };
  private strokes: Stroke[] = [];
  private background: HTMLImageElement | null = null;
  private backgroundSvg = '';

  // Werkzeug
  private readOnly: boolean;
  private tool: 'pen' | 'eraser' = 'pen';
  private color: InkColor = 'schwarz';
  private widthMm = WIDTH_MM.mittel;

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
  private gesture: Gesture | null = null;
  private liveArea: Box | null = null;
  private predArea: Box | null = null;
  private predTimer = 0;
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
    const erased = this.erasing ? new Set(this.erasing.removed.map((r) => r.stroke.id)) : null;
    this.head = { kind: p.kind, key: p.key, meta: { ...p.meta } };
    this.strokes = p.strokes.slice();
    this.history.clear();
    if (this.erasing && erased) this.erasing.removed = takeOutIds(this.strokes, erased);
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

  /** Die Seite, wie sie jetzt ist: eine Momentaufnahme, spätere Änderungen verändern sie nicht. */
  getPage(): Page {
    return { ...this.head, meta: { ...this.head.meta }, strokes: this.strokes.slice() };
  }

  setTool(t: 'pen' | 'eraser'): void {
    this.tool = t;
  }

  setColor(c: InkColor): void {
    this.color = c;
  }

  setWidth(w: WidthName): void {
    this.widthMm = WIDTH_MM[w];
  }

  /**
   * Sperrt die Fläche oder gibt sie frei. Beim Sperren endet, was gerade entsteht, ohne zur Seite zu gehören: Ein Strich
   * verschwindet, radierte Striche stehen wieder da. Die Seite wird nicht mehr gespeichert, also soll auch nichts auf
   * dem Bildschirm stehen, was nie gespeichert wird.
   */
  setReadOnly(on: boolean): void {
    this.readOnly = on;
    if (on) this.cancelInput();
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
    clearTimeout(this.predTimer);
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
    this.fit = Math.max(0.2, Math.min((this.vw - 32) / PAGE_W, 1.6));
    if (!had) {
      this.hasView = true;
      this.view = { s: this.fit, x: (this.vw - PAGE_W * this.fit) / 2, y: 16 };
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
    restore(this.strokes, er.removed);
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

  /**
   * Ein Strich ist ein einziger glatter Pfad in einer Breite, derselbe wie in der SVG-Datei (`pathD`): zu jedem
   * Punkt eine Kurve bis zur Mitte zum nächsten, zuletzt eine Linie zum Endpunkt. Ein einzelner Punkt ist ein Kreis.
   */
  private drawStroke(ctx: CanvasRenderingContext2D, s: Stroke): void {
    const p = s.pts;
    const n = p.length;
    if (!n) return;
    const w = this.lineW(s);
    ctx.strokeStyle = INK[s.color];
    ctx.fillStyle = INK[s.color];
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
   * Hintergrund als SVG-Bild, damit er bei jedem Zoom scharf bleibt. Gleicher Text: nichts neu laden. Mit `keepOld` bleibt das
   * bisherige Bild stehen, bis das neue geladen ist: Bei jeder Eingabe im Kopf einer Besprechung ändert sich der Hintergrund,
   * und eine Zeichnung zwischendurch zeigte kurz leeres Papier.
   */
  private setBackground(svg: string, keepOld = false): void {
    if (svg === this.backgroundSvg) return;
    this.backgroundSvg = svg;
    if (!keepOld) this.background = null;
    if (!svg) return;
    const img = new Image();
    img.onload = () => {
      if (this.destroyed || svg !== this.backgroundSvg) return;
      this.background = img;
      this.scheduleRender();
    };
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_W}" height="${PAGE_H}" viewBox="0 0 ${PAGE_W} ${PAGE_H}">${svg}</svg>`,
    )}`;
  }

  private drawPaper(ctx: CanvasRenderingContext2D): void {
    const px = 1 / this.view.s; // ein Bildschirmpunkt in Seiteneinheiten
    ctx.fillStyle = 'rgba(22, 32, 48, 0.10)';
    ctx.fillRect(2 * px, 3 * px, PAGE_W, PAGE_H);
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, PAGE_W, PAGE_H);
    if (this.background) ctx.drawImage(this.background, 0, 0, PAGE_W, PAGE_H);
  }

  private scheduleRender(): void {
    if (this.raf || this.destroyed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  /** Die Grundebene ganz neu: Papier und alle Striche, die im Bild liegen. */
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
      this.drawPaper(bctx);
      const x0 = -view.x / view.s;
      const y0 = -view.y / view.s;
      const x1 = x0 + this.vw / view.s;
      const y1 = y0 + this.vh / view.s;
      for (const s of this.strokes) {
        const { box, maxW } = boundsOf(s);
        const m = Math.max(maxW, this.lineW(s));
        if (box[2] + m < x0 || box[0] - m > x1 || box[3] + m < y0 || box[1] - m > y1) continue;
        this.drawStroke(bctx, s);
      }
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

  private liveUpdate(): void {
    const d = this.drawing;
    if (!d) return;
    const s = d.builder.stroke();
    d.current = s;
    if (!s.pts.length) return;
    this.clearLive(false);
    this.setView(this.lctx);
    this.drawStroke(this.lctx, s);
    this.liveArea = this.screenBox(d.box, this.lineW(s) + 3 / this.view.s);
  }

  private redrawLive(): void {
    this.clearLive(true);
    this.liveUpdate();
  }

  private clearPred(): void {
    clearTimeout(this.predTimer);
    if (!this.predArea) return;
    const [x0, y0, x1, y1] = this.predArea;
    const { pctx, dpr } = this;
    pctx.setTransform(1, 0, 0, 1, 0, 0);
    pctx.clearRect(Math.floor(x0 * dpr) - 2, Math.floor(y0 * dpr) - 2, Math.ceil((x1 - x0) * dpr) + 4, Math.ceil((y1 - y0) * dpr) + 4);
    this.predArea = null;
  }

  /** Zeichnet die Linie ein Stück vor den Stift, damit sie nicht hinterherhinkt. */
  private predict(e: PointerEvent): void {
    this.clearPred();
    const d = this.drawing;
    if (!this.opts.prediction || !d || !d.current.pts.length) return;
    let target: Pt2 | null = null;
    try {
      const list = e.getPredictedEvents(); // Safari liefert eigene Vorhersagen, wenn es sie kann
      if (list.length) target = this.local(list[list.length - 1]);
    } catch {
      // keine Vorhersage vom Browser
    }
    target ??= extrapolate(d.hist); // sonst aus der Geschwindigkeit der letzten Punkte vorausrechnen
    if (!target) return;
    const pts = d.current.pts;
    const last = pts[pts.length - 1];
    const t = this.toPage(target.x, target.y);
    const w = this.lineW(d.current);
    const { pctx } = this;
    this.setView(pctx);
    pctx.strokeStyle = INK[d.current.color];
    pctx.lineCap = 'round';
    pctx.lineWidth = w;
    pctx.beginPath();
    pctx.moveTo(last.x, last.y);
    pctx.lineTo(t.x, t.y);
    pctx.stroke();
    this.predArea = this.screenBox([Math.min(last.x, t.x), Math.min(last.y, t.y), Math.max(last.x, t.x), Math.max(last.y, t.y)], w + 2 / this.view.s);
    this.predTimer = window.setTimeout(() => this.clearPred(), 40); // der Stift steht still: Vorhersage wieder weg
  }

  private beginDraw(e: PointerEvent): void {
    const pos = this.local(e);
    if (this.tool === 'eraser') {
      this.erasing = { id: e.pointerId, removed: [], last: pos };
      this.eraseAt(pos);
      this.eraserCursor(pos);
      return;
    }
    const builder = this.newBuilder();
    this.drawing = { id: e.pointerId, builder, box: emptyBox(), current: builder.stroke(), hist: [] };
    this.addSample(e);
    this.liveUpdate();
  }

  private newBuilder(): StrokeBuilder {
    return new StrokeBuilder({
      color: this.color,
      widthMm: this.widthMm,
      sigma: this.opts.sigma,
      t: Date.now(),
      minDist: 0.6 / this.view.s, // auf dem Bildschirm immer gleich weit, egal wie weit hineingezoomt ist
    });
  }

  /** Liegt der Ort der Seite in einem Rechteck, in dem der Stift nicht schreibt? */
  private inNoInk(p: Pt2): boolean {
    return (this.opts.noInk ?? []).some(([x, y, w, h]) => p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h);
  }

  private addSample(ev: PointerEvent): void {
    const d = this.drawing!;
    const pos = this.local(ev);
    const pt = this.toPage(pos.x, pos.y);
    if (this.inNoInk(pt)) {
      this.cutStroke();
      return;
    }
    d.hist.push({ x: pos.x, y: pos.y, t: ev.timeStamp });
    if (d.hist.length > 12) d.hist.shift();
    if (d.builder.add(pt.x, pt.y, ev.pressure)) growBox(d.box, pt);
  }

  /**
   * Der Stift kommt in ein Rechteck ohne Tinte: Der Strich bis hierher ist fertig, und der nächste beginnt, wo der Stift das
   * Rechteck verlässt. Ohne den Schnitt zöge die Linie quer durch das Rechteck von dem Punkt davor zu dem Punkt danach.
   */
  private cutStroke(): void {
    const d = this.drawing;
    if (!d || !d.builder.stroke().pts.length) return;
    this.commitStroke(d);
    const builder = this.newBuilder();
    d.builder = builder;
    d.box = emptyBox();
    d.current = builder.stroke();
    d.hist = [];
    this.clearLive(true);
    this.clearPred();
  }

  /** Der Strich wird Teil der Seite, und die Seite meldet die Änderung sofort. */
  private commitStroke(d: Drawing): void {
    const s = d.builder.stroke();
    if (!s.pts.length) return;
    this.strokes.push(s);
    this.setView(this.bctx);
    this.drawStroke(this.bctx, s);
    this.history.push({ type: 'add', stroke: s });
    this.changed();
  }

  /** Der Stift hebt ab. */
  private finishDraw(commit: boolean): void {
    const d = this.drawing;
    this.drawing = null;
    this.clearLive(true);
    this.clearPred();
    if (d && commit) this.commitStroke(d);
  }

  // ---------- Radierer (ganze Striche) ----------

  /** Radiert an einem Ort (Bildschirmpunkte) alle Striche im Umkreis von 10 Bildschirmpunkten. */
  private eraseAt(at: Pt2): void {
    const er = this.erasing;
    if (!er) return;
    const p = this.toPage(at.x, at.y);
    const hits = hitIndexes(this.strokes, p, ERASER_RADIUS_PX / this.view.s, this.pixel());
    if (!hits.length) return;
    er.removed.push(...takeOut(this.strokes, hits));
    this.scheduleRender();
  }

  /** Radiert entlang einer Strecke in kleinen Schritten, damit kein Strich zwischen zwei Messpunkten durchrutscht. */
  private erasePath(from: Pt2, to: Pt2): void {
    for (const at of pointsAlong(from, to)) this.eraseAt(at);
  }

  private eraserCursor(p: Pt2): void {
    this.clearLive(false);
    const ctx = this.lctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.beginPath();
    ctx.arc(p.x, p.y, ERASER_RADIUS_PX, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(44, 90, 138, 0.12)';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(44, 90, 138, 0.9)';
    ctx.stroke();
    this.liveArea = [p.x - 12, p.y - 12, p.x + 12, p.y + 12];
  }

  private finishErase(): void {
    const er = this.erasing;
    this.erasing = null;
    this.clearLive(true);
    if (!er?.removed.length) return;
    this.history.push({ type: 'erase', removed: er.removed });
    this.changed();
  }

  // ---------- Ansicht und Gesten ----------

  private zoomLimits(): ZoomLimits {
    return { min: this.fit * MIN_ZOOM, max: this.fit * MAX_ZOOM };
  }

  private clampView(): void {
    this.view = clampView(this.view, { w: this.vw, h: this.vh }, { w: PAGE_W, h: PAGE_H });
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

  /** Auf einer vollen Seite würde jedes Bild alle Striche neu zeichnen: Dann zeigt die Geste nur ein Bild der Grundebene. */
  private startMoving(g: Gesture): void {
    if (g.moved) return;
    g.moved = true;
    let points = 0;
    for (const s of this.strokes) points += s.pts.length;
    if (points <= HEAVY_POINTS) return;
    this.snap.width = this.base.width;
    this.snap.height = this.base.height;
    context(this.snap).drawImage(this.base, 0, 0);
    g.snapView = { ...this.view };
  }

  /** Alle Finger sind weg. Mit `revert` gilt die Ansicht von vor der Geste: Der Stift kam, das war die Hand. */
  private endGesture(revert: boolean): void {
    const g = this.gesture;
    if (!g) return;
    this.gesture = null;
    if (revert && g.moved) this.view = g.revert;
    this.snap.width = 0;
    this.snap.height = 0;
    if (g.moved) this.render();
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
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    this.refreshRect();
    if (e.pointerType === 'pen') {
      this.filter.penDown(e.timeStamp);
      this.endGesture(true); // die Hand lag schon auf dem Bildschirm: was die Finger eben verschoben haben, war sie
      this.touches.clear();
      this.forgetTaps();
      if (this.drawing) this.finishDraw(true);
      if (this.erasing) this.finishErase();
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
      for (const ev of samples(e)) this.addSample(ev);
      this.liveUpdate();
      this.predict(e);
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
    }
  };

  private onUp = (e: PointerEvent): void => {
    const { drawing: d, erasing: er } = this;
    if (d && e.pointerId === d.id) this.finishDraw(true);
    else if (er && e.pointerId === er.id) this.finishErase();
    if (e.pointerType === 'pen') this.filter.penUp(e.timeStamp);
    if (!this.touches.delete(e.pointerId)) return;
    if (e.type === 'pointercancel') this.forgetTaps(); // eine abgebrochene Berührung ist kein Tipp
    else this.logFinger(e, 'up');
    if (this.touches.size) {
      this.rebaseGesture();
      return;
    }
    this.endGesture(false);
    if (isTwoFingerTap(this.fingerLog)) this.undo();
    else if (isFingerTap(this.tapLog)) this.opts.onTap?.(this.toPage(this.tapLog[0].x, this.tapLog[0].y));
    this.forgetTaps();
  };

  /** Mausrad: blättern, mit Strg (oder Cmd, so meldet das Trackpad Zwei-Finger-Zoomen) zoomen. */
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
  };
}
