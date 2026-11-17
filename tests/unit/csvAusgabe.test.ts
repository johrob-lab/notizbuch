// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { csvAusgeben } from '../../src/ui/csvAusgabe';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as unknown as Record<string, unknown>).canShare;
  delete (navigator as unknown as Record<string, unknown>).share;
});

function stubUrl() {
  URL.createObjectURL = vi.fn(() => 'blob:test');
  URL.revokeObjectURL = vi.fn();
}

test('sharing hands over a file with the exact bytes', async () => {
  const share = vi.fn(async (_data: ShareData) => undefined);
  Object.assign(navigator, { canShare: () => true, share });
  await csvAusgeben('﻿a;b\r\n', 'x.csv', 'teilen');
  expect(share).toHaveBeenCalledTimes(1);
  const files = share.mock.calls[0][0].files ?? [];
  expect(files).toHaveLength(1);
  expect(files[0].name).toBe('x.csv');
  expect([...new Uint8Array(await files[0].arrayBuffer())]).toEqual([0xef, 0xbb, 0xbf, 0x61, 0x3b, 0x62, 0x0d, 0x0a]);
});

test('without sharing the file is downloaded', async () => {
  stubUrl();
  const names: string[] = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    names.push(this.download);
  });
  await csvAusgeben('a', 'x.csv', 'teilen');
  expect(names).toEqual(['x.csv']);

  Object.assign(navigator, { canShare: () => true, share: vi.fn() });
  await csvAusgeben('a', 'x.csv', 'laden');
  expect(names).toEqual(['x.csv', 'x.csv']);
  expect((navigator as unknown as { share: ReturnType<typeof vi.fn> }).share).not.toHaveBeenCalled();
});
