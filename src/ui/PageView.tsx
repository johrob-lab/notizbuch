import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { GestureFilter } from '../ink/gestures';
import { InkSurface } from '../ink/surface';
import type { InkColor, Page, WidthName } from '../ink/types';
import { todayVienna } from '../lib/dates';
import { tapTargetAt, tapTargets, todayMarks, type Layout } from '../pages/layouts';
import type { SyncEngine } from '../sync/engine';
import { PageSession, type Phase } from './pageSession';
import { QuickSwitch } from './QuickSwitch';
import { retryCues } from './retryCues';
import { routeHash } from './router';
import { Toolbar, type Tool } from './Toolbar';

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

type Props = PageProps & {
  /**
   * Felder und Hintergrund dieser Seite. Eine andere Seite ist ein neues `PageView` (die App setzt dafür den `key`):
   * Jede Seite schreibt nur mit ihren eigenen Feldern und ihrem eigenen Hintergrund.
   */
  layout: Layout;
  /** Pfad der Seitendatei im Vault. */
  path: string;
};

const UNREADABLE = 'Diese Seite lässt sich nicht lesen und wird nicht verändert.';
const NOT_LOADED = 'Diese Seite konnte nicht geladen werden. Neuer Versuch, sobald das Netz da ist.';

/** Testzugang: nur lesen, enthält keine Geheimnisse. Er steht da, sobald die Seite gelesen ist. */
type TestAccess = { currentPage(): Page; toClient(x: number, y: number): { x: number; y: number } };
const testAccessHolder = (): { __notizbuch?: TestAccess } => window as unknown as { __notizbuch?: TestAccess };

export function PageView(p: Props) {
  const { engine, layout, path, readOnly, sigma, prediction } = p;
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<InkSurface | null>(null);
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

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const emptyPage = (): Page => ({ kind: layout.kind, key: layout.key, meta: {}, strokes: [] });
    // In die Datei kommt der Hintergrund der Seite, auf den Bildschirm dazu die Markierung für heute.
    const background = layout.background();
    const shown = background + todayMarks(layout, today);

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
    });
    view.setPage(emptyPage(), layout.fields, shown);
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
      surface: {
        getPage: () => view.getPage(),
        setPage: (page) => view.setPage(page, layout.fields, shown),
        setReadOnly: (on) => view.setReadOnly(on),
      },
      retryCues,
      onPhase: (next) => {
        setHistory({ canUndo: view.canUndo, canRedo: view.canRedo });
        setPhase(next);
        testAccessHolder().__notizbuch = access;
      },
      onSaveFailed: setSaveFailed,
    });
    setPhase('laden');
    void session.reload();

    return () => {
      if (testAccessHolder().__notizbuch === access) delete testAccessHolder().__notizbuch;
      surface.current = null;
      view.finishInput(); // ein Strich, der gerade entsteht, gehört noch zur Seite
      session.close();
      view.destroy();
    };
  }, [engine, layout, path, days, today, readOnly, sigma, prediction, palm]);

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
            />
          )}
        </div>
      )}
      <div class="buehne">
        <div class="flaeche" data-testid="surface" ref={host} />
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
