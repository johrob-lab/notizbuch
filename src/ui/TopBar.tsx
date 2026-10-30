import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { todayVienna } from '../lib/dates';
import type { SyncEngine } from '../sync/engine';
import { nextRoute, prevRoute, routeHash, viewRoute, type Route, type Steps } from './router';
import { StatusPill } from './StatusPill';

type Props = {
  route: Route;
  engine: Pick<SyncEngine, 'status' | 'onConflict' | 'onError'>;
  /**
   * Wohin ‹ und › führen, wenn die Seite das selbst bestimmt (die Seiten einer Besprechung). Ohne diese Angabe blättern sie
   * einen Tag, eine Woche oder einen Monat. Solange eine Besprechung sie noch nicht liefert, sind beide Pfeile grau.
   */
  steps?: Steps;
  /**
   * Ein Hinweis, der beim Start der App kommt (zum Beispiel, dass der Zugang bald abläuft). Er steht wie jede Meldung da, bis man ihn
   * schließt, und kommt nicht wieder, wenn man blättert: Er gehört zum Start, nicht zur Seite. Ändert sich der Text, ersetzt der neue den
   * alten, `null` nimmt ihn weg.
   */
  startNotice?: string | null;
  /** Dieses Fenster liest nur (das zweite Fenster eines Geräts): Der Stand des Abgleichs gehört dem anderen und fehlt hier. */
  passive?: boolean;
  /** Die App wartet (der Zugang wird umgestellt): Nichts in der Leiste lässt sich antippen, auch nicht mit der Tastatur. */
  blocked?: boolean;
};

type Note = { id: number; text: string; alert: boolean; start?: boolean };

const SOON = 'kommt mit Stufe C';
/** So lange steht ein Hinweis, der nur informiert. Meldungen über Fehler und Konflikte und der Hinweis zum Start bleiben, bis man sie schließt. */
const INFO_MS = 8000;
/** Ein Fehler beim Abgleich, der keine Datei betrifft. Es gibt ihn höchstens einmal, auch wenn er sich wiederholt. */
const FAILED_WITHOUT_FILE = 'Abgleich hat nicht geklappt. Neuer Versuch folgt.';

type Item = { name: string; view?: 'monat' | 'woche' | 'tag' };
const ITEMS: Item[] = [
  { name: 'Index' },
  { name: 'Jahr' },
  { name: 'Monat', view: 'monat' },
  { name: 'Woche', view: 'woche' },
  { name: 'Tag', view: 'tag' },
  { name: 'To-Dos' },
];

const STEP_LABELS: Record<Route['view'], [string, string]> = {
  tag: ['Voriger Tag', 'Nächster Tag'],
  woche: ['Vorige Woche', 'Nächste Woche'],
  monat: ['Voriger Monat', 'Nächster Monat'],
  besprechung: ['Vorige Seite', 'Nächste Seite'],
  einstellungen: ['Vorige Seite', 'Nächste Seite'],
};

/** Zahnrad, 24 x 24, als Linie wie die Symbole der Werkzeugleiste. */
const GEAR =
  'M10.2 4.8L10.4 2.5H13.6L13.8 4.8L15.8 5.7L17.6 4.2L19.8 6.4L18.3 8.2L19.2 10.2L21.5 10.4V13.6L19.2 13.8L18.3 15.8L19.8 17.6L17.6 19.8L15.8 18.3L13.8 19.2L13.6 21.5H10.4L10.2 19.2L8.2 18.3L6.4 19.8L4.2 17.6L5.7 15.8L4.8 13.8L2.5 13.6V10.4L4.8 10.2L5.7 8.2L4.2 6.4L6.4 4.2L8.2 5.7Z M15 12a3 3 0 1 0-6 0 3 3 0 0 0 6 0z';

const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** Ein Schritt zurück oder vor. Wo es keinen gibt (Einstellungen, erste und letzte Seite einer Besprechung, Ende des Kalenders), ist der Knopf ausgegraut. */
function Step({ label, symbol, from, to }: { label: string; symbol: string; from: Route; to: Route }) {
  if (routeHash(to) === routeHash(from)) {
    return (
      <button type="button" class="pill pfeil" aria-label={label} aria-disabled="true">
        {symbol}
      </button>
    );
  }
  return (
    <a class="pill pfeil" href={routeHash(to)} aria-label={label}>
      {symbol}
    </a>
  );
}

/**
 * Die Leiste oben: Blättern, die Ansichten, der Stand des Abgleichs und die Einstellungen. Hier laufen auch die
 * Meldungen der Engine auf (Konfliktkopie, Fehler beim Abgleich) und bleiben, bis man sie schließt. Ein Hinweis, der nur
 * informiert, verschwindet nach 8 Sekunden von selbst.
 */
export function TopBar({ route, engine, steps, startNotice, passive, blocked }: Props) {
  const [notes, setNotes] = useState<Note[]>([]);
  const lastId = useRef(0);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const announce = useCallback((text: string, alert: boolean) => {
    const id = ++lastId.current;
    // Dieselbe Meldung nur einmal: Ein Fehler, der sich wiederholt, soll die Leiste nicht füllen.
    setNotes((list) => (list.some((n) => n.text === text) ? list : [...list, { id, text, alert }]));
    if (alert) return;
    const timer = setTimeout(() => {
      timers.current.delete(timer);
      setNotes((list) => list.filter((n) => n.id !== id));
    }, INFO_MS);
    timers.current.add(timer);
  }, []);
  useEffect(() => {
    const running = timers.current;
    return () => {
      for (const timer of running) clearTimeout(timer);
      running.clear();
    };
  }, []);

  // Der Hinweis zum Start läuft nur, wenn sich sein Text ändert (nicht bei jeder Seite): Wer ihn geschlossen hat, sieht ihn
  // beim Blättern nicht wieder. Ein neuer Text ersetzt den alten, auch wenn der noch offen ist.
  useEffect(() => {
    const id = ++lastId.current;
    setNotes((list) => {
      const rest = list.filter((n) => !n.start);
      if (startNotice) return [...rest, { id, text: startNotice, alert: false, start: true }];
      return rest.length === list.length ? list : rest;
    });
  }, [startNotice]);

  // Vor dem ersten Zeichnen und nicht danach: Die Engine ist beim Start schon am Abgleichen, und eine Meldung, die vor
  // dem Anmelden kommt, ginge verloren.
  useLayoutEffect(() => {
    const conflict = ({ copyPath }: { copyPath: string }) => announce(`Konfliktkopie angelegt: ${fileName(copyPath)}`, true);
    // Der Fehler kann beim Hochladen und beim Lesen kommen, darum heißt es „Abgleich“. Ohne Datei bleibt der Text allgemein.
    const failed = ({ path }: { path: string }) => announce(path ? `Abgleich hat nicht geklappt: ${fileName(path)}` : FAILED_WITHOUT_FILE, true);
    engine.onConflict = conflict;
    engine.onError = failed;
    return () => {
      if (engine.onConflict === conflict) engine.onConflict = undefined;
      if (engine.onError === failed) engine.onError = undefined;
    };
  }, [engine, announce]);

  const [prevLabel, nextLabel] = STEP_LABELS[route.view];
  // Eine Besprechung bestimmt ihre Schritte selbst, `null` ist ein Schritt, den es nicht gibt (der Knopf bleibt grau).
  const back = steps ? (steps.prev ?? route) : prevRoute(route);
  const forward = steps ? (steps.next ?? route) : nextRoute(route);
  // Wer die App über Nacht offen lässt, soll mit „Heute“ im neuen Tag landen: Der Tag wird beim Tippen berechnet.
  const today = () => routeHash({ view: 'tag', key: todayVienna() });

  return (
    <header class="topbar" inert={blocked}>
      <div class="schritte" role="group" aria-label="Blättern">
        <Step label={prevLabel} symbol="‹" from={route} to={back} />
        <Step label={nextLabel} symbol="›" from={route} to={forward} />
        <a
          class="pill"
          href={today()}
          onClick={(e) => {
            e.preventDefault();
            window.location.hash = today();
          }}
        >
          Heute
        </a>
      </div>
      <nav class="ansichten" aria-label="Ansichten">
        {ITEMS.map(({ name, view }) =>
          view ? (
            <a key={name} class="pill" href={routeHash(viewRoute(route, view))} aria-current={route.view === view ? 'page' : undefined}>
              {name}
            </a>
          ) : (
            <button key={name} type="button" class="pill" aria-disabled="true" title={SOON} onClick={() => announce(`${name} ${SOON}`, false)}>
              {name}
            </button>
          ),
        )}
      </nav>
      {/* Das Fenster, das nur liest, hat keinen Stand zu zeigen. Die leere Fläche hält das Zahnrad rechts. */}
      {passive ? <span class="status" /> : <StatusPill engine={engine} />}
      <a class="pill zahnrad" href="#/einstellungen" aria-label="Einstellungen" aria-current={route.view === 'einstellungen' ? 'page' : undefined}>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={GEAR} />
        </svg>
      </a>
      {notes.length > 0 && (
        <div class="meldungen">
          {notes.map((n) => (
            <div key={n.id} class="meldung" role={n.alert ? 'alert' : 'status'}>
              <span>{n.text}</span>
              <button type="button" class="tb" aria-label="Hinweis schließen" onClick={() => setNotes((list) => list.filter((x) => x.id !== n.id))}>
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </header>
  );
}
