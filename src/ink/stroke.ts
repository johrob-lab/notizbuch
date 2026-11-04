import {
  BLEISTIFT_PRESSURE,
  DEFAULT_FUELLER,
  DEFAULT_PEN_ANGLE,
  DIR_LEN,
  DIR_MIN,
  DIR_MIN_PX,
  FINELINER_FACTOR,
  FUELLER_FLOOR,
  MIN_DIST_PX,
  PRESS_LEN,
  SMOOTH_NEW,
  TAP_MAX,
  TAPER_LEN,
  doubled,
  nibFactorR,
  penAngle,
  pressureFactor,
  pressureRamp,
  taperFactor,
  type Doubled,
  type FuellerSettings,
  type PenKind,
} from './pens';
import { isShape } from './pens';
import { MM, type InkColor, type Pt, type Stroke } from './types';

/** Punkt zwischen `range.min` und `range.max`, `t` von 0 bis 1. */
const lerp = (range: { min: number; max: number }, t: number): number => range.min + (range.max - range.min) * t;

/** `a` und `b` gemischt, `b` mit dem Gewicht `SMOOTH_NEW`. */
const mix = (a: Doubled, b: Doubled): Doubled => ({ c: a.c * (1 - SMOOTH_NEW) + b.c * SMOOTH_NEW, s: a.s * (1 - SMOOTH_NEW) + b.s * SMOOTH_NEW });

/** `w`, aber nie unter `min`. Auch was keine Zahl ist, wird `min`. */
const atLeast = (w: number, min: number): number => (w >= min ? w : min);

/** Abstand zweier Punkte. */
const dist = (a: { x: number; y: number }, x: number, y: number): number => Math.hypot(x - a.x, y - a.y);

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

/** Neue, über alle Geräte eindeutige `id` eines Strichs, der zur Zeit `t` (Millisekunden) entstand. */
export function newStrokeId(t: number): string {
  return `s${t}${randomSuffix()}`;
}

/**
 * Baut einen Strich aus den Stiftpunkten auf. Die Rechnung stammt aus `pushPoint` und `smoothTail` im Stift-Test
 * (`docs/reference/stift-test.html`) und ist dort mit dem Apple Pencil geprüft: Mindestabstand zum letzten Rohpunkt,
 * Druck geglättet, Breite aus dem Druck, Gauß-Glättung mit einem Fenster, das zu den Enden hin schrumpft.
 *
 * Die Füllfeder rechnet ihre Breite mit den Reglern (`FuellerSettings`) und glättet Druck und Richtung über den Weg statt
 * je Punkt: Stark gezoomt liegen die Stiftpunkte so dicht, dass sonst das Zittern des Stifts die Breite springen ließe.
 * Beim Schreiben läuft der Anfang spitz zu, `finish()` gibt den fertigen Strich mit beiden spitzen Enden.
 */
export class StrokeBuilder {
  private readonly opts: {
    pen: PenKind;
    color: InkColor;
    widthMm: number;
    sigma: number;
    t: number;
    minDist: number;
    fueller: FuellerSettings;
    pxUnit: number;
  };
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

  // Nur Füllfeder:
  /** Strichrichtung als doppelter Winkel, geglättet. `null`, bis der Stift weit genug gekommen ist. */
  private dir: Doubled | null = null;
  /** Der Rohpunkt, an dem die Richtung zuletzt bestimmt wurde (am Anfang der erste). */
  private anchor: { x: number; y: number } | null = null;
  /** Richtung, in die der Stift zeigt, als doppelter Winkel, geglättet. `null` vor dem ersten Punkt. */
  private nib: Doubled | null = null;
  /** Der zuletzt gezählte Ort für den Weg (am Anfang der erste Rohpunkt) und der bis dorthin gezählte Weg. */
  private counted: { x: number; y: number } | null = null;
  private countedSum = 0;
  /** Weg des letzten Rohpunkts ab dem Anfang, in Seiteneinheiten. */
  private travel = 0;
  /** Je Rohpunkt die Grundbreite (ohne Verjüngung) und der Weg ab dem Anfang. */
  private readonly base: number[] = [];
  private readonly ways: number[] = [];

  /**
   * `minDist` ist der Mindestabstand zwischen zwei Rohpunkten in Seiteneinheiten (die App rechnet
   * 0.6 / Zoom, damit er auf dem Bildschirm gleich bleibt). `t` ist der Beginn des Strichs in Millisekunden.
   * Nur für die Füllfeder: `fueller` sind die Regler (ohne Angabe die Startwerte), `pxUnit` sind Seiteneinheiten je
   * Bildschirmpunkt (ohne Angabe aus `minDist`).
   */
  constructor(o: {
    pen?: PenKind;
    color: InkColor;
    widthMm: number;
    sigma: number;
    t: number;
    minDist: number;
    fueller?: FuellerSettings;
    pxUnit?: number;
  }) {
    this.opts = {
      ...o,
      pen: o.pen ?? 'kugel',
      fueller: { ...DEFAULT_FUELLER, ...o.fueller },
      pxUnit: o.pxUnit ?? o.minDist / MIN_DIST_PX,
    };
    this.id = newStrokeId(o.t);
    this.nomW = o.widthMm * MM;
    const sig = o.sigma;
    this.K = sig > 0 ? Math.ceil(2.5 * sig) : 0;
    this.wts = sig > 0 ? Array.from({ length: this.K + 1 }, (_, j) => Math.exp(-(j * j) / (2 * sig * sig))) : [];
  }

  /**
   * Nimmt einen Stiftpunkt auf (Seiteneinheiten, Druck 0 bis 1). `false`, wenn der Punkt dem letzten behaltenen
   * Punkt zu nah ist und deshalb verworfen wurde. Ohne Druckwert (0 oder keine Zahl) gilt 0.5. `tiltX` und `tiltY`
   * (Neigung des Stifts) braucht nur die Füllfeder; ohne Neigung gilt die Haltung eines Rechtshänders.
   */
  add(x: number, y: number, pressure: number, tiltX = 0, tiltY = 0): boolean {
    const raw = this.raw;
    const last = raw[raw.length - 1];
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const min = this.opts.minDist;
      if (dx * dx + dy * dy < min * min) return false;
    }
    const pv = pressure > 0 ? pressure : 0.5;
    const pt: Pt = { x, y, w: this.opts.pen === 'fueller' ? this.fuellerAt(x, y, last, pv, tiltX, tiltY) : this.widthAt(pv) };
    raw.push(pt);
    this.sumW += pt.w;
    this.smoothTail();
    return true;
  }

  /**
   * Der Strich, wie er jetzt ist. Das ist eine Momentaufnahme: Punkte, die danach kommen, ändern ihn nicht.
   * `w` ist der Mittelwert der Breiten der Rohpunkte, ohne Punkte die Nennbreite. Bei der Füllfeder läuft hier nur der
   * Anfang spitz zu.
   */
  stroke(): Stroke {
    const n = this.raw.length;
    return {
      id: this.id,
      tool: this.opts.pen,
      color: this.opts.pen === 'bleistift' ? 'grau' : this.opts.color,
      widthMm: this.opts.widthMm,
      t: this.opts.t,
      w: n ? this.sumW / n : this.nomW,
      pts: this.out.slice(),
    };
  }

  /**
   * Der fertige Strich nach dem Abheben, eine Momentaufnahme wie `stroke()`. Bei der Füllfeder laufen beide Enden spitz
   * zu, bei einem Strich kürzer als zwei Verjüngungen je auf seiner halben Länge. Ein Tipp ohne Weg bleibt ein runder
   * Punkt in voller Breite. Die Orte sind dieselben wie bei `stroke()`. Bei den anderen Stiften gleich `stroke()`.
   */
  finish(): Stroke {
    const s = this.stroke();
    const n = this.raw.length;
    if (this.opts.pen !== 'fueller' || !n) return s;
    const { schaerfe } = this.opts.fueller;
    const floor = this.nomW * FUELLER_FLOOR;
    const total = this.ways[n - 1];
    const len = Math.min(TAPER_LEN, total / 2);
    let sum = 0;
    const pts = s.pts.map((p, i) => {
      const way = this.ways[i];
      const w =
        total < TAP_MAX ? this.base[i] : atLeast(this.base[i] * taperFactor(schaerfe, way, len) * taperFactor(schaerfe, total - way, len), floor);
      sum += w;
      return { x: p.x, y: p.y, w };
    });
    return { ...s, w: sum / n, pts };
  }

  /** Breite am neuen Rohpunkt bei Kugelschreiber, Fineliner und Bleistift. `pv` ist der Druck, er wird je Punkt geglättet. */
  private widthAt(pv: number): number {
    const ps = (this.ps = this.ps === null ? pv : this.ps * 0.7 + pv * 0.3);
    const nomW = this.nomW;
    switch (this.opts.pen) {
      case 'fineliner':
        return nomW * FINELINER_FACTOR;
      case 'bleistift':
        return nomW * lerp(BLEISTIFT_PRESSURE, pressureRamp(ps));
      default:
        return nomW * (0.7 + 0.6 * ps); // Druck wirkt dezent auf die Breite
    }
  }

  /**
   * Breite der Füllfeder am neuen Rohpunkt, mit der Verjüngung am Anfang. `last` ist der vorige Rohpunkt, `pv` der Druck.
   * Druck und Richtung werden über den Weg geglättet, nicht je Punkt: Steht der Stift und zittert, ändert sich die Breite
   * nicht, auch wenn er viele Punkte schickt. Merkt sich je Punkt Grundbreite und Weg für `finish()`.
   */
  private fuellerAt(x: number, y: number, last: Pt | undefined, pv: number, tiltX: number, tiltY: number): number {
    const { fueller, pxUnit } = this.opts;
    const nomW = this.nomW;
    // Druck: der erste direkt, danach über den Weg zum vorigen Rohpunkt geglättet.
    const ps = (this.ps = this.ps === null || !last ? pv : this.ps + (pv - this.ps) * (1 - Math.exp(-dist(last, x, y) / PRESS_LEN)));
    // Richtung: erst, wenn der Stift weit genug vom Anker weg ist, sonst bleibt die letzte. Der Anker rückt dann nach.
    if (!this.anchor) this.anchor = { x, y };
    else {
      const d = dist(this.anchor, x, y);
      if (d >= Math.max(DIR_MIN, DIR_MIN_PX * pxUnit)) {
        const u = doubled(Math.atan2(y - this.anchor.y, x - this.anchor.x));
        const k = 1 - Math.exp(-d / DIR_LEN);
        this.dir = this.dir ? { c: this.dir.c + (u.c - this.dir.c) * k, s: this.dir.s + (u.s - this.dir.s) * k } : u;
        this.anchor = { x, y };
      }
    }
    // Richtung, in die der Stift zeigt: je Punkt gemischt und auf Länge 1 gebracht.
    const now = doubled(penAngle(tiltX, tiltY) ?? DEFAULT_PEN_ANGLE);
    this.nib = this.nib ? mix(this.nib, now) : now;
    const nibLen = Math.hypot(this.nib.c, this.nib.s);
    const nib = nibLen > 0 ? { c: this.nib.c / nibLen, s: this.nib.s / nibLen } : now; // Länge 0: zwei Neigungen genau gegenüber
    // Weg: Der gezählte Ort rückt erst nach, wenn der Stift einige Bildschirmpunkte weit gekommen ist. So zählt Zittern im
    // Stand nicht. Der Weg nimmt nie ab.
    if (!this.counted) this.counted = { x, y };
    else {
      const d = dist(this.counted, x, y);
      if (d >= DIR_MIN_PX * pxUnit) {
        this.countedSum += d;
        this.counted = { x, y };
      }
    }
    this.travel = Math.max(this.travel, this.countedSum + dist(this.counted, x, y));
    const floor = nomW * FUELLER_FLOOR;
    const base = atLeast(nomW * nibFactorR(fueller.rundung, this.dir, nib) * pressureFactor(fueller.druck, ps), floor);
    this.base.push(base);
    this.ways.push(this.travel);
    return atLeast(base * taperFactor(fueller.schaerfe, this.travel, TAPER_LEN), floor);
  }

  /**
   * Wie viele Punkte am Anfang fest sind: Weitere Stiftpunkte ändern sie nicht mehr (die Glättung reicht nur K Punkte
   * zurück). Ohne Glättung sind alle Punkte fest.
   */
  settled(): number {
    const n = this.raw.length;
    return this.K ? Math.max(0, n - 1 - this.K) : n;
  }

  /** Die geglätteten Punkte, ohne Kopie. Nur lesen: Die Liste wächst mit jedem Punkt weiter. */
  points(): readonly Pt[] {
    return this.out;
  }

  /** Mittlere Breite, wie sie `stroke().w` hätte, ohne den Strich zu kopieren. */
  meanW(): number {
    const n = this.raw.length;
    return n ? this.sumW / n : this.nomW;
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
  // Füllfeder und Bleistift: Die Breite gilt an jeder Stelle einzeln, je Strecke die größere halbe Breite ihrer zwei Punkte.
  if (isShape(s.tool)) {
    if (q.length === 1) return (q[0].x - x) ** 2 + (q[0].y - y) ** 2 <= (r + q[0].w / 2) ** 2;
    for (let i = 1; i < q.length; i++) {
      const rr = r + Math.max(q[i - 1].w, q[i].w) / 2;
      if (segDist2(x, y, q[i - 1], q[i]) <= rr * rr) return true;
    }
    return false;
  }
  const rr = r + s.w / 2;
  if (q.length === 1) return (q[0].x - x) ** 2 + (q[0].y - y) ** 2 <= rr * rr;
  for (let i = 1; i < q.length; i++) if (segDist2(x, y, q[i - 1], q[i]) <= rr * rr) return true;
  return false;
}
