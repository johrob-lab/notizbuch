// Neue Versionen der App holen und laden, ohne dass jemand etwas tun muss. Der Service Worker übernimmt sofort (siehe
// vite.config.ts), die Seite lädt aber erst in einem ruhigen Moment neu, damit kein Strich mitten im Schreiben verloren geht.

/** So oft fragt die App nach einer neuen Version. */
export const CHECK_EVERY_MS = 60 * 60 * 1000;
/** So lange muss die letzte Eingabe zurückliegen, damit die App neu laden darf. */
export const QUIET_MS = 60 * 1000;
/** So oft wird geprüft, ob es ruhig genug ist. */
export const QUIET_POLL_MS = 5 * 1000;

export type UpdateEnv = {
  sw:
    | {
        readonly controller: unknown;
        register(url: string, o: { scope: string }): Promise<{ update(): Promise<unknown> }>;
        addEventListener(type: 'controllerchange', fn: () => void): void;
      }
    | undefined;
  /** Hier kommen die Eingaben an (Zeiger und Tasten). */
  target: { addEventListener(type: string, fn: (e: Event) => void, o?: AddEventListenerOptions): void };
  doc: { readonly visibilityState: string; addEventListener(type: 'visibilitychange', fn: () => void): void };
  /** Ein Textfeld hat den Fokus: Ein Entwurf darin lässt sich nicht speichern, also lädt die App nicht von selbst neu. */
  editing(): boolean;
  reload(): void;
  /** Speichert, was noch aussteht, bevor die Seite neu lädt. */
  beforeReload(): Promise<void>;
  now(): number;
};

export type AppUpdate = {
  /** Fragt nach einer neuen Version. Wirft nie. */
  check(): Promise<void>;
  /** Lädt die App neu, nachdem `beforeReload` fertig ist (oder gescheitert). Nur einmal. */
  reloadNow(): Promise<void>;
  /** Eine neue Version ist aktiv, die Seite läuft aber noch mit der alten. */
  readonly ready: boolean;
  stop(): void;
};

let current: AppUpdate | undefined;

export function startAppUpdate(env: UpdateEnv, swUrl: string, scope: string): AppUpdate {
  let ready = false;
  let reloading = false;
  let stopped = false;
  let registration: { update(): Promise<unknown> } | undefined;
  const down = new Set<number>();
  let lastInput = env.now();
  let justShown = false;
  const timers: ReturnType<typeof setInterval>[] = [];

  const check = async (): Promise<void> => {
    if (stopped) return;
    try {
      await registration?.update();
    } catch {
      // kein Netz oder kein Service Worker: beim nächsten Mal wieder
    }
  };

  const reloadNow = async (): Promise<void> => {
    if (reloading) return;
    reloading = true;
    try {
      await env.beforeReload();
    } catch {
      // Ein Fehler beim Speichern hält das Neuladen nicht auf.
    }
    env.reload();
  };

  const quiet = (): boolean => {
    if (stopped || !ready || reloading || env.editing() || env.doc.visibilityState !== 'visible' || down.size > 0) return false;
    return justShown || env.now() - lastInput >= QUIET_MS;
  };
  const maybeReload = (): void => {
    if (quiet()) void reloadNow();
  };

  const sw = env.sw;
  if (sw) {
    const hadController = sw.controller != null;
    sw.addEventListener('controllerchange', () => {
      if (stopped || !hadController) return; // erstes Einrichten: nichts Neues zu laden
      ready = true;
      maybeReload();
    });
    sw.register(swUrl, { scope }).then(
      (r) => {
        registration = r;
      },
      () => undefined,
    );

    const touch = (): void => {
      if (stopped) return;
      lastInput = env.now();
    };
    env.target.addEventListener(
      'pointerdown',
      (e) => {
        if (stopped) return;
        down.add((e as PointerEvent).pointerId ?? 0);
        touch();
      },
      { capture: true },
    );
    for (const type of ['pointerup', 'pointercancel']) {
      env.target.addEventListener(
        type,
        (e) => {
          if (stopped) return;
          down.delete((e as PointerEvent).pointerId ?? 0);
          touch();
        },
        { capture: true },
      );
    }
    env.target.addEventListener('keydown', touch, { capture: true });
    env.target.addEventListener('wheel', touch, { capture: true });

    env.doc.addEventListener('visibilitychange', () => {
      if (stopped) return;
      if (env.doc.visibilityState !== 'visible') {
        justShown = false;
        down.clear(); // ein verlorenes pointerup darf das Neuladen nicht für immer sperren
        return;
      }
      justShown = true;
      void check();
      maybeReload();
      // Nur der Moment des Öffnens zählt als ruhig, danach gilt wieder die Pause seit der letzten Eingabe.
      setTimeout(() => {
        justShown = false;
      }, 0);
    });

    timers.push(setInterval(() => void check(), CHECK_EVERY_MS));
    timers.push(setInterval(maybeReload, QUIET_POLL_MS));
  }

  const instance: AppUpdate = {
    check,
    reloadNow,
    get ready() {
      return ready;
    },
    stop() {
      stopped = true;
      for (const t of timers) clearInterval(t);
      if (current === instance) current = undefined;
    },
  };
  current = instance;
  return instance;
}

/** Fragt nach einer neuen Version, wenn die App welche sucht. */
export function checkForUpdate(): void {
  void current?.check();
}

/** Lädt die App neu (nach dem Speichern der Stiftwahl). */
export function reloadApp(): void {
  if (current) void current.reloadNow();
  else location.reload();
}
