import { expect, test } from 'vitest';
import { repairOldLine } from '../../src/ink/repair';
import { toHundredths } from '../../src/ink/stroke';
import { storedForm } from '../../src/ink/svg';
import type { Pt } from '../../src/ink/types';

// Die Reparatur alter zerfranster Striche als reine Rechnung, Orte in Seiteneinheiten. Wie sie beim Lesen einer Seite wirkt und dass
// sie nur einmal greift, prüft svg.test.ts. Alles hier ist erfunden.

/**
 * Ein Viertelkreis mit Radius 3 um (100, 100), die Punkte 0,1 Einheiten auseinander, die Breite wächst von 0,5 auf 1,1. So gezoomt
 * geschrieben, wie die App ihn vor Paket 3d speicherte: die Orte mit einer Nachkommastelle, die Breiten mit zwei.
 */
function oldArc(): Pt[] {
  const n = Math.round((3 * Math.PI) / 2 / 0.1);
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (i / n) * (Math.PI / 2);
    return { x: Math.round((100 + 3 * Math.cos(a)) * 10) / 10, y: Math.round((100 + 3 * Math.sin(a)) * 10) / 10, w: toHundredths(0.5 + (0.6 * i) / n) };
  });
}

const place = (p: Pt) => ({ x: p.x, y: p.y });

/** Auf eine Nachkommastelle, so hielt die alte Datei die Orte. */
const oneDecimal = (v: number) => Math.round(v * 10) / 10;

/** Die Punkte genau so, wie `serializePage` sie in die Datei schreibt und `parsePage` sie wieder liest (`storedForm`). */
const inFile = (pts: Pt[]): Pt[] => storedForm({ id: 'x', tool: 'fueller', color: 'schwarz', widthMm: 0.2, t: 0, w: 0, pts }).pts;

/** Ein kurzer senkrechter Strich der Füllfeder, gezoomt geschrieben und alt gespeichert. Repariert läge er wieder ganz auf dem Raster. */
const UPRIGHT: Pt[] = [
  { x: 243.9, y: 1099.7, w: 0.19 },
  { x: 243.9, y: 1099.9, w: 0.88 },
  { x: 243.9, y: 1100, w: 1.15 },
  { x: 243.9, y: 1100.3, w: 1.14 },
  { x: 243.9, y: 1100.5, w: 0.81 },
  { x: 243.9, y: 1100.7, w: 0.18 },
];

/**
 * Ein alter, gezoomt geschriebener Strich ab (x0, y0): 30 Punkte geradeaus nach rechts, genau 0,1 auseinander, dann ein Viertelkreis
 * mit Radius 1 nach oben.
 */
function runAndBend(x0: number, y0: number): Pt[] {
  const run = Array.from({ length: 30 }, (_, i) => ({ x: oneDecimal(x0 + i * 0.1), y: y0, w: 0.6 }));
  const bend = Array.from({ length: 16 }, (_, i) => {
    const a = ((i + 1) / 16) * (Math.PI / 2);
    return { x: oneDecimal(x0 + 2.9 + Math.sin(a)), y: oneDecimal(y0 - 1 + Math.cos(a)), w: 0.6 };
  });
  return [...run, ...bend];
}

test('only an old, dense line of at least five points is repaired, any other comes back as it is', () => {
  const arc = oldArc();
  expect(repairOldLine(arc)).not.toEqual(arc);
  // Vier Punkte sind zu wenig.
  const short = arc.slice(0, 4);
  expect(repairOldLine(short)).toBe(short);
  // Jeder vierte Punkt: 0,4 Einheiten auseinander, also nicht gezoomt geschrieben.
  const loose = arc.filter((_, i) => i % 4 === 0);
  expect(repairOldLine(loose)).toBe(loose);
  // Eine einzige Zahl mit zwei Nachkommastellen: neue Genauigkeit.
  const fresh = arc.map((p, i) => (i === 10 ? { ...p, y: toHundredths(p.y + 0.01) } : p));
  expect(repairOldLine(fresh)).toBe(fresh);
});

test('the repaired line keeps its ends and its arc, drops doubled points and has the precision of the file', () => {
  const arc = oldArc();
  const out = repairOldLine(arc);
  // Doppelt aufgenommene Punkte ändern nichts.
  const doubled = arc.flatMap((p, i) => (i % 3 === 1 ? [p, { ...p }] : [p]));
  expect(repairOldLine(doubled)).toEqual(out);
  // Anfang und Ende bleiben.
  expect(place(out[0])).toEqual(place(arc[0]));
  expect(place(out[out.length - 1])).toEqual(place(arc[arc.length - 1]));
  // Die Punkte bleiben auf dem Bogen, näher als das Runden der alten Datei (bis 0,07) sie davon weggerückt hatte.
  for (const p of out) expect(Math.abs(Math.hypot(p.x - 100, p.y - 100) - 3)).toBeLessThan(0.03);
  // Ausgedünnt: Kein Punkt liegt näher als 0,05 am vorigen.
  for (let i = 1; i < out.length; i++) expect(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)).toBeGreaterThanOrEqual(0.05);
  // Alle Zahlen mit höchstens zwei Nachkommastellen, wie die Datei sie hält.
  for (const p of out) for (const v of [p.x, p.y, p.w]) expect(toHundredths(v)).toBe(v);
  // Die Breiten kommen aus der Datei.
  expect(out.every((p) => arc.some((q) => q.w === p.w))).toBe(true);
});

test('a line whose repair would lie on the old grid again stays as it is, so the repair happens at most once', () => {
  // Läge die reparierte Linie in der Datei wieder ganz auf dem Raster, hielte das nächste Lesen sie für alt und reparierte sie noch
  // einmal anders. Darum bleibt sie, wie sie ist.
  expect(repairOldLine(UPRIGHT)).toBe(UPRIGHT);
  // Viele solche achsparallelen Striche, gezoomt geschrieben: Was die Reparatur ergibt, so wie die Datei es hält, repariert sie nicht
  // noch einmal. Ein Teil davon bleibt, wie er war, der Rest ändert sich genau einmal.
  let seed = 7;
  const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  let kept = 0;
  let changed = 0;
  for (let k = 0; k < 500; k++) {
    const n = 8 + Math.floor(rand() * 20);
    const [x0, y0] = [100 + rand() * 900, 100 + rand() * 1300];
    const upright = k % 2 === 1;
    const line = Array.from({ length: n }, (_, i) => {
      const along = i * 0.1 + (rand() - 0.5) * 0.01;
      const across = (rand() - 0.5) * 0.02;
      return { x: oneDecimal(x0 + (upright ? across : along)), y: oneDecimal(y0 + (upright ? along : across)), w: 0.5 };
    });
    const once = repairOldLine(line);
    if (once === line) kept++;
    else changed++;
    const saved = inFile(once);
    expect(repairOldLine(saved), `Strich ${k}`).toEqual(saved);
  }
  expect(kept).toBeGreaterThan(0);
  expect(changed).toBeGreaterThan(0);
});

test('a straight run on the old grid keeps its places and its even spacing, wherever it lies', () => {
  // Auf dem Raster der alten Datei sind Abstände genau gleich. Ob ein Nachbar am Rand des Fensters mitzählt oder ein Punkt beim
  // Ausdünnen bleibt, hängt darum nicht vom letzten Bit der Rechnung ab, also weder von der Lage des Strichs noch vom Gerät.
  for (const [x0, y0] of [
    [100, 200.1],
    [345.6, 812.3],
    [500.2, 300],
    [10, 10],
  ]) {
    const line = runAndBend(x0, y0);
    const out = repairOldLine(line);
    expect(out, `${x0} ${y0}`).not.toBe(line);
    // Das gerade Stück fern der Biegung (weiter als zweimal 2,5 σ) bleibt Punkt für Punkt, wo es war, alle genau 0,1 auseinander.
    expect(out.slice(0, 12).map(place), `${x0} ${y0}`).toEqual(line.slice(0, 12).map(place));
  }
});
