import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SMOOTHING } from '../ink/types';
import { accessProblem, PendingChangesError, saveAccess, waitingText } from '../lib/access';
import { monthKey, todayVienna } from '../lib/dates';
import { expiryWarning, knownExpiry } from '../lib/expiry';
import { loadSettings, updateSettings, type Settings } from '../lib/settings';
import { SyncEngine } from '../sync/engine';
import { GitHubClient, type ListDir } from '../sync/github';
import { openStore, type Store } from '../sync/store';
import { acquireActiveWindow, type ActiveWindow } from './activeWindow';
import type { AccessValues } from './AccessForm';
import { BesprechungPage } from './BesprechungPage';
import { MonatPage } from './MonatPage';
import { MonthTabs } from './MonthTabs';
import type { PageProps } from './PageView';
import { parseRoute, routeHash, shownDay, type Route, type Steps } from './router';
import { SettingsPage } from './Settings';
import { Setup } from './Setup';
import { TagPage } from './TagPage';
import { FAILED, OTHER_WINDOW } from './texts';
import { TopBar } from './TopBar';
import { WochePage } from './WochePage';
import './app.css';

/** Alles, was zu einem Zugang gehört: Wechselt das Repository, entsteht das alles neu. */
type Session = {
  engine: SyncEngine;
  client: GitHubClient;
  settings: Settings;
  listDir: ListDir;
  /** Die Warnung, dass der Zugang bald abläuft, oder `null`. */
  warning: string | null;
};

type Boot =
  | { phase: 'laden' }
  | { phase: 'einrichten'; store: Store }
  | { phase: 'fehler' }
  | ({ phase: 'bereit'; store: Store; window: ActiveWindow } & Session);

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** Die Warnung vor dem Ablauf: nach dem Datum, das GitHub genannt hat, sonst nach dem aus der Einrichtung. */
const warningFor = (client: GitHubClient, settings: Settings): string | null => expiryWarning(knownExpiry(client, settings.tokenExpiry), new Date());

/**
 * Startet die Engine für diese Einstellungen. Ein Fenster, das nicht schreiben darf (`active` ist falsch), bekommt eine Engine,
 * die nur liest: Sie fragt GitHub nicht, lädt nichts hoch und legt nichts im Speicher an.
 */
async function startSession(store: Store, settings: Settings, active: boolean): Promise<Session> {
  const client = new GitHubClient({ token: settings.token, repo: settings.repo });
  const engine = new SyncEngine({ client, store, device: settings.device, readOnly: !active });
  await engine.start();
  // Die Dateilisten (Projekte, Seiten einer Besprechung) holt die Oberfläche selbst: Sie gehören nicht zum Abgleich.
  return { engine, client, settings, listDir: (folder) => client.listDir(folder), warning: warningFor(client, settings) };
}

function Seite({ route, listDir, onSteps, ...page }: { route: Route; listDir: ListDir; onSteps(steps: Steps | null): void } & PageProps) {
  switch (route.view) {
    case 'tag':
      return <TagPage day={route.key} listDir={listDir} {...page} />;
    case 'woche':
      return <WochePage week={route.key} {...page} />;
    case 'monat':
      return <MonatPage month={route.key} {...page} />;
    case 'besprechung':
      return <BesprechungPage base={route.key} n={route.n ?? 1} listDir={listDir} onSteps={onSteps} {...page} />;
    case 'einstellungen':
      return null; // die Einstellungen sind keine Seite zum Schreiben, die App zeigt sie selbst
  }
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'laden' });
  const bootNow = useRef(boot);
  bootNow.current = boot;
  const hash = useHash();
  // Nur wenn sich die Adresse ändert: Ohne gültige Adresse gilt „heute“, und das soll sich nicht mitten im Schreiben
  // ändern, weil nach Mitternacht etwas anderes neu gezeichnet wird.
  const route = useMemo(() => parseRoute(hash), [hash]);
  // Wohin ‹ und › von einer Besprechungsseite aus führen, mit der Adresse der Seite, für die das gilt: Beim Wechsel zur
  // nächsten Seite gilt der Stand der alten nicht mehr, auch nicht für den Augenblick, bis die neue ihren meldet.
  const [pageSteps, setPageSteps] = useState<{ hash: string; steps: Steps } | null>(null);
  const here = routeHash(route);
  const reportSteps = useCallback((steps: Steps | null) => setPageSteps(steps && { hash: here, steps }), [here]);

  // Was beim Schließen der App aufgeräumt werden muss: die Engine, die gerade läuft, die Sperre des Fensters und der Speicher.
  const live = useRef<{ store?: Store; engine?: SyncEngine; window?: ActiveWindow; gone: boolean }>({ gone: false });

  /**
   * Das Fenster fragt einmal, ob es schreiben darf, und behält die Antwort, solange es offen ist. Dann läuft die Engine. Ein
   * Fenster, das die Sperre nicht bekommt, liest nur und sagt es.
   */
  const begin = async (store: Store, settings: Settings): Promise<Boot> => {
    const hold = (live.current.window ??= await acquireActiveWindow());
    const session = await startSession(store, settings, hold.active);
    live.current.engine = session.engine;
    return { phase: 'bereit', store, window: hold, ...session };
  };

  useEffect(() => {
    live.current.gone = false;
    void (async () => {
      try {
        const store = await openStore();
        live.current.store = store;
        if (live.current.gone) return;
        const settings = await loadSettings(store);
        if (live.current.gone) return;
        if (!settings) {
          setBoot({ phase: 'einrichten', store });
          return;
        }
        const next = await begin(store, settings);
        if (!live.current.gone) setBoot(next);
      } catch {
        if (!live.current.gone) setBoot({ phase: 'fehler' });
      }
    })();
    return () => {
      live.current.gone = true;
      live.current.engine?.stop();
      live.current.window?.release();
      live.current.store?.close();
    };
    // `begin` hängt nur von `live` ab, das sich nie ändert.
  }, []);

  /** Setzt die Oberfläche auf einen anderen Zugang um: neue Engine, neuer Client, neue Einstellungen. */
  const take = (session: Session) => setBoot((now) => (now.phase === 'bereit' ? { ...now, ...session } : now));

  // ---------- Einrichtung ----------

  const setUp = async (values: AccessValues): Promise<string | null> => {
    const now = bootNow.current;
    if (now.phase !== 'einrichten') return FAILED;
    const client = new GitHubClient({ token: values.token, repo: values.repo });
    const problem = await accessProblem(client);
    if (problem !== null) return problem;
    let saved: Settings;
    try {
      saved = await saveAccess(now.store, values, values.device);
    } catch (error) {
      if (error instanceof PendingChangesError) return error.message;
      throw error;
    }
    const next = await begin(now.store, saved);
    if (live.current.gone) return null;
    setBoot(next);
    window.location.hash = routeHash({ view: 'tag', key: todayVienna() });
    return null;
  };

  // ---------- Einstellungen ----------

  /** Eine Wahl der Einstellungen gilt sofort und wird gespeichert, ausgehend vom Stand im Speicher: Nichts anderes geht dabei verloren. */
  const choose = async (patch: Partial<Pick<Settings, 'smoothing' | 'prediction' | 'device'>>): Promise<void> => {
    const now = bootNow.current;
    if (now.phase !== 'bereit' || !now.window.active) return;
    const before = Object.fromEntries(Object.keys(patch).map((key) => [key, now.settings[key as keyof Settings]])) as Partial<Settings>;
    setBoot((current) => (current.phase === 'bereit' ? { ...current, settings: { ...current.settings, ...patch } } : current));
    if (patch.device) now.engine.setDevice(patch.device);
    try {
      await updateSettings(now.store, (saved) => ({ ...saved, ...patch }));
    } catch (error) {
      // Gespeichert ist nichts: Die Oberfläche zeigt wieder, was gilt, und die Seite sagt, dass es nicht geklappt hat.
      setBoot((current) => (current.phase === 'bereit' ? { ...current, settings: { ...current.settings, ...before } } : current));
      if (before.device) now.engine.setDevice(before.device);
      throw error;
    }
  };

  /**
   * Ein neuer Zugang. Bei einem anderen Repository wird zuerst gesichert, was noch wartet (zum alten Repository, mit dem alten
   * Zugang), und dem neuen wird nichts geschickt, solange etwas wartet. Dann beendet die App die alte Engine und leert in einem
   * Zug mit dem Speichern der Einstellungen alles, was zum alten Repository gehört: So kann nichts davon ins neue gelangen.
   * Bei gleichem Repository gilt der neue Token für die laufende Engine, und Dateien und Warteschlange bleiben, wie sie sind.
   */
  const changeAccess = async (values: AccessValues): Promise<string | null> => {
    const now = bootNow.current;
    if (now.phase !== 'bereit' || !now.window.active) return FAILED;
    const { store, engine, settings } = now;
    const switching = values.repo !== settings.repo;

    if (switching) {
      await engine.flush();
      const waiting = await store.count('outbox');
      if (waiting > 0) return waitingText(waiting);
    }
    const client = new GitHubClient({ token: values.token, repo: values.repo });
    const problem = await accessProblem(client);
    if (problem !== null) return problem;

    // Ab hier schreibt und lädt die alte Engine nichts mehr. Was sie schon in den Speicher gestellt hat, sieht die Prüfung beim Speichern.
    if (switching) engine.close();
    let saved: Settings;
    try {
      saved = await saveAccess(store, values, settings.device);
    } catch (error) {
      // Nichts wurde gewechselt: Mit dem alten Zugang geht es weiter, in einer neuen Engine, denn die alte ist beendet.
      if (switching) take(await startSession(store, settings, true).then(remember));
      if (error instanceof PendingChangesError) return error.message;
      throw error;
    }

    if (switching) {
      take(await startSession(store, saved, true).then(remember));
      return null;
    }
    engine.setClient(client);
    take({ engine, client, settings: saved, listDir: (folder) => client.listDir(folder), warning: warningFor(client, saved) });
    // Was mit dem alten Token nicht ging, geht jetzt: hochladen, was wartet, und nach Änderungen anderswo fragen.
    void engine.flush();
    void engine.pollRemote();
    return null;
  };

  /** Merkt sich die Engine, die gerade läuft, damit sie beim Schließen der App angehalten wird. */
  const remember = (session: Session): Session => {
    live.current.engine = session.engine;
    return session;
  };

  // Der Schnellwechsel wurde verschoben: gleich auf dem Bildschirm, dann in den Einstellungen des Geräts. Gespeichert
  // wird der Stand aus dem Speicher, damit nichts überschrieben wird, was sich dort inzwischen geändert hat.
  const moveQuickSwitch = (pos: [number, number]) => {
    const now = bootNow.current;
    if (now.phase !== 'bereit' || !now.window.active) return; // das Fenster, das nur liest, speichert auch keine Einstellung
    setBoot((current) => (current.phase === 'bereit' ? { ...current, settings: { ...current.settings, quickSwitchPos: pos } } : current));
    void updateSettings(now.store, (saved) => ({ ...saved, quickSwitchPos: pos })).catch(() => undefined);
  };

  // Die Reiter gehören zum Jahr und Monat der Seite. Die Einstellungen sind keine Seite des Kalenders und haben keine.
  const shown = shownDay(route);

  return (
    <main id="app" class={boot.phase === 'bereit' && !boot.window.active ? 'nur-lesen' : undefined}>
      {boot.phase === 'bereit' ? (
        <>
          <TopBar
            route={route}
            engine={boot.engine}
            steps={pageSteps?.hash === here ? pageSteps.steps : undefined}
            startNotice={boot.warning}
            passive={!boot.window.active}
          />
          {!boot.window.active && (
            <p class="fensterhinweis" role="status">
              {OTHER_WINDOW}
            </p>
          )}
          <div class="inhalt">
            {/* Jede Seite ist ein eigenes Bauteil: Beim Wechsel wird die alte gesichert und geschlossen, die neue liest ihre Datei. */}
            {route.view === 'einstellungen' ? (
              <SettingsPage key={here} settings={boot.settings} warning={boot.warning} passive={!boot.window.active} onChange={choose} onAccess={changeAccess} />
            ) : (
              <Seite
                key={here}
                route={route}
                listDir={boot.listDir}
                onSteps={reportSteps}
                engine={boot.engine}
                readOnly={boot.settings.device === 'Firmen-PC'}
                sigma={SMOOTHING[boot.settings.smoothing] ?? SMOOTHING.mittel}
                prediction={boot.settings.prediction}
                quickSwitchPos={boot.settings.quickSwitchPos}
                onQuickSwitchMove={moveQuickSwitch}
              />
            )}
            {route.view !== 'einstellungen' && <MonthTabs year={Number(shown.slice(0, 4))} current={monthKey(shown)} />}
          </div>
        </>
      ) : boot.phase === 'einrichten' ? (
        <Setup onSubmit={setUp} />
      ) : (
        <>
          <h1>Notizbuch</h1>
          {boot.phase === 'fehler' && <p>Das Notizbuch lässt sich auf diesem Gerät nicht starten.</p>}
        </>
      )}
    </main>
  );
}
