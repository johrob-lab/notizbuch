import { describe, expect, it } from 'vitest';
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
});
