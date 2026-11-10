import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SIDES, viewFor, type Side } from '../ink/chain';
import { GestureFilter, type View } from '../ink/gestures';
import { meterLabel } from '../ink/meter';
import { effect } from '@preact/signals';
import { FuellerPanel, fuellerPanel } from './FuellerPanel';
import { inkPrefs } from './inkPrefs';
import { inkTools } from './inkTools';
import { InkSurface, type NeighborPage } from '../ink/surface';
import type { FieldBox, Page, Stroke } from '../ink/types';
import { todayVienna, type Day } from '../lib/dates';
import type { VollbildWerkzeuge } from '../lib/settings';
import { tapTargetAt, tapTargets, todayMarks, type Layout } from '../pages/layouts';
import type { SyncEngine } from '../sync/engine';
import { normalizePath } from '../sync/paths';
import { watchCards } from './cardGestures';
import { offerHandoff, takeHandoff, updateHandoff, type Handoff } from './handoff';
import type { Neighbors, NeighborSpec } from './neighbors';
import { PageSession, previewStrokes, type Phase } from './pageSession';
import { QuickSwitch } from './QuickSwitch';
import { retryCues } from './retryCues';
import { routeHash, type Route } from './router';
import { Icon, Toolbar } from './Toolbar';
import { checkForUpdate, reloadApp } from '../lib/appUpdate';
import { ToolTab } from './ToolTab';
import { ToolWheel } from './ToolWheel';

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
  /** Zeile mit der Messung der Schreibverzögerung über der Seite, siehe `Settings.messung`. */
  messung?: boolean;
  /** Ort des Schnellwechsels, siehe `Settings.quickSwitchPos`. */
  quickSwitchPos?: [number, number];
  onQuickSwitchMove(pos: [number, number]): void;
  /** Im Vollbild: womit man die Werkzeuge erreicht. Dann zeigt die Seite weder Werkzeugleiste noch Kopfdaten noch den Ersatzknopf „Ganze Seite“. Sonst `null`. */
  vollbild?: VollbildWerkzeuge | null;
  /** Wohin ‹ und › im Vollbild führen, mit ihrer Beschriftung, und ob es dorthin einen Schritt gibt: dieselben Ziele wie in der Leiste oben. */
  nav?: { back: Route; forward: Route; labels: [string, string]; canBack: boolean; canForward: boolean };
  /** Schaltet das Vollbild aus (der Knopf „Vollbild aus“ im Rad). */
  onVollbildAus?(): void;
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
  /**
   * SVG nur für den Bildschirm, über dem Hintergrund und der Markierung für heute: die Geburtstage, Termine und Prioritäten in
   * Woche und Monat und die Geburtstage in der Kopfzeile der Tagesseite. Es kommt nie in die Datei. Ändert es sich, zeigt die
   * Fläche es, ohne neu zu entstehen: Striche, Rückgängig, Ansicht und ein Strich, der gerade entsteht, bleiben. Seiten mit
   * Kopfdaten zeigen ihren eigenen Hintergrund und kein `marks`.
   */
  marks?: string;
  /** Zusatz zum Namen eines Tages in der Liste „Tage dieser Seite“, zum Beispiel `2 Termine, 1 Priorität`. Leer heißt: keiner. */
  dayInfo?: (day: Day) => string;
  /**
   * Die Seiten über und unter dieser (Tag, Woche, Monat, siehe `neighborsOf`), jede mit ihrem `marks` (`withMarks`): Die Fläche
   * zeigt sie als Vorschau, man scrollt in sie hinein, und wer loslässt, während eine die Mitte bedeckt, hat sie offen. Ihre
   * Dateien werden nur gelesen, und nur für einen neuen Pfad neu: Ein neues Objekt mit anderem `marks` ändert nur den
   * Hintergrund ihrer Vorschau.
   */
  neighbors?: Neighbors;
};

/**
 * Ein Nachbar, wie ihn die Fläche zeigt: wer er ist, der Pfad seiner Datei in NFC, was die Vorschau zeigt und ob ihre Striche
 * aus seiner Datei stammen (`read`: die Datei war gelesen, auch als „gibt es nicht“).
 */
type ShownNeighbor = { spec: NeighborSpec; path: string; page: NeighborPage; read: boolean };
type ShownNeighbors = Record<Side, ShownNeighbor | null>;

const pagesOf = (n: ShownNeighbors) => ({ above: n.above?.page ?? null, below: n.below?.page ?? null });
/** Wird ein Nachbar zur offenen Seite, liegt die bisherige von ihm aus auf der anderen Seite. */
const ACROSS: Record<Side, Side> = { above: 'below', below: 'above' };

const UNREADABLE = 'Diese Seite lässt sich nicht lesen und wird nicht verändert.';
const TOO_NEW = 'Diese Seite stammt aus einer neueren Version der App. Bitte neu laden.';
const BLOCKED = 'Die App öffnet diese Seite nicht, denn Wörter wie Passwort sind im Dateinamen nicht erlaubt.';
const NOT_LOADED = 'Diese Seite konnte nicht geladen werden. Neuer Versuch, sobald das Netz da ist.';

/**
 * Testzugang: nur lesen, enthält keine Geheimnisse. Er steht da, sobald die Seite gelesen ist. `screenBackground` ist der
 * Hintergrund, den die Fläche gerade zeigt, mit allem, was nur auf dem Bildschirm steht. `neighbors` sagt, wie viele Striche
 * die Vorschau der Nachbarn zeigt (`null` ohne Nachbarn), `neighborBackground` den Hintergrund ihrer Vorschau.
 */
type TestAccess = {
  currentPage(): Page;
  toClient(x: number, y: number): { x: number; y: number };
  liveStats(): { events: number; ptsMax: number };
  screenBackground(): string;
  neighbors(): { above: number | null; below: number | null };
  neighborBackground(side: Side): string | null;
};
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
  const { engine, layout, path, sigma, prediction, kopf, overlay, marks = '' } = p;
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
  // Was die Fläche ohne `marks` als Hintergrund zeigt: den Hintergrund der Seite (nur er kommt in die Datei) und die Markierung
  // für heute.
  const shown = useMemo(() => layout.background() + todayMarks(layout, today), [layout, today]);
  // Das `marks`, das die Fläche zeigt. Zeigt die Sitzung die Seite neu (`setPage`), nimmt sie es mit. Neu wird es erst in dem
  // Effekt, der es auch zeigt (unten): Bis dahin bleibt die Sitzung bei dem, was zu sehen ist.
  const marksRef = useRef(marks);
  // Die Nachbarn, die die Fläche zeigt. Neu werden sie im Effekt, der sie liest (unten). Eine neue Fläche bekommt sie gleich, und
  // wohin ein Wechsel führt, steht auch hier: zu dem Nachbarn, der zu sehen war.
  const shownNeighbors = useRef<ShownNeighbors>({ above: null, below: null });
  // Die Nachbarn, wie die Seite sie gerade bekommt, für den Effekt der Fläche: Er entsteht nicht neu, wenn sie sich ändern.
  const neighborsRef = useRef(p.neighbors);
  neighborsRef.current = p.neighbors;
  // Öffnete die Seite durch Weiterscrollen (Übergabe, siehe `handoff.ts`) und hatte die verlassene Seite ihre Datei gelesen oder war
  // sie ein Entwurf (siehe `read` im Effekt der Fläche), liegt hier bis zum ersten Lesen der Nachbarn, auf welcher Seite sie als
  // Nachbarin hängt. Dieses Lesen lässt ihre Datei aus: Ihre Sitzung speichert vielleicht noch.
  const keptFrom = useRef<Side | null>(null);
  const [phase, setPhase] = useState<Phase>('laden');
  // Der Hinweis „Seite wird geladen“ kommt erst, wenn feststeht, dass die Seite nicht schon zu sehen ist (im Effekt der Fläche):
  // Mit einer Übergabe, deren Vorschau gelesen war, zeigt sie bis zum Lesen ihrer Datei diese Vorschau und nimmt, wo geschrieben
  // wird, schon Striche an.
  const [loadingHint, setLoadingHint] = useState(false);
  // Eine Seite aus einer neueren Version: Vielleicht liegt diese schon bereit, dann lädt die App sie im ruhigen Moment.
  useEffect(() => {
    if (phase === 'zuNeu') checkForUpdate();
  }, [phase]);
  // Die Werkzeugwahl gilt für alle Seiten (siehe `inkPrefs`): Wer radiert und weiterblättert, radiert weiter.
  const { tool, pen: chosenPen, color, width, eraserSize, eraserMode } = inkPrefs.value;
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [saveFailed, setSaveFailed] = useState(false);
  const [meterText, setMeterText] = useState('');
  const [kopfMeta, setKopfMeta] = useState<Record<string, string>>(() => kopf?.complete({ kind: layout.kind, key: layout.key, meta: {}, strokes: [] }).meta ?? {});

  // Die Fläche entsteht, bevor der Browser die neue Seite zum ersten Mal zeigt (darum `useLayoutEffect`): Ein Effekt danach käme
  // erst nach diesem Bild, und nach jedem Wechsel stünde ein Bild lang die leere Bühne da. Beim Weiterscrollen, wo die Seite an
  // Ort und Stelle bleibt, blinkte sie dann.
  useLayoutEffect(() => {
    const el = host.current;
    if (!el) return;
    const head = kopfRef.current;
    const emptyPage = (): Page => {
      const page: Page = { kind: layout.kind, key: layout.key, meta: {}, strokes: [] };
      return head ? head.complete(page) : page;
    };
    // In die Datei kommt der Hintergrund der Seite, auf den Bildschirm dazu die Markierung für heute und das neueste `marks`.
    // Eine Seite mit Kopfdaten zeigt sie im Hintergrund: Er gehört zu den Kopfdaten, die gerade gelten.
    const background = layout.background();
    const shownFor = (meta: Record<string, string>): string => (head ? head.layoutFor(meta).background : shown + marksRef.current);
    // Weiterscrollen: Hat die Seite, von der man kam, eine Übergabe bereitgelegt, gilt sie nur beim ersten Aufbau dieser Seite.
    // Entsteht die Fläche später für dieselbe Seite neu (andere Einstellungen), ist sie verbraucht.
    const handoff = takeHandoff(path);
    // War die Vorschau dieser Seite gelesen, zeigt die Fläche von Anfang an einen gelesenen Stand der Seite: Dann nimmt sie sofort
    // Striche an (Entwurf), geschrieben wird erst nach dem ersten Lesen (siehe `PageSession`). Wo nur angesehen wird, nie.
    const draft = handoff?.read === true && !readOnly;
    // Ob die Fläche einen gelesenen Stand der Seite zeigt, mit allem, was ihre Sitzung speichert: Die Sitzung hat die Datei gelesen
    // (`bereit`), oder die Seite ist ein Entwurf. Dann zeigt die Fläche die gelesene Vorschau, und was sie dazubekommt, speichert die
    // Sitzung nach dem Lesen, auch wenn die Seite dann schon verlassen ist. Eine Übergabe sagt das der nächsten Seite weiter: Sie
    // zeigt diese Seite dann mit den Strichen aus der Übergabe und lässt ihre Datei beim ersten Lesen der Nachbarn aus (`keptFrom`).
    let read = draft;
    // Diese Seite als Nachbarin der nächsten, von dort aus auf der Seite `side`: mit allen Strichen, die sie jetzt hat, dem
    // Hintergrund, den sie gerade zeigt, und ob sie als gelesen gilt (`read`).
    const leaving = (side: Side): Handoff['from'] => ({ side, page: { strokes: view.getPage().strokes, background: view.shownBackground }, read });
    // Die Übergabe, die diese Seite zuletzt angeboten hat. Bis die nächste Seite aufgebaut ist, nimmt diese noch Eingaben an: Beim
    // Abbau (unten) kommt in die Übergabe, was sie dann ist.
    let offered: Handoff | null = null;

    const view: InkSurface = new InkSurface(el, {
      readOnly: true, // bis die Seite gelesen ist
      sigma,
      prediction,
      filter: palm,
      onChange: (page) => {
        setHistory({ canUndo: view.canUndo, canRedo: view.canRedo });
        setMeterText(meterLabel(view.meter.summary()));
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
      // Losgelassen, während ein Nachbar die Mitte bedeckt: Er wird die offene Seite. Die Adresse wechselt ohne neuen Eintrag
      // im Verlauf, die App baut dann die Seite neu auf wie bei jeder anderen Adresse. Damit dabei nichts springt, legt diese
      // Seite vorher eine Übergabe bereit: Die neue steht, wo sie als Nachbarin stand, zeigt zuerst ihre Vorschau, und diese
      // Seite hängt dort als Nachbarin, mit allen Strichen, die sie beim Abbau hat (auch einem, der erst dann fertig wird), und
      // dem Hintergrund, den sie zeigt. Ob die Vorschau ihre Datei schon gelesen hatte und ob diese Seite als gelesen gilt (`read`),
      // sagt sie dazu.
      onNeighbor: (side, now) => {
        const next = shownNeighbors.current[side];
        if (!next) return;
        offered = {
          path: next.path,
          view: viewFor(now, side),
          page: next.page,
          read: next.read,
          from: leaving(ACROSS[side]),
          at: Date.now(),
        };
        offerHandoff(offered);
        window.location.replace(routeHash(next.spec.route));
      },
      initialView: handoff?.view,
    });
    const first = emptyPage();
    if (handoff) {
      // Bis ihre Datei gelesen ist, zeigt die Seite, was die Vorschau von ihr zeigte. Für die Sitzung ist das keine Änderung (die
      // Fläche meldet nichts), geschrieben wird deswegen nichts. Danach zeigt die Sitzung die Datei, wenn sie anders ist; im
      // Entwurf kommt dazu, was auf der Fläche inzwischen dazukam.
      view.setPage({ ...first, strokes: handoff.page.strokes }, layout.fields, handoff.page.background);
      const from = handoff.from;
      const spec = neighborsRef.current?.[from.side];
      if (spec) {
        // Hatte die verlassene Seite ihre Datei gelesen oder war sie ein Entwurf, bleibt es bei ihren Strichen aus der Übergabe.
        // Sonst hat sie nie geschrieben, und der Nachbar-Effekt liest sie wie jeden Nachbarn; bis dahin zeigt sie, was sie zeigte.
        if (from.read) keptFrom.current = from.side;
        const withFrom = { ...shownNeighbors.current };
        withFrom[from.side] = { spec, path: normalizePath(spec.path), page: from.page, read: from.read };
        shownNeighbors.current = withFrom;
      }
    } else view.setPage(first, layout.fields, shownFor(first.meta));
    // Entsteht die Fläche für dieselbe Seite neu (andere Einstellungen), zeigt sie gleich die Nachbarn, die schon da waren. Nach
    // einer Übergabe ist das die Seite, von der man kam.
    const known = shownNeighbors.current;
    if (known.above || known.below) view.setNeighbors(pagesOf(known));
    // Was gewählt ist, gilt sofort auch für die Fläche, gleich wo es gewählt wurde (Leiste, Schnellwechsel). Ein Signal-Effekt
    // läuft gleich bei der Änderung, nicht erst nach dem nächsten Bild: Der Stift, der danach aufsetzt, hat schon das neue Werkzeug.
    const stopPrefs = effect(() => {
      const chosen = inkPrefs.value;
      view.setTool(chosen.tool);
      view.setPen(chosen.pen);
      view.setColor(chosen.color);
      view.setWidth(chosen.width);
      view.setEraser(chosen.eraserSize, chosen.eraserMode);
      view.setScribble(chosen.scribble);
      view.setFueller(chosen.fueller);
    });
    surface.current = view;

    const access: TestAccess = {
      currentPage: () => view.getPage(),
      toClient: (x, y) => view.toClient(x, y),
      liveStats: () => view.liveStats(),
      screenBackground: () => view.shownBackground,
      neighbors: () => view.neighborStrokes,
      neighborBackground: (side) => view.neighborBackground(side),
    };
    const session = new PageSession({
      engine,
      path,
      emptyPage,
      readOnly,
      draft,
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
        if (next === 'bereit') read = true;
        setHistory({ canUndo: view.canUndo, canRedo: view.canRedo });
        setPhase(next);
        setKopfMeta(view.getPage().meta);
        testAccessHolder().__notizbuch = access;
      },
      onSaveFailed: setSaveFailed,
    });
    sessionRef.current = session;
    setPhase('laden');
    setLoadingHint(!handoff?.read);
    void session.reload();

    return () => {
      stopPrefs();
      if (testAccessHolder().__notizbuch === access) delete testAccessHolder().__notizbuch;
      surface.current = null;
      sessionRef.current = null;
      view.finishInput(); // ein Strich, der gerade entsteht, gehört noch zur Seite
      // Und zu ihr als Nachbarin der nächsten Seite: Deren Aufbau kommt erst nach diesem Abbau und nimmt dann die Übergabe.
      if (offered) updateHandoff(offered, leaving(offered.from.side));
      session.close();
      view.destroy();
    };
  }, [engine, layout, path, days, shown, readOnly, locked, sigma, prediction, palm]);

  // Neue Geburtstage, Termine und Prioritäten (Woche, Monat) und neue Geburtstage im Kopf der Tagesseite zeigt die Fläche an Ort
  // und Stelle. Darum steht `marks` nicht im Effekt oben: Eine neue Fläche verlöre den Strich, der gerade entsteht, und den Verlauf
  // für Rückgängig. Dieser Effekt läuft nach jenem, die Fläche ist da.
  useEffect(() => {
    marksRef.current = marks;
    if (!kopfRef.current) surface.current?.showBackground(shown + marks);
  }, [shown, marks]);

  // Die Nachbarn über und unter der Seite: Die Fläche zeigt sie sofort mit Papier und Hintergrund (dazu die Markierung für heute
  // und ihr `marks`), ihre Striche, sobald ihre Datei gelesen ist (im Effekt danach). Er läuft nach dem Effekt der Fläche, sie ist
  // also da. Ein neues `marks` (Termine und Geburtstage sind gelesen oder haben sich geändert) bringt nur einen neuen Hintergrund:
  // Die Striche bleiben stehen, und ihre Datei wird deswegen nicht neu gelesen.
  const neighbors = p.neighbors;
  useEffect(() => {
    const next: ShownNeighbors = { above: null, below: null };
    for (const side of SIDES) {
      const spec = neighbors?.[side];
      if (!spec) continue;
      const path = normalizePath(spec.path);
      // Bis die Datei gelesen ist, bleiben die Striche, die die Vorschau von ihr schon zeigte, und mit ihnen, ob sie gelesen waren.
      // Mit demselben `marks` bleibt auch der Hintergrund: Nach einer Übergabe ist das der, den die verlassene Seite zeigte (in der
      // Woche mit ihren Prioritäten).
      const before = shownNeighbors.current[side];
      const same = before?.path === path ? before : null;
      const keep = same && (same.spec === spec || same.spec.marks === spec.marks);
      const background = keep ? same.page.background : spec.layout.background() + todayMarks(spec.layout, today) + (spec.marks ?? '');
      next[side] = { spec, path, page: { strokes: same?.page.strokes ?? [], background }, read: same?.read ?? false };
    }
    shownNeighbors.current = next;
    surface.current?.setNeighbors(pagesOf(next));
  }, [neighbors, today]);

  // Die Dateien der Nachbarn: gelesen, sobald sie Nachbarn sind, und neu, wenn ein anderes Gerät eine davon ändert. Er liest nur, er
  // schreibt nie, und er hängt nur an ihren Pfaden. Eine Antwort gilt, solange der Nachbar diesen Pfad hat, und je Nachbar zählt die
  // neueste Anfrage. Die Seite, von der man durch Weiterscrollen kam, liest er beim ersten Lauf nicht, wenn sie ihre Datei gelesen
  // hatte oder ein Entwurf war (`keptFrom`): Sie zeigt, was die Übergabe brachte, bis eine fremde Änderung kommt oder er wieder
  // läuft. Das tut er nur mit einer neuen Engine (die Pfade stehen mit der Seite fest), und deren Stand gilt dann auch für sie.
  const abovePath = neighbors?.above ? normalizePath(neighbors.above.path) : null;
  const belowPath = neighbors?.below ? normalizePath(neighbors.below.path) : null;
  useEffect(() => {
    const paths: Record<Side, string | null> = { above: abovePath, below: belowPath };
    if (!paths.above && !paths.below) return; // ohne Nachbarn (Besprechung) gibt es nichts zu lesen
    let current = true;
    // Je Nachbar zählt die neueste Anfrage: Antwortet eine frühere erst nach einer späteren, gilt die spätere.
    const latest: Record<Side, number> = { above: 0, below: 0 };
    const load = (side: Side) => {
      const path = paths[side];
      if (!path) return;
      const mine = ++latest[side];
      // Fehlt die Datei, lässt sie sich nicht lesen oder ist sie kaputt, zeigt die Vorschau nur das Papier. Gelesen ist sie, sobald
      // die Engine geantwortet hat, auch mit „gibt es nicht“; ein Fehler lässt sie ungelesen. Ihre Striche stehen in der Reihenfolge,
      // in der die Sitzung sie liest (siehe `previewStrokes`).
      engine
        .peek(path)
        .then((text) => ({ strokes: previewStrokes(text), read: true }))
        .catch(() => ({ strokes: [] as Stroke[], read: false }))
        .then(({ strokes, read }) => {
          const now = shownNeighbors.current[side];
          if (!current || mine !== latest[side] || now?.path !== path) return;
          const shownNow = { ...shownNeighbors.current, [side]: { ...now, page: { ...now.page, strokes }, read } };
          shownNeighbors.current = shownNow;
          surface.current?.setNeighbors(pagesOf(shownNow));
        });
    };
    // Die Kopie der verlassenen Seite hat ihren letzten Strich vielleicht noch nicht, weil ihre Sitzung gerade speichert. Ihre
    // Striche hat die Vorschau schon aus der Übergabe. Das gilt nur für dieses erste Lesen nach dem Wechsel.
    for (const side of SIDES) if (side !== keptFrom.current) load(side);
    keptFrom.current = null;
    const stop = engine.addRemoteChangeListener((changed) => {
      const touched = new Set(changed.map(normalizePath));
      for (const side of SIDES) {
        const path = paths[side];
        if (path && touched.has(path)) load(side);
      }
    });
    return () => {
      current = false;
      stop();
    };
  }, [engine, abovePath, belowPath]);

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

  const full = p.vollbild != null;
  const canWrite = !readOnly && phase !== 'unlesbar' && phase !== 'zuNeu' && phase !== 'gesperrt' && phase !== 'nichtGeladen';
  // Das Regler-Fenster der Füllfeder gehört zu dieser Seite, wie sie gerade zu sehen ist. Es schließt, wenn sie geht (Seitenwechsel),
  // wenn das Vollbild wechselt (es stand unter der Werkzeugleiste oder in der Mitte der Bühne) und wenn sie sich nicht mehr
  // beschreiben lässt. Alles andere, was es schließt, regelt `FuellerPanel` selbst.
  useLayoutEffect(
    () => () => {
      fuellerPanel.value = null;
    },
    [full, canWrite],
  );
  const wheel = p.vollbild === 'kreis';
  const ink = inkTools({
    surface,
    canWrite,
    full,
    canUndo: history.canUndo,
    canRedo: history.canRedo,
    nav: p.nav,
    onVollbildAus: p.onVollbildAus,
    quickSwitchPos: p.quickSwitchPos,
    onQuickSwitchMove: p.onQuickSwitchMove,
    filter: palm,
  });
  const { actions, quick } = ink;

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
      {!readOnly && !full && (
        <div class="leiste">
          {canWrite && (
            <Toolbar
              tool={tool}
              pen={chosenPen}
              color={color}
              width={width}
              canUndo={history.canUndo}
              canRedo={history.canRedo}
              eraserSize={eraserSize}
              eraserMode={eraserMode}
              onTool={ink.choose.tool}
              onPen={ink.choose.pen}
              fuellerOpen={fuellerPanel.value !== null}
              onEraserSize={ink.choose.eraserSize}
              onEraserMode={ink.choose.eraserMode}
              onColor={ink.choose.color}
              onWidth={ink.choose.width}
              onUndo={() => surface.current?.undo()}
              onRedo={() => surface.current?.redo()}
              onFit={() => surface.current?.zoomToFit()}
            />
          )}
        </div>
      )}
      {kopf && tools && !full && <div class="kopf">{kopf.form(tools)}</div>}
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
            {days.map((d) => {
              const info = p.dayInfo?.(d.day);
              return (
                <a key={d.day} href={routeHash({ view: 'tag', key: d.day })} aria-current={d.day === today ? 'date' : undefined}>
                  {info ? `${d.label}, ${info}` : d.label}
                </a>
              );
            })}
          </nav>
        )}
        {/* Die Hinweise liegen über der Fläche, damit sie die Seite nicht verschieben, wenn sie kommen oder gehen. */}
        {phase === 'laden' && loadingHint && <p class="hinweis">Seite wird geladen</p>}
        {phase === 'unlesbar' && (
          <p class="hinweis" role="alert">
            {UNREADABLE}
          </p>
        )}
        {phase === 'zuNeu' && (
          <p class="hinweis" role="alert">
            {TOO_NEW}{' '}
            <button type="button" class="pill" onClick={reloadApp}>
              Neu laden
            </button>
          </p>
        )}
        {phase === 'gesperrt' && (
          <p class="hinweis" role="alert">
            {BLOCKED}
          </p>
        )}
        {phase === 'nichtGeladen' && (
          <p class="hinweis" role="status">
            {NOT_LOADED}
          </p>
        )}
        {p.messung && meterText && (
          <p class="messung" aria-live="off">
            {meterText}
          </p>
        )}
        {saveFailed && (
          <p class="hinweis fehler" role="alert">
            Die letzte Änderung konnte nicht auf diesem Gerät gespeichert werden.
          </p>
        )}
        {/* Wo es keine Werkzeugleiste gibt (Firmen-PC, Seite nicht lesbar oder nicht geladen), bleibt dieser Knopf: der Weg zurück zur ganzen Seite. */}
        {!canWrite && !full && (
          <button type="button" class="tb ganze-seite" aria-label="Ganze Seite" title="Ganze Seite" onClick={() => surface.current?.zoomToFit()}>
            <Icon name="fit" />
          </button>
        )}
        {/* Im Vollbild steht das Rad (Kreis) oder die Lasche (Tab) da, auch ohne Schreiben: Sie bieten dann Blättern, Ganze Seite und den Weg aus dem Vollbild. */}
        {wheel && actions ? (
          <ToolWheel {...quick} canWrite={canWrite} actions={actions} onAction={ink.runAction} />
        ) : (
          <>
            {actions && <ToolTab actions={actions} filter={palm} onAction={ink.runAction} />}
            {canWrite && <QuickSwitch {...quick} />}
          </>
        )}
        {/* Das Regler-Fenster der Füllfeder liegt über allem auf der Bühne. Ohne Schreiben gibt es keine Stiftwahl, also auch kein Fenster. */}
        {canWrite && <FuellerPanel filter={palm} />}
      </div>
    </div>
  );
}
