import { useEffect, useMemo, useState } from 'preact/hooks';
import { SMOOTHING } from '../ink/types';
import { isValidDay, todayVienna, type Day } from '../lib/dates';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { SyncEngine } from '../sync/engine';
import { GitHubClient } from '../sync/github';
import { openStore, type Store } from '../sync/store';
import { PageView } from './PageView';
import './app.css';

type Boot =
  | { phase: 'laden' }
  | { phase: 'einrichten' }
  | { phase: 'fehler' }
  | { phase: 'bereit'; store: Store; engine: SyncEngine; settings: Settings };

/** Der Tag aus `#/tag/<YYYY-MM-DD>`. Fehlt er oder gibt es ihn nicht im Kalender, gilt heute. */
function dayOf(hash: string): Day {
  const match = /^#\/tag\/(.*)$/.exec(hash);
  return match && isValidDay(match[1]) ? match[1] : todayVienna();
}

function useHash(): string {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export function App() {
  const [boot, setBoot] = useState<Boot>({ phase: 'laden' });
  const hash = useHash();
  // Nur wenn sich die Adresse ändert: Ohne Tag in der Adresse gilt „heute“, und das soll sich nicht mitten im Schreiben
  // ändern, weil nach Mitternacht etwas anderes neu gezeichnet wird.
  const day = useMemo(() => dayOf(hash), [hash]);

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
        engine = new SyncEngine({
          client: new GitHubClient({ token: settings.token, repo: settings.repo }),
          store,
          device: settings.device,
        });
        await engine.start();
        if (!stopped) setBoot({ phase: 'bereit', store, engine, settings });
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

  return (
    <main id="app">
      {boot.phase === 'bereit' ? (
        <PageView
          key={day}
          engine={boot.engine}
          day={day}
          readOnly={boot.settings.device === 'Firmen-PC'}
          sigma={SMOOTHING[boot.settings.smoothing] ?? SMOOTHING.mittel}
          prediction={boot.settings.prediction}
          quickSwitchPos={boot.settings.quickSwitchPos}
          onQuickSwitchMove={moveQuickSwitch}
        />
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
