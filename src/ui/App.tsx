import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SMOOTHING } from '../ink/types';
import { AccessChangedError, accessProblem, PendingChangesError, saveAccess, waitingText } from '../lib/access';
import { todayVienna, type Day } from '../lib/dates';
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
import { parseRoute, routeHash, shownMonth, type Route, type Steps } from './router';
import { SettingsPage } from './Settings';
import { Setup } from './Setup';
import { TagPage } from './TagPage';
import { ACCESS_BUSY, FAILED, OTHER_WINDOW, SWITCHING } from './texts';
import { TopBar } from './TopBar';
import { WochePage } from './WochePage';
import './app.css';

/** Alles, was zu einem Zugang gehört: Wechselt das Repository, entsteht das alles neu. */
type Session = {
  engine: SyncEngine;
  client: GitHubClient;
  settings: Settings;
  listDir: ListDir;
};

type Ready = { phase: 'bereit'; store: Store; window: ActiveWindow } & Session;

type Boot = { phase: 'laden' } | { phase: 'einrichten'; store: Store } | { phase: 'fehler' } | Ready;

/** Was beim Schließen der App aufgeräumt werden muss, und was gerade läuft. */
type Live = {
  store?: Store;
  /** Die Engine, die gilt. Sie ist vermerkt, bevor sie startet: Schließt die App währenddessen, hält das Aufräumen auch sie an. */
  engine?: SyncEngine;
  /** Die Frage nach der Sperre des Fensters, ab dem Augenblick, in dem sie gestellt ist: Schließt die App, bevor der Browser antwortet, gibt das Aufräumen die Sperre frei, sobald sie kommt. */
  lock?: Promise<ActiveWindow>;
  /** Eine Änderung des Zugangs läuft. Es läuft nie mehr als eine. */
  changing: boolean;
  gone: boolean;
};

/** Die Einstellungen als Seite. Solange der Zugang umgestellt wird, zeigt die App nur sie, welche Adresse auch dasteht. */
const SETTINGS_ROUTE: Route = { view: 'einstellungen', key: '' };

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/**
 * Der Kalendertag in Wien. Er ändert sich nicht mitten im Schreiben, sondern wenn die App wieder sichtbar wird: Wer sie über
 * Nacht im Hintergrund lässt, bekommt dann den Hinweis auf den Ablauf des Zugangs, der erst heute fällig ist.
 */
function useToday(): Day {
  const [today, setToday] = useState(() => todayVienna());
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setToday(todayVienna());
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, []);
  return today;
}

/** Die Warnung vor dem Ablauf, für diesen Augenblick gerechnet: nach dem Datum, das GitHub genannt hat, sonst nach dem aus der Einrichtung. */
const warningFor = (client: GitHubClient, typedExpiry: Day | undefined): string | null => expiryWarning(knownExpiry(client, typedExpiry), new Date());

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
  // Das Repository wird gewechselt: Bis das durch ist, wartet die App. Sie zeigt nur die Einstellungen und nimmt weder eine Berührung
  // noch einen Strich an, denn die Seiten gehörten sonst zur Engine und zu den Dateien des alten Repositorys.
  const [switching, setSwitching] = useState(false);
  const hash = useHash();
  const today = useToday();
  // Nur wenn sich die Adresse ändert: Ohne gültige Adresse gilt „heute“, und das soll sich nicht mitten im Schreiben
  // ändern, weil nach Mitternacht etwas anderes neu gezeichnet wird.
  const route = useMemo(() => (switching ? SETTINGS_ROUTE : parseRoute(hash)), [hash, switching]);
  // Wohin ‹ und › von einer Besprechungsseite aus führen, mit der Adresse der Seite, für die das gilt: Beim Wechsel zur
  // nächsten Seite gilt der Stand der alten nicht mehr, auch nicht für den Augenblick, bis die neue ihren meldet.
  const [pageSteps, setPageSteps] = useState<{ hash: string; steps: Steps } | null>(null);
  const here = routeHash(route);
  const reportSteps = useCallback((steps: Steps | null) => setPageSteps(steps && { hash: here, steps }), [here]);

  // Der Hinweis zum Start: Er kommt mit dem Start der Sitzung und, wenn sich dadurch ein anderer Text ergibt, noch einmal an einem anderen
  // Tag, sobald die App wieder sichtbar wird. Derselbe Text kommt nicht wieder, auch wenn man ihn geschlossen hat. (`today` stößt nur
  // das Neurechnen an.)
  const usedClient = boot.phase === 'bereit' ? boot.client : null;
  const typedExpiry = boot.phase === 'bereit' ? boot.settings.tokenExpiry : undefined;
  const startNotice = useMemo(() => (usedClient === null ? null : warningFor(usedClient, typedExpiry)), [usedClient, typedExpiry, today]);

  const live = useRef<Live>({ changing: false, gone: false });

  /**
   * Merkt sich die Engine, die gilt, und beendet die, die sie ablöst: Es läuft immer genau eine, und beim Schließen der App wird
   * genau diese angehalten.
   */
  const register = (engine: SyncEngine): void => {
    const replaced = live.current.engine;
    live.current.engine = engine;
    if (replaced !== undefined && replaced !== engine) replaced.close();
  };

  /**
   * Startet die Engine für diese Einstellungen. Ein Fenster, das nicht schreiben darf (`active` ist falsch), bekommt eine Engine,
   * die nur liest: Sie fragt GitHub nicht, lädt nichts hoch und legt nichts im Speicher an. Ist die App am Ende des Starts
   * geschlossen (oder die Engine abgelöst), gibt es keine Sitzung: `null`.
   */
  const startSession = async (store: Store, settings: Settings, active: boolean): Promise<Session | null> => {
    const client = new GitHubClient({ token: settings.token, repo: settings.repo });
    const engine = new SyncEngine({ client, store, device: settings.device, readOnly: !active });
    register(engine); // vor dem Start, damit das Schließen der App sie auch mitten im Start anhält
    await engine.start();
    if (live.current.gone || live.current.engine !== engine) {
      engine.stop();
      return null;
    }
    // Die Dateilisten (Projekte, Seiten einer Besprechung) holt die Oberfläche selbst: Sie gehören nicht zum Abgleich.
    return { engine, client, settings, listDir: (folder) => client.listDir(folder) };
  };

  /**
   * Das Fenster fragt einmal, ob es schreiben darf, und behält die Antwort, solange es offen ist. Dann läuft die Engine. Ein
   * Fenster, das die Sperre nicht bekommt, liest nur und sagt es. Ist die App inzwischen geschlossen, startet nichts (`null`):
   * Die Sperre, nach der gefragt wurde, gibt das Aufräumen frei, sobald der Browser antwortet.
   */
  const begin = async (store: Store, settings: Settings): Promise<Ready | null> => {
    if (live.current.gone) return null;
    const hold = await (live.current.lock ??= acquireActiveWindow());
    if (live.current.gone) return null;
    const session = await startSession(store, settings, hold.active);
    if (session === null) return null;
    return { phase: 'bereit', store, window: hold, ...session };
  };

  useEffect(() => {
    live.current.gone = false;
    void (async () => {
      try {
        const store = await openStore();
        if (live.current.gone) {
          store.close(); // die App wurde geschlossen, bevor der Speicher offen war: Das Aufräumen kannte ihn nicht
          return;
        }
        live.current.store = store;
        const settings = await loadSettings(store);
        if (live.current.gone) return;
        if (!settings) {
          setBoot({ phase: 'einrichten', store });
          return;
        }
        const next = await begin(store, settings);
        if (next !== null && !live.current.gone) setBoot(next);
      } catch {
        if (!live.current.gone) setBoot({ phase: 'fehler' });
      }
    })();
    return () => {
      live.current.gone = true;
      live.current.engine?.stop();
      // Die Sperre kommt vielleicht erst später vom Browser: Dann wird sie sofort wieder freigegeben.
      void live.current.lock?.then((hold) => hold.release(), () => undefined);
      live.current.store?.close();
    };
    // `begin` hängt nur von `live` ab, das sich nie ändert.
  }, []);

  /** Setzt die Oberfläche auf eine andere Sitzung um: neue Engine, neuer Client, neue Einstellungen. */
  const take = (session: Session) => setBoot((now) => (now.phase === 'bereit' ? { ...now, ...session } : now));

  /**
   * Startet die Sitzung für diese Einstellungen und setzt die Oberfläche darauf um. Die Engine davor ist beendet; gelingt es nicht,
   * eine neue zu starten, bleibt nur der Fehlerschirm, denn eine App mit beendeter Engine sähe gesund aus und schriebe nichts.
   */
  const restart = async (store: Store, settings: Settings): Promise<void> => {
    try {
      const session = await startSession(store, settings, true);
      if (session !== null) take(session);
    } catch {
      if (!live.current.gone) setBoot({ phase: 'fehler' });
    }
  };

  /**
   * Ein Wechsel, der nicht stattgefunden hat, oder ein Speicher, der anders aussieht, als die App glaubte: Es geht mit dem weiter,
   * was im Speicher steht (nicht mit dem, was die App vor der Prüfung gelesen hat, und was ein anderes Fenster inzwischen geändert
   * haben kann), in einer neuen Engine, denn die alte ist beendet.
   */
  const resume = async (store: Store): Promise<void> => {
    let stored: Settings | null;
    try {
      stored = await loadSettings(store);
    } catch {
      if (!live.current.gone) setBoot({ phase: 'fehler' });
      return;
    }
    if (live.current.gone) return;
    if (stored === null) {
      // Die Einstellungen sind weg (der Browser hat die Daten dieser Seite gelöscht): Es bleibt die Einrichtung.
      live.current.engine?.close();
      setBoot({ phase: 'einrichten', store });
      return;
    }
    await restart(store, stored);
  };

  // ---------- Einrichtung ----------

  /**
   * Ein anderes Fenster hat die Einrichtung inzwischen abgeschlossen: Dieses ändert und leert nichts, es öffnet die App mit dem,
   * was gespeichert ist. Liefert den Text, was nicht geklappt hat, oder `null`.
   */
  const reopen = async (store: Store): Promise<string | null> => {
    const stored = await loadSettings(store);
    if (live.current.gone) return null;
    if (stored === null) return FAILED;
    const next = await begin(store, stored);
    if (next === null) return null;
    setBoot(next);
    window.location.hash = routeHash({ view: 'tag', key: todayVienna() });
    return null;
  };

  const setUp = async (values: AccessValues): Promise<string | null> => {
    const now = bootNow.current;
    if (now.phase !== 'einrichten') return FAILED;
    const { store } = now;
    const client = new GitHubClient({ token: values.token, repo: values.repo });
    const problem = await accessProblem(client);
    if (live.current.gone) return null;
    if (problem !== null) return problem;
    let saved: Settings;
    try {
      saved = (await saveAccess(store, values, values.device, null)).settings;
    } catch (error) {
      if (error instanceof AccessChangedError) return reopen(store);
      throw error;
    }
    const next = await begin(store, saved);
    if (next === null) return null;
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
   * Nach jedem Warten gilt noch, dass die App offen ist und die Engine dieselbe: Sonst endet die Änderung, ohne etwas zu tun.
   */
  const applyAccess = async (now: Ready, values: AccessValues, switching: boolean): Promise<string | null> => {
    const { store, engine, settings } = now;
    const abandoned = () => live.current.gone || live.current.engine !== engine;

    if (switching) {
      await engine.flush();
      if (abandoned()) return FAILED;
      const waiting = await store.count('outbox');
      if (abandoned()) return FAILED;
      if (waiting > 0) return waitingText(waiting);
    }
    const client = new GitHubClient({ token: values.token, repo: values.repo });
    const problem = await accessProblem(client);
    if (abandoned()) return FAILED;
    if (problem !== null) return problem;

    // Ab hier schreibt und lädt die alte Engine nichts mehr. Was sie schon in den Speicher gestellt hat, sieht die Prüfung beim Speichern.
    if (switching) engine.close();
    let result: Awaited<ReturnType<typeof saveAccess>>;
    try {
      result = await saveAccess(store, values, settings.device, settings.repo);
    } catch (error) {
      const refused = error instanceof PendingChangesError || error instanceof AccessChangedError ? error : null;
      // Nichts wurde gewechselt. Beim Wechsel ist die alte Engine beendet, und war der Speicher ein anderer als gedacht, passt sie auch nicht mehr.
      if (switching || error instanceof AccessChangedError) await resume(store);
      if (refused !== null) return refused.message;
      throw error;
    }
    if (abandoned()) return FAILED;

    if (result.switched) {
      await restart(store, result.settings);
      return null;
    }
    // Gleiches Repository: Token und Ablaufdatum gelten, alles andere in den Einstellungen bleibt, wie es die Oberfläche gerade hat.
    engine.setClient(client);
    const { token, tokenExpiry } = result.settings;
    setBoot((current) =>
      current.phase === 'bereit' ? { ...current, client, listDir: (folder) => client.listDir(folder), settings: { ...current.settings, token, tokenExpiry } } : current,
    );
    // Was mit dem alten Token nicht ging, geht jetzt: hochladen, was wartet, und nach Änderungen anderswo fragen.
    void engine.flush();
    void engine.pollRemote();
    return null;
  };

  /**
   * Nimmt eine Änderung des Zugangs an, aber nur eine zugleich. Die Prüfung läuft weiter, auch wenn man das Formular verlässt (ein
   * neuer Token sperrt die App nicht); ein neues Formular könnte sonst eine zweite beginnen, die Engine und Einstellungen unter der
   * ersten austauscht. Ein Wechsel des Repositorys sperrt die App, bis er durch ist.
   */
  const changeAccess = async (values: AccessValues): Promise<string | null> => {
    const now = bootNow.current;
    if (now.phase !== 'bereit' || !now.window.active) return FAILED;
    if (live.current.changing) return ACCESS_BUSY;
    const switchesRepo = values.repo !== now.settings.repo;
    live.current.changing = true;
    if (switchesRepo) setSwitching(true);
    try {
      return await applyAccess(now, values, switchesRepo);
    } finally {
      live.current.changing = false;
      if (switchesRepo && !live.current.gone) setSwitching(false);
    }
  };

  // Der Schnellwechsel wurde verschoben: gleich auf dem Bildschirm, dann in den Einstellungen des Geräts. Gespeichert
  // wird der Stand aus dem Speicher, damit nichts überschrieben wird, was sich dort inzwischen geändert hat.
  const moveQuickSwitch = (pos: [number, number]) => {
    const now = bootNow.current;
    if (now.phase !== 'bereit' || !now.window.active) return; // das Fenster, das nur liest, speichert auch keine Einstellung
    setBoot((current) => (current.phase === 'bereit' ? { ...current, settings: { ...current.settings, quickSwitchPos: pos } } : current));
    void updateSettings(now.store, (saved) => ({ ...saved, quickSwitchPos: pos })).catch(() => undefined);
  };

  // Die Reiter gehören zum Jahr und Monat der Seite, bei einer Woche zu denen ihres Donnerstags. Die Einstellungen sind keine
  // Seite des Kalenders und haben keine.
  const shown = shownMonth(route);

  // Was gleich unter der Leiste steht und bleibt: Das zweite Fenster eines Geräts liest nur, oder der Zugang wird umgestellt.
  const banner = boot.phase !== 'bereit' ? null : !boot.window.active ? OTHER_WINDOW : switching ? SWITCHING : null;
  const classes = [banner !== null ? 'mit-hinweis' : '', switching ? 'umstellen' : ''].filter(Boolean).join(' ');

  return (
    <main id="app" class={classes || undefined}>
      {boot.phase === 'bereit' ? (
        <>
          <TopBar
            route={route}
            engine={boot.engine}
            steps={pageSteps?.hash === here ? pageSteps.steps : undefined}
            startNotice={startNotice}
            passive={!boot.window.active}
            blocked={switching}
          />
          {banner !== null && (
            <p class="fensterhinweis" role="status">
              {banner}
            </p>
          )}
          <div class="inhalt" inert={switching}>
            {/* Jede Seite ist ein eigenes Bauteil: Beim Wechsel wird die alte gesichert und geschlossen, die neue liest ihre Datei. */}
            {route.view === 'einstellungen' ? (
              <SettingsPage
                key={here}
                settings={boot.settings}
                warning={warningFor(boot.client, boot.settings.tokenExpiry)}
                passive={!boot.window.active}
                onChange={choose}
                onAccess={changeAccess}
              />
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
            {route.view !== 'einstellungen' && <MonthTabs year={Number(shown.slice(0, 4))} current={shown} />}
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
