/**
 * Liest CSV mit Strichpunkt als Trenner. Anführungszeichen schützen Strichpunkt und Zeilenumbruch,
 * ein doppeltes Anführungszeichen darin ist ein einzelnes. Zeilenende CRLF oder LF, ein BOM am
 * Anfang fällt weg, eine letzte leere Zeile gibt keinen Datensatz. Wirft nie: Ein offenes
 * Anführungszeichen reicht bis zum Ende.
 */
export function parseCsv(text: string): string[][] {
  const s = text.startsWith('﻿') ? text.slice(1) : text;
  const zeilen: string[][] = [];
  let zeile: string[] = [];
  let wert = '';
  let inQuotes = false;
  let offen = false; // Es gibt etwas in der aktuellen Zeile, auch wenn es leer ist.

  const wertEnde = (): void => {
    zeile.push(wert);
    wert = '';
  };
  const zeileEnde = (): void => {
    wertEnde();
    zeilen.push(zeile);
    zeile = [];
    offen = false;
  };

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inQuotes) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          wert += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        wert += c;
      }
      continue;
    }
    offen = true;
    if (c === '"') inQuotes = true;
    else if (c === ';') wertEnde();
    else if (c === '\r') {
      if (s[i + 1] === '\n') i++;
      zeileEnde();
    } else if (c === '\n') zeileEnde();
    else wert += c;
  }
  if (offen || wert !== '' || inQuotes) zeileEnde();
  return zeilen;
}
