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
  STABIL_REACH,
  TAPER_LEN,
  doubled,
  nibFactorR,
  penAngle,
  pressureFactor,
  pressureRamp,
  stabilSigmaPx,
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
 * Ebenso glättet sie die Orte nach der Strecke statt nach der Zahl der Punkte (`smoothArc`), mit σ aus der
 * Strich-Stabilisierung in Bildschirmpunkten: Wie dicht die Punkte kommen, hängt am Tempo und am Zoom.
 * Beim Schreiben läuft der Anfang spitz zu, `finish()` gibt den fertigen Strich mit beiden spitzen Enden. Steht die erste
 * Richtung fest, rechnet sie die Punkte davor einmal nach, bis dahin ist bei ihr kein Punkt fest (`settled`).
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
  /** Halbe Fensterbreite der Glättung in Punkten, 0 heißt: nicht glätten. Die Füllfeder glättet nach der Strecke (`smoothArc`). */
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
  /** Der Richtungsanker: folgt dem Stift wie an einem Seil, die Richtung zeigt von ihm zum Stift (am Anfang der erste Rohpunkt). */
  private anchor: { x: number; y: number } | null = null;
  /** Richtung, in die der Stift zeigt, als doppelter Winkel, geglättet. `null` vor dem ersten Punkt. */
  private nib: Doubled | null = null;
  /**
   * Der gezählte Ort für den Weg (am Anfang der erste Rohpunkt), der dem Stift wie an einem Seil folgt, und der Weg, den
   * er dabei zurückgelegt hat. Bleibt dieser 0, kam der Stift nie weiter als das Seil vom Aufsetzpunkt weg: ein Tipp.
   */
  private counted: { x: number; y: number } | null = null;
  private countedSum = 0;
  /** Weg des letzten Rohpunkts ab dem Anfang, in Seiteneinheiten. */
  private travel = 0;
  /** Je Rohpunkt die Grundbreite (ohne Verjüngung) und der Weg ab dem Anfang. */
  private readonly base: number[] = [];
  private readonly ways: number[] = [];
  /** Geglätteter Druck und Stiftrichtung der Punkte, solange die erste Richtung fehlt: Mit ihr werden sie nachgerechnet. */
  private early: { ps: number; nib: Doubled }[] = [];
  /** σ der Glättung nach Strecke in Seiteneinheiten, 0 heißt: nicht glätten. */
  private readonly arcSigma: number;
  /** Je Rohpunkt die Strecke ab dem Anfang: die Summe der Abstände der Rohpunkte, in Seiteneinheiten. */
  private readonly arc: number[] = [];
  /** So viele Punkte am Anfang liegen mehr als 2,5 σ (Strecke) vor dem letzten: Ihr geglätteter Ort ändert sich nicht mehr. */
  private fixed = 0;

  /**
   * `minDist` ist der Mindestabstand zwischen zwei Rohpunkten in Seiteneinheiten (die App rechnet
   * 0.6 / Zoom, damit er auf dem Bildschirm gleich bleibt). `t` ist der Beginn des Strichs in Millisekunden.
   * `sigma` ist die Glättung in Punkten (`SMOOTHING`) und gilt nicht für die Füllfeder: Sie glättet nach der Strecke mit ihrer
   * Strich-Stabilisierung. Nur für die Füllfeder: `fueller` sind die Regler (ohne Angabe die Startwerte), `pxUnit` sind
   * Seiteneinheiten je Bildschirmpunkt (ohne Angabe aus `minDist`).
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
    const fueller = this.opts.pen === 'fueller';
    const sig = fueller ? 0 : o.sigma;
    this.K = sig > 0 ? Math.ceil(2.5 * sig) : 0;
    this.wts = sig > 0 ? Array.from({ length: this.K + 1 }, (_, j) => Math.exp(-(j * j) / (2 * sig * sig))) : [];
    // σ in Bildschirmpunkten, in Seiteneinheiten umgerechnet: So glättet sie auf dem Bildschirm gleich stark, wie weit auch gezoomt ist.
    const arcSigma = fueller ? stabilSigmaPx(this.opts.fueller.stabil) * this.opts.pxUnit : 0;
    this.arcSigma = arcSigma > 0 && Number.isFinite(arcSigma) ? arcSigma : 0;
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
    if (this.opts.pen === 'fueller') this.smoothArc();
    else this.smoothTail();
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
   * zu, bei einem Strich kürzer als zwei Verjüngungen je auf seiner halben Länge. Ein Tipp (der Stift kam nie weiter als
   * das Seil vom Aufsetzpunkt weg) bleibt ein runder Punkt, jeder Punkt in seiner Grundbreite. Die Orte sind dieselben wie
   * bei `stroke()`. Bei den anderen Stiften gleich `stroke()`.
   */
  finish(): Stroke {
    const s = this.stroke();
    const n = this.raw.length;
    if (this.opts.pen !== 'fueller' || !n) return s;
    const tap = !(this.countedSum > 0);
    const { schaerfe } = this.opts.fueller;
    const floor = this.nomW * FUELLER_FLOOR;
    const total = this.ways[n - 1];
    const len = Math.min(TAPER_LEN, total / 2);
    let sum = 0;
    const pts = s.pts.map((p, i) => {
      const way = this.ways[i];
      const w = tap ? this.base[i] : atLeast(this.base[i] * taperFactor(schaerfe, way, len) * taperFactor(schaerfe, total - way, len), floor);
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
    const { pxUnit } = this.opts;
    // Druck: der erste direkt, danach über den Weg zum vorigen Rohpunkt geglättet.
    const ps = (this.ps = this.ps === null || !last ? pv : this.ps + (pv - this.ps) * (1 - Math.exp(-dist(last, x, y) / PRESS_LEN)));
    // Richtung, in die der Stift zeigt: je Punkt gemischt und auf Länge 1 gebracht.
    const now = doubled(penAngle(tiltX, tiltY) ?? DEFAULT_PEN_ANGLE);
    this.nib = this.nib ? mix(this.nib, now) : now;
    const nibLen = Math.hypot(this.nib.c, this.nib.s);
    const nib = nibLen > 0 ? { c: this.nib.c / nibLen, s: this.nib.s / nibLen } : now; // Länge 0: zwei Neigungen genau gegenüber
    // Richtung des Strichs am Seil: Der Anker folgt dem Stift im Abstand `dirRope` (0,5 mm und einige Bildschirmpunkte). Ist
    // das Seil straff, zeigt die Richtung vom Anker zum Punkt, und der Anker wird auf dieser Linie nachgezogen, bis er genau
    // `dirRope` vom Punkt weg ist. Geglättet wird über den Weg des Ankers: So dreht die Richtung mit jedem Punkt ein wenig,
    // nicht in Stufen. Ist das Seil locker, bleibt alles. Zittern im Stand zieht den Anker höchstens um die Breite des
    // Zitterns nach, danach ist das Seil locker. Mit der ersten Richtung bekommen auch die Punkte davor ihren Federfaktor.
    const dirRope = Math.max(DIR_MIN, DIR_MIN_PX * pxUnit);
    if (!this.anchor) this.anchor = { x, y };
    else {
      const d = dist(this.anchor, x, y);
      if (d >= dirRope) {
        const u = doubled(Math.atan2(y - this.anchor.y, x - this.anchor.x));
        const moved = d - dirRope; // so weit wird der Anker nachgezogen
        if (this.dir) {
          const k = 1 - Math.exp(-moved / DIR_LEN);
          this.dir = { c: this.dir.c + (u.c - this.dir.c) * k, s: this.dir.s + (u.s - this.dir.s) * k };
        } else {
          this.dir = u;
          this.backfill(u);
        }
        const f = moved / d;
        this.anchor = { x: this.anchor.x + (x - this.anchor.x) * f, y: this.anchor.y + (y - this.anchor.y) * f };
      }
    }
    // Weg wie an einem Seil: Ist der Rohpunkt weiter als das Seil (einige Bildschirmpunkte) vom gezählten Ort weg, rückt der
    // Ort nur bis auf die Länge des Seils an ihn heran, und nur dieses Stück zählt. So zählt Zittern im Stand nicht, auch wenn
    // es breiter ist als das Seil lang. Weg = gezählter Weg + Abstand zum gezählten Ort, er nimmt nie ab.
    const rope = DIR_MIN_PX * pxUnit;
    if (!this.counted) this.counted = { x, y };
    else {
      const d = dist(this.counted, x, y);
      if (d > rope) {
        const k = (d - rope) / d;
        this.countedSum += d - rope;
        this.counted = { x: this.counted.x + (x - this.counted.x) * k, y: this.counted.y + (y - this.counted.y) * k };
      }
    }
    this.travel = Math.max(this.travel, this.countedSum + dist(this.counted, x, y));
    const base = this.baseWidth(this.dir, nib, ps);
    if (!this.dir) this.early.push({ ps, nib });
    this.base.push(base);
    this.ways.push(this.travel);
    return this.startWidth(base, this.travel);
  }

  /** Grundbreite der Füllfeder: Nennbreite × Federfaktor × Druckfaktor, nie unter dem Boden. */
  private baseWidth(dir: Doubled | null, nib: Doubled, ps: number): number {
    const { rundung, druck } = this.opts.fueller;
    return atLeast(this.nomW * nibFactorR(rundung, dir, nib) * pressureFactor(druck, ps), this.nomW * FUELLER_FLOOR);
  }

  /** Breite der Füllfeder beim Schreiben: Grundbreite mit der Verjüngung am Anfang, nie unter dem Boden. */
  private startWidth(base: number, way: number): number {
    return atLeast(base * taperFactor(this.opts.fueller.schaerfe, way, TAPER_LEN), this.nomW * FUELLER_FLOOR);
  }

  /**
   * Die erste Richtung steht fest: Die Punkte davor, bisher mit Federfaktor 1, bekommen den Federfaktor dieser Richtung, jeder
   * mit seinem eigenen Druck und seiner eigenen Stiftrichtung. Sonst wüchse die Breite bis hierher wie bei einer runden
   * Feder und spränge dann. Neue Punkte statt geänderter: Ein Strich, den `stroke()` vorher gab, bleibt, wie er war.
   */
  private backfill(first: Doubled): void {
    this.early.forEach(({ ps, nib }, i) => {
      const base = this.baseWidth(first, nib, ps);
      const w = this.startWidth(base, this.ways[i]);
      const r = this.raw[i];
      const o = this.out[i];
      this.base[i] = base;
      this.sumW += w - r.w;
      this.raw[i] = { x: r.x, y: r.y, w };
      this.out[i] = { x: o.x, y: o.y, w };
    });
    this.early = [];
  }

  /**
   * Wie viele Punkte am Anfang fest sind: Weitere Stiftpunkte ändern sie nicht mehr (die Glättung reicht nur K Punkte
   * zurück). Ohne Glättung sind alle Punkte fest. Bei der Füllfeder sind es die Punkte mehr als 2,5 σ (Strecke) vor dem
   * letzten, aber keiner, bis die erste Richtung feststeht: Mit ihr ändert sich noch die Breite der Punkte davor.
   */
  settled(): number {
    if (this.opts.pen === 'fueller') return this.dir ? this.fixed : 0;
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
   * Glättung der Orte der Füllfeder nach der Strecke: Jeder Punkt ist das Mittel der Punkte, deren Strecke höchstens `r` von
   * seiner abliegt, gewichtet mit exp(−d² / 2σ²), `d` der Unterschied der Strecke. `r` ist 2,5 σ und wird zu den Enden hin
   * kleiner, zu beiden Seiten gleich weit: Anfang, Ende und Stiftspitze bleiben genau dort, wo der Stift war. So glättet sie
   * gleich stark, ob der Stift seine Punkte dicht (langsam) oder weit auseinander (schnell) schickt. Die Breite bleibt die des
   * Rohpunkts. Ein neuer Punkt ändert nur Punkte, die noch nicht fest sind (`fixed`): Die Punkte davor liegen mehr als 2,5 σ
   * vor dem vorigen letzten Punkt, ihr Fenster hängt nicht mehr am Ende und reicht nicht bis zum neuen Punkt.
   */
  private smoothArc(): void {
    const { raw, out, arc } = this;
    const n = raw.length;
    const p = raw[n - 1];
    const end = n > 1 ? arc[n - 2] + dist(raw[n - 2], p.x, p.y) : 0;
    arc.push(end);
    const sigma = this.arcSigma;
    if (!sigma) {
      out[n - 1] = p;
      this.fixed = n;
      return;
    }
    const reach = STABIL_REACH * sigma;
    const k = 1 / (2 * sigma * sigma);
    for (let i = this.fixed; i < n; i++) {
      const s = arc[i];
      const r = Math.min(reach, s, end - s);
      let lo = i;
      while (lo > 0 && s - arc[lo - 1] <= r) lo--;
      let hi = i;
      while (hi < n - 1 && arc[hi + 1] - s <= r) hi++;
      let sx = 0;
      let sy = 0;
      let sw = 0;
      for (let j = lo; j <= hi; j++) {
        const d = arc[j] - s;
        const w = Math.exp(-d * d * k);
        sx += w * raw[j].x;
        sy += w * raw[j].y;
        sw += w;
      }
      out[i] = { x: sx / sw, y: sy / sw, w: raw[i].w };
    }
    while (this.fixed < n && end - arc[this.fixed] > reach) this.fixed++;
  }

  /**
   * Glättung von Kugelschreiber, Fineliner und Bleistift nach der Zahl der Punkte. Das Fenster wird zu den Enden hin kleiner:
   * Anfang, Ende und Stiftspitze bleiben genau dort, wo der Stift war. Ein neuer Punkt ändert nur die letzten K + 1 Punkte,
   * weiter vorn reicht das Fenster nicht bis zu ihm.
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
