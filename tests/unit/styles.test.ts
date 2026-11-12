import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Safari rechnet env() in einer eigenen CSS-Variablen als 0 (WebKit-Fehler 274773 und 213752), Chrome und Edge rechnen
// richtig. Eine Regel wie `--abstand: env(safe-area-inset-top)` wirkt darum am iPad nicht, obwohl sie am PC stimmt.
// env() gehört direkt in die Eigenschaft, die den Wert braucht.
describe('app.css', () => {
  it('nutzt env() nie in einer eigenen CSS-Variablen', () => {
    const css = readFileSync(resolve('src/ui/app.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const variablen = css.match(/--[\w-]+\s*:[^;}]*/g) ?? [];
    expect(variablen.filter((v) => v.includes('env('))).toEqual([]);
  });
});
