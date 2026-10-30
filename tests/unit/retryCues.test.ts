import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { retryCues } from '../../src/ui/retryCues';

// Wann es Sinn hat, eine Seite noch einmal zu laden, die sich nicht laden ließ: Das Netz ist zurück, die App ist wieder
// zu sehen, oder es sind drei Minuten vergangen (so oft gleicht auch die Engine ab).

function setVisibility(state: 'hidden' | 'visible') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  delete (document as { visibilityState?: unknown }).visibilityState;
  vi.useRealTimers();
});

test('the network coming back is a cue', () => {
  const retry = vi.fn();
  const stop = retryCues(retry);
  window.dispatchEvent(new Event('online'));
  expect(retry).toHaveBeenCalledTimes(1);
  stop();
});

test('the app coming back to the front is a cue, going to the back is not', () => {
  const retry = vi.fn();
  const stop = retryCues(retry);
  setVisibility('hidden');
  expect(retry).not.toHaveBeenCalled();
  setVisibility('visible');
  expect(retry).toHaveBeenCalledTimes(1);
  stop();
});

test('every 3 minutes is a cue', () => {
  const retry = vi.fn();
  const stop = retryCues(retry);
  vi.advanceTimersByTime(179_999);
  expect(retry).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(retry).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(180_000);
  expect(retry).toHaveBeenCalledTimes(2);
  stop();
});

test('after signing off nothing is a cue any more', () => {
  const retry = vi.fn();
  const stop = retryCues(retry);
  stop();
  window.dispatchEvent(new Event('online'));
  setVisibility('visible');
  vi.advanceTimersByTime(600_000);
  expect(retry).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});
