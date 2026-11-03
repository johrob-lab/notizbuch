import { describe, expect, it } from 'vitest';
import { capturePointer, inside } from '../../src/ui/pointerBits';

const at = (clientX: number, clientY: number) => ({ clientX, clientY }) as PointerEvent;
const box = { left: 10, right: 50, top: 20, bottom: 60 };

describe('inside', () => {
  it('takes a rectangle, edges included', () => {
    expect(inside(at(10, 20), box)).toBe(true);
    expect(inside(at(50, 60), box)).toBe(true);
    expect(inside(at(51, 40), box)).toBe(false);
    expect(inside(at(30, 19), box)).toBe(false);
  });

  it('takes an element and uses its current box', () => {
    const el = { getBoundingClientRect: () => box } as unknown as Element;
    expect(inside(at(30, 40), el)).toBe(true);
    expect(inside(at(0, 0), el)).toBe(false);
  });
});

describe('capturePointer', () => {
  it('does not throw for a synthetic pointer without an active id', () => {
    const el = {
      setPointerCapture: () => {
        throw new Error('NotFoundError');
      },
    } as unknown as Element;
    expect(() => capturePointer(el, 7)).not.toThrow();
  });

  it('captures the pointer on the element', () => {
    const ids: number[] = [];
    const el = { setPointerCapture: (id: number) => ids.push(id) } as unknown as Element;
    capturePointer(el, 7);
    expect(ids).toEqual([7]);
  });
});
