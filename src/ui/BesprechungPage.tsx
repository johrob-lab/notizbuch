import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Page } from '../ink/types';
import { isValidDay } from '../lib/dates';
import { besprechungPagePath } from '../lib/filenames';
import { firstFreePage, isValidTime, listMeetings, meetingMeta, meetingPageText, pageAfterDelete, projectNames } from '../lib/meetings';
import { besprechungLayout } from '../pages/layouts';
import type { DirEntry } from '../sync/github';
import { confirmDialog } from './Dialog';
import { PageView, type Kopf, type KopfTools, type PageProps } from './PageView';
import { routeHash } from './router';

// Eine Seite einer Besprechung: Über der Schreibfläche steht ein Formular für Thema, Datum, Zeit, Ort und Projekt, daneben
// die Leiste für die Seiten (welche Seite von wie vielen, neue Seite, Seite löschen). Das Formular ist HTML und nicht auf
// die Fläche gezeichnet: Es lässt sich mit dem Stift (Scribble) und mit der Tastatur ausfüllen. Die Fläche zeigt den
// Kopf im Hintergrund der Seite, geschrieben wird er mit der Seite in dieselbe Datei. Der Dateiname ändert sich dabei nie.

/** Die Dateiliste eines Ordners im Vault. */
export type ListDir = (folder: string) => Promise<DirEntry[]>;

type Props = PageProps & {
  /** Name der Besprechung ohne Seitennummer, zum Beispiel `2026-10-29 0800 Thema`, und die Nummer dieser Seite. */
  base: string;
  n: number;
  listDir: ListDir;
};

const PROJECTS = '02 Projekte';
const QUESTION = 'Seite wirklich löschen?';
const ADD_FAILED = 'Die neue Seite konnte nicht angelegt werden. Bitte noch einmal versuchen.';
const DELETE_FAILED = 'Die Seite konnte nicht gelöscht werden. Bitte noch einmal versuchen.';

/**
 * Seiten, die in dieser Sitzung gelöscht wurden. Bei GitHub steht eine Seite noch in der Dateiliste, solange das Löschen
 * dort nicht angekommen ist (zum Beispiel ohne Netz): Gezählt wird sie dann nicht mit.
 */
const deleted = new Set<string>();

type FormProps = {
  tools: KopfTools;
  /** Die Projekte aus `02 Projekte`. `null`, solange die Liste fehlt: Dann gibt es nur „kein Projekt“ und das Projekt der Seite. */
  projects: string[] | null;
  /** „Seite 2 von 3“, oder „Seite 2“, wenn die Seiten nicht bekannt sind. */
  label: string;
  /** Am Firmen-PC lässt sich der Kopf tippen, aber keine Seite anlegen oder löschen. */
  readOnly: boolean;
  problem: string;
  onAdd(): void;
  onDelete(): void;
};

function Form({ tools, projects, label, readOnly, problem, onAdd, onDelete }: FormProps) {
  const { meta } = tools;
  // Solange die Seite nicht gelesen ist, lässt sich nichts ändern: Sonst entstünde neben einer Seite, die man noch nicht sieht, eine zweite.
  const ready = tools.phase === 'bereit';
  const listed = projects ?? [];
  const options = meta.projekt && !listed.includes(meta.projekt) ? [...listed, meta.projekt] : listed;
  // Ein Datum oder eine Zeit, die keine gültige Angabe ist (geleert, halb getippt), wird nicht gespeichert. Beim Verlassen
  // des Feldes zeigt es wieder, was die Seite hat.
  const restore = (key: 'datum' | 'zeit') => (e: Event) => {
    (e.currentTarget as HTMLInputElement).value = tools.current().meta[key] ?? '';
  };

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
          onInput={(e) => isValidDay(e.currentTarget.value) && tools.edit({ datum: e.currentTarget.value })}
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
          onInput={(e) => isValidTime(e.currentTarget.value) && tools.edit({ zeit: e.currentTarget.value })}
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
      </div>
      {problem && (
        <p class="kopfhinweis" role="alert">
          {problem}
        </p>
      )}
    </form>
  );
}

export function BesprechungPage({ base: address, n, listDir, ...rest }: Props) {
  const { engine, readOnly } = rest;
  // Der Vault schreibt Umlaute als ein Zeichen: Auch eine Adresse mit Buchstabe plus Trema führt zu derselben Datei.
  const base = address.normalize('NFC');
  const path = besprechungPagePath(base, n);
  const folder = path.slice(0, path.lastIndexOf('/'));
  const [projects, setProjects] = useState<string[] | null>(null);
  const [listed, setListed] = useState<number[] | null>(null);
  const [problem, setProblem] = useState('');
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

  // Die Seiten der Besprechung stehen als Dateien im Ordner des Jahres.
  useEffect(() => {
    let current = true;
    listDir(folder).then(
      (entries) => {
        if (!current) return;
        const names = entries.filter((entry) => entry.type === 'file').map((entry) => entry.name);
        setListed(listMeetings(names, base.slice(0, 10)).find((meeting) => meeting.base === base)?.pages ?? []);
      },
      () => undefined,
    );
    return () => {
      current = false;
    };
  }, [listDir, folder, base]);

  // Die Seiten, die es gibt: die der Liste ohne die gelöschten, und diese Seite, auch wenn die Liste sie noch nicht kennt.
  const pages = useMemo(() => {
    if (listed === null) return null;
    const present = listed.filter((page) => !deleted.has(besprechungPagePath(base, page)));
    return [...new Set([...present, n])].sort((a, b) => a - b);
  }, [listed, base, n]);
  const last = pages === null ? n : pages[pages.length - 1];

  const layout = useMemo(() => ({ ...besprechungLayout(meetingMeta(base, n, {})), key: base }), [base, n]);
  const kopf = useMemo(
    () => ({
      // Der Dateiname bestimmt, welche Besprechung und welche Seite es ist: Der Schlüssel der Seite ist `base`, die Nummer `n`.
      complete: (page: Page): Page => ({ ...page, kind: 'besprechung', key: base, meta: meetingMeta(base, n, page.meta) }),
      layoutFor: (meta: Record<string, string>) => {
        const { fields, background } = besprechungLayout(meta);
        return { fields, background: background() };
      },
    }),
    [base, n],
  );

  // Eine neue Seite hat die Kopfdaten dieser Seite, wie sie jetzt sind, und die nächste freie Nummer: Eine Seite, die es nur
  // auf diesem Gerät gibt, wird nie überschrieben.
  const addPage = async (tools: KopfTools) => {
    if (busy.current) return;
    busy.current = true;
    setProblem('');
    try {
      const next = await firstFreePage(base, last + 1, async (candidate) => (await engine.read(candidate)) !== null);
      // Wer inzwischen woanders ist, bekommt weder eine leere Seite noch einen Sprung zurück hierher.
      if (away.signal.aborted) return;
      const nextPath = besprechungPagePath(base, next);
      const page: Page = { kind: 'besprechung', key: base, meta: meetingMeta(base, next, tools.current().meta), strokes: [] };
      await engine.write(nextPath, meetingPageText(page), 'svg');
      deleted.delete(nextPath);
      if (!away.signal.aborted) window.location.hash = routeHash({ view: 'besprechung', key: base, n: next });
    } catch {
      setProblem(ADD_FAILED);
    } finally {
      busy.current = false;
    }
  };

  // Gelöscht wird nur nach der Rückfrage der App und nur mit „Löschen“. Danach geht die Seite davor auf, bei der einzigen
  // Seite der Tag der Besprechung.
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
      deleted.add(path);
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
        label={pages === null ? `Seite ${n}` : `Seite ${n} von ${last}`}
        readOnly={readOnly}
        problem={problem}
        onAdd={() => void addPage(tools)}
        onDelete={() => void deletePage(tools)}
      />
    ),
  };

  return <PageView key={attempt} {...rest} layout={layout} path={path} kopf={head} />;
}
