import { expect, test } from 'vitest';
import { repairOldLine } from '../../src/ink/repair';
import { toHundredths } from '../../src/ink/stroke';
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
