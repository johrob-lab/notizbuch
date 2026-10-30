import { useEffect, useMemo, useState } from 'preact/hooks';
import { SMOOTHING } from '../ink/types';
import { monthKey } from '../lib/dates';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { SyncEngine } from '../sync/engine';
import { GitHubClient } from '../sync/github';
import { openStore, type Store } from '../sync/store';
import { BesprechungPage, type ListDir } from './BesprechungPage';
import { MonatPage } from './MonatPage';
import { MonthTabs } from './MonthTabs';
import type { PageProps } from './PageView';
import { parseRoute, routeHash, shownDay, type Route } from './router';
import { TagPage } from './TagPage';
import { TopBar } from './TopBar';
import { WochePage } from './WochePage';
import './app.css';

type Boot =
  | { phase: 'laden' }
  | { phase: 'einrichten' }
  | { phase: 'fehler' }
  | { phase: 'bereit'; store: Store; engine: SyncEngine; settings: Settings; listDir: ListDir };

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

/** Für Seiten, die erst später kommen. */
function Platzhalter({ text }: { text: string }) {
  return (
    <section class="platzhalter">
      <p>{text}</p>
    </section>
  );
}

function Seite({ route, listDir, ...page }: { route: Route; listDir: ListDir } & PageProps) {
  switch (route.view) {
    case 'tag':
      return <TagPage day={route.key} {...page} />;
    case 'woche':
      return <WochePage week={route.key} {...page} />;
    case 'monat':
      return <MonatPage month={route.key} {...page} />;
    case 'besprechung':
      return <BesprechungPage base={route.key} n={route.n ?? 1} listDir={listDir} {...page} />;
    case 'einstellungen':
      return <Platzhalter text="Einstellungen folgen." />;
  }
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'laden' });
  const hash = useHash();
  // Nur wenn sich die Adresse ändert: Ohne gültige Adresse gilt „heute“, und das soll sich nicht mitten im Schreiben
  // ändern, weil nach Mitternacht etwas anderes neu gezeichnet wird.
  const route = useMemo(() => parseRoute(hash), [hash]);

  useEffect(() => {
    let stopped = false;
    let store: Store | undefined;
    let engine: SyncEngine | undefined;
    void (async () => {
      try {
        store = await openStore();
        if (stopped) return;
        const settings = await loadSettings(store);
        if (stopped) return;
        if (!settings) {
          setBoot({ phase: 'einrichten' });
          return;
        }
        const client = new GitHubClient({ token: settings.token, repo: settings.repo });
        engine = new SyncEngine({ client, store, device: settings.device });
        await engine.start();
        // Die Dateilisten (Projekte, Seiten einer Besprechung) holt die Oberfläche selbst: Sie gehören nicht zum Abgleich.
        if (!stopped) setBoot({ phase: 'bereit', store, engine, settings, listDir: (folder) => client.listDir(folder) });
      } catch {
        if (!stopped) setBoot({ phase: 'fehler' });
      }
    })();
    return () => {
      stopped = true;
      engine?.stop();
      store?.close();
    };
  }, []);

  // Der Schnellwechsel wurde verschoben: gleich auf dem Bildschirm, dann in den Einstellungen des Geräts. Gespeichert
  // wird der Stand aus dem Speicher, damit nichts überschrieben wird, was sich dort inzwischen geändert hat.
  const moveQuickSwitch = (pos: [number, number]) => {
    if (boot.phase !== 'bereit') return;
    const { store } = boot;
    setBoot({ ...boot, settings: { ...boot.settings, quickSwitchPos: pos } });
    void (async () => {
      const saved = await loadSettings(store);
      if (saved) await saveSettings(store, { ...saved, quickSwitchPos: pos });
    })().catch(() => undefined);
  };

  // Die Reiter gehören zum Jahr und Monat der Seite. Die Einstellungen sind keine Seite des Kalenders und haben keine.
  const shown = shownDay(route);

  return (
    <main id="app">
      {boot.phase === 'bereit' ? (
        <>
          <TopBar route={route} engine={boot.engine} />
          <div class="inhalt">
            {/* Jede Seite ist ein eigenes Bauteil: Beim Wechsel wird die alte gesichert und geschlossen, die neue liest ihre Datei. */}
            <Seite
              key={routeHash(route)}
              route={route}
              listDir={boot.listDir}
              engine={boot.engine}
              readOnly={boot.settings.device === 'Firmen-PC'}
              sigma={SMOOTHING[boot.settings.smoothing] ?? SMOOTHING.mittel}
              prediction={boot.settings.prediction}
              quickSwitchPos={boot.settings.quickSwitchPos}
              onQuickSwitchMove={moveQuickSwitch}
            />
            {route.view !== 'einstellungen' && <MonthTabs year={Number(shown.slice(0, 4))} current={monthKey(shown)} />}
          </div>
        </>
      ) : (
        <>
          <h1>Notizbuch</h1>
          {boot.phase === 'einrichten' && <p>Bitte zuerst einrichten.</p>}
          {boot.phase === 'fehler' && <p>Das Notizbuch lässt sich auf diesem Gerät nicht starten.</p>}
        </>
      )}
    </main>
  );
}
