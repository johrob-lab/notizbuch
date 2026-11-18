import { useEffect, useMemo, useState } from 'preact/hooks';
import { mergeMeetings, type MeetingRef } from '../lib/dayMeetings';
import { PAGES_DIR } from '../lib/filenames';
import { meetingLabel, meetingMonths, meetingsInPaths } from '../lib/meetingList';
import type { SyncEngine } from '../sync/engine';
import { withTimeout, type ListDir } from '../sync/github';
import { retryCues } from './retryCues';
import { routeHash } from './router';

// Die Liste aller Besprechungen, neueste zuerst, nach Monaten. Sie liest, was dieses Gerät hat, und was GitHub hat (die
// Jahresordner von `07 Anhänge/Notizbuch`). Was auf dem Gerät liegt, steht sofort da, auch Besprechungen, die noch nicht
// hochgeladen sind; was nur GitHub kennt, kommt dazu, sobald dessen Liste da ist. Ohne Netz (oder wenn ein Ordner nicht zu
// listen ist) bleibt es bei dem, was auf dem Gerät liegt, mit einem Hinweis, und die Liste lädt neu, sobald es Sinn hat (Netz
// zurück, App wieder im Vordergrund, alle drei Minuten). Ein Tipp auf „Besprechungen“ in der Leiste, während die Liste offen
// ist, baut sie ganz neu auf (ihr Schlüssel in App.tsx). Eine Schreibfläche gibt es hier nicht.

type Local = { present: MeetingRef[]; deleted: MeetingRef[] };

/**
 * Was die Liste weiß. `local`: was dieses Gerät hat, `null`, bis es geantwortet hat. `github`: was GitHub listet, `laden`,
 * solange die erste Antwort aussteht, `offline`, wenn die Liste nicht zu bekommen war.
 */
type Known = { local: Local | null; github: MeetingRef[] | 'laden' | 'offline' };

const START: Known = { local: null, github: 'laden' };

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

/**
 * Fragt beide Quellen und meldet jede mit `show`, sobald sie geantwortet hat: Das Gerät wartet nicht auf GitHub. Liefert, wenn
 * beide fertig sind, ob die Liste von GitHub da ist.
 */
async function load(engine: SyncEngine, listDir: ListDir, show: (known: Partial<Known>) => void): Promise<boolean> {
  const device = engine.localPaths(`${PAGES_DIR}/`).then(
    ({ present, deleted }) => show({ local: { present: meetingsInPaths(present), deleted: meetingsInPaths(deleted) } }),
    () => show({ local: { present: [], deleted: [] } }),
  );
  // Eine Anfrage, die nie antwortet, gilt nach der üblichen Zeit als fehlendes Netz: Die Liste bleibt nicht beim Laden hängen.
  const github = withTimeout(() => listedPaths(listDir)).then(
    (paths) => {
      show({ github: meetingsInPaths(paths) });
      return true;
    },
    () => {
      show({ github: 'offline' }); // ohne die Liste von GitHub gilt, was dieses Gerät hat
      return false;
    },
  );
  const [, online] = await Promise.all([device, github]);
  return online;
}

type Props = { engine: SyncEngine; listDir: ListDir };

export function BesprechungenPage({ engine, listDir }: Props) {
  const [known, setKnown] = useState<Known>(START);

  useEffect(() => {
    // Endet mit der Seite (oder mit einer neuen Engine): Was danach noch ankommt, zeigt die Liste nicht mehr.
    let current = true;
    let running = false;
    let missed = false;
    let stopCues: (() => void) | undefined;
    const show = (patch: Partial<Known>) => {
      if (current) setKnown((now) => ({ ...now, ...patch }));
    };
    // Ein neues Laden lässt stehen, was die Liste zeigt, auch den Hinweis, bis neue Antworten da sind. Es läuft nie mehr als
    // eines. Ein Anlass, der währenddessen kommt (etwa das Netz zurück, während ein Versuch noch hängt), wird gemerkt: Fehlt
    // danach die Liste von GitHub, folgt gleich genau ein weiterer Versuch. Scheitert auch der, wartet die Liste auf den
    // nächsten Anlass; ist die Liste von GitHub da, braucht es keinen mehr.
    const run = () => {
      if (running) {
        missed = true;
        return;
      }
      running = true;
      missed = false;
      void load(engine, listDir, show).then((online) => {
        running = false;
        if (!current) return;
        if (online) {
          stopCues?.();
          stopCues = undefined;
        } else {
          stopCues ??= retryCues(run);
          if (missed) run();
        }
      });
    };
    run();
    return () => {
      current = false;
      stopCues?.();
    };
  }, [engine, listDir]);

  const { local, github } = known;
  // Fertig ist die Liste, wenn das Gerät geantwortet hat und die Liste von GitHub da ist oder nicht zu bekommen war.
  const settled = local !== null && github !== 'laden';
  // Einträge erst, wenn das Gerät geantwortet hat: Erst dann ist bekannt, welche Seiten noch auf ihr Löschen warten.
  const months = useMemo(
    () => (local === null ? [] : meetingMonths(mergeMeetings({ listed: typeof github === 'string' ? [] : github, local: local.present, deleted: local.deleted }))),
    [local, github],
  );

  return (
    <section class="besprechungen-liste" aria-label="Besprechungen" aria-busy={!settled}>
      <h1>Besprechungen</h1>
      {!settled && <p role="status">Besprechungen werden geladen</p>}
      {settled && github === 'offline' && <p role="status">{NO_NETWORK}</p>}
      {settled && months.length === 0 && <p>Noch keine Besprechungen</p>}
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
    </section>
  );
}
