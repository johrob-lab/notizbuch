import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';
import { buildSamples, type Sample } from '../../scripts/samples/pages';
import { parsePage } from '../../src/ink/svg';
import { besprechungPagePath, monatPagePath, tagPagePath, wochePagePath } from '../../src/lib/filenames';
import { assertAllowedPath } from '../../src/sync/paths';

// Die Beispielseiten für den Trockenlauf und den Probebetrieb. Erfundener Inhalt, erzeugt mit den echten Funktionen
// der App (StrokeBuilder, serializePage, Layouts). Hier zählt: Die Seiten lassen sich lesen, sie sind immer gleich,
// und das Skript schreibt genau diese Dateien.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LAUNCHER = join(ROOT, 'scripts', 'make-samples.mjs');
const DAY = '2026-10-29';
const MEETING = `${DAY} 0800 Abstimmung Beispiel 2027`;

function find(samples: Sample[], folder: string, path: string): Sample {
  const sample = samples.find((s) => s.folder === folder && s.path === path);
  if (!sample) throw new Error(`Beispielseite fehlt: ${folder}/${path}`);
  return sample;
}

const temp: string[] = [];
afterEach(() => {
  for (const dir of temp.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('sample pages', () => {
  const samples = buildSamples();

  test('the set: day, two meeting pages, week, month and the later day page', () => {
    expect(samples.map((s) => `${s.folder}: ${s.path}`)).toEqual([
      `lauf1: ${tagPagePath(DAY)}`,
      `lauf1: ${besprechungPagePath(MEETING, 1)}`,
      `lauf1: ${besprechungPagePath(MEETING, 2)}`,
      `lauf1: ${wochePagePath('2026-W44')}`,
      `monat: ${monatPagePath('2026-10')}`,
      `lauf3-nachtrag: ${tagPagePath(DAY)}`,
    ]);
  });

  test('every page is readable by the app and keeps all its strokes', () => {
    for (const sample of samples) {
      const page = parsePage(sample.svg);
      expect(page.kind, sample.path).toBe(sample.page.kind);
      expect(page.key, sample.path).toBe(sample.page.key);
      expect(page.strokes.length, sample.path).toBeGreaterThan(0);
      expect(page.strokes.length, sample.path).toBe(sample.page.strokes.length);
    }
  });

  test('the day page has strokes in two fields, in black, blue, red and green', () => {
    const day = find(samples, 'lauf1', tagPagePath(DAY));
    const fields = [...day.svg.matchAll(/<g data-feld="([^"]+)"/g)].map((m) => m[1]);
    expect(fields).toEqual(expect.arrayContaining(['notizen', 'aufgaben']));
    const page = parsePage(day.svg);
    expect(page).toMatchObject({ kind: 'tag', key: DAY });
    expect(new Set(page.strokes.map((s) => s.color))).toEqual(new Set(['schwarz', 'blau', 'rot', 'gruen']));
  });

  test('the two meeting pages belong to Beispielprojekt A', () => {
    // Das Projekt gibt es im Mini-Vault der Tests: Die Auswahl in der App kennt es.
    expect(existsSync(join(ROOT, 'tests', 'fixtures', 'vault', '02 Projekte', 'Beispielprojekt A.md'))).toBe(true);
    for (const n of [1, 2]) {
      const sample = find(samples, 'lauf1', besprechungPagePath(MEETING, n));
      expect(sample.svg).toContain('data-projekt="Beispielprojekt A"');
      const page = parsePage(sample.svg);
      expect(page).toMatchObject({ kind: 'besprechung', key: MEETING });
      expect(page.meta).toMatchObject({ projekt: 'Beispielprojekt A', seitennr: String(n), thema: 'Abstimmung Beispiel 2027', datum: DAY, zeit: '08:00' });
    }
  });

  test('week and month page', () => {
    expect(parsePage(find(samples, 'lauf1', wochePagePath('2026-W44')).svg)).toMatchObject({ kind: 'woche', key: '2026-W44' });
    expect(parsePage(find(samples, 'monat', monatPagePath('2026-10')).svg)).toMatchObject({ kind: 'monat', key: '2026-10' });
  });

  test('the same input gives the same files, and the later day page continues the first', () => {
    expect(buildSamples().map((s) => s.svg)).toEqual(samples.map((s) => s.svg));
    const first = find(samples, 'lauf1', tagPagePath(DAY)).page.strokes;
    const later = find(samples, 'lauf3-nachtrag', tagPagePath(DAY)).page.strokes;
    expect(later.length).toBeGreaterThan(first.length);
    expect(later.slice(0, first.length)).toEqual(first); // der Anfang bleibt Strich für Strich derselbe
    // Die neuen Striche kommen später als alles, was schon da war.
    const lastBefore = Math.max(...first.map((s) => s.t));
    expect(later.slice(first.length).every((s) => s.t > lastBefore)).toBe(true);
  });

  test('building the pages leaves Math.random alone', () => {
    const before = Math.random;
    buildSamples();
    expect(Math.random).toBe(before);
  });

  test('all pages lie where the app may write', () => {
    for (const sample of samples) expect(() => assertAllowedPath(sample.path, 'write'), sample.path).not.toThrow();
  });
});

describe('make-samples.mjs', () => {
  test('writes the same pages into the output folder, and the app can read them', () => {
    const out = mkdtempSync(join(tmpdir(), 'notizbuch-samples-'));
    temp.push(out);
    // Aus einem fremden Ordner gestartet: Das Skript findet seine Dateien selbst.
    const result = spawnSync(process.execPath, [LAUNCHER, out], { cwd: out, encoding: 'utf8', timeout: 120_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Striche');
    for (const sample of buildSamples()) {
      const written = readFileSync(join(out, sample.folder, sample.path), 'utf8');
      expect(written, sample.path).toBe(sample.svg);
      expect(parsePage(written).strokes.length, sample.path).toBe(sample.page.strokes.length);
    }
  }, 150_000);

  test('asks for an output folder', () => {
    const result = spawnSync(process.execPath, [LAUNCHER], { encoding: 'utf8', timeout: 60_000 });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Aufruf');
  });
});
