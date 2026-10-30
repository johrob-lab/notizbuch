/** So oft gleicht auch die Engine ab. */
const RETRY_MS = 180_000;

/**
 * Meldet `retry`, wenn ein neuer Versuch Sinn hat, eine Seite zu laden, die sich nicht laden ließ: Das Netz ist zurück
 * (`online`), die App kommt wieder in den Vordergrund, oder es sind drei Minuten vergangen. Gibt die Abmeldung zurück.
 */
export function retryCues(retry: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === 'visible') retry();
  };
  window.addEventListener('online', retry);
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(retry, RETRY_MS);
  return () => {
    window.removeEventListener('online', retry);
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(timer);
  };
}
