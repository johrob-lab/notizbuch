import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { belegteFelder } from '../ink/svg';
import type { Page } from '../ink/types';
import { excelStandPath, sperrenCsvName, sperrenCsvPath, sperrenJsonPath, sperrenPagePath } from '../lib/filenames';
import { neuesterStrich } from '../lib/tabelleCsv';
import { FACHLINIEN, keineListe, mitFachlinie, parseSperrenKey, seitenSchluessel } from '../lib/sperren';
import { excelStandText, graueSperren, gueltigeEintraege, leseExcelStand, type ExcelLesung } from '../lib/sperrenExcel';
import { sperrenLayout } from '../pages/layouts';
import type { ReadFile } from '../sync/github';
import { GraueSperren } from './GraueSperren';
import { PageView, type Kopf, type KopfTools, type PageProps } from './PageView';
import { routeHash } from './router';
import { useCsvDownload } from './useCsvDownload';
import { UNLESBAR, useVaultText } from './useVaultText';

// Eine Seite der Sperren: zwei Monate einer Fachlinie. Über der Fläche steht ein Formular mit der Wahl der Fachlinie (zwei
// Links, die dieselben zwei Monate der anderen Fachlinie öffnen), dem Knopf für den Download der Liste und dem Stand aus Excel.
// Die Seite hat keine Kopfdaten zum Ändern: Das Formular ist nur Bedienung, `complete` setzt nur Art und Schlüssel.
//
// Die abgestimmten Sperren aus dem Excel-Stand stehen grau in den freien Plätzen (`GraueSperren`, nur auf dem Bildschirm). Was
// schon aus dem Notizbuch stammt oder dort an dem Tag gültig ist (Liste der Abendroutine), steht als Schrift da und kommt nicht
// grau. Ein Platz mit Tinte ist nicht frei: Wer in einen grauen Platz schreibt, schiebt das Grau weiter.

/** Ein Excel-Stand, den die Engine nicht lesen kann (zum Beispiel kein UTF-8): Der Kopf sagt, dass er sich nicht lesen lässt. */
const UNLESBARER_STAND: ExcelLesung = { ok: false, fehler: 'Die Datei lässt sich nicht lesen.' };

type Props = PageProps & {
  /** Der Schlüssel der Seite, zum Beispiel `IB-2027-03`. */
  sperrenKey: string;
  /** Liest eine Datei aus dem Repository (für die Liste zum Download). */
  readFile: ReadFile;
  /** Wird einmal gerufen, wenn die Seite aufgeht: Das Gerät merkt sich, welche Sperrenseite zuletzt offen war. */
  onOpen(key: string): void;
};

type FormProps = {
  sperrenKey: string;
  /** Der Stand aus Excel, zum Beispiel `Excel-Stand vom 26.11.2026, 09:40`. Leer, solange die Datei lädt. */
  stand: string;
  /** Hinweis unter dem Formular (der Download meldet hier, was er getan hat). */
  hinweis: string;
  onDownload(): void;
};

function Form({ sperrenKey, stand, hinweis, onDownload }: FormProps) {
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
      {stand && <p class="excelstand">{stand}</p>}
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
  // Der Schlüssel ist gültig: Sonst hätte `sperrenLayout` schon geworfen.
  const { fachlinie, jahr } = parseSperrenKey(sperrenKey)!;
  // Nur einmal je Seite: `onOpen` darf sich bei jedem Zeichnen der App ändern.
  const opened = useRef(onOpen);
  opened.current = onOpen;
  useEffect(() => opened.current(sperrenKey), [sperrenKey]);

  // Das Grau kommt aus dem Excel-Stand des Jahres, der Liste der Abendroutine und den Plätzen mit Tinte. Die Tinte meldet die
  // Fläche nach jeder Änderung (`onStrokes`). Neu gezeichnet wird nur, wenn sich die belegten Plätze ändern, nicht bei jedem Strich.
  const excel = useVaultText(rest.engine, excelStandPath(fachlinie, jahr));
  const liste = useVaultText(rest.engine, sperrenCsvPath(fachlinie, jahr));
  const lesung = useMemo((): ExcelLesung | null | undefined => {
    if (excel === UNLESBAR) return UNLESBARER_STAND;
    return excel === undefined || excel === null ? excel : leseExcelStand(excel, { fachlinie, jahr });
  }, [excel, fachlinie, jahr]);
  // Eine Liste, die fehlt oder sich nicht lesen lässt, hat keine gültigen Einträge.
  const gueltig = useMemo(() => gueltigeEintraege(typeof liste === 'string' ? liste : null), [liste]);
  const tage = useMemo(() => [...new Set(layout.fields.map((f) => f.datum))], [layout]);
  const [belegt, setBelegt] = useState<ReadonlySet<string>>(() => new Set());
  const belegtKey = useRef('');
  const onStrokes = (page: Page) => {
    const next = belegteFelder(page.strokes, layout.fields);
    const key = [...next].sort().join(' ');
    if (key === belegtKey.current) return;
    belegtKey.current = key;
    setBelegt(next);
  };
  const grau = useMemo(
    () => (lesung?.ok ? graueSperren(lesung.stand.zeilen, { tage, belegt, gueltig }) : { plaetze: [], mehr: [] }),
    [lesung, tage, belegt, gueltig],
  );
  const stand = excelStandText(lesung, fachlinie, jahr);

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
        stand={stand}
        hinweis={hinweis}
        onDownload={() => {
          const s = parseSperrenKey(sperrenKey);
          if (s === null) return;
          void download({
            csvPath: sperrenCsvPath(s.fachlinie, s.jahr),
            jsonPath: sperrenJsonPath(s.fachlinie, s.jahr),
            name: sperrenCsvName(s.fachlinie, s.jahr),
            seite: seitenSchluessel(s),
            neuester: neuesterStrich(tools.current()),
            keine: keineListe(s.fachlinie, s.jahr),
          });
        }}
      />
    ),
  };
  return (
    <PageView
      {...rest}
      layout={layout}
      path={sperrenPagePath(sperrenKey)}
      kopf={head}
      overlay={<GraueSperren fields={layout.fields} plaetze={grau.plaetze} mehr={grau.mehr} />}
      onStrokes={onStrokes}
    />
  );
}
