import { PAGE_H, PAGE_W } from '../ink/types';

// Das Bild der Seite für Claude: ein PNG in genau der Größe, die Claude ohne Verkleinern liest. Jeder Fehler gibt
// `null` statt zu werfen, das Fenster schickt dann die Frage ohne Bild und sagt das dazu.

/** Was Claude ohne Verkleinern liest: längste Kante und Bild-Token (je 28 × 28 Pixel ein Token). */
export const IMAGE_LIMIT = { longEdge: 2576, tokens: 4784 };

const TOKEN_PX = 28;

/**
 * Die größte Größe im Seitenverhältnis von `w` × `h`, die den Rand und die Token einhält. Sie geht von der größten
 * Breite abwärts (die Höhe ist `Math.round(width * h / w)`) und nimmt die erste, die passt.
 */
export function imageSize(w: number, h: number, limit: { longEdge: number; tokens: number } = IMAGE_LIMIT): { w: number; h: number } {
  for (let width = limit.longEdge; width >= 1; width--) {
    const height = Math.max(1, Math.round((width * h) / w));
    if (Math.max(width, height) > limit.longEdge) continue;
    if (Math.ceil(width / TOKEN_PX) * Math.ceil(height / TOKEN_PX) <= limit.tokens) return { w: width, h: height };
  }
  return { w: 1, h: 1 };
}

/** Setzt `width` und `height` nur am äußeren `<svg>`-Tag. Vorhandene Werte werden ersetzt, fehlende angehängt. */
export function sizedSvg(svg: string, size: { w: number; h: number }): string {
  const match = /<svg\b[^>]*>/.exec(svg);
  if (!match) return svg;
  let tag = match[0];
  const set = (name: 'width' | 'height', value: number): void => {
    const own = new RegExp(`(\\s)${name}="[^"]*"`);
    if (own.test(tag)) tag = tag.replace(own, `$1${name}="${value}"`);
    else tag = tag.replace(/\s*(\/?)>$/, ` ${name}="${value}"$1>`);
  };
  set('width', size.w);
  set('height', size.h);
  return svg.slice(0, match.index) + tag + svg.slice(match.index + match[0].length);
}

/** Wartet, bis das Bild fertig dekodiert ist (`decode`, sonst `onload`), `false` bei Fehler. `src` setzt erst, wer danach aufruft. */
function loaded(img: HTMLImageElement, src: string): Promise<boolean> {
  if (typeof img.decode === 'function') {
    img.src = src;
    return img.decode().then(
      () => true,
      () => false,
    );
  }
  return new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
    img.src = src;
  });
}

/** Die Seite als PNG, Base64 ohne `data:`-Präfix. `null` heißt: kein Bild (Fehler oder Zeitgrenze). */
export async function pageImage(svg: string, timeoutMs = 8000): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const size = imageSize(PAGE_W, PAGE_H);
    const img = new Image();
    const done = loaded(img, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sizedSvg(svg, size))}`);
    const timeout = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    });
    if (!(await Promise.race([done, timeout]))) {
      // Nach der Zeitgrenze (oder dem Fehler) soll nichts weiterladen.
      img.src = '';
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = size.w;
    canvas.height = size.h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    // Weiß unterlegen, damit durchsichtige Stellen nicht schwarz werden.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, size.w, size.h);
    ctx.drawImage(img, 0, 0, size.w, size.h);
    const url = canvas.toDataURL('image/png');
    const prefix = 'data:image/png;base64,';
    return url.startsWith(prefix) && url.length > prefix.length ? url.slice(prefix.length) : null;
  } catch {
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
