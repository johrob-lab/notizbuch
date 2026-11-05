import { arcGaussAt } from './smooth';
import { toHundredths } from './stroke';
import type { Pt } from './types';

// Alte zerfranste Striche reparieren. Bis Paket 3d schrieb die App die Orte der Punkte mit einer Nachkommastelle. Gezoomt geschrieben
// liegen die Punkte nur etwa 0,1 Einheiten auseinander: Auf 0,1 gerundet springen ihre Richtungen, und der Umriss von Füllfeder und
// Bleistift zerfranst. Beim Lesen werden solche Striche geglättet. Die nächste Speicherung legt sie mit zwei Nachkommastellen ab,
// danach greift die Reparatur nicht mehr. Reine Rechnung in Seiteneinheiten. Die Zahlen sind an echten, gezoomt geschriebenen
// Strichen geeicht: Der Umriss wird so ruhig wie bei ungerundeten Punkten, und Schleifen werden kaum kleiner.

/** Erst ab so vielen Punkten wird repariert. */
const MIN_POINTS = 5;
/** Liegen die Punkte im Median näher beieinander als das (Seiteneinheiten), wurde gezoomt geschrieben. */
const DENSE = 0.35;
/** Ein Punkt, der näher als das am vorigen liegt, ist doppelt: In der alten Datei liegen beide auf demselben Ort. */
const SAME = 0.01;
/** σ der Glättung nach der Strecke in Seiteneinheiten (2 Bildschirmpunkte bei Zoom 6,7). */
const SIGMA = 0.3;
/**
 * So viele σ weit (Strecke) reicht die Glättung zu jeder Seite. Gleich viel wie beim Schreiben (`STABIL_REACH`), aber eigens festgelegt:
 * Die Reparatur ist an diesem Wert geeicht und bleibt gleich, wenn die Stabilisierung beim Schreiben einmal nachgestellt wird.
 */
const REACH = 2.5;
/** Nach dem Glätten liegt kein Punkt näher als das am vorigen: Feiner hat die alte Datei die Orte nicht aufgelöst. */
const GAP = 0.1;
/**
 * Spielraum bei Gleichstand (Seiteneinheiten). Auf dem Raster der alten Datei sind Abstände genau gleich: Ob ein Nachbar am Rand des
 * Fensters noch mitzählt oder ein Punkt beim Ausdünnen bleibt, entschiede sonst das letzte Bit der Rechnung, und das kann je nach Lage des
 * Strichs und je nach Gerät anders ausfallen. Mit dem Spielraum zählt ein Gleichstand immer mit.
 */
const TIE = 1e-9;

/** Wahr, wenn x und y aller Punkte höchstens eine Nachkommastelle haben: So schrieb die App die Orte vor Paket 3d. */
function oneDecimal(pts: readonly Pt[]): boolean {
  return pts.every((p) => Math.round(p.x * 10) / 10 === p.x && Math.round(p.y * 10) / 10 === p.y);
}

/** Abstand zweier Punkte. */
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Der Median der Abstände aufeinanderfolgender Punkte (mindestens zwei Punkte). */
function medianStep(pts: readonly Pt[]): number {
  const steps = pts
    .slice(1)
    .map((p, i) => dist(pts[i], p))
    .sort((a, b) => a - b);
  const m = steps.length >> 1;
  return steps.length % 2 ? steps[m] : (steps[m - 1] + steps[m]) / 2;
}

/**
 * Gauß-Glättung aller Orte nach der Strecke `arc` (`arcGaussAt`) mit σ `SIGMA`, Nachbarn am Rand des Fensters mit Spielraum `TIE`: Anfang
 * und Ende bleiben genau dort, wo sie waren.
 */
function gauss(pts: readonly { x: number; y: number }[], arc: readonly number[]): { x: number; y: number }[] {
  return pts.map((_, i) => arcGaussAt(pts, arc, i, SIGMA, REACH * SIGMA, TIE));
}

/**
 * Repariert die Mittellinie eines alten, gezoomt geschriebenen Strichs von Füllfeder oder Bleistift: alte Genauigkeit (alle Orte mit
 * höchstens einer Nachkommastelle), mindestens 5 Punkte und im Median weniger als 0,35 Einheiten auseinander. Sonst kommen dieselben
 * Punkte zurück (dasselbe Array). Repariert wird in drei Schritten:
 * 1. Doppelte Punkte fallen weg (die größere Breite bleibt).
 * 2. Gauß-Glättung nach der Strecke (`gauss`), deren Schwund ausgeglichen wird: Die Glättung zieht jeden Bogen ein wenig nach innen,
 *    ein zweiter Durchgang über die geglätteten Punkte misst, wie weit, und die Punkte rücken um so viel wieder hinaus
 *    (2 G − G∘G). So werden auch kleine Schleifen nicht merklich kleiner. Anfang und Ende bleiben.
 * 3. Ausdünnen: Kein Punkt liegt näher als `GAP` am vorigen. Der letzte bleibt immer, dafür fällt sein Vorgänger weg, wenn er näher als
 *    `GAP` / 2 an ihm liegt. Gleichstände zählen als weit genug (`TIE`).
 * Die Orte kommen auf zwei Nachkommastellen gerundet zurück, die Breiten bleiben: genau so legt die Datei sie beim nächsten Speichern
 * ab. Danach hat der Strich die neue Genauigkeit, und die Reparatur greift nicht mehr. Läge das Ergebnis in der Datei wieder ganz auf
 * dem alten Raster, hielte das nächste Lesen den Strich für alt und reparierte ihn noch einmal, anders. Dann kommen dieselben Punkte
 * zurück wie hineingegeben: So ändert sich ein Strich genau einmal oder nie. Das betrifft Geraden auf dem Raster (dort hat das Runden
 * nichts zerfranst) und selten sehr kurze Striche.
 */
export function repairOldLine(pts: Pt[]): Pt[] {
  if (pts.length < MIN_POINTS || !oneDecimal(pts) || !(medianStep(pts) < DENSE)) return pts;
  const line: Pt[] = [];
  for (const p of pts) {
    const last = line[line.length - 1];
    if (!last || dist(last, p) >= SAME) line.push({ x: p.x, y: p.y, w: p.w });
    else if (p.w > last.w) last.w = p.w;
  }
  const arc = [0];
  for (let i = 1; i < line.length; i++) arc.push(arc[i - 1] + dist(line[i - 1], line[i]));
  const once = gauss(line, arc);
  const twice = gauss(once, arc);
  const smooth = line.map((p, i) => ({ x: 2 * once[i].x - twice[i].x, y: 2 * once[i].y - twice[i].y, w: p.w }));
  const kept = [smooth[0]];
  for (let i = 1; i < smooth.length - 1; i++) if (dist(kept[kept.length - 1], smooth[i]) >= GAP - TIE) kept.push(smooth[i]);
  const end = smooth[smooth.length - 1];
  if (smooth.length > 1) {
    if (kept.length > 1 && dist(kept[kept.length - 1], end) < GAP / 2 - TIE) kept.pop();
    kept.push(end);
  }
  // Genau die Zahlen der Datei: `fmtCoord` und `fmtWidth` schreiben `toHundredths`, `parsePage` liest dieselben Zahlen zurück.
  const stored = kept.map((p) => ({ x: toHundredths(p.x), y: toHundredths(p.y), w: toHundredths(p.w) }));
  return oneDecimal(stored) ? pts : stored;
}
