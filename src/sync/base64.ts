// Nur Web-APIs (TextEncoder, TextDecoder, btoa, atob), damit der Code in Safari und Edge läuft, ohne Node-Zusätze.
// Streng bei ungültigem UTF-8: Ersatzzeichen würden eine Datei beim Speichern still verändern.
// Aus demselben Grund bleibt ein BOM am Anfang (ignoreBOM) als erstes Zeichen U+FEFF im Text. Sonst fiele es beim
// Lesen weg und fehlte nach dem nächsten Speichern in der Datei.
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

// Soviele Bytes kommen auf einmal in String.fromCharCode. Mehr Argumente auf einmal sprengen in manchen Engines das Limit.
const CHUNK = 8192;

/** Text als UTF-8 in Base64. Auch mehrere MB große Texte gehen durch. */
export function utf8ToBase64(s: string): string {
  const bytes = encoder.encode(s);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK) {
    parts.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK)));
  }
  return btoa(parts.join(''));
}

/** Base64 als UTF-8-Text. Leerraum und Zeilenumbrüche, die GitHub einfügt, werden vorher entfernt. */
export function base64ToUtf8(b: string): string {
  const binary = atob(b.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return decoder.decode(bytes);
}

/**
 * Ist das der Fehler, den `base64ToUtf8` wirft, wenn die Bytes kein UTF-8 sind? Dann ist die Datei kaputt und bleibt es: Ein neuer
 * Versuch, sie zu lesen, ändert nichts. Jeder andere Fehler beim Lesen (Netz, Server) kann beim nächsten Mal gelingen.
 */
export function isNotUtf8(error: unknown): boolean {
  return error instanceof TypeError;
}
