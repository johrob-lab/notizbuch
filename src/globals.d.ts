// Mit "moduleDetection": "force" ist auch diese Datei ein Modul, darum steht die Angabe in `declare global`.
declare global {
  /** Wann diese Version gebaut wurde (ISO-Zeit), von vite.config.ts eingesetzt. Die Einstellungen zeigen es an. */
  const __STAND__: string;
}

export {};
