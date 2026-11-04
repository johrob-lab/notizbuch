// Die Körnung des Bleistifts auf dem Bildschirm: eine Kachel aus Feldern, von denen jedes ganz deckt oder gar nicht. Die
// Fläche legt sie in Seitenkoordinaten, die Körnung liegt also fest auf der Seite und wandert beim Verschieben und Zoomen
// mit. Weil jedes Feld ganz oder gar nicht deckt, wird es dort, wo sich Stücke eines Strichs auf einer Ebene überlappen,
// nicht dunkler. In der Datei steht die Körnung als Filter (`svg.ts`). Reine Rechnung, ohne Bildschirm.

/** Startwerte der Körnung: Die Kachel hat `tile` mal `tile` Felder, der Anteil `cover` davon deckt, `seed` wählt welche. */
export const GRAIN = { tile: 64, cell: 0.8, cover: 0.75, seed: 7 }; // cell: Seiteneinheiten je Feld

/**
 * Ein Bleistiftstrich, der auf dem Bildschirm schmaler ist als so viele Bildpunkte, wird ohne Körnung gemalt, einfarbig: Ein
 * feiner Punkt fiele sonst ganz in ein Loch der Körnung und wäre nicht zu sehen. So schmal ist die Körnung ohnehin nicht zu erkennen.
 */
export const GRAIN_MIN_PX = 2;

/** Zufallszahlen von 0 bis unter 1, aus demselben `seed` immer dieselbe Folge (mulberry32). */
function randomFrom(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Die Maske der Kachel, zeilenweise `size` mal `size` Felder: 255 deckt, bei 0 scheint das Papier durch. Jedes Feld deckt
 * mit der Wahrscheinlichkeit `cover`, welche, bestimmt `seed`: Dieselben Angaben ergeben immer dieselbe Maske.
 */
export function grainMask(size: number, cover: number, seed: number): Uint8Array {
  const next = randomFrom(seed);
  const mask = new Uint8Array(size * size);
  for (let i = 0; i < mask.length; i++) mask[i] = next() < cover ? 255 : 0;
  return mask;
}
