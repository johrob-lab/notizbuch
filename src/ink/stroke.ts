import { MM, type InkColor, type Pt, type Stroke } from './types';

/**
 * Zahl für die SVG-Datei: auf eine Nachkommastelle gerundet, ohne `.0` am Ende und nie als `-0`.
 * Was keine endliche Zahl ist, wird `0`, damit die Datei lesbar bleibt.
 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Math.round und String statt toFixed: `(-0.04).toFixed(1)` wäre "-0.0", String(-0) ist "0".
  return String(Math.round(n * 10) / 10);
}

/** Kurzes Zufallsstück für die `id`: vier Zeichen aus 0 bis 9 und a bis z. */
function randomSuffix(): string {
  return Math.floor(Math.random() * 36 ** 4)
    .toString(36)
    .padStart(4, '0');
}

/**
 * Baut einen Strich aus den Stiftpunkten auf. Die Rechnung stammt aus `pushPoint` und `smoothTail` im Stift-Test
 * (`docs/reference/stift-test.html`) und ist dort mit dem Apple Pencil geprüft: Mindestabstand zum letzten Rohpunkt,
 * Druck geglättet, Breite aus dem Druck, Gauß-Glättung mit einem Fenster, das zu den Enden hin schrumpft.
 */
export class StrokeBuilder {
  private readonly opts: { color: InkColor; widthMm: number; sigma: number; t: number; minDist: number };
  private readonly id: string;
  private readonly nomW: number;
  /** Halbe Fensterbreite der Glättung in Punkten, 0 heißt: nicht glätten. */
  private readonly K: number;
  /** Gewichte des Fensters: `wts[j]` gehört zu einem Punkt im Abstand j. */
  private readonly wts: number[];
  /** Die Punkte, wie der Stift sie geliefert hat. */
  private readonly raw: Pt[] = [];
  /** Die geglätteten Punkte, immer so viele wie `raw`. */
  private readonly out: Pt[] = [];
  /** Geglätteter Druck, `null` vor dem ersten Punkt. */
  private ps: number | null = null;
  private sumW = 0;

  /**
   * `minDist` ist der Mindestabstand zwischen zwei Rohpunkten in Seiteneinheiten (die App rechnet
   * 0.6 / Zoom, damit er auf dem Bildschirm gleich bleibt). `t` ist der Beginn des Strichs in Millisekunden.
   */
  constructor(o: { color: InkColor; widthMm: number; sigma: number; t: number; minDist: number }) {
    this.opts = { ...o };
    this.id = `s${o.t}${randomSuffix()}`;
    this.nomW = o.widthMm * MM;
    const sig = o.sigma;
    this.K = sig > 0 ? Math.ceil(2.5 * sig) : 0;
    this.wts = sig > 0 ? Array.from({ length: this.K + 1 }, (_, j) => Math.exp(-(j * j) / (2 * sig * sig))) : [];
  }

  /**
   * Nimmt einen Stiftpunkt auf (Seiteneinheiten, Druck 0 bis 1). `false`, wenn der Punkt dem letzten behaltenen
   * Punkt zu nah ist und deshalb verworfen wurde. Ohne Druckwert (0 oder keine Zahl) gilt 0.5.
   */
  add(x: number, y: number, pressure: number): boolean {
    const raw = this.raw;
    const last = raw[raw.length - 1];
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const min = this.opts.minDist;
      if (dx * dx + dy * dy < min * min) return false;
    }
    const pv = pressure > 0 ? pressure : 0.5;
    this.ps = this.ps === null ? pv : this.ps * 0.7 + pv * 0.3;
    const pt: Pt = { x, y, w: this.nomW * (0.7 + 0.6 * this.ps) }; // Druck wirkt dezent auf die Breite
    raw.push(pt);
    this.sumW += pt.w;
    this.smoothTail();
    return true;
  }

  /**
   * Der Strich, wie er jetzt ist. Das ist eine Momentaufnahme: Punkte, die danach kommen, ändern ihn nicht.
   * `w` ist der Mittelwert der Breiten der Rohpunkte, ohne Punkte die Nennbreite.
   */
  stroke(): Stroke {
    const n = this.raw.length;
    return {
      id: this.id,
      tool: 'kugel',
      color: this.opts.color,
      widthMm: this.opts.widthMm,
      t: this.opts.t,
      w: n ? this.sumW / n : this.nomW,
      pts: this.out.slice(),
    };
  }

  /**
   * Das Fenster wird zu den Enden hin kleiner: Anfang, Ende und Stiftspitze bleiben genau dort, wo der Stift war.
   * Ein neuer Punkt ändert nur die letzten K + 1 Punkte, weiter vorn reicht das Fenster nicht bis zu ihm.
   */
  private smoothTail(): void {
    const { raw, out, K, wts } = this;
    const n = raw.length;
    if (!K) {
      out[n - 1] = raw[n - 1];
      return;
    }
    for (let i = Math.max(0, n - 1 - K); i < n; i++) {
      const r = Math.min(K, i, n - 1 - i);
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let j = -r; j <= r; j++) {
        const w = wts[j < 0 ? -j : j];
        sx += w * raw[i + j].x;
        sy += w * raw[i + j].y;
        sw += w;
      }
      out[i] = { x: sx / sw, y: sy / sw, w: raw[i].w };
    }
  }
}

/**
 * Pfad eines Strichs: `M x0 y0`, dann für jeden Punkt von 1 bis n-2 `Q xi yi mx my` (m ist die Mitte von Punkt i
 * und i+1), zuletzt `L` zum letzten Punkt. So ist der Strich ein glatter Pfad in einer Breite. Ein einzelner Punkt
 * wird `M x y L x y` und bleibt mit runder Linienkappe als Punkt sichtbar. Ohne Punkte kommt ein leerer Text zurück.
 */
export function pathD(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  const parts = [`M ${fmtNum(pts[0].x)} ${fmtNum(pts[0].y)}`];
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    parts.push(`Q ${fmtNum(a.x)} ${fmtNum(a.y)} ${fmtNum((a.x + b.x) / 2)} ${fmtNum((a.y + b.y) / 2)}`);
  }
  const last = pts[n - 1];
  parts.push(`L ${fmtNum(last.x)} ${fmtNum(last.y)}`);
  return parts.join(' ');
}

/** Wie viele Zahlen auf einen Befehl folgen, 0 bei allem, was `pathD` nicht schreibt. */
function operands(command: string): number {
  switch (command) {
    case 'M':
    case 'L':
      return 2;
    case 'Q':
      return 4;
    default:
      return 0;
  }
}

/**
 * Liest die Punkte aus einem Pfad, den `pathD` geschrieben hat: den M-Punkt, jeden Kontrollpunkt eines Q und den
 * L-Punkt (die Mitten hinter den Kontrollpunkten sind aus diesen berechenbar). Alles, was anders aufgebaut
 * ist, ergibt eine leere Liste: andere Befehle, fehlende oder keine Zahlen.
 */
export function parsePathD(d: string): { x: number; y: number }[] {
  const tokens = d.trim().split(/\s+/);
  const pts: { x: number; y: number }[] = [];
  let i = 0;
  while (i < tokens.length) {
    const count = operands(tokens[i]);
    if (!count || i + count >= tokens.length) return [];
    const [x, y] = tokens.slice(i + 1, i + 1 + count).map(Number);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return [];
    pts.push({ x, y });
    i += count + 1;
  }
  return pts;
}

function segDist2(px: number, py: number, a: Pt, b: Pt): number {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a.x) * vx + (py - a.y) * vy) / l2)) : 0;
  const dx = a.x + t * vx - px;
  const dy = a.y + t * vy - py;
  return dx * dx + dy * dy;
}

/**
 * Wahr, wenn der Radierer an (x, y) mit dem Radius `r` den Strich berührt: Der Abstand zu einer Strecke des Strichs
 * ist höchstens `r` plus die halbe Strichbreite. Alles in Seiteneinheiten. Die Mindestbreite von einem Bildpunkt,
 * die beim Zeichnen gilt, kennt die Funktion nicht: Wer sie braucht, rechnet sie in `r` ein.
 */
export function hitStroke(s: Stroke, x: number, y: number, r: number): boolean {
  const q = s.pts;
  const rr = r + s.w / 2;
  if (q.length === 1) return (q[0].x - x) ** 2 + (q[0].y - y) ** 2 <= rr * rr;
  for (let i = 1; i < q.length; i++) if (segDist2(x, y, q[i - 1], q[i]) <= rr * rr) return true;
  return false;
}
