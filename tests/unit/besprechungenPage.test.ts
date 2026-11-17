import { h, render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { SyncEngine } from '../../src/sync/engine';
import { BesprechungenPage } from '../../src/ui/BesprechungenPage';

// Die Liste der Besprechungen hängt nie beim Laden: Antwortet GitHub nicht, gilt das nach 30 Sekunden als fehlendes Netz.

const host = document.createElement('div');
document.body.appendChild(host);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  render(null, host);
  vi.useRealTimers();
});

test('a listing that never answers ends in the local meetings and the hint after 30 seconds', async () => {
  const engine = { localPaths: async () => ({ present: ['07 Anhänge/Notizbuch/2026/2026-10-29 1000 Nur hier S1.svg'], deleted: [] }) } as unknown as SyncEngine;
  const listDir = () => new Promise<never>(() => undefined);
  await act(() => {
    render(h(BesprechungenPage, { engine, listDir }), host);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(29_000);
  });
  expect(host.textContent).toContain('Besprechungen werden geladen');
  expect(host.querySelector('a')).toBeNull();

  await act(async () => {
    await vi.advanceTimersByTimeAsync(1_000);
  });
  expect(host.textContent).not.toContain('Besprechungen werden geladen');
  expect(host.querySelector('a')?.textContent).toBe('Do 29.10. · 10:00 · Nur hier');
  expect(host.querySelector('p[role="status"]')?.textContent).toBe('Ohne Netz siehst du nur die Besprechungen auf diesem Gerät.');
});
