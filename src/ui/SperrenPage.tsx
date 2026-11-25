import { useEffect, useMemo, useRef } from 'preact/hooks';
import type { Page } from '../ink/types';
import { sperrenCsvName, sperrenCsvPath, sperrenJsonPath, sperrenPagePath } from '../lib/filenames';
import { neuesterStrich } from '../lib/tabelleCsv';
import { FACHLINIEN, keineListe, mitFachlinie, parseSperrenKey } from '../lib/sperren';
import { sperrenLayout } from '../pages/layouts';
import type { ReadFile } from '../sync/github';
import { PageView, type Kopf, type KopfTools, type PageProps } from './PageView';
import { routeHash } from './router';
import { useCsvDownload } from './useCsvDownload';

// Eine Seite der Sperren: ein Quartal einer Fachlinie. Über der Fläche steht ein Formular mit der Wahl der Fachlinie (zwei
// Links, die dasselbe Quartal der anderen Fachlinie öffnen) und dem Knopf für den Download der Liste. Die Seite hat keine
// Kopfdaten zum Ändern: Das Formular ist nur Bedienung, `complete` setzt nur Art und Schlüssel.

type Props = PageProps & {
  /** Der Schlüssel der Seite, zum Beispiel `IB-2027-Q1`. */
  sperrenKey: string;
  /** Liest eine Datei aus dem Repository (für die Liste zum Download). */
  readFile: ReadFile;
  /** Wird einmal gerufen, wenn die Seite aufgeht: Das Gerät merkt sich, welche Sperrenseite zuletzt offen war. */
  onOpen(key: string): void;
};

type FormProps = {
  sperrenKey: string;
  /** Hinweis unter dem Formular (der Download meldet hier, was er getan hat). */
  hinweis: string;
  onDownload(): void;
};

function Form({ sperrenKey, hinweis, onDownload }: FormProps) {
  const aktuell = parseSperrenKey(sperrenKey)?.fachlinie;
  return (
    <form class="kopfdaten sperrenkopf" aria-label="Sperren" onSubmit={(e) => e.preventDefault()}>
      <div class="fachlinie" role="group" aria-label="Fachlinie">
        {FACHLINIEN.map((f) => (
          <a key={f} class="pill" href={routeHash({ view: 'sperren', key: mitFachlinie(sperrenKey, f) })} aria-current={f === aktuell ? 'page' : undefined}>
            {f}
          </a>
        ))}
      </div>
      <div class="seitenleiste">
        <button type="button" class="knopf" onClick={onDownload}>
          Für Excel herunterladen
        </button>
      </div>
      {hinweis && (
        <p class="kopfhinweis" role="status">
          {hinweis}
        </p>
      )}
    </form>
  );
}

export function SperrenPage({ sperrenKey, readFile, onOpen, ...rest }: Props) {
  const layout = useMemo(() => sperrenLayout(sperrenKey), [sperrenKey]);
  // Nur einmal je Seite: `onOpen` darf sich bei jedem Zeichnen der App ändern.
  const opened = useRef(onOpen);
  opened.current = onOpen;
  useEffect(() => opened.current(sperrenKey), [sperrenKey]);

  const kopf = useMemo(
    (): Omit<Kopf, 'form'> => ({
      complete: (page: Page): Page => ({ ...page, kind: 'sperren', key: sperrenKey }),
      layoutFor: () => {
        const { fields, background } = sperrenLayout(sperrenKey);
        return { fields, background: background() };
      },
    }),
    [sperrenKey],
  );
  // Am Firmen-PC (`readOnly`) kommt die Liste als Download, am iPad über das Teilen-Blatt, auch im zweiten Fenster.
  const { hinweis, download } = useCsvDownload({ readFile, readOnly: rest.readOnly });
  const head: Kopf = {
    ...kopf,
    // Der Knopf ist nie gesperrt: Auch am Firmen-PC und im zweiten Fenster lässt sich die Liste laden. Sie gehört zum Jahr der Seite.
    form: (tools: KopfTools) => (
      <Form
        sperrenKey={sperrenKey}
        hinweis={hinweis}
        onDownload={() => {
          const s = parseSperrenKey(sperrenKey);
          if (s === null) return;
          void download({
            csvPath: sperrenCsvPath(s.fachlinie, s.jahr),
            jsonPath: sperrenJsonPath(s.fachlinie, s.jahr),
            name: sperrenCsvName(s.fachlinie, s.jahr),
            seite: s.quartal,
            neuester: neuesterStrich(tools.current()),
            keine: keineListe(s.fachlinie, s.jahr),
          });
        }}
      />
    ),
  };
  return <PageView {...rest} layout={layout} path={sperrenPagePath(sperrenKey)} kopf={head} />;
}
