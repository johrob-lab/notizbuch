import { h, render } from 'preact';
import { afterEach, expect, test } from 'vitest';
import { MiniCalendar } from '../../src/ui/MiniCalendar';

// Die Karte „Kalender“: Tage mit Geburtstag bekommen die Klasse und den Namen im Label.

const host = document.createElement('div');
document.body.appendChild(host);

afterEach(() => {
  render(null, host);
});

test('days with a birthday get the class geburtstag and the name in their label', () => {
  render(h(MiniCalendar, { rect: [0, 0, 388, 256], day: '2026-10-29', today: '2026-10-29', termine: [], geburtstage: [{ date: '2026-10-28', name: 'Max Beispiel', art: 'Geburtstag' }] }), host);
  const day = host.querySelector('a[aria-label="Mi 28.10.2026, Geburtstag von Max Beispiel"]');
  expect(day?.classList.contains('geburtstag')).toBe(true);
  expect(host.querySelectorAll('a.geburtstag')).toHaveLength(1);
});
