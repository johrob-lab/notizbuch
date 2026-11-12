import { render } from 'preact';
import { startAppUpdate } from './lib/appUpdate';
import { isHomeScreenApp } from './lib/homeScreen';
import { flushInkPrefs } from './ui/inkPrefs';
import { holdsDrafts } from './ui/pageSession';
import { App } from './ui/App';

// Als App vom Home-Bildschirm rückt app.css die Leiste oben unter den Glaseffekt von iPadOS (siehe homeScreen.ts).
if (isHomeScreenApp(window)) document.documentElement.classList.add('heimbildschirm');

// Die App registriert den Service Worker selbst und lädt eine neue Version in einem ruhigen Moment (siehe appUpdate.ts).
if (import.meta.env.PROD) {
  startAppUpdate(
    {
      sw: navigator.serviceWorker,
      target: window,
      doc: document,
      // Wie bei einem Textfeld mit Fokus: Striche, die nur im Arbeitsspeicher liegen (der Entwurf einer Seite, deren Datei noch
      // nicht gelesen ist), lassen sich vor dem Neuladen nicht speichern, also lädt die App nicht von selbst neu.
      editing: () => {
        if (holdsDrafts()) return true;
        const el = document.activeElement as HTMLElement | null;
        return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
      },
      reload: () => location.reload(),
      beforeReload: flushInkPrefs,
      now: () => Date.now(),
    },
    import.meta.env.BASE_URL + 'sw.js',
    import.meta.env.BASE_URL,
  );
}

render(<App />, document.getElementById('root')!);
