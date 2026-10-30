import type { ComponentChildren } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GestureFilter, type View } from '../ink/gestures';
import { InkSurface } from '../ink/surface';
import type { FieldBox, InkColor, Page, WidthName } from '../ink/types';
import { todayVienna } from '../lib/dates';
import { tapTargetAt, tapTargets, todayMarks, type Layout } from '../pages/layouts';
import type { SyncEngine } from '../sync/engine';
import { watchCards } from './cardGestures';
import { PageSession, type Phase } from './pageSession';
import { QuickSwitch } from './QuickSwitch';
import { retryCues } from './retryCues';
import { routeHash } from './router';
import { Icon, Toolbar, type Tool } from './Toolbar';

// Eine Seite zum Schreiben, ganz gleich ob Tag, Woche oder Monat: Das Layout sagt, welche Felder und welchen Hintergrund
// sie hat. Lesen, Speichern und fremde Änderungen übernimmt `PageSession`, diese Datei verbindet sie mit der Schreibfläche
// und der Werkzeugleiste. Der Stand des Abgleichs und die Meldungen zeigt die Leiste oben (`TopBar`).

/** Was jede Seite von der App bekommt, gleich welchen Typs. */
export type PageProps = {
  engine: SyncEngine;
  /** Nur ansehen (Firmen-PC): keine Werkzeuge, es wird nie geschrieben. */
  readOnly: boolean;
  /** Glättung des Stifts (σ) und Vorhersage aus den Einstellungen. */
  sigma: number;
  prediction: boolean;
  /** Ort des Schnellwechsels, siehe `Settings.quickSwitchPos`. */
  quickSwitchPos?: [number, number];
  onQuickSwitchMove(pos: [number, number]): void;
};

/** Was das Formular über einer Seite mit Kopfdaten von der Seite bekommt. */
export type KopfTools = {
  /** Die Kopfdaten, wie sie jetzt gelten. */
  meta: Record<string, string>;
  /** Solange die Seite nicht gelesen ist (`bereit`), lässt sich der Kopf nicht ändern: Sonst entstünde neben einer Seite, die man noch nicht sieht, eine zweite. */
  phase: Phase;
  /**
   * Ändert die genannten Kopfdaten: auf dem Bildschirm, im Hintergrund und in der Datei. Die Seite bleibt dieselbe, ihre
   * Striche und ihr Verlauf für Rückgängig auch, ebenso ein Strich, der gerade entsteht.
   */
  edit(patch: Record<string, string>): void;
  /** Die Seite, wie sie jetzt ist, mit allen Strichen und den neuesten Kopfdaten. */
  current(): Page;
  /** Die Seite wird gelöscht: Von ihr wird nichts mehr gespeichert. Endet, wenn kein Speichern mehr läuft. */
  retire(): Promise<void>;
};

/** Eine Seite, deren Kopfdaten man ändern kann (die Besprechung): Sie bekommt ein Formular über der Fläche. */
export type Kopf = {
  /** Ergänzt eine Seite um das, was ihr fehlt: Kopfdaten aus dem Namen der Besprechung, den Schlüssel aus ihrem Dateinamen. */
  complete(page: Page): Page;
  /** Felder und Hintergrund zu bestimmten Kopfdaten: Der Hintergrund der Datei zeigt sie. */
  layoutFor(meta: Record<string, string>): { fields: FieldBox[]; background: string };
  /** Das Formular. */
  form(tools: KopfTools): ComponentChildren;
};

type Props = PageProps & {
  /**
   * Felder und Hintergrund dieser Seite. Eine andere Seite ist ein neues `PageView` (die App setzt dafür den `key`):
   * Jede Seite schreibt nur mit ihren eigenen Feldern und ihrem eigenen Hintergrund.
   */
  layout: Layout;
  /** Pfad der Seitendatei im Vault. */
  path: string;
  /**
   * Nur für Seiten mit Kopfdaten. Das Formular darf bei jedem Zeichnen ein neues Objekt sein: Die Seite liest immer das
   * neueste, öffnet sich deswegen aber nicht neu.
   */
  kopf?: Kopf;
  /**
   * Bauteile, die über der Schreibfläche liegen und mit der Seite wandern und zoomen (die Karten der Tagesseite). Sie
   * stehen in Seiteneinheiten, 1192 mal 1590 Punkte groß. Der Stift schreibt nicht in den Rechtecken der Karten (`Layout.cards`).
   */
  overlay?: ComponentChildren;
};

const UNREADABLE = 'Diese Seite lässt sich nicht lesen und wird nicht verändert.';
const NOT_LOADED = 'Diese Seite konnte nicht geladen werden. Neuer Versuch, sobald das Netz da ist.';

/** Testzugang: nur lesen, enthält keine Geheimnisse. Er steht da, sobald die Seite gelesen ist. */
type TestAccess = { currentPage(): Page; toClient(x: number, y: number): { x: number; y: number } };
const testAccessHolder = (): { __notizbuch?: TestAccess } => window as unknown as { __notizbuch?: TestAccess };

/**
 * Legt die Ebene mit den Karten auf die Seite: Punkte der Seite werden mit demselben Maßstab und Versatz wie die Schreibfläche
 * auf den Bildschirm gerechnet. Direkt am Element statt über den Zustand, denn das geschieht bei jedem Bild einer Geste.
 */
function placeCards(layer: HTMLElement | null, view: View): void {
  if (!layer) return;
  layer.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.s})`;
  layer.dataset.bereit = ''; // erst jetzt sichtbar: vorher läge sie an der falschen Stelle
}

export function PageView(p: Props) {
  const { engine, layout, path, sigma, prediction, kopf, overlay } = p;
  // Das zweite Fenster eines Geräts (die Engine liest nur) schreibt nichts, auch keine Kopfdaten.
  const locked = engine.readOnly;
  const readOnly = p.readOnly || locked;
  const stage = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const cards = useRef<HTMLDivElement>(null);
  const surface = useRef<InkSurface | null>(null);
  const sessionRef = useRef<PageSession | null>(null);
  const kopfRef = useRef(kopf);
  kopfRef.current = kopf;
  // Ein Tor gegen Handballen für Fläche und Schnellwechsel: Beide liegen dort, wo beim Schreiben die Hand ruht.
  const [palm] = useState(() => new GestureFilter());
  // Heute, solange die Seite offen ist: Die Markierung und `aria-current` sollen sich nicht mitten im Schreiben ändern.
  const [today] = useState(() => todayVienna());
  const days = useMemo(() => tapTargets(layout), [layout]);
  const [phase, setPhase] = useState<Phase>('laden');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<InkColor>('schwarz');
  const [width, setWidth] = useState<WidthName>('mittel');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [saveFailed, setSaveFailed] = useState(false);
  const [kopfMeta, setKopfMeta] = useState<Record<string, string>>(() => kopf?.complete({ kind: layout.kind, key: layout.key, meta: {}, strokes: [] }).meta ?? {});

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const head = kopfRef.current;
    const emptyPage = (): Page => {
      const page: Page = { kind: layout.kind, key: layout.key, meta: {}, strokes: [] };
      return head ? head.complete(page) : page;
    };
    // In die Datei kommt der Hintergrund der Seite, auf den Bildschirm dazu die Markierung für heute. Eine Seite mit
    // Kopfdaten zeigt sie im Hintergrund: Er gehört zu den Kopfdaten, die gerade gelten.
    const background = layout.background();
    const shown = background + todayMarks(layout, today);
    const shownFor = (meta: Record<string, string>): string => (head ? head.layoutFor(meta).background : shown);

    const view: InkSurface = new InkSurface(el, {
      readOnly: true, // bis die Seite gelesen ist
      sigma,
      prediction,
      filter: palm,
      onChange: (page) => {
        setHistory({ canUndo: view.canUndo, canRedo: view.canRedo });
        session.changed(page);
      },
      // Ein Finger oder die Maus auf einer Tageszahl öffnet den Tag. Der Stift tippt nie, er schreibt.
      onTap: ({ x, y }) => {
        const hit = tapTargetAt(days, x, y);
        if (hit) window.location.hash = routeHash({ view: 'tag', key: hit.day });
      },
      // Die Karten über der Fläche liegen im Maßstab der Seite und wandern mit ihr. Der Stift schreibt nicht unter sie.
      onView: (now) => placeCards(cards.current, now),
      noInk: layout.cards.map((card) => card.rect),
    });
    const first = emptyPage();
    view.setPage(first, layout.fields, shownFor(first.meta));
    view.setTool(tool);
    view.setColor(color);
    view.setWidth(width);
    surface.current = view;

    const access: TestAccess = { currentPage: () => view.getPage(), toClient: (x, y) => view.toClient(x, y) };
    const session = new PageSession({
      engine,
      path,
      emptyPage,
      readOnly,
      fields: layout.fields,
      background,
      completePage: head?.complete,
      layoutFor: head?.layoutFor,
      // Am Firmen-PC lässt sich der Kopf tippen, auch wo nicht geschrieben wird.
      headerWritable: head !== undefined && !locked,
      surface: {
        getPage: () => view.getPage(),
        setPage: (page) => view.setPage(page, layout.fields, shownFor(page.meta)),
        setReadOnly: (on) => view.setReadOnly(on),
      },
      retryCues,
      onPhase: (next) => {
        setHistory({ canUndo: view.canUndo, canRedo: view.canRedo });
        setPhase(next);
        setKopfMeta(view.getPage().meta);
        testAccessHolder().__notizbuch = access;
      },
      onSaveFailed: setSaveFailed,
    });
    sessionRef.current = session;
    setPhase('laden');
    void session.reload();

    return () => {
      if (testAccessHolder().__notizbuch === access) delete testAccessHolder().__notizbuch;
      surface.current = null;
      sessionRef.current = null;
      view.finishInput(); // ein Strich, der gerade entsteht, gehört noch zur Seite
      session.close();
      view.destroy();
    };
  }, [engine, layout, path, days, today, readOnly, locked, sigma, prediction, palm]);

  // Die Karten liegen über der Fläche und fangen Berührungen und Rad ab, die auf ihnen beginnen. `watchCards` gibt der Seite, was
  // die Karte nicht selbst braucht: Finger, die ziehen oder zoomen, und das Rad. Auch das Tor gegen Handballen gilt auf den Karten.
  const hasCards = overlay !== undefined;
  useEffect(() => {
    const around = frame.current;
    const surfaceHost = host.current;
    const inStage = stage.current;
    if (!around || !surfaceHost || !inStage) return;
    return watchCards({ stage: inStage, host: surfaceHost, frame: around, surface: () => surface.current, filter: palm });
  }, [hasCards, palm]);

  const chooseTool = (t: Tool) => {
    setTool(t);
    surface.current?.setTool(t);
  };
  // Wer Farbe oder Breite wählt, will schreiben: Der Kugelschreiber ist dann wieder das Werkzeug.
  const chooseColor = (c: InkColor) => {
    setColor(c);
    surface.current?.setColor(c);
    chooseTool('pen');
  };
  const chooseWidth = (w: WidthName) => {
    setWidth(w);
    surface.current?.setWidth(w);
    chooseTool('pen');
  };

  const canWrite = !readOnly && phase !== 'unlesbar' && phase !== 'nichtGeladen';

  // Eine Änderung am Kopf ändert die Kopfdaten der Fläche an Ort und Stelle (dieselbe Seite, dieselben Striche) und geht
  // dann wie ein Strich durch die Sitzung: mit allen Strichen, die die Fläche jetzt hat, und den neuen Kopfdaten.
  const tools: KopfTools | undefined = kopf && {
    meta: kopfMeta,
    phase,
    edit: (patch) => {
      const view = surface.current;
      const open = sessionRef.current;
      if (!view || !open || phase !== 'bereit') return;
      const now = view.getPage();
      const meta = kopf.complete({ ...now, meta: { ...now.meta, ...patch } }).meta;
      setKopfMeta(meta);
      view.setHead(meta, kopf.layoutFor(meta).background);
      open.changed(view.getPage());
    },
    current: () => surface.current?.getPage() ?? kopf.complete({ kind: layout.kind, key: layout.key, meta: {}, strokes: [] }),
    retire: () => sessionRef.current?.retire() ?? Promise.resolve(),
  };

  return (
    <div class="seite">
      {/* Nur ansehen heißt: keine Werkzeuge, also auch keine Leiste. Sonst bleibt sie stehen, damit die Seite nicht springt. */}
      {!readOnly && (
        <div class="leiste">
          {canWrite && (
            <Toolbar
              tool={tool}
              color={color}
              width={width}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              onTool={chooseTool}
              onColor={chooseColor}
              onWidth={chooseWidth}
              onUndo={() => surface.current?.undo()}
              onRedo={() => surface.current?.redo()}
              onFit={() => surface.current?.zoomToFit()}
            />
          )}
        </div>
      )}
      {kopf && tools && <div class="kopf">{kopf.form(tools)}</div>}
      <div class="buehne" ref={stage}>
        <div class="flaeche" data-testid="surface" ref={host} />
        {/* Die Karten gehören nicht zur Schreibfläche: Sie liegen daneben und sind echte Bedienelemente (Kästchen, Knöpfe, Felder). */}
        {overlay && (
          <div class="karten-rahmen" ref={frame}>
            <div class="karten" ref={cards}>
              {overlay}
            </div>
          </div>
        )}
        {/* Die Tageszahlen sind auf der Seite gezeichnet. Als Links sind sie auch mit der Tastatur und für Sprachausgabe da. */}
        {days.length > 0 && (
          <nav class="tage" aria-label="Tage dieser Seite">
            {days.map((d) => (
              <a key={d.day} href={routeHash({ view: 'tag', key: d.day })} aria-current={d.day === today ? 'date' : undefined}>
                {d.label}
              </a>
            ))}
          </nav>
        )}
        {/* Die Hinweise liegen über der Fläche, damit sie die Seite nicht verschieben, wenn sie kommen oder gehen. */}
        {phase === 'laden' && <p class="hinweis">Seite wird geladen</p>}
        {phase === 'unlesbar' && (
          <p class="hinweis" role="alert">
            {UNREADABLE}
          </p>
        )}
        {phase === 'nichtGeladen' && (
          <p class="hinweis" role="status">
            {NOT_LOADED}
          </p>
        )}
        {saveFailed && (
          <p class="hinweis fehler" role="alert">
            Die letzte Änderung konnte nicht auf diesem Gerät gespeichert werden.
          </p>
        )}
        {/* Wo es keine Werkzeugleiste gibt (Firmen-PC, Seite nicht lesbar oder nicht geladen), bleibt dieser Knopf: der Weg zurück zur ganzen Seite. */}
        {!canWrite && (
          <button type="button" class="tb ganze-seite" aria-label="Ganze Seite" title="Ganze Seite" onClick={() => surface.current?.zoomToFit()}>
            <Icon name="fit" />
          </button>
        )}
        {canWrite && (
          <QuickSwitch
            tool={tool}
            pos={p.quickSwitchPos}
            filter={palm}
            onToggle={() => chooseTool(tool === 'pen' ? 'eraser' : 'pen')}
            onMove={p.onQuickSwitchMove}
          />
        )}
      </div>
    </div>
  );
}
