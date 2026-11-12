import { expect, test } from 'vitest';
import { isHomeScreenApp } from '../../src/lib/homeScreen';

/** Ein Fenster, wie `isHomeScreenApp` es sieht: `standalone` gibt es nur am iPad und iPhone. */
function win(standalone: boolean | undefined, displayModeStandalone: boolean) {
  return {
    navigator: standalone === undefined ? {} : { standalone },
    matchMedia: (query: string) => ({ matches: displayModeStandalone && query === '(display-mode: standalone)' }),
  };
}

test('an app opened from the home screen of the iPad is a home screen app', () => {
  expect(isHomeScreenApp(win(true, false))).toBe(true);
  expect(isHomeScreenApp(win(true, true))).toBe(true);
});

test('an installed app without navigator.standalone counts by its display mode', () => {
  expect(isHomeScreenApp(win(undefined, true))).toBe(true);
});

test('a browser tab is no home screen app', () => {
  expect(isHomeScreenApp(win(undefined, false))).toBe(false);
  expect(isHomeScreenApp(win(false, false))).toBe(false);
});
