// @ts-check
// Schreibt erfundene Beispielseiten des Notizbuchs (SVG) in einen Ausgabeordner.
//
// Aufruf:  node scripts/make-samples.mjs <Ausgabeordner>
//
// Die Seiten entstehen mit dem echten Code der App (Strich und Glättung, SVG-Format, Layouts). Der ist TypeScript. Darum baut
// dieses Skript scripts/samples/pages.ts zuerst mit Vite zu einem einzigen Modul (im Speicher, es entsteht keine Datei) und
// lädt es dann. Vite kommt mit "npm install". Alles Erzeugte ist erfunden: keine echten Namen, keine Vault-Inhalte. Jeder Lauf
// ergibt dieselben Dateien.
//
// Im Ausgabeordner entstehen drei Unterordner:
//   lauf1/            Tagesseite, Besprechung über zwei Seiten (Projekt "Beispielprojekt A") und Wochenseite, Stand 29.10.2026 abends
//   monat/            Monatsseite Oktober 2026
//   lauf3-nachtrag/   dieselbe Tagesseite, am Nachmittag weitergeschrieben (der Anfang bleibt Strich für Strich gleich)
// Darunter liegen die Dateien so, wie sie im Vault liegen (07 Anhänge/Notizbuch/2026/...). Sie lassen sich dorthin kopieren.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), 'samples');
const USAGE = 'Aufruf: node scripts/make-samples.mjs <Ausgabeordner>';

/** @typedef {{ folder: string, path: string, page: { strokes: { t: number }[] }, svg: string }} Sample */

/** Baut scripts/samples/pages.ts mit Vite zu einem Modul und gibt dessen `buildSamples` zurück. */
async function loadBuilder() {
  let vite;
  try {
    vite = await import('vite');
  } catch {
    throw new Error('Vite fehlt. Bitte zuerst "npm install" ausführen.');
  }
  const result = await vite.build({
    configFile: false,
    root: SAMPLES_DIR,
    logLevel: 'warn',
    publicDir: false,
    // Alles ins Modul packen: Das Modul liegt nur im Speicher und findet später keine Pakete mehr.
    ssr: { noExternal: true },
    build: { ssr: join(SAMPLES_DIR, 'pages.ts'), write: false, minify: false, target: 'node22' },
  });
  const bundles = Array.isArray(result) ? result : [result];
  /** @type {string | undefined} */
  let code;
  for (const bundle of bundles) {
    if (!('output' in bundle)) continue;
    for (const item of bundle.output) {
      if (item.type === 'chunk' && item.isEntry) code = item.code;
    }
  }
  if (code === undefined) throw new Error('Beim Bauen der Beispielseiten kam kein Modul heraus.');
  const loaded = await import(`data:text/javascript;base64,${Buffer.from(code, 'utf8').toString('base64')}`);
  /** @type {() => Sample[]} */
  const buildSamples = loaded.buildSamples;
  return buildSamples;
}

/**
 * @param {string[]} argv
 * @returns {Promise<number>}
 */
async function main(argv) {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(USAGE);
    return 0;
  }
  if (argv.length !== 1) {
    console.error(USAGE);
    return 1;
  }
  const out = resolve(argv[0]);
  const buildSamples = await loadBuilder();
  const samples = buildSamples();
  for (const sample of samples) {
    const file = join(out, sample.folder, sample.path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, sample.svg, 'utf8');
    // "Stand" ist der Beginn des jüngsten Strichs, so wie ihn die Abendroutine als Marke für neue Striche braucht.
    const stand = Math.max(0, ...sample.page.strokes.map((stroke) => stroke.t));
    console.log(`${sample.folder}/${sample.path}  Striche ${sample.page.strokes.length}  Stand ${stand}`);
  }
  console.log(`Fertig: ${samples.length} Seiten in ${out}`);
  return 0;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  console.error(`Fehler: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
