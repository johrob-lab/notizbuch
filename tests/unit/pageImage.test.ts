import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageSize, pageImage, sizedSvg } from '../../src/ki/pageImage';

describe('Bild der Seite', () => {
  it('a page becomes as large as Claude reads it without shrinking', () => {
    const sizes = [
      { in: imageSize(1192, 1590), out: { w: 1658, h: 2212 } },
      { in: imageSize(1000, 1000), out: { w: 1932, h: 1932 } },
      { in: imageSize(4000, 100), out: { w: 2576, h: 64 } },
    ];
    for (const s of sizes) {
      expect(s.in).toEqual(s.out);
      expect(Math.ceil(s.in.w / 28) * Math.ceil(s.in.h / 28)).toBeLessThanOrEqual(4784);
      expect(Math.max(s.in.w, s.in.h)).toBeLessThanOrEqual(2576);
    }
  });

  it('only the outer svg gets the new size', () => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1192 1590" width="1192" height="1590" data-seite="tag"><rect width="10" height="20"/></svg>';
    const out = sizedSvg(svg, { w: 1658, h: 2212 });
    const tag = out.slice(0, out.indexOf('>') + 1);
    expect(tag).toContain('width="1658"');
    expect(tag).toContain('height="2212"');
    expect(tag).toContain('viewBox="0 0 1192 1590"');
    expect(out).toContain('<rect width="10" height="20"/>');
    const bare = sizedSvg('<svg xmlns="http://www.w3.org/2000/svg"><g/></svg>', { w: 5, h: 7 });
    const bareTag = bare.slice(0, bare.indexOf('>') + 1);
    expect(bareTag).toContain('width="5"');
    expect(bareTag).toContain('height="7"');
  });

  it('without a canvas the picture is null, not an error', async () => {
    await expect(pageImage('<svg xmlns="http://www.w3.org/2000/svg"/>', 50)).resolves.toBeNull();
  });

  describe('jeder Weg ohne Bild', () => {
    const SVG = '<svg xmlns="http://www.w3.org/2000/svg"/>';
    const PNG = 'data:image/png;base64,QUJD';

    /** Ein Bild, das sich so verhält, wie der Test es sagt: `laedt`, `fehler` oder `nie`. Mit `decode` gibt es auch die Methode. */
    function stubImage(mode: 'laedt' | 'fehler' | 'nie', decode?: () => Promise<void>) {
      const made: { src: string; onload: (() => void) | null; onerror: (() => void) | null }[] = [];
      class FakeImage {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        private source = '';
        constructor() {
          made.push(this);
          if (decode) (this as unknown as { decode: () => Promise<void> }).decode = decode;
        }
        get src() {
          return this.source;
        }
        set src(value: string) {
          this.source = value;
          if (value === '') return;
          if (mode === 'laedt') queueMicrotask(() => this.onload?.());
          if (mode === 'fehler') queueMicrotask(() => this.onerror?.());
        }
      }
      vi.stubGlobal('Image', FakeImage);
      return made;
    }

    /** Ein Canvas mit Zeichenfläche (`ctx`) oder ohne (`null`). */
    function stubCanvas(ctx: object | null) {
      vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as never);
      vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue(PNG);
    }
    const drawing = () => ({ fillStyle: '', fillRect: vi.fn(), drawImage: vi.fn() });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.restoreAllMocks();
    });

    it('a load error gives null', async () => {
      stubImage('fehler');
      stubCanvas(drawing());
      await expect(pageImage(SVG, 1000)).resolves.toBeNull();
    });

    it('the time limit gives null and stops the loading', async () => {
      const made = stubImage('nie');
      stubCanvas(drawing());
      await expect(pageImage(SVG, 20)).resolves.toBeNull();
      expect(made).toHaveLength(1);
      expect(made[0].src).toBe('');
    });

    it('a canvas without a 2d context gives null', async () => {
      stubImage('laedt');
      stubCanvas(null);
      await expect(pageImage(SVG, 1000)).resolves.toBeNull();
    });

    it('with decode the page is drawn only after decode, and a failing decode gives null', async () => {
      let finish: () => void = () => undefined;
      const ctx = drawing();
      // Ohne onload: Nur `decode` meldet, dass das Bild fertig ist.
      stubImage('nie', () => new Promise<void>((resolve) => (finish = resolve)));
      stubCanvas(ctx);
      const done = pageImage(SVG, 1000);
      await Promise.resolve();
      expect(ctx.drawImage).not.toHaveBeenCalled();
      finish();
      await expect(done).resolves.toBe('QUJD');
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);

      stubImage('nie', () => Promise.reject(new Error('kaputt')));
      await expect(pageImage(SVG, 1000)).resolves.toBeNull();
    });

    it('without decode the page is drawn after onload', async () => {
      const ctx = drawing();
      stubImage('laedt');
      stubCanvas(ctx);
      await expect(pageImage(SVG, 1000)).resolves.toBe('QUJD');
      expect(ctx.drawImage).toHaveBeenCalledTimes(1);
    });
  });
});
