import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { dayEntries, mergeMeetings, meetingRequest, namesIn, type DayEntry, type MeetingRef } from '../lib/dayMeetings';
import { nextFullHour, type Day } from '../lib/dates';
import { tagPagePath } from '../lib/filenames';
import { createMeeting, listMeetings } from '../lib/meetings';
import type { Termin } from '../lib/termine';
import { meetingPageText } from '../pages/meetingText';
import type { Rect } from '../pages/layouts';
import type { SyncEngine } from '../sync/engine';
import type { ListDir } from '../sync/github';
import { cardStyle } from './cardStyle';
import { formDialog } from './Dialog';
import { routeHash } from './router';
import { FAILED } from './texts';

// Die Karte „Besprechungen“ der Tagesseite: die Termine des Tages aus `Termine.md` und die Besprechungen, die es zu dem Tag
// schon gibt. Ein Tipp auf einen Termin öffnet seine Besprechung oder legt sie an (Thema, Zeit und Ort aus dem Termin).
// „+ Besprechung“ fragt nach Thema und Zeit. Beides geht auch am Firmen-PC: Die neue Seite hat nur ihre Kopfdaten, und die
// lassen sich dort tippen. Tinte gibt es am Firmen-PC nie.

const QUESTION = 'Neue Besprechung';
const ALL_DAY_TIME = '08:00';

type Props = {
  engine: SyncEngine;
  day: Day;
  rect: Rect;
  termine: Termin[];
  listDir: ListDir;
};

/** Eine Besprechung wird geöffnet: bei ihrer ersten Seite. */
function open(meeting: MeetingRef): void {
  window.location.hash = routeHash({ view: 'besprechung', key: meeting.base, n: meeting.pages[0] ?? 1 });
}

function pagesText(count: number): string {
  return count === 1 ? 'Besprechung' : `Besprechung · ${count} Seiten`;
}

export function MeetingsCard({ engine, day, rect, termine, listDir }: Props) {
  // Die Seiten der Besprechungen eines Tages liegen im Ordner seines Jahres.
  const folder = useMemo(() => {
    const page = tagPagePath(day);
    return page.slice(0, page.lastIndexOf('/'));
  }, [day]);
  // Was GitHub listet (`null`, solange die Liste fehlt oder scheitert) und was dieses Gerät hat. Dazu gehören Besprechungen, die
  // noch nicht hochgeladen sind und in keiner Liste von GitHub stehen, und die Seiten, deren Löschen noch auf den Abgleich wartet.
  const [listed, setListed] = useState<MeetingRef[] | null>(null);
  const [local, setLocal] = useState<{ present: MeetingRef[]; deleted: MeetingRef[] }>({ present: [], deleted: [] });
  const busy = useRef(false);
  // Endet mit der Seite: Eine offene Frage geht dann mit, sie bezöge sich sonst auf einen Tag, der nicht mehr offen ist.
  const [away] = useState(() => new AbortController());
  useEffect(() => () => away.abort(), [away]);

  useEffect(() => {
    let current = true;
    listDir(folder).then(
      (entries) => current && setListed(listMeetings(entries.filter((entry) => entry.type === 'file').map((entry) => entry.name), day)),
      () => undefined, // ohne die Liste von GitHub gilt, was dieses Gerät hat
    );
    return () => {
      current = false;
    };
  }, [listDir, folder, day]);

  useEffect(() => {
    let current = true;
    engine.localPaths(`${folder}/`).then(
      ({ present, deleted }) => current && setLocal({ present: listMeetings(namesIn(folder, present), day), deleted: listMeetings(namesIn(folder, deleted), day) }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [engine, folder, day]);

  const entries = useMemo(
    () => dayEntries(day, termine, mergeMeetings({ listed: listed ?? [], local: local.present, deleted: local.deleted })),
    [day, termine, listed, local],
  );

  /**
   * Legt die erste Seite einer Besprechung an und gibt ihren Namen zurück, oder einen Hinweis für die Person, wenn Tag, Zeit
   * oder Thema nicht gehen (zum Beispiel ein Wort wie Passwort im Thema). Gibt es die Seite schon, auf diesem Gerät oder auf
   * GitHub, wird sie nicht überschrieben: Es bleibt bei der vorhandenen.
   */
  const create = async (request: { datum: Day; zeit: string; thema: string; ort?: string }): Promise<{ base: string } | { problem: string }> => {
    let made: ReturnType<typeof createMeeting>;
    try {
      made = createMeeting(request);
    } catch (error) {
      return { problem: error instanceof Error ? error.message : FAILED };
    }
    if ((await engine.read(made.path)) === null) await engine.write(made.path, meetingPageText(made.page), 'svg');
    return { base: made.base };
  };

  /** Die Frage nach Thema und Zeit. Bei Erfolg öffnet sich die neue Besprechung. */
  const ask = async (o: { thema: string; zeit: string; ort?: string; fehler?: string }): Promise<void> => {
    const made: { base: string | null } = { base: null };
    const yes = await formDialog({
      frage: QUESTION,
      felder: [
        { name: 'thema', label: 'Thema', value: o.thema },
        { name: 'zeit', label: 'Zeit', value: o.zeit, type: 'time' },
      ],
      ja: 'Anlegen',
      fehler: o.fehler,
      signal: away.signal,
      onSubmit: async (values) => {
        const result = await create({ datum: day, zeit: values.zeit ?? '', thema: values.thema ?? '', ort: o.ort });
        if ('problem' in result) return result.problem;
        made.base = result.base;
        return null;
      },
    });
    // Wer inzwischen woanders ist (die Frage war schon beantwortet), bleibt dort.
    if (yes && made.base !== null && !away.signal.aborted) window.location.hash = routeHash({ view: 'besprechung', key: made.base, n: 1 });
  };

  /** Ein Vorgang nach dem anderen: Zwei Tipps kurz hintereinander legen die Besprechung nicht doppelt an. */
  const guarded = async (task: () => Promise<void>): Promise<void> => {
    if (busy.current) return;
    busy.current = true;
    try {
      await task();
    } catch {
      // Ein Fehler beim Lesen oder Speichern: Die Karte bleibt, wie sie ist, ein neuer Tipp versucht es noch einmal.
    } finally {
      busy.current = false;
    }
  };

  const openTermin = (termin: Termin, meeting: MeetingRef | null) =>
    guarded(async () => {
      if (meeting) {
        open(meeting);
        return;
      }
      const request = meetingRequest(day, termin);
      // Ein ganztägiger Termin hat keine Uhrzeit: Die Frage schlägt eine vor.
      if (!request) return ask({ thema: termin.title, zeit: ALL_DAY_TIME, ort: termin.place });
      // Scheitert schon das Nachsehen, ob es die Seite gibt (zum Beispiel ein Serverfehler), tut ein Tipp nicht einfach nichts:
      // Dieselbe Frage zeigt es und lässt es mit „Anlegen“ noch einmal versuchen.
      const result = await create(request).catch((): { problem: string } => ({ problem: FAILED }));
      if ('problem' in result) return ask({ thema: request.thema, zeit: request.zeit, ort: request.ort, fehler: result.problem });
      if (!away.signal.aborted) window.location.hash = routeHash({ view: 'besprechung', key: result.base, n: 1 });
    });

  // Der Platz in der Liste gehört zum Schlüssel: Zwei Termine mit gleicher Zeit und gleichem Titel sind zwei Einträge.
  const row = (entry: DayEntry, index: number) => {
    if (entry.kind === 'besprechung') {
      return (
        <li key={`${index} ${entry.meeting.base}`}>
          <a class="eintrag-zeile" href={routeHash({ view: 'besprechung', key: entry.meeting.base, n: entry.meeting.pages[0] ?? 1 })}>
            <span class="zeit">{entry.zeit}</span>
            <span class="titel">{entry.thema}</span>
            <span class="zusatz">{pagesText(entry.meeting.pages.length)}</span>
          </a>
        </li>
      );
    }
    const { termin, meeting } = entry;
    return (
      <li key={`${index} ${termin.start ?? 'ganztaegig'} ${termin.title}`}>
        <button type="button" class="eintrag-zeile" onClick={() => void openTermin(termin, meeting)}>
          <span class="zeit">{termin.allDay ? 'ganztägig' : termin.start}</span>
          <span class="titel">{termin.title}</span>
          {termin.place && <span class="zusatz">{termin.place}</span>}
          {meeting && <span class="zusatz">{pagesText(meeting.pages.length)}</span>}
        </button>
      </li>
    );
  };

  return (
    <section class="karte besprechungen" aria-label="Besprechungen" style={cardStyle(rect)}>
      <ul class="eintraege">{entries.length === 0 ? <li class="leer">Keine Termine</li> : entries.map(row)}</ul>
      <button type="button" class="knopf neu" onClick={() => void guarded(() => ask({ thema: '', zeit: nextFullHour() }))}>
        + Besprechung
      </button>
    </section>
  );
}
