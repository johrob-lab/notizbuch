// Läuft die App als App vom Home-Bildschirm (und nicht in einem Tab des Browsers)? Am iPad sagt das `navigator.standalone`,
// sonst die Darstellung `standalone` eines installierten Web-Apps. Die App setzt dann die Klasse `heimbildschirm` an <html>
// (siehe main.tsx), und app.css rückt die Leiste oben unter den Glaseffekt von iPadOS. Auch eine am PC installierte App
// zählt dazu, sie bekommt den kleinen Abstand ebenfalls, das schadet nicht.

export type HomeScreenWindow = {
  /** `standalone` gibt es nur in Safari am iPad und iPhone, darum steht es nicht im Typ `Navigator`. */
  navigator: object;
  matchMedia(query: string): { matches: boolean };
};

export function isHomeScreenApp(w: HomeScreenWindow): boolean {
  return (w.navigator as { standalone?: unknown }).standalone === true || w.matchMedia('(display-mode: standalone)').matches;
}
