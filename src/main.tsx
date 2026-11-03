import { render } from 'preact';
import { startAppUpdate } from './lib/appUpdate';
import { flushInkPrefs } from './ui/inkPrefs';
import { App } from './ui/App';

// Die App registriert den Service Worker selbst und lädt eine neue Version in einem ruhigen Moment (siehe appUpdate.ts).
if (import.meta.env.PROD) {
  startAppUpdate(
    {
      sw: navigator.serviceWorker,
      target: window,
      doc: document,
      reload: () => location.reload(),
      beforeReload: flushInkPrefs,
      now: () => Date.now(),
    },
    import.meta.env.BASE_URL + 'sw.js',
    import.meta.env.BASE_URL,
  );
}

render(<App />, document.getElementById('root')!);
