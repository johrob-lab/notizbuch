import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Page } from '../ink/types';
import { isValidDay } from '../lib/dates';
import { besprechungPagePath, tabelleCsvPath, tabelleJsonPath } from '../lib/filenames';
import {
  ART_TABELLE,
  firstFreePage,
  istTabelle,
  isValidTime,
  listMeetings,
  meetingMeta,
  meetingPages,
  neighbourPages,
  pageAfterDelete,
  pageLabel,
  projectNames,
} from '../lib/meetings';
import { csvDateiname, KEINE_CSV, neuesterStrich } from '../lib/tabelleCsv';
import { meetingLayout } from '../pages/layouts';
import { meetingPageText } from '../pages/meetingText';
import { type ListDir, type ReadFile } from '../sync/github';
import { normalizePath } from '../sync/paths';
import { confirmDialog } from './Dialog';
import { PageView, type Kopf, type KopfTools, type PageProps } from './PageView';
import { routeHash, type Steps } from './router';
import { useCsvDownload } from './useCsvDownload';

// Eine Seite einer Besprechung: Über der Schreibfläche steht ein Formular für Thema, Datum, Zeit, Ort und Projekt, daneben
// die Leiste für die Seiten (welche Seite von wie vielen, neue Seite, Seite löschen). Das Formular ist HTML und nicht auf
// die Fläche gezeichnet: Es lässt sich mit dem Stift (Scribble) und mit der Tastatur ausfüllen. Die Fläche zeigt den
// Kopf im Hintergrund der Seite, geschrieben wird er mit der Seite in dieselbe Datei. Der Dateiname ändert sich dabei nie.
// Geblättert wird mit ‹ und › der Leiste oben: Diese Seite weiß, welche Seiten es gibt, und meldet der App, wohin sie führen.

type Props = PageProps & {
  /** Name der Besprechung ohne Seitennummer, zum Beispiel `2026-10-29 0800 Thema`, und die Nummer dieser Seite. */
  base: string;
  n: number;
  listDir: ListDir;
  /** Liest eine Datei aus dem Repository (für die CSV einer Tabellenseite). */
  readFile: ReadFile;
  /** Meldet, wohin ‹ und › der Leiste oben von dieser Seite aus führen. `null`, sobald die Seite geht. */
  onSteps(steps: Steps | null): void;
};

const PROJECTS = '02 Projekte';
const QUESTION = 'Seite wirklich löschen?';
const ART_QUESTION = 'Auf der Seite steht schon etwas. Art trotzdem ändern?';
const ADD_FAILED = 'Die neue Seite konnte nicht angelegt werden. Bitte noch einmal versuchen.';
const DELETE_FAILED = 'Die Seite konnte nicht gelöscht werden. Bitte noch einmal versuchen.';

/** Die Nummern der Seiten dieser Besprechung unter den Dateinamen. */
const pagesOf = (names: string[], base: string): number[] => listMeetings(names, base.slice(0, 10)).find((meeting) => meeting.base === base)?.pages ?? [];

/** Die Namen der Dateien, die direkt in diesem Ordner liegen (nicht in einem Unterordner darin). */
function namesIn(folder: string, paths: string[]): string[] {
  const prefix = `${normalizePath(folder)}/`;
  return paths.map(normalizePath).filter((path) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/')).map((path) => path.slice(prefix.length));
}

type FormProps = {
  tools: KopfTools;
  /** Die Projekte aus `02 Projekte`. `null`, solange die Liste fehlt: Dann gibt es nur „kein Projekt“ und das Projekt der Seite. */
  projects: string[] | null;
  /** „Seite 2 von 3“, oder „Seite 2“, wenn die Liste der Seiten fehlt. */
  label: string;
  /** Am Firmen-PC lässt sich der Kopf tippen, aber keine Seite anlegen oder löschen. */
  readOnly: boolean;
  /** Das zweite Fenster eines Geräts: Nichts lässt sich ändern, auch der Kopf nicht. */
  locked: boolean;
  problem: string;
  /** Der Hinweis zum Herunterladen der CSV (kein Fehler, darum eigener Absatz). */
  hinweis: string;
  onAdd(): void;
  onDelete(): void;
  onArt(select: HTMLSelectElement): void;
  onDownload(): void;
};

function Form({ tools, projects, label, readOnly, locked, problem, hinweis, onAdd, onDelete, onArt, onDownload }: FormProps) {
  const { meta } = tools;
  // Solange die Seite nicht gelesen ist, lässt sich nichts ändern: Sonst entstünde neben einer Seite, die man noch nicht sieht, eine zweite.
  const ready = tools.phase === 'bereit' && !locked;
  const listed = projects ?? [];
  const options = meta.projekt && !listed.includes(meta.projekt) ? [...listed, meta.projekt] : listed;
  // Ein Datum oder eine Zeit, die keine gültige Angabe ist (geleert, halb getippt), wird nicht gespeichert. Beim Verlassen
  // des Feldes zeigt es wieder, was die Seite hat.
  const restore = (key: 'datum' | 'zeit') => (e: Event) => {
    (e.currentTarget as HTMLInputElement).value = tools.current().meta[key] ?? '';
  };
  // Datum und Zeit werden gespeichert, sobald die Eingabe gültig ist, bei `input` wie bei `change`: Manche Auswahlfenster
  // (iPadOS) melden nur `change`, andere beides. Derselbe Wert wird nur einmal geschrieben.
  const save = (key: 'datum' | 'zeit', valid: (value: string) => boolean) => (e: Event) => {
    const { value } = e.currentTarget as HTMLInputElement;
    if (valid(value) && value !== tools.current().meta[key]) tools.edit({ [key]: value });
  };
  const saveDay = save('datum', isValidDay);
  const saveTime = save('zeit', isValidTime);

  return (
    <form class="kopfdaten" aria-label="Kopfdaten der Besprechung" onSubmit={(e) => e.preventDefault()}>
      <div class="feld thema">
        <label for="kopf-thema">Thema</label>
        <input id="kopf-thema" type="text" value={meta.thema ?? ''} maxLength={200} autoComplete="off" disabled={!ready} onInput={(e) => tools.edit({ thema: e.currentTarget.value })} />
      </div>
      <div class="feld">
        <label for="kopf-datum">Datum</label>
        <input
          id="kopf-datum"
          type="date"
          value={meta.datum ?? ''}
          disabled={!ready}
          onInput={saveDay}
          onChange={saveDay}
          onBlur={restore('datum')}
        />
      </div>
      <div class="feld">
        <label for="kopf-zeit">Zeit</label>
        <input
          id="kopf-zeit"
          type="time"
          value={meta.zeit ?? ''}
          disabled={!ready}
          onInput={saveTime}
          onChange={saveTime}
          onBlur={restore('zeit')}
        />
      </div>
      <div class="feld ort">
        <label for="kopf-ort">Ort</label>
        <input id="kopf-ort" type="text" value={meta.ort ?? ''} maxLength={200} autoComplete="off" disabled={!ready} onInput={(e) => tools.edit({ ort: e.currentTarget.value })} />
      </div>
      <div class="feld">
        <label for="kopf-projekt">Projekt</label>
        <select id="kopf-projekt" value={meta.projekt ?? ''} disabled={!ready} onChange={(e) => tools.edit({ projekt: e.currentTarget.value })}>
          <option value="">kein Projekt</option>
          {options.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </div>
      <div class="feld">
        <label for="kopf-art">Art</label>
        <select id="kopf-art" value={istTabelle(meta) ? ART_TABELLE : ''} disabled={!ready} onChange={(e) => onArt(e.currentTarget)}>
          <option value="">Notizen</option>
          <option value={ART_TABELLE}>Tabelle Arbeitsvorbereitung</option>
        </select>
      </div>
      <div class="seitenleiste">
        <span class="seitenzahl">{label}</span>
        {!readOnly && (
          <>
            <button type="button" class="knopf" disabled={!ready} onClick={onAdd}>
              + Seite
            </button>
            <button type="button" class="knopf" disabled={!ready} onClick={onDelete}>
              Seite löschen
            </button>
          </>
        )}
        {/* Der Knopf ändert nichts und ist darum nie gesperrt, auch am Firmen-PC und im zweiten Fenster. */}
        {istTabelle(meta) && (
          <button type="button" class="knopf" onClick={onDownload}>
            Für Excel herunterladen
          </button>
        )}
      </div>
      {hinweis && (
        <p class="kopfhinweis" role="status">
          {hinweis}
        </p>
      )}
      {problem && (
        <p class="kopfhinweis" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

export function BesprechungPage({ base: address, n, listDir, readFile, onSteps, ...rest }: Props) {
  const { engine } = rest;
  // Im zweiten Fenster eines Geräts (die Engine liest nur) gilt dasselbe wie am Firmen-PC, und der Kopf lässt sich auch nicht tippen.
  const locked = engine.readOnly;
  const readOnly = rest.readOnly || locked;
  // Der Vault schreibt Umlaute als ein Zeichen: Auch eine Adresse mit Buchstabe plus Trema führt zu derselben Datei.
  const base = address.normalize('NFC');
  const path = besprechungPagePath(base, n);
  const folder = path.slice(0, path.lastIndexOf('/'));
  const [projects, setProjects] = useState<string[] | null>(null);
  // Die Seiten, die GitHub listet (`null`, solange die Liste fehlt), und die, die dieses Gerät hat oder zum Löschen vorgemerkt hat.
  const [listed, setListed] = useState<number[] | null>(null);
  const [local, setLocal] = useState<{ present: number[]; deleted: number[] }>({ present: [], deleted: [] });
  const [problem, setProblem] = useState('');
  const { hinweis, download } = useCsvDownload({ readFile, readOnly: rest.readOnly });
  // Zählt die Versuche, die Seite neu zu öffnen: Scheitert das Löschen, ist die Sitzung der Seite beendet.
  const [attempt, setAttempt] = useState(0);
  const busy = useRef(false);
  // Endet mit der Seite: Eine offene Rückfrage geht dann mit, sie bezöge sich sonst auf eine Seite, die nicht mehr da ist.
  const [away] = useState(() => new AbortController());
  useEffect(() => () => away.abort(), [away]);

  // Die Projekte stehen als Dateien in 02 Projekte. Ohne Netz gibt es nur „kein Projekt“ und das Projekt der Seite; beim
  // nächsten Öffnen der Seite gibt es einen neuen Versuch.
  useEffect(() => {
    let current = true;
    listDir(PROJECTS).then(
      (entries) => current && setProjects(projectNames(entries)),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [listDir]);

  // Die Seiten der Besprechung stehen als Dateien im Ordner des Jahres. Die Liste von GitHub kommt erst nach einer Anfrage und
  // fehlt ohne Netz.
  useEffect(() => {
    let current = true;
    listDir(folder).then(
      (entries) => {
        if (!current) return;
        const names = entries.filter((entry) => entry.type === 'file').map((entry) => entry.name);
        setListed(pagesOf(names, base));
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [listDir, folder, base]);

  // Was dieses Gerät hat, braucht kein Netz: auch Seiten, die noch nicht hochgeladen sind und in keiner Liste von GitHub stehen,
  // und die Seiten, deren Löschen noch auf den Abgleich wartet. GitHub listet sie bis dahin weiter, sie zählen nicht mit.
  useEffect(() => {
    let current = true;
    engine.localPaths(`${folder}/`).then(
      ({ present, deleted }) => current && setLocal({ present: pagesOf(namesIn(folder, present), base), deleted: pagesOf(namesIn(folder, deleted), base) }),
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [engine, folder, base]);

  // Die Seiten, die es gibt, und wohin man von dieser Seite blättert. Ohne die Liste von GitHub sind nur die Seiten bekannt, die
  // dieses Gerät hat: Dann steht im Titel nur die Nummer, und › führt nur auf eine Seite, die dieses Gerät hat.
  const complete = listed !== null;
  const pages = useMemo(() => meetingPages({ listed, local: local.present, deleted: local.deleted, n }), [listed, local, n]);
  const { prev, next } = useMemo(() => neighbourPages(pages, n, complete), [pages, n, complete]);
  const last = pages[pages.length - 1];

  // Die Leiste oben blättert mit ‹ und ›: Sie erfährt von dieser Seite, wohin.
  useEffect(() => {
    const route = (page: number | null) => (page === null ? null : ({ view: 'besprechung', key: base, n: page } as const));
    onSteps({ prev: route(prev), next: route(next) });
    return () => onSteps(null);
  }, [onSteps, base, prev, next]);

  const layout = useMemo(() => ({ ...meetingLayout(meetingMeta(base, n, {})), key: base }), [base, n]);
  const kopf = useMemo(
    () => ({
      // Der Dateiname bestimmt, welche Besprechung und welche Seite es ist: Der Schlüssel der Seite ist `base`, die Nummer `n`.
      complete: (page: Page): Page => ({ ...page, kind: 'besprechung', key: base, meta: meetingMeta(base, n, page.meta) }),
      layoutFor: (meta: Record<string, string>) => {
        const { fields, background } = meetingLayout(meta);
        return { fields, background: background() };
      },
    }),
    [base, n],
  );

  // Eine neue Seite hat die Kopfdaten dieser Seite, wie sie jetzt sind (auch `art`: `meetingMeta` behält Angaben, die es nicht
  // kennt, darum ist die nächste Seite einer Tabelle wieder eine Tabelle), und die nächste freie Nummer: Eine Seite, die es nur
  // auf diesem Gerät gibt, wird nie überschrieben.
  // Bekannte Grenze: Ob eine Nummer frei ist, sagt `engine.read`. Ohne Netz kennt sie nur Seiten, die dieses Gerät hat, eine
  // Seite, die es nur auf GitHub gibt, gilt dann als frei. Die neue Seite trägt deren Nummer, und beim Abgleich trifft sie
  // auf die vorhandene Datei: `mergePages` führt beide zusammen. Es geht kein Strich verloren, und weil es keine gemeinsame
  // Fassung gibt, gelten die Kopfdaten der vorhandenen Datei, wo sie etwas angeben.
  const addPage = async (tools: KopfTools) => {
    if (busy.current) return;
    busy.current = true;
    setProblem('');
    try {
      const created = await firstFreePage(base, last + 1, async (candidate) => (await engine.read(candidate)) !== null);
      // Wer inzwischen woanders ist, bekommt weder eine leere Seite noch einen Sprung zurück hierher.
      if (away.signal.aborted) return;
      const createdPath = besprechungPagePath(base, created);
      const page: Page = { kind: 'besprechung', key: base, meta: meetingMeta(base, created, tools.current().meta), strokes: [] };
      await engine.write(createdPath, meetingPageText(page), 'svg');
      if (!away.signal.aborted) window.location.hash = routeHash({ view: 'besprechung', key: base, n: created });
    } catch {
      setProblem(ADD_FAILED);
    } finally {
      busy.current = false;
    }
  };

  // Die Art der Seite (Notizen oder Tabelle) wechselt im Kopf. Steht schon etwas auf der Seite, fragt die App erst: Die Striche
  // bleiben, kommen aber in andere Felder. Bei „Abbrechen“ zeigt die Auswahl wieder, was die Seite hat: Die Kopfangabe hat
  // sich nicht geändert, also zeichnet nichts neu.
  const changeArt = async (tools: KopfTools, select: HTMLSelectElement) => {
    const wanted = select.value;
    const restore = () => {
      select.value = istTabelle(tools.current().meta) ? ART_TABELLE : '';
    };
    if (tools.current().strokes.length > 0) {
      if (!(await confirmDialog({ frage: ART_QUESTION, ja: 'Ändern', signal: away.signal }))) return restore();
    }
    tools.edit({ art: wanted });
  };

  // Gelöscht wird nur nach der Rückfrage der App und nur mit „Löschen“. Danach geht die Seite davor auf, sonst die nächste,
  // bei der einzigen Seite der Tag der Besprechung.
  const deletePage = async (tools: KopfTools) => {
    if (busy.current) return;
    busy.current = true;
    setProblem('');
    try {
      if (!(await confirmDialog({ frage: QUESTION, ja: 'Löschen', signal: away.signal }))) return;
      try {
        // Erst muss ein laufendes Speichern der Seite zu Ende sein, sonst legte es die Datei nach dem Löschen wieder an.
        await tools.retire();
        await engine.remove(path);
      } catch (error) {
        setAttempt((count) => count + 1); // Die Sitzung der Seite ist beendet: Die Seite wird neu geöffnet.
        throw error;
      }
      const target = pageAfterDelete(pages, n);
      // Wer inzwischen woanders ist (die Rückfrage war schon beantwortet), bleibt dort.
      if (!away.signal.aborted) {
        window.location.hash = routeHash(target === null ? { view: 'tag', key: base.slice(0, 10) } : { view: 'besprechung', key: base, n: target });
      }
    } catch {
      setProblem(DELETE_FAILED);
    } finally {
      busy.current = false;
    }
  };

  const head: Kopf = {
    ...kopf,
    form: (tools) => (
      <Form
        tools={tools}
        projects={projects}
        label={pageLabel(pages, n, complete)}
        readOnly={readOnly}
        locked={locked}
        problem={problem}
        hinweis={hinweis}
        onAdd={() => void addPage(tools)}
        onDelete={() => void deletePage(tools)}
        onArt={(select) => void changeArt(tools, select)}
        onDownload={() =>
          void download({ csvPath: tabelleCsvPath(base), jsonPath: tabelleJsonPath(base), name: csvDateiname(base), seite: n, neuester: neuesterStrich(tools.current()), keine: KEINE_CSV })
        }
      />
    ),
  };

  return <PageView key={attempt} {...rest} readOnly={readOnly} layout={layout} path={path} kopf={head} />;
}
