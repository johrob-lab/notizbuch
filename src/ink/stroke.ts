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
  SPEED_TAU_MS,
  STABIL_REACH,
  START_WAIT,
  TAPER_LEN,
  TAPER_SLOW,
  doubled,
  nibFactorR,
  penAngle,
  pressureFactor,
  pressureRamp,
  speedBlend,
  speedFactor,
  stabilSigmaPx,
  taperFactor,
  taperScale,
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
 * Was keine endliche Zahl ist, wird `0`, damit die Datei lesbar bleibt. Orte schreibt `fmtCoord`.
 */
export function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  // Math.round und String statt toFixed: `(-0.04).toFixed(1)` wäre "-0.0", String(-0) ist "0".
  return String(Math.round(n * 10) / 10);
}

/**
 * `n` auf zwei Nachkommastellen gerundet, als Zahl: genau die Zahl, die aus `fmtCoord(n)` wieder gelesen wird. Nie `-0`, was keine
 * endliche Zahl ist, wird 0.
 */
export function toHundredths(n: number): number {
  // `+ 0` macht aus -0 eine 0, so wie `String(-0)` "0" ist. Jede andere Zahl liest sich aus ihrem `String` genau so zurück.
  return Number.isFinite(n) ? Math.round(n * 100) / 100 + 0 : 0;
}

/**
 * Ort für die SVG-Datei (x und y eines Punkts, jede Zahl eines Pfads): auf zwei Nachkommastellen gerundet, ohne Nullen am Ende
 * und nie als `-0`. Gezoomt geschriebene Punkte liegen nur etwa 0,1 Einheiten auseinander: Auf eine Nachkommastelle gerundet
 * sprängen ihre Richtungen in Stufen von 45 Grad, und der Umriss der Füllfeder zerfranste. Was keine endliche Zahl ist, wird `0`.
 */
export function fmtCoord(n: number): string {
  return String(toHundredths(n));
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
 * Beim Schreiben läuft der Anfang spitz zu, `finish()` gibt den fertigen Strich mit beiden spitzen Enden. Steht der Anfang fest
 * (erste Richtung und Tempo beim Ansetzen), rechnet sie die Punkte davor einmal nach, bis dahin ist bei ihr kein Punkt fest
 * (`settled`).
 * Mit den Zeiten der Stiftpunkte misst die Füllfeder das Tempo wie Tinte: Schnelle Striche werden schmaler, und jedes Ende läuft
 * so lang spitz aus, wie es das Tempo dort verlangt (schnell lang, langsam kurz). Ohne Zeiten wirkt das Tempo nicht. Die Längen
 * der Spitzen zählen wie σ und das Tempo auf dem Glas (in Bildschirmpunkten).
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
  /**
   * Geglätteter Druck, Stiftrichtung, Tempofaktor und Strichrichtung (`null` vor der ersten) der Punkte, solange der Anfang nicht
   * feststeht: Mit ihm werden sie nachgerechnet.
   */
  private early: { ps: number; nib: Doubled; sf: number; dir: Doubled | null }[] = [];
  /** Die erste Richtung des Strichs: Die Punkte davor bekommen ihren Federfaktor. */
  private firstDir: Doubled | null = null;
  /** Alle Stiftpunkte bisher kamen mit einer Zeit. Ohne Zeiten, oder ab einem Punkt ohne Zeit, wirkt das Tempo nicht. */
  private timed = true;
  /** Ab dieser Zeit (ms) wird das Tempo beim Ansetzen gemessen: die des ersten Stiftpunkts, oder die, zu der die Zeit zurücksprang. */
  private t0 = 0;
  /** Zeit des letzten Stiftpunkts, dessen Zeit gezählt hat, und die Strecke ab `t0` bis zu ihm (Seiteneinheiten). */
  private tick = { t: 0, s: 0 };
  /** Strecke seit `tick`, die auf eine spätere Zeit wartet: Schritte mit derselben Zeit wie `tick`. */
  private pending = 0;
  /** Geglättetes Tempo in Bildschirmpunkten je ms: am Anfang 0, ab dem Festlegen des Anfangs zuerst das Tempo beim Ansetzen. */
  private vs = 0;
  /** Der letzte Stiftpunkt, behalten oder verworfen: Von ihm aus misst der nächste seinen Schritt für das Tempo. */
  private seen: { x: number; y: number } | null = null;
  /** Zeit des letzten Stiftpunkts mit Zeit (ms): Von ihr an klingt das Tempo bis zum Abheben ab (`finish`). */
  private lastT = Number.NaN;
  /**
   * Länge der Verjüngung am Anfang (Seiteneinheiten), fest, sobald der Anfang feststeht: die erste Richtung und ein Zeitschritt,
   * der zählt (ohne Zeiten nur die erste Richtung). Davor `null`: Es gilt eine vorläufige Länge.
   */
  private startLen: number | null = null;
  /** Länge einer Verjüngung ohne Tempo in Seiteneinheiten: `TAPER_LEN` Bildschirmpunkte. */
  private readonly taperLen: number;
  /** Weg des Richtungsankers (Seiteneinheiten), über den die Richtung geglättet wird: `DIR_LEN`, bei stärkerer Stabilisierung σ. */
  private readonly dirLen: number;
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
    const isFueller = this.opts.pen === 'fueller';
    const sig = isFueller ? 0 : o.sigma;
    this.K = sig > 0 ? Math.ceil(2.5 * sig) : 0;
    this.wts = sig > 0 ? Array.from({ length: this.K + 1 }, (_, j) => Math.exp(-(j * j) / (2 * sig * sig))) : [];
    // σ in Bildschirmpunkten, in Seiteneinheiten umgerechnet: So glättet sie auf dem Bildschirm gleich stark, wie weit auch gezoomt ist.
    const arcSigma = isFueller ? stabilSigmaPx(this.opts.fueller.stabil) * this.opts.pxUnit : 0;
    this.arcSigma = arcSigma > 0 && Number.isFinite(arcSigma) ? arcSigma : 0;
    this.dirLen = Math.max(DIR_LEN, this.arcSigma);
    // Das Tempo und die Längen der Spitzen zählen in Bildschirmpunkten: Ohne brauchbare Umrechnung wirkt das Tempo nicht, und
    // die Spitzen sind `TAPER_LEN` Seiteneinheiten lang.
    const { pxUnit } = this.opts;
    const usable = pxUnit > 0 && Number.isFinite(pxUnit);
    if (!usable) this.timed = false;
    this.taperLen = TAPER_LEN * (usable ? pxUnit : 1);
  }

  /**
   * Nimmt einen Stiftpunkt auf (Seiteneinheiten, Druck 0 bis 1). `false`, wenn der Punkt dem letzten behaltenen
   * Punkt zu nah ist und deshalb verworfen wurde. Ohne Druckwert (0 oder keine Zahl) gilt 0.5. `tiltX` und `tiltY`
   * (Neigung des Stifts) braucht nur die Füllfeder; ohne Neigung gilt die Haltung eines Rechtshänders. Ebenso `t`, die Zeit
   * des Stiftpunkts in ms (`timeStamp` des Ereignisses): Daraus misst die Füllfeder das Tempo, auch mit einem verworfenen Punkt
   * (er fügt keinen Punkt hinzu). Ohne Zeit wirkt das Tempo nicht.
   */
  add(x: number, y: number, pressure: number, tiltX = 0, tiltY = 0, t?: number): boolean {
    const raw = this.raw;
    const last = raw[raw.length - 1];
    if (last) {
      const dx = x - last.x;
      const dy = y - last.y;
      const min = this.opts.minDist;
      if (dx * dx + dy * dy < min * min) {
        if (this.opts.pen === 'fueller') this.trackDropped(x, y, t);
        return false;
      }
    }
    const pv = pressure > 0 ? pressure : 0.5;
    const pt: Pt = { x, y, w: this.opts.pen === 'fueller' ? this.fuellerAt(x, y, last, pv, tiltX, tiltY, t) : this.widthAt(pv) };
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
   * zu, jedes so lang, wie es das Tempo dort verlangt (am Anfang beim Ansetzen, am Ende beim Abheben). Ist der Strich kürzer
   * als beide Spitzen zusammen, wirken sie beide zugleich (ihr Produkt), nie unter dem Boden: So wird kein Punkt breiter als
   * beim Schreiben, und ein kurzer schneller Schwung bleibt fein. `tUp` ist die Zeit des Abhebens (ms, `timeStamp` des
   * `pointerup`): Seit dem letzten Stiftpunkt klingt das Tempo bis dahin ab, ein Stift, der vor dem Abheben ruhte, endet
   * also kurz. Ein Tipp (der Stift kam nie weiter als das Seil vom Aufsetzpunkt weg) bleibt ein runder Punkt, jeder Punkt
   * in seiner Grundbreite. Die Orte sind dieselben wie bei `stroke()`. Bei den anderen Stiften gleich `stroke()`.
   */
  finish(tUp?: number): Stroke {
    const s = this.stroke();
    const n = this.raw.length;
    if (this.opts.pen !== 'fueller' || !n) return s;
    const tap = !(this.countedSum > 0);
    const { schaerfe } = this.opts.fueller;
    const floor = this.nomW * FUELLER_FLOOR;
    const total = this.ways[n - 1];
    const startLen = this.startTaper();
    const endLen = this.endTaper(tUp);
    let sum = 0;
    const pts = s.pts.map((p, i) => {
      const way = this.ways[i];
      const tapered = this.base[i] * taperFactor(schaerfe, way, startLen) * taperFactor(schaerfe, total - way, endLen);
      const w = tap ? this.base[i] : atLeast(tapered, floor);
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
   * Breite der Füllfeder am neuen Rohpunkt, mit der Verjüngung am Anfang. `last` ist der vorige Rohpunkt, `pv` der Druck,
   * `t` die Zeit. Druck und Richtung werden über den Weg geglättet, nicht je Punkt: Steht der Stift und zittert, ändert sich
   * die Breite nicht, auch wenn er viele Punkte schickt. Das Tempo wird über die Zeit geglättet (`trackSpeed`). Merkt sich je
   * Punkt Grundbreite und Weg für `finish()`.
   */
  private fuellerAt(x: number, y: number, last: Pt | undefined, pv: number, tiltX: number, tiltY: number, t: number | undefined): number {
    const { pxUnit } = this.opts;
    const step = last ? dist(last, x, y) : 0;
    // Druck: der erste direkt, danach über den Weg zum vorigen Rohpunkt geglättet.
    const ps = (this.ps = this.ps === null || !last ? pv : this.ps + (pv - this.ps) * (1 - Math.exp(-step / PRESS_LEN)));
    // Tempo vor der Richtung: Steht mit diesem Punkt der Anfang fest, zählt er zum Tempo beim Ansetzen.
    this.trackSpeed(x, y, t);
    // Richtung, in die der Stift zeigt: je Punkt gemischt und auf Länge 1 gebracht.
    const now = doubled(penAngle(tiltX, tiltY) ?? DEFAULT_PEN_ANGLE);
    this.nib = this.nib ? mix(this.nib, now) : now;
    const nibLen = Math.hypot(this.nib.c, this.nib.s);
    const nib = nibLen > 0 ? { c: this.nib.c / nibLen, s: this.nib.s / nibLen } : now; // Länge 0: zwei Neigungen genau gegenüber
    // Richtung des Strichs am Seil: Der Anker folgt dem Stift im Abstand `dirRope` (0,5 mm und einige Bildschirmpunkte). Ist
    // das Seil straff, zeigt die Richtung vom Anker zum Punkt, und der Anker wird auf dieser Linie nachgezogen, bis er genau
    // `dirRope` vom Punkt weg ist. Geglättet wird über den Weg des Ankers (`dirLen`, bei starker Stabilisierung länger): So dreht
    // die Richtung mit jedem Punkt ein wenig, nicht in Stufen. Ist das Seil locker, bleibt alles. Zittern im Stand zieht den
    // Anker höchstens um die Breite des Zitterns nach, danach ist das Seil locker. Mit der ersten Richtung bekommen die Punkte
    // davor deren Federfaktor, sonst wüchse die Breite bis hierher wie bei einer runden Feder und spränge dann.
    const dirRope = Math.max(DIR_MIN, DIR_MIN_PX * pxUnit);
    let firstNow = false;
    if (!this.anchor) this.anchor = { x, y };
    else {
      const d = dist(this.anchor, x, y);
      if (d >= dirRope) {
        const u = doubled(Math.atan2(y - this.anchor.y, x - this.anchor.x));
        const moved = d - dirRope; // so weit wird der Anker nachgezogen
        if (this.dir) {
          const k = 1 - Math.exp(-moved / this.dirLen);
          this.dir = { c: this.dir.c + (u.c - this.dir.c) * k, s: this.dir.s + (u.s - this.dir.s) * k };
        } else {
          this.dir = this.firstDir = u;
          firstNow = true;
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
    // Steht jetzt der Anfang fest, beginnt das Tempo mit dem beim Ansetzen, und die Punkte davor werden nachgerechnet. Sonst
    // bekommen sie mit der ersten Richtung wenigstens deren Federfaktor.
    if (this.startLen === null && this.startReady()) this.startNow();
    else if (firstNow) this.redoEarly();
    const sf = this.speedNow();
    const base = this.baseWidth(this.dir, nib, ps, sf);
    if (this.startLen === null) this.early.push({ ps, nib, sf, dir: this.dir });
    this.base.push(base);
    this.ways.push(this.travel);
    return this.startWidth(base, this.travel);
  }

  /**
   * Misst das Tempo mit einem Stiftpunkt an der Stelle (`x`, `y`) zur Zeit `t`, ob er behalten oder verworfen wird. Sein Schritt
   * ist der Abstand zum vorigen Stiftpunkt, auch wenn der verworfen wurde: So zählt die Strecke, die der Stift zurücklegt, und
   * ruht er, sinkt das Tempo. Ein Schritt zählt, wenn seine Zeit nach der des letzten gezählten liegt (`tick`): Das Tempo ist dann
   * die Strecke seitdem in Bildschirmpunkten durch die Zeit seitdem, und das geglättete Tempo folgt ihm mit
   * 1 − exp(−Δt / `SPEED_TAU_MS`). Ein Schritt mit derselben Zeit (zusammengefasste Ereignisse, die sich eine Zeit teilen) ändert
   * das Tempo nicht, seine Strecke zählt beim nächsten Schritt mit. Springt die Zeit zurück, zählt der Schritt ebenso wenig, und
   * ab ihm wird neu gemessen, auch das Tempo beim Ansetzen. So gibt es weder NaN noch ein unendliches Tempo. Ein Punkt ohne Zeit
   * beendet den Einfluss des Tempos für den Rest des Strichs.
   */
  private trackSpeed(x: number, y: number, t: number | undefined): void {
    const prev = this.seen;
    this.seen = { x, y };
    if (t === undefined || !Number.isFinite(t)) {
      this.timed = false;
      return;
    }
    if (!this.timed) return;
    this.lastT = t;
    if (!prev) {
      this.t0 = t;
      this.tick = { t, s: 0 };
      return;
    }
    this.pending += dist(prev, x, y);
    const dt = t - this.tick.t;
    const v = this.pending / this.opts.pxUnit / dt;
    // Ein Schritt mit späterer Zeit zählt. Bei derselben Zeit (oder einem Tempo, das keine endliche Zahl ist) wartet die Strecke
    // auf eine spätere Zeit.
    if (dt > 0 && Number.isFinite(v)) {
      this.vs += (v - this.vs) * (1 - Math.exp(-dt / SPEED_TAU_MS));
      this.tick = { t, s: this.tick.s + this.pending };
      this.pending = 0;
    } else if (dt < 0) {
      // Die Zeit springt zurück: Ab hier wird neu gemessen, auch das Tempo beim Ansetzen (Zeit und Strecke ab hier).
      this.t0 = t;
      this.tick = { t, s: 0 };
      this.pending = 0;
    }
  }

  /** Ein verworfener Stiftpunkt der Füllfeder: Er fügt keinen Punkt hinzu, zählt aber zum Tempo, und mit ihm kann der Anfang feststehen. */
  private trackDropped(x: number, y: number, t: number | undefined): void {
    this.trackSpeed(x, y, t);
    if (this.startLen === null && this.startReady()) this.startNow();
  }

  /** Tempofaktor der Breite für den nächsten Punkt aus dem geglätteten Tempo. Ohne Zeiten 1. */
  private speedNow(): number {
    return this.timed ? speedFactor(speedBlend(this.vs)) : 1;
  }

  /**
   * Kann der Anfang festgelegt werden? Dazu braucht es die erste Richtung und, mit Zeiten, einen Zeitschritt, der zählt (eine Zeit
   * nach `t0`). Kommt keiner, bis der gezählte Weg oder die Strecke der Rohpunkte `START_WAIT` × `TAPER_LEN` Bildschirmpunkte lang
   * ist, sind wohl alle Zeiten gleich: Dann wird nicht länger gewartet, der Anfang gilt als langsam. Die Strecke zählt mit, damit auch
   * ein Stift, der nach der ersten Richtung ruht und zittert, nicht endlos offene Punkte sammelt.
   */
  private startReady(): boolean {
    if (!this.dir) return false;
    const way = Math.max(this.travel, this.arc[this.arc.length - 1] ?? 0);
    return !this.timed || this.tick.t > this.t0 || way >= START_WAIT * this.taperLen;
  }

  /** Tempo beim Ansetzen (Bildschirmpunkte je ms): die gezählte Strecke ab `t0` durch die Zeit seitdem. Ohne gezählte Zeit 0, langsam. */
  private startSpeed(): number {
    const dt = this.tick.t - this.t0;
    return dt > 0 ? this.tick.s / this.opts.pxUnit / dt : 0;
  }

  /**
   * Der Anfang steht fest: Die Länge der Verjüngung am Anfang kommt aus dem Tempo beim Ansetzen, und das geglättete Tempo beginnt
   * mit ihm statt mit 0. Die Punkte davor bekommen seinen Tempofaktor: So beginnt ein schneller Strich gleich schmal und läuft lang
   * spitz an, statt nach einer kurzen Spitze satt wie eine Keule zu werden. Ohne Zeiten `TAPER_LEN` Bildschirmpunkte und der
   * Tempofaktor 1.
   */
  private startNow(): void {
    let sf = 1;
    if (this.timed) {
      const v = this.startSpeed();
      if (Number.isFinite(v)) this.vs = v;
      const q = speedBlend(v);
      sf = speedFactor(q);
      this.startLen = this.taperLen * taperScale(q);
    } else this.startLen = this.taperLen;
    this.redoEarly(sf);
    this.early = [];
  }

  /**
   * Länge der Verjüngung am Anfang (Seiteneinheiten): sobald der Anfang feststeht die aus dem Tempo beim Ansetzen, davor vorläufig
   * die für langsam. Ohne Zeiten `TAPER_LEN` Bildschirmpunkte.
   */
  private startTaper(): number {
    return this.startLen ?? this.taperLen * (this.timed ? TAPER_SLOW : 1);
  }

  /**
   * Länge der Verjüngung am Ende (Seiteneinheiten) aus dem geglätteten Tempo am letzten Stiftpunkt. Mit der Zeit des Abhebens `tUp`
   * klingt es bis dahin ab (× exp(−Δt / `SPEED_TAU_MS`)): Ein Stift, der vor dem Abheben stehen blieb, endet kurz, auch wenn er
   * dabei keine Punkte mehr schickte. Ohne Zeiten `TAPER_LEN` Bildschirmpunkte.
   */
  private endTaper(tUp: number | undefined): number {
    if (!this.timed) return this.taperLen;
    const rest = tUp === undefined ? 0 : tUp - this.lastT;
    const vs = rest > 0 ? this.vs * Math.exp(-rest / SPEED_TAU_MS) : this.vs;
    return this.taperLen * taperScale(speedBlend(vs));
  }

  /** Grundbreite der Füllfeder: Nennbreite × Federfaktor × Druckfaktor × Tempofaktor `sf`, nie unter dem Boden. */
  private baseWidth(dir: Doubled | null, nib: Doubled, ps: number, sf: number): number {
    const { rundung, druck } = this.opts.fueller;
    return atLeast(this.nomW * nibFactorR(rundung, dir, nib) * pressureFactor(druck, ps) * sf, this.nomW * FUELLER_FLOOR);
  }

  /** Breite der Füllfeder beim Schreiben: Grundbreite mit der Verjüngung am Anfang (`startTaper`), nie unter dem Boden. */
  private startWidth(base: number, way: number): number {
    return atLeast(base * taperFactor(this.opts.fueller.schaerfe, way, this.startTaper()), this.nomW * FUELLER_FLOOR);
  }

  /**
   * Rechnet die Punkte nach, solange der Anfang nicht feststeht (`early`): jeder mit dem Federfaktor seiner Richtung (vor der
   * ersten Richtung mit deren Faktor statt 1), seinem eigenen Druck und seiner eigenen Stiftrichtung, mit dem Tempofaktor `sf`
   * (ohne Angabe seinem eigenen) und der Verjüngung am Anfang (`startTaper`). Neue Punkte statt geänderter: Ein Strich, den
   * `stroke()` vorher gab, bleibt, wie er war. Roh- und geglättete Liste ändern sich gemeinsam: `smoothArc` übernimmt die Breite
   * des Rohpunkts.
   */
  private redoEarly(sf?: number): void {
    this.early.forEach((e, i) => {
      const base = this.baseWidth(e.dir ?? this.firstDir, e.nib, e.ps, sf ?? e.sf);
      const w = this.startWidth(base, this.ways[i]);
      const r = this.raw[i];
      const o = this.out[i];
      this.base[i] = base;
      this.sumW += w - r.w;
      this.raw[i] = { x: r.x, y: r.y, w };
      this.out[i] = { x: o.x, y: o.y, w };
    });
  }

  /**
   * Wie viele Punkte am Anfang fest sind: Weitere Stiftpunkte ändern sie nicht mehr (die Glättung reicht nur K Punkte
   * zurück). Ohne Glättung sind alle Punkte fest. Bei der Füllfeder sind es die Punkte mehr als 2,5 σ (Strecke) vor dem
   * letzten, aber keiner, bis der Anfang feststeht (die erste Richtung und, mit Zeiten, das Tempo beim Ansetzen): Bis dahin
   * ändert sich die Breite der Punkte noch (Federfaktor, Tempofaktor und Länge der Verjüngung am Anfang).
   */
  settled(): number {
    if (this.opts.pen === 'fueller') return this.startLen !== null ? this.fixed : 0;
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
 * Alle Zahlen mit zwei Nachkommastellen (`fmtCoord`).
 */
export function pathD(pts: { x: number; y: number }[]): string {
  const n = pts.length;
  if (n === 0) return '';
  const parts = [`M ${fmtCoord(pts[0].x)} ${fmtCoord(pts[0].y)}`];
  for (let i = 1; i < n - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    parts.push(`Q ${fmtCoord(a.x)} ${fmtCoord(a.y)} ${fmtCoord((a.x + b.x) / 2)} ${fmtCoord((a.y + b.y) / 2)}`);
  }
  const last = pts[n - 1];
  parts.push(`L ${fmtCoord(last.x)} ${fmtCoord(last.y)}`);
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
