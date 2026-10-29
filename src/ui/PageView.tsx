import type { Signal } from '@preact/signals';
import { useEffect, useRef, useState } from 'preact/hooks';
import { GestureFilter } from '../ink/gestures';
import { InkSurface } from '../ink/surface';
import type { InkColor, Page, WidthName } from '../ink/types';
import type { Day } from '../lib/dates';
import { tagPagePath } from '../lib/filenames';
import { statusLabel, type SyncEngine } from '../sync/engine';
import { PageSession, type Phase } from './pageSession';
import { QuickSwitch } from './QuickSwitch';
import { retryCues } from './retryCues';
import { Toolbar, type Tool } from './Toolbar';

// Eine Tagesseite zum Schreiben. Lesen, Speichern und fremde Änderungen übernimmt `PageSession`, diese Datei verbindet
// sie mit der Schreibfläche, der Werkzeugleiste und dem Status. Felder und Hintergrund der Seite kommen später.

type Props = {
  engine: SyncEngine;
  day: Day;
  /** Nur ansehen (Firmen-PC): keine Werkzeuge, es wird nie geschrieben. */
  readOnly: boolean;
  /** Glättung des Stifts (σ) und Vorhersage aus den Einstellungen. */
  sigma: number;
  prediction: boolean;
  /** Ort des Schnellwechsels, siehe `Settings.quickSwitchPos`. */
  quickSwitchPos?: [number, number];
  onQuickSwitchMove(pos: [number, number]): void;
};

const UNREADABLE = 'Diese Seite lässt sich nicht lesen und wird nicht verändert.';
const NOT_LOADED = 'Diese Seite konnte nicht geladen werden. Neuer Versuch, sobald das Netz da ist.';

/** Testzugang: nur lesen, enthält keine Geheimnisse. Er steht da, sobald die Seite gelesen ist. */
type TestAccess = { currentPage(): Page; toClient(x: number, y: number): { x: number; y: number } };
const testAccessHolder = (): { __notizbuch?: TestAccess } => window as unknown as { __notizbuch?: TestAccess };

function useSignalValue<T>(source: Signal<T>): T {
  const [value, setValue] = useState(source.value);
  useEffect(() => source.subscribe(setValue), [source]);
  return value;
}

export function PageView(p: Props) {
  const { engine, day, readOnly, sigma, prediction } = p;
  const host = useRef<HTMLDivElement>(null);
  const surface = useRef<InkSurface | null>(null);
  // Ein Tor gegen Handballen für Fläche und Schnellwechsel: Beide liegen dort, wo beim Schreiben die Hand ruht.
  const [palm] = useState(() => new GestureFilter());
  const [phase, setPhase] = useState<Phase>('laden');
  const [tool, setTool] = useState<Tool>('pen');
  const [color, setColor] = useState<InkColor>('schwarz');
  const [width, setWidth] = useState<WidthName>('mittel');
  const [history, setHistory] = useState({ canUndo: false, canRedo: false });
  const [saveFailed, setSaveFailed] = useState(false);
  const status = useSignalValue(engine.status);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const emptyPage = (): Page => ({ kind: 'tag', key: day, meta: {}, strokes: [] });

    const view: InkSurface = new InkSurface(el, {
      readOnly: true, // bis die Seite gelesen ist
      sigma,
      prediction,
      filter: palm,
      onChange: (page) => {
        setHistory({ canUndo: view.canUndo, canRedo: view.canRedo });
        session.changed(page);
      },
    });
    view.setPage(emptyPage(), [], '');
    view.setTool(tool);
    view.setColor(color);
    view.setWidth(width);
    surface.current = view;

    const access: TestAccess = { currentPage: () => view.getPage(), toClient: (x, y) => view.toClient(x, y) };
    const session = new PageSession({
      engine,
      path: tagPagePath(day),
      emptyPage,
      readOnly,
      surface: {
        getPage: () => view.getPage(),
        setPage: (page) => view.setPage(page, [], ''),
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
  }, [engine, day, readOnly, sigma, prediction, palm]);

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
        <span class={`status status-${status.state}`} data-testid="status" role="status">
          {statusLabel(status)}
        </span>
      </div>
      <div class="buehne">
        <div class="flaeche" data-testid="surface" ref={host} />
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
