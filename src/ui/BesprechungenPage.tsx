import { useEffect, useMemo, useState } from 'preact/hooks';
import { mergeMeetings, type MeetingRef } from '../lib/dayMeetings';
import { PAGES_DIR } from '../lib/filenames';
import { meetingLabel, meetingMonths, meetingsInPaths } from '../lib/meetingList';
import type { SyncEngine } from '../sync/engine';
import { withTimeout, type ListDir } from '../sync/github';
import { routeHash } from './router';

// Die Liste aller Besprechungen, neueste zuerst, nach Monaten. Sie liest, was GitHub hat (die Jahresordner von
// `07 Anhänge/Notizbuch`) und was dieses Gerät hat: Besprechungen, die noch nicht hochgeladen sind, stehen sofort drin. Ohne
// Netz (oder wenn ein Ordner nicht zu listen ist) zeigt sie, was auf dem Gerät liegt, mit einem Hinweis. Eine Schreibfläche
// gibt es hier nicht.

type Local = { present: MeetingRef[]; deleted: MeetingRef[] };
type Loaded = { listed: MeetingRef[]; local: Local; offline: boolean };

const YEAR_FOLDER = /^\d{4}$/;
const NO_NETWORK = 'Ohne Netz siehst du nur die Besprechungen auf diesem Gerät.';

/** Die Pfade aller Seiten auf GitHub: die Jahresordner von `PAGES_DIR`, darin die Dateien. Scheitert ein Aufruf, wirft das. */
async function listedPaths(listDir: ListDir): Promise<string[]> {
  const years = (await listDir(PAGES_DIR)).filter((entry) => entry.type === 'dir' && YEAR_FOLDER.test(entry.name));
  const folders = await Promise.all(
    years.map(async (year) => (await listDir(`${PAGES_DIR}/${year.name}`)).filter((entry) => entry.type === 'file').map((entry) => `${PAGES_DIR}/${year.name}/${entry.name}`)),
  );
  return folders.flat();
}

async function load(engine: SyncEngine, listDir: ListDir): Promise<Loaded> {
  const [github, device] = await Promise.all([
    // Eine Anfrage, die nie antwortet, gilt nach der üblichen Zeit als fehlendes Netz: Die Liste bleibt nicht beim Laden hängen.
    withTimeout(() => listedPaths(listDir)).then(
      (paths) => ({ listed: meetingsInPaths(paths), offline: false }),
      () => ({ listed: [], offline: true }), // ohne die Liste von GitHub gilt, was dieses Gerät hat
    ),
    engine.localPaths(`${PAGES_DIR}/`).then(
      ({ present, deleted }) => ({ present: meetingsInPaths(present), deleted: meetingsInPaths(deleted) }),
      () => ({ present: [], deleted: [] }),
    ),
  ]);
  return { ...github, local: device };
}

type Props = { engine: SyncEngine; listDir: ListDir };

export function BesprechungenPage({ engine, listDir }: Props) {
  // `null`, solange keine der beiden Quellen fertig oder gescheitert ist.
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  useEffect(() => {
    let current = true;
    void load(engine, listDir).then((result) => current && setLoaded(result));
    return () => {
      current = false;
    };
  }, [engine, listDir]);

  const months = useMemo(
    () => (loaded ? meetingMonths(mergeMeetings({ listed: loaded.listed, local: loaded.local.present, deleted: loaded.local.deleted })) : []),
    [loaded],
  );

  return (
    <section class="besprechungen" aria-label="Besprechungen" aria-busy={loaded === null}>
      <h1>Besprechungen</h1>
      {loaded === null ? (
        <p role="status">Besprechungen werden geladen</p>
      ) : (
        <>
          {loaded.offline && <p role="status">{NO_NETWORK}</p>}
          {months.length === 0 && <p>Noch keine Besprechungen</p>}
          {months.map((month) => (
            <div key={month.month} class="besprechungen-monat">
              <h2>{month.title}</h2>
              <ul>
                {month.entries.map((entry) => (
                  <li key={entry.base}>
                    <a href={routeHash({ view: 'besprechung', key: entry.base, n: entry.pages[0] ?? 1 })}>{meetingLabel(entry)}</a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
